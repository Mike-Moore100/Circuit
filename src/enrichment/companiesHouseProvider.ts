// Phase 1 — Companies House (UK) HTTP provider.
//
// Thin client around three endpoints we need:
//   GET /search/companies?q=...
//   GET /company/{number}
//   GET /company/{number}/officers
//
// Auth: HTTP Basic with the API key as username, empty password.
// Free tier: 600 requests / 5 minutes. The orchestrator paces calls;
// this provider only enforces a per-call timeout.
//
// Fails safely: if the key is empty, every method returns `null` and
// records the reason in the result. We never throw out of this module
// — the orchestrator owns the contract that registry enrichment must
// never block the pipeline.

import type {
  CompanyRegistryRecord,
  RegistryCompanyStatus,
  RegistryOfficer,
} from './companyRegistryTypes';

// Raw API shapes — only the fields we touch.
interface CompanySearchResponse {
  items?: Array<{
    company_number?: string;
    title?: string;
    company_status?: string;
    address_snippet?: string;
    company_type?: string;
    date_of_creation?: string;
  }>;
}

interface CompanyProfileResponse {
  company_number?: string;
  company_name?: string;
  company_status?: string;
  date_of_creation?: string;
  sic_codes?: string[];
  registered_office_address?: {
    locality?: string;
    region?: string;
    country?: string;
    postal_code?: string;
  };
  accounts?: {
    overdue?: boolean;
  };
  confirmation_statement?: {
    overdue?: boolean;
  };
}

interface OfficersResponse {
  items?: Array<{
    name?: string;
    officer_role?: string;
    appointed_on?: string;
    resigned_on?: string;
  }>;
}

export interface SearchHit {
  companyNumber: string;
  name: string;
  status: string | null;
  addressSnippet: string | null;
  incorporationDate: string | null;
}

export interface CompaniesHouseProviderConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface CompaniesHouseProvider {
  enabled: boolean;
  searchByName(name: string, limit?: number): Promise<SearchHit[]>;
  getProfile(companyNumber: string): Promise<CompanyProfileResponse | null>;
  getOfficers(companyNumber: string): Promise<RegistryOfficer[]>;
  // Composite: fetches profile + officers and folds them into a
  // canonical CompanyRegistryRecord. Returns null when the underlying
  // calls fail safely.
  buildRecord(companyNumber: string): Promise<CompanyRegistryRecord | null>;
  // Latest auth status — populated after the first call. The
  // orchestrator inspects this so it can distinguish "key is bad"
  // from "no match" and surface that to the operator.
  lastStatus: number | null;
  lastError: string | null;
}

const DEFAULT_BASE_URL = 'https://api.company-information.service.gov.uk';

export function createCompaniesHouseProvider(
  cfg: CompaniesHouseProviderConfig,
): CompaniesHouseProvider {
  const apiKey = (cfg.apiKey ?? '').trim();
  const baseUrl = cfg.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = cfg.timeoutMs ?? 8000;
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const enabled = apiKey.length > 0;

  // Mutable status — surfaced through `lastStatus` / `lastError` so the
  // orchestrator can distinguish "key is bad" (401/403) from "no match"
  // (200 with empty items[]).
  let lastStatus: number | null = null;
  let lastError: string | null = null;

  async function call<T>(path: string): Promise<T | null> {
    if (!enabled) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const auth = Buffer.from(`${apiKey}:`).toString('base64');
      const res = await fetchImpl(`${baseUrl}${path}`, {
        signal: controller.signal,
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
        },
      });
      lastStatus = res.status;
      if (!res.ok) {
        // Capture the auth-shape errors so the operator can act on them.
        if (res.status === 401 || res.status === 403) {
          lastError = `Companies House returned ${res.status} — check COMPANIES_HOUSE_API_KEY`;
        } else if (res.status === 429) {
          lastError = 'Companies House rate limit hit — slow down';
        } else {
          lastError = `Companies House HTTP ${res.status}`;
        }
        return null;
      }
      lastError = null;
      return (await res.json()) as T;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function searchByName(name: string, limit = 5): Promise<SearchHit[]> {
    if (!enabled || !name) return [];
    const q = encodeURIComponent(name);
    const payload = await call<CompanySearchResponse>(
      `/search/companies?q=${q}&items_per_page=${Math.max(1, Math.min(20, limit))}`,
    );
    if (!payload?.items) return [];
    return payload.items
      .filter((it) => typeof it.company_number === 'string' && typeof it.title === 'string')
      .map((it) => ({
        companyNumber: it.company_number!,
        name: it.title!,
        status: it.company_status ?? null,
        addressSnippet: it.address_snippet ?? null,
        incorporationDate: it.date_of_creation ?? null,
      }));
  }

  async function getProfile(
    companyNumber: string,
  ): Promise<CompanyProfileResponse | null> {
    if (!enabled || !companyNumber) return null;
    return call<CompanyProfileResponse>(`/company/${encodeURIComponent(companyNumber)}`);
  }

  async function getOfficers(companyNumber: string): Promise<RegistryOfficer[]> {
    if (!enabled || !companyNumber) return [];
    const payload = await call<OfficersResponse>(
      `/company/${encodeURIComponent(companyNumber)}/officers?items_per_page=20`,
    );
    if (!payload?.items) return [];
    return payload.items
      .filter((o) => typeof o.name === 'string')
      .map((o) => ({
        name: o.name!,
        role: o.officer_role ?? null,
        appointedOn: o.appointed_on ?? null,
        resignedOn: o.resigned_on ?? null,
        isActive: !o.resigned_on,
      }));
  }

  async function buildRecord(
    companyNumber: string,
  ): Promise<CompanyRegistryRecord | null> {
    const [profile, officers] = await Promise.all([
      getProfile(companyNumber),
      getOfficers(companyNumber),
    ]);
    if (!profile) return null;
    const filingsOverdue =
      profile.accounts?.overdue === true ||
      profile.confirmation_statement?.overdue === true;
    return {
      registryId: profile.company_number ?? companyNumber,
      registry: 'companies_house',
      companyName: profile.company_name ?? '',
      status: normaliseStatus(profile.company_status),
      incorporationDate: profile.date_of_creation ?? null,
      sicCodes: profile.sic_codes ?? [],
      registeredOfficeLocality: profile.registered_office_address?.locality ?? null,
      registeredOfficeCountry:
        profile.registered_office_address?.country ?? 'United Kingdom',
      officers,
      filingsCurrent: filingsOverdue ? false : profile.accounts ? true : null,
    };
  }

  return {
    enabled,
    searchByName,
    getProfile,
    getOfficers,
    buildRecord,
    get lastStatus() { return lastStatus; },
    get lastError() { return lastError; },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function normaliseStatus(raw: string | null | undefined): RegistryCompanyStatus {
  if (!raw) return 'unknown';
  const s = raw.toLowerCase().replace(/\s+/g, '-');
  if (s === 'active') return 'active';
  if (s === 'dissolved' || s === 'dissolved-on-companies-house') return 'dissolved';
  if (s.includes('liquidation')) return 'liquidation';
  if (s.includes('administration') || s.includes('receivership')) return 'administration';
  if (
    s === 'closed' ||
    s === 'inactive' ||
    s === 'converted-closed' ||
    s === 'voluntary-arrangement'
  ) {
    return 'inactive';
  }
  return 'unknown';
}
