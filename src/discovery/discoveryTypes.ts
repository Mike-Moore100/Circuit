// Phase 11 — massive cheap discovery layer.
//
// Architecture rule: discovery is decoupled from qualification. This layer
// produces a high-volume stream of "we found a business" rows; the deeper
// pipeline (inspection → contacts → evidence → intelligence) only runs
// over the validated, de-duplicated subset that gets promoted to companies.
//
// No AI here. No Playwright. No paid enrichment unless FREE_SOURCE_MODE=0
// AND the operator explicitly turns it on.

export type ValidationStatus =
  | 'pending'
  | 'valid'
  | 'invalid'
  | 'duplicate';

// What a discovery source produces. Same shape regardless of provider so the
// scheduler / deduper / validator are source-agnostic.
export interface RawDiscovery {
  // Stable provider identifier — e.g. 'serp.duckduckgo', 'directory.yell'.
  source: string;
  businessName: string;
  rawUrl: string;
  // Filled by domainExtraction.ts. null if the URL is unparseable.
  extractedDomain: string | null;
  title: string | null;
  snippet: string | null;
  // Best-effort, may be null. Lifted from snippet or directory metadata.
  location: string | null;
  phone: string | null;
  discoveredAt: string;
  validationStatus: ValidationStatus;
  validationReason: string | null;
}

export interface DiscoveryQuery {
  // Free-form keyword (industry term). e.g. "marketing agency".
  industry: string;
  // Free-form geo term. e.g. "Manchester".
  location: string;
  // Optional extra modifiers tacked onto the query string.
  modifiers?: string[];
}

export interface SearchOptions {
  maxResults?: number;
  timeoutMs?: number;
  userAgent?: string;
  // Injection point — tests pass a fake fetch so we never hit the network.
  fetchImpl?: typeof fetch;
}

// Every discovery provider implements this. Free providers (DuckDuckGo HTML,
// public directories) are usable in FREE_SOURCE_MODE; paid providers
// (SerpAPI, Bright Data, etc.) declare `isFree: false` and the scheduler
// skips them when free-mode is on.
export interface DiscoverySourceConnector {
  name: string;
  isFree: boolean;
  search(query: DiscoveryQuery, options?: SearchOptions): Promise<RawDiscovery[]>;
}

// Persisted discovery run aggregate. Mirrors the discovery_runs DB row.
export interface DiscoveryRunSummary {
  id: string;
  source: string;
  startedAt: string;
  completedAt: string | null;
  rawFound: number;
  validDomains: number;
  deduped: number;
  rejected: number;
  errors: string[];
}
