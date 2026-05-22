// Side-effect import: loads .env into process.env before we read keys below.
// Must be the first import in this file so all subsequent reads see it.
import './loadEnv';
import path from 'node:path';

const projectRoot = process.cwd();

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envPath(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw && raw.length > 0 ? path.resolve(projectRoot, raw) : path.resolve(projectRoot, fallback);
}

export const config = {
  dbPath: envPath('CIRCUIT_DB_PATH', 'data/circuit.db'),
  outputDir: envPath('CIRCUIT_OUTPUT_DIR', 'data/outputs'),
  minReviewScore: envInt('CIRCUIT_MIN_REVIEW_SCORE', 60),

  googleMaps: {
    apiKey: process.env.GOOGLE_PLACES_API_KEY ?? '',
    maxSearchesPerRun: envInt('GOOGLE_MAPS_MAX_SEARCHES_PER_RUN', 20),
    maxResultsPerSearch: envInt('GOOGLE_MAPS_MAX_RESULTS_PER_SEARCH', 20),
    maxLeadsPerRun: envInt('GOOGLE_MAPS_MAX_LEADS_PER_RUN', 200),
    requestTimeoutMs: envInt('GOOGLE_MAPS_REQUEST_TIMEOUT_MS', 15000),
    // Set to "1" to force the mock provider even with an API key present.
    forceMock: process.env.GOOGLE_MAPS_FORCE_MOCK === '1',
  },

  aiAnalysis: {
    enabled: (process.env.AI_ANALYSIS_ENABLED ?? '1') !== '0',
    provider: (process.env.AI_ANALYSIS_PROVIDER ?? 'anthropic').toLowerCase(),
    model: process.env.AI_ANALYSIS_MODEL ?? 'claude-haiku-4-5-20251001',
    maxLeadsPerRun: envInt('AI_ANALYSIS_MAX_LEADS_PER_RUN', 10),
    allowedPriorities: (process.env.AI_ANALYSIS_ALLOWED_PRIORITIES ?? 'A')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean) as Array<'A' | 'B' | 'C'>,
    dailyCostLimitUsd: Number(process.env.AI_ANALYSIS_DAILY_COST_LIMIT_USD ?? '5'),
    maxInputChars: envInt('AI_ANALYSIS_MAX_INPUT_CHARS', 12000),
    apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.AI_PROVIDER_API_KEY ?? '',
    // Set to 1 to force the mock provider even when an API key is present.
    forceMock: process.env.AI_ANALYSIS_FORCE_MOCK === '1',
    maxOutputTokens: envInt('AI_ANALYSIS_MAX_OUTPUT_TOKENS', 1500),
    requestTimeoutMs: envInt('AI_ANALYSIS_REQUEST_TIMEOUT_MS', 30000),
  },

  intelligence: {
    enabled: (process.env.INTELLIGENCE_ENABLED ?? '1') !== '0',
  },

  // Phase 1 — Companies House (UK registry) enrichment. Strictly optional;
  // the pipeline never depends on it. Disabled by default so US-only
  // deployments don't make pointless calls. The provider also fails
  // safely if `apiKey` is empty — `enabled` is just a UX gate.
  companiesHouse: {
    enabled: (process.env.COMPANIES_HOUSE_ENABLED ?? '0') === '1',
    apiKey: process.env.COMPANIES_HOUSE_API_KEY ?? '',
    baseUrl:
      process.env.COMPANIES_HOUSE_BASE_URL ?? 'https://api.company-information.service.gov.uk',
    requestTimeoutMs: envInt('COMPANIES_HOUSE_REQUEST_TIMEOUT_MS', 8000),
    // Stale-after window for cached enrichments — re-fetch beyond this.
    // Companies House status can change (dissolution, name change),
    // but daily refresh is overkill; 30 days strikes a balance.
    cacheTtlDays: envInt('COMPANIES_HOUSE_CACHE_TTL_DAYS', 30),
    // Per-batch ceiling so a runaway enrichment loop can't burn the
    // 600 requests / 5 min free-tier rate limit.
    maxLeadsPerRun: envInt('COMPANIES_HOUSE_MAX_LEADS_PER_RUN', 50),
  },

  // FREE_SOURCE_MODE=1 → suppress paid sources during sourcing (e.g.
  // Google Places). The mock connector + any free sources remain
  // available, so the rest of the pipeline still has data to chew on.
  freeSourceMode: process.env.FREE_SOURCE_MODE === '1',

  // Phase 14.1 — data mode correctness.
  // DEMO_MODE=1 makes the dashboard include DEMO-origin companies in
  // addition to REAL ones. Default: REAL only.
  demoMode: process.env.DEMO_MODE === '1',
  // ALLOW_MOCK_DATA=1 is required before any mock seed / mock source
  // can run. Belt-and-braces so the operator never accidentally runs
  // the mock connector in production.
  allowMockData: process.env.ALLOW_MOCK_DATA === '1',

  evidence: {
    enabled: (process.env.EVIDENCE_ENABLED ?? '1') !== '0',
    autoRun: process.env.EVIDENCE_AUTO_RUN === '1',
    timeoutMs: envInt('EVIDENCE_TIMEOUT_MS', 25000),
    maxLeadsPerRun: envInt('EVIDENCE_MAX_LEADS_PER_RUN', 25),
    cacheTtlDays: envInt('EVIDENCE_CACHE_TTL_DAYS', 14),
    screenshotDir: envPath('EVIDENCE_SCREENSHOT_DIR', 'data/screenshots'),
    allowedCampaigns: (process.env.EVIDENCE_ALLOWED_CAMPAIGNS ?? 'AI_AUTOMATION,WEB_REBUILD,FUNNEL_OPTIMIZATION,LOCAL_DIGITAL_UPGRADE')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    allowedPriorities: (process.env.EVIDENCE_ALLOWED_PRIORITIES ?? 'A,B')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean) as Array<'A' | 'B' | 'C'>,
  },

  contactPlaywright: {
    enabled: (process.env.CONTACT_PLAYWRIGHT_FALLBACK_ENABLED ?? '1') !== '0',
    maxPagesPerCompany: envInt('CONTACT_PLAYWRIGHT_MAX_PAGES_PER_COMPANY', 3),
    timeoutMs: envInt('CONTACT_PLAYWRIGHT_TIMEOUT_MS', 12000),
  },

  contactDiscovery: {
    enabled: (process.env.CONTACT_DISCOVERY_ENABLED ?? '1') !== '0',
    maxPagesPerSite: envInt('CONTACT_DISCOVERY_MAX_PAGES_PER_SITE', 4),
    timeoutMs: envInt('CONTACT_DISCOVERY_TIMEOUT_MS', 10000),
    concurrency: envInt('CONTACT_DISCOVERY_CONCURRENCY', 4),
    userAgent:
      process.env.CONTACT_DISCOVERY_USER_AGENT ??
      'CircuitContacts/0.1 (+lead-research bot; non-commercial; respect robots)',
    // Allowed campaigns. Default narrows to non-REJECT.
    allowedCampaigns: (process.env.CONTACT_DISCOVERY_ALLOWED_CAMPAIGNS ?? 'AI_AUTOMATION,WEB_REBUILD,FUNNEL_OPTIMIZATION,LOCAL_DIGITAL_UPGRADE')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    allowedPriorities: (process.env.CONTACT_DISCOVERY_ALLOWED_PRIORITIES ?? 'A,B')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean) as Array<'A' | 'B' | 'C'>,
  },

  websiteInspection: {
    enabled: (process.env.WEBSITE_INSPECTION_ENABLED ?? '1') !== '0',
    timeoutMs: envInt('WEBSITE_INSPECTION_TIMEOUT_MS', 10000),
    maxPagesPerSite: envInt('WEBSITE_INSPECTION_MAX_PAGES_PER_SITE', 3),
    usePlaywright: process.env.WEBSITE_INSPECTION_USE_PLAYWRIGHT === '1',
    cacheTtlDays: envInt('WEBSITE_INSPECTION_CACHE_TTL_DAYS', 7),
    concurrency: envInt('WEBSITE_INSPECTION_CONCURRENCY', 4),
    userAgent:
      process.env.WEBSITE_INSPECTION_USER_AGENT ??
      'CircuitInspector/0.1 (+lead-research bot; non-commercial; respect robots)',
  },
} as const;

export type CircuitConfig = typeof config;
