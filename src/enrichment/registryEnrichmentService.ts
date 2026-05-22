// Phase 1 — registry enrichment orchestrator.
//
// Decides UK vs non-UK, calls the Companies House provider for UK
// candidates only, derives operator-scannable signals, persists the
// result. Strictly enrichment: every code path returns a structured
// result, never throws into the pipeline.
//
// UK detection is intentionally conservative — we only enrich when at
// least ONE of the following is true:
//   - companies.discovery_location matches a known UK city / county
//   - companies.location ditto
//   - the domain TLD is .uk / .co.uk / .org.uk
// Anything else short-circuits with `skipped_non_uk` so US discovery
// stays cheap.

import type { Database } from 'better-sqlite3';
import { config } from '../config/index';
import { getDb } from '../db/client';
import {
  getRegistryEnrichment,
  upsertRegistryEnrichment,
} from '../db/repository';
import {
  createCompaniesHouseProvider,
  type CompaniesHouseProvider,
} from './companiesHouseProvider';
import type {
  CompanyRegistryRecord,
  LegitimacyConfidence,
  RegistryEnrichmentResult,
  RegistryEnrichmentSignals,
} from './companyRegistryTypes';

// ---------------------------------------------------------------------------
// UK detection
// ---------------------------------------------------------------------------
// Cheap, deterministic. We only need to know "is this lead UK-shaped"
// not "what country exactly". When ambiguous, we skip to keep US runs
// cheap. Operators can force enrichment for a specific lead via the
// `force` option on `enrichCompany` (used by /debug:registry --force).
const UK_TLDS = new Set([
  'uk', 'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'gov.uk',
]);

const UK_CITIES = new Set([
  'london', 'manchester', 'birmingham', 'leeds', 'liverpool', 'bristol',
  'glasgow', 'edinburgh', 'cardiff', 'newcastle', 'sheffield', 'nottingham',
  'leicester', 'coventry', 'bradford', 'oxford', 'cambridge', 'brighton',
  'reading', 'southampton', 'portsmouth', 'derby', 'stoke', 'plymouth',
  'aberdeen', 'belfast', 'swansea', 'sunderland',
]);

export interface UkDetectionInputs {
  domain: string | null;
  location: string | null;
  discoveryLocation: string | null;
  registeredOfficeCountry?: string | null;
}

export interface UkDetectionResult {
  isUk: boolean;
  reason: string;
}

export function detectUkContext(inputs: UkDetectionInputs): UkDetectionResult {
  const { domain, location, discoveryLocation, registeredOfficeCountry } = inputs;

  if (registeredOfficeCountry && /united\s*kingdom|^uk$|england|scotland|wales|northern\s*ireland/i.test(registeredOfficeCountry)) {
    return { isUk: true, reason: 'registered office country' };
  }
  if (domain) {
    const lower = domain.toLowerCase();
    for (const tld of UK_TLDS) {
      if (lower.endsWith(`.${tld}`)) return { isUk: true, reason: `domain .${tld}` };
    }
  }
  for (const candidate of [discoveryLocation, location]) {
    if (!candidate) continue;
    const lower = candidate.toLowerCase().trim();
    if (UK_CITIES.has(lower)) return { isUk: true, reason: `location ${candidate}` };
    if (/united\s*kingdom|\buk\b|england|scotland|wales/i.test(candidate)) {
      return { isUk: true, reason: `location text "${candidate}"` };
    }
  }
  return { isUk: false, reason: 'no UK indicator on lead' };
}

// ---------------------------------------------------------------------------
// Match scoring — given a search hit list, pick the best match against
// the lead's name. Conservative: name token overlap + city match.
// We won't enrich at all if the best match is below a threshold.
// ---------------------------------------------------------------------------
function nameTokenScore(needle: string, hay: string): number {
  const aTokens = tokens(needle);
  const bTokens = tokens(hay);
  if (aTokens.length === 0 || bTokens.length === 0) return 0;
  const aSet = new Set(aTokens);
  let matched = 0;
  for (const t of bTokens) if (aSet.has(t)) matched += 1;
  return matched / Math.max(aTokens.length, bTokens.length);
}

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_TOKENS.has(t));
}

const STOP_TOKENS = new Set([
  'ltd', 'limited', 'llp', 'plc', 'company', 'co', 'the',
  'and', 'of', 'group', 'services',
]);

