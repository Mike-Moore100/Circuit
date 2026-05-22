// Phase 1 — Companies House (UK) enrichment types.
//
// Shape designed to be registry-agnostic so we can add other public
// registries later (OpenCorporates, Irish CRO, etc.) without changing
// the consumer side. Today only Companies House writes through this
// pipe.
//
// IMPORTANT: this is enrichment, not discovery. The dashboard and
// scoring layers should treat the absence of a registry record as
// "we don't know yet", never as a negative signal.

export type RegistryName = 'companies_house';

// Canonical company status, normalised across registries.
export type RegistryCompanyStatus =
  | 'active'
  | 'dissolved'
  | 'liquidation'
  | 'administration'
  | 'inactive'
  | 'unknown';

export type LegitimacyConfidence = 'high' | 'medium' | 'low';

export interface RegistryOfficer {
  name: string;
  role: string | null;
  appointedOn: string | null; // ISO YYYY-MM-DD
  resignedOn: string | null;
  isActive: boolean;
}

export interface CompanyRegistryRecord {
  // Companies House issues an 8-char alphanumeric — we keep it as a
  // string to stay registry-agnostic.
  registryId: string;
  registry: RegistryName;
  companyName: string;
  status: RegistryCompanyStatus;
  // ISO date or null when the registry doesn't expose it.
  incorporationDate: string | null;
  sicCodes: string[];
  registeredOfficeLocality: string | null;
  registeredOfficeCountry: string | null;
  officers: RegistryOfficer[];
  // null when the registry doesn't surface filings status, false when
  // it does and we're behind, true when up to date.
  filingsCurrent: boolean | null;
}

// What the orchestrator returns to callers. Mostly the derived signals
// the dashboard + downstream layers consume; the full record stays
// available for debugging.
export interface RegistryEnrichmentSignals {
  isUkCompany: boolean;
  isActive: boolean;
  companyAgeYears: number | null;
  sicCodes: string[];
  directorsFound: number;
  legitimacyConfidence: LegitimacyConfidence;
  // Operator-scannable strings to surface on the lead drawer.
  notes: string[];
}

export type EnrichmentOutcome =
  | 'enriched'
  | 'skipped_non_uk'
  | 'skipped_no_key'
  | 'skipped_disabled'
  | 'skipped_no_match'
  | 'skipped_cache_hit_fresh'
  | 'error';

export interface RegistryEnrichmentResult {
  companyId: string;
  registry: RegistryName | null;
  outcome: EnrichmentOutcome;
  record: CompanyRegistryRecord | null;
  signals: RegistryEnrichmentSignals | null;
  reason: string;
  fetchedAt: string;
}

// Shape stored in the cache table. `record_json` and `signals_json` are
// stringified for storage; the service deserialises on read.
export interface RegistryEnrichmentRow {
  company_id: string;
  registry: string | null;
  outcome: string;
  record_json: string | null;
  signals_json: string | null;
  reason: string;
  fetched_at: string;
}