// ---------------------------------------------------------------------------
// Derived signals — pure function over the canonical record.
// ---------------------------------------------------------------------------
export function deriveSignals(
  record: CompanyRegistryRecord,
  now: Date = new Date(),
): RegistryEnrichmentSignals {
  const incorporation = record.incorporationDate
    ? new Date(record.incorporationDate)
    : null;
  let ageYears: number | null = null;
  if (incorporation && !Number.isNaN(incorporation.getTime())) {
    ageYears = (now.getTime() - incorporation.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    ageYears = Math.round(ageYears * 10) / 10;
  }
  const directorsFound = record.officers.filter(
    (o) => o.isActive && /director|secretary|partner|member/i.test(o.role ?? ''),
  ).length;
  const isActive = record.status === 'active';

  const notes: string[] = [];
  if (record.status === 'active') notes.push('Active on the UK register');
  else if (record.status === 'dissolved') notes.push('Dissolved — likely not a live business');
  else if (record.status === 'liquidation') notes.push('In liquidation — high commercial risk');
  else if (record.status === 'administration') notes.push('In administration — contact cautiously');
  else if (record.status === 'inactive') notes.push('Marked inactive on the register');

  if (ageYears !== null) {
    if (ageYears >= 10) notes.push(`Established ${ageYears.toFixed(1)} years`);
    else if (ageYears >= 3) notes.push(`Operating ${ageYears.toFixed(1)} years`);
    else if (ageYears >= 1) notes.push(`Young company (${ageYears.toFixed(1)} years)`);
    else notes.push('Newly incorporated (< 1 year)');
  }
  if (directorsFound > 0) {
    notes.push(`${directorsFound} active director${directorsFound === 1 ? '' : 's'}`);
  }
  if (record.filingsCurrent === false) {
    notes.push('Filings overdue at Companies House');
  }
  if (record.sicCodes.length > 0) {
    notes.push(`SIC ${record.sicCodes.slice(0, 3).join(', ')}`);
  }

  return {
    isUkCompany: true,
    isActive,
    companyAgeYears: ageYears,
    sicCodes: record.sicCodes,
    directorsFound,
    legitimacyConfidence: legitimacyConfidence(record, ageYears, directorsFound),
    notes,
  };
}

function legitimacyConfidence(
  record: CompanyRegistryRecord,
  ageYears: number | null,
  directors: number,
): LegitimacyConfidence {
  // Hard floor — anything not actively trading is low confidence.
  if (record.status === 'dissolved' || record.status === 'liquidation' || record.status === 'administration') {
    return 'low';
  }
  if (record.status !== 'active') return 'low';
  // Active + filings current + mature + directors = high.
  if (record.filingsCurrent === false) return 'medium';
  const hasMaturity = (ageYears ?? 0) >= 3;
  const hasDirectors = directors >= 1;
  if (hasMaturity && hasDirectors) return 'high';
  if (hasMaturity || hasDirectors) return 'medium';
  return 'low';
}

// ---------------------------------------------------------------------------
// Public orchestrator
// ---------------------------------------------------------------------------
export interface RegistryEnrichmentServiceConfig {
  // The provider to use. The default is a Companies House provider
  // configured from `config.companiesHouse` — tests inject a fake here.
  provider?: CompaniesHouseProvider;
  // Optional override for the cache TTL (days).
  cacheTtlDays?: number;
  // Operator-supplied "now" — useful in tests so age calcs are stable.
  now?: () => Date;
  // DB injection point.
  db?: Database;
  // Test override for the global "enabled" gate. When undefined we
  // fall back to config.companiesHouse.enabled which is evaluated at
  // module load.
  enabled?: boolean;
}

export interface EnrichCompanyInput {
  companyId: string;
  name: string;
  domain: string | null;
  location: string | null;
  discoveryLocation: string | null;
  // Set to true to bypass UK detection (e.g. operator forced it).
  force?: boolean;
}

export class RegistryEnrichmentService {
  private readonly provider: CompaniesHouseProvider;
  private readonly cacheTtlDays: number;
  private readonly now: () => Date;
  private readonly db: Database | undefined;
  private readonly enabled: boolean;

  constructor(cfg: RegistryEnrichmentServiceConfig = {}) {
    this.provider =
      cfg.provider ??
      createCompaniesHouseProvider({
        apiKey: config.companiesHouse.apiKey,
        baseUrl: config.companiesHouse.baseUrl,
        timeoutMs: config.companiesHouse.requestTimeoutMs,
      });
    this.cacheTtlDays = cfg.cacheTtlDays ?? config.companiesHouse.cacheTtlDays;
    this.now = cfg.now ?? (() => new Date());
    this.db = cfg.db;
    this.enabled = cfg.enabled ?? config.companiesHouse.enabled;
  }

  async enrichCompany(input: EnrichCompanyInput): Promise<RegistryEnrichmentResult> {
    const db = this.db ?? getDb();
    const nowIso = this.now().toISOString();

    if (!this.enabled) {
      const result = this.persist(db, input.companyId, {
        outcome: 'skipped_disabled',
        reason: 'COMPANIES_HOUSE_ENABLED=0 — registry enrichment is off',
        registry: null,
        record: null,
        signals: null,
        fetchedAt: nowIso,
      });
      return { ...result, companyId: input.companyId };
    }
    if (!this.provider.enabled) {
      const result = this.persist(db, input.companyId, {
        outcome: 'skipped_no_key',
        reason: 'COMPANIES_HOUSE_API_KEY missing — failed safe',
        registry: null,
        record: null,
        signals: null,
        fetchedAt: nowIso,
      });
      return { ...result, companyId: input.companyId };
    }

    // UK gating (force overrides)
    const detection = detectUkContext({
      domain: input.domain,
      location: input.location,
      discoveryLocation: input.discoveryLocation,
    });
    if (!detection.isUk && !input.force) {
      const result = this.persist(db, input.companyId, {
        outcome: 'skipped_non_uk',
        reason: detection.reason,
        registry: null,
        record: null,
        signals: null,
        fetchedAt: nowIso,
      });
      return { ...result, companyId: input.companyId };
    }

    // Cache check — only return cached if it's still fresh.
    const cached = getRegistryEnrichment(input.companyId, db);
    if (cached && this.isFresh(cached.fetched_at) && cached.outcome === 'enriched') {
      return rehydrate(input.companyId, cached);
    }

    // Search → pick best match → fetch full record. We try a few name
    // variants in priority order — SERP titles are noisy ("Home",
    // "29 Best Accountants in Birmingham", "Brandnation: Creative...")
    // so we strip suffixes and fall back to the domain root.
    const candidates = nameCandidates(input.name, input.domain);
    let hits: Awaited<ReturnType<CompaniesHouseProvider['searchByName']>> = [];
    let queryUsed = candidates[0];
    let best: { companyNumber: string; name: string } | null = null;
    for (const candidate of candidates) {
      const tryHits = await this.provider.searchByName(candidate, 5);
      if (tryHits.length === 0) continue;
      const tryBest = pickBestMatch(candidate, tryHits);
      if (tryBest) {
        hits = tryHits;
        queryUsed = candidate;
        best = tryBest;
        break;
      }
      // Keep these around for the diagnostic if no candidate matches.
      if (hits.length === 0) {
        hits = tryHits;
        queryUsed = candidate;
      }
    }
    if (hits.length === 0) {
      // Distinguish "API auth failed" from "genuine no-match". The
      // provider tracks the last HTTP status; 401/403 always means the
      // key is wrong, NEVER a missing company.
      if (this.provider.lastStatus === 401 || this.provider.lastStatus === 403) {
        const result = this.persist(db, input.companyId, {
          outcome: 'error',
          reason:
            this.provider.lastError ??
            `Companies House auth rejected (${this.provider.lastStatus})`,
          registry: 'companies_house',
          record: null,
          signals: null,
          fetchedAt: nowIso,
        });
        return { ...result, companyId: input.companyId };
      }
      const result = this.persist(db, input.companyId, {
        outcome: 'skipped_no_match',
        reason: `No match in Companies House search (tried: ${candidates.slice(0, 3).join(' | ')})`,
        registry: 'companies_house',
        record: null,
        signals: null,
        fetchedAt: nowIso,
      });
      return { ...result, companyId: input.companyId };
    }
    if (!best) {
      const result = this.persist(db, input.companyId, {
        outcome: 'skipped_no_match',
        reason: `Search returned ${hits.length} hits for "${queryUsed}" but none scored above the match threshold`,
        registry: 'companies_house',
        record: null,
        signals: null,
        fetchedAt: nowIso,
      });
      return { ...result, companyId: input.companyId };
    }

    const record = await this.provider.buildRecord(best.companyNumber);
    if (!record) {
      const result = this.persist(db, input.companyId, {
        outcome: 'error',
        reason: `Could not fetch profile for ${best.companyNumber}`,
        registry: 'companies_house',
        record: null,
        signals: null,
        fetchedAt: nowIso,
      });
      return { ...result, companyId: input.companyId };
    }

    const signals = deriveSignals(record, this.now());
    const result = this.persist(db, input.companyId, {
      outcome: 'enriched',
      reason: `Matched ${record.companyName} (${record.registryId})`,
      registry: 'companies_house',
      record,
      signals,
      fetchedAt: nowIso,
    });
    return { ...result, companyId: input.companyId };
  }

  private persist(
    db: Database,
    companyId: string,
    fields: Omit<RegistryEnrichmentResult, 'companyId'>,
  ): Omit<RegistryEnrichmentResult, 'companyId'> {
    upsertRegistryEnrichment(
      {
        companyId,
        registry: fields.registry,
        outcome: fields.outcome,
        recordJson: fields.record ? JSON.stringify(fields.record) : null,
        signalsJson: fields.signals ? JSON.stringify(fields.signals) : null,
        reason: fields.reason,
        fetchedAt: fields.fetchedAt,
      },
      db,
    );
    return fields;
  }

  private isFresh(fetchedAt: string): boolean {
    const fetched = new Date(fetchedAt).getTime();
    if (Number.isNaN(fetched)) return false;
    const ageMs = this.now().getTime() - fetched;
    return ageMs < this.cacheTtlDays * 24 * 60 * 60 * 1000;
  }
}

// SERP-derived names are noisy. We try in priority order:
//   1. cleaned-up version of the captured name (strip " — Foo", "Home", etc.)
//   2. the original name verbatim
//   3. the domain root ("brandnation.co.uk" → "brandnation")
// First non-empty, deduped, lowercased.
export function nameCandidates(
  name: string,
  domain: string | null,
): string[] {
  const out: string[] = [];
  const push = (s: string | null) => {
    if (!s) return;
    const trimmed = s.trim();
    if (!trimmed) return;
    if (!out.some((x) => x.toLowerCase() === trimmed.toLowerCase())) {
      out.push(trimmed);
    }
  };

  // Cleaning pass — strip everything after a separator that usually
  // marks a tagline ("Brandnation: Creative…" → "Brandnation").
  const cleaned = name
    .replace(/[\s—\-–|:]+(?:creative|the\s|leading|best|top|home|welcome|specialists?|services?).*$/i, '')
    .replace(/^\s*\d+\s+(?:best|top|leading)\s+/i, '')
    .replace(/^welcome\s+to\s+/i, '')
    .replace(/[—–\-:|]\s.*$/, '') // any suffix after a long-dash, colon, pipe
    .trim();
  if (cleaned !== name && cleaned.length > 1) push(cleaned);

  push(name);

  if (domain) {
    const root = domain.replace(/^www\./, '').split('.')[0];
    if (root && root.length > 2) push(root);
  }
  return out;
}

function pickBestMatch(
  needle: string,
  hits: Array<{ companyNumber: string; name: string }>,
): { companyNumber: string; name: string } | null {
  let best: { score: number; hit: { companyNumber: string; name: string } } | null = null;
  for (const hit of hits) {
    const score = nameTokenScore(needle, hit.name);
    if (!best || score > best.score) best = { score, hit };
  }
  // Require at least 50% token overlap. Lower than that almost always
  // pulls in coincidental matches we don't want.
  if (!best || best.score < 0.5) return null;
  return best.hit;
}

function rehydrate(
  companyId: string,
  row: { registry: string | null; outcome: string; record_json: string | null; signals_json: string | null; reason: string; fetched_at: string },
): RegistryEnrichmentResult {
  let record: CompanyRegistryRecord | null = null;
  let signals: RegistryEnrichmentSignals | null = null;
  try { record = row.record_json ? (JSON.parse(row.record_json) as CompanyRegistryRecord) : null; } catch { /* tolerate */ }
  try { signals = row.signals_json ? (JSON.parse(row.signals_json) as RegistryEnrichmentSignals) : null; } catch { /* tolerate */ }
  return {
    companyId,
    registry: (row.registry as RegistryEnrichmentResult['registry']) ?? null,
    outcome: 'skipped_cache_hit_fresh',
    record,
    signals,
    reason: `Cache hit — ${row.reason}`,
    fetchedAt: row.fetched_at,
  };
}
