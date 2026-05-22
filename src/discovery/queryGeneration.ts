// Phase 1 Discovery Diversity — query generation.
//
// Builds a deterministic, balanced (industry × city × modifier) query set
// from configurable pools. Every input that affects ordering is sorted
// first so two calls with the same config always produce the same plan.
//
// Three knobs control concentration:
//
//   - quotas      : per-industry max query count
//   - mix         : target weights across industries (0–1, sum ≤ 1.0)
//   - perCityCap  : optional ceiling on the same industry × city pair
//
// We deliberately keep this pure — no DB, no I/O. The discoveryDiversity
// module is the orchestrator that pulls corpus state in.

import type { DiscoveryQuery } from './discoveryTypes';

// ---------------------------------------------------------------------------
// Target pools — operational SMBs first; "peer" agencies (marketing, web,
// design) come last and carry hard caps elsewhere so they can't dominate.
// Adding new entries here makes them eligible for diversification
// immediately — no other planner changes required.
// ---------------------------------------------------------------------------
export const TARGET_INDUSTRIES = [
  // ---- Operational / admin-heavy SMBs (the priority pool) ----------
  'recruitment agency',
  'accountants',
  'bookkeeping services',
  'legal services',
  'conveyancing solicitors',
  'estate agents',
  'property management',
  'payroll services',
  'care agency',
  'cleaning services',
  'courier services',
  'logistics company',
  'trades services',
  'healthcare admin',
  'healthcare staffing agency',
  'consultants',
  // ---- Peer agencies — eligible but capped ------------------------
  'marketing agency',
  'web agency',
  'design studio',
] as const;

// Industry-specific query templates. Some industries read better with
// modifiers ("conveyancing solicitors" already implies a service).
// Operators can override per-industry via the QueryGenerationConfig.
const DEFAULT_INDUSTRY_TEMPLATES: Record<string, string> = {
  // Operational SMBs — prefer the phrasing that biases the SERP toward
  // independent local businesses rather than aggregator pages.
  accountants: 'chartered accountants %CITY%',
  'recruitment agency': 'recruitment agency %CITY%',
  'bookkeeping services': 'bookkeeping services %CITY%',
  'legal services': 'solicitors firm %CITY%',
  'conveyancing solicitors': 'conveyancing solicitors %CITY%',
  'estate agents': 'estate agents %CITY%',
  'property management': 'property management company %CITY%',
  'payroll services': 'payroll bureau %CITY%',
  'care agency': 'home care agency %CITY%',
  'cleaning services': 'commercial cleaning company %CITY%',
  'courier services': 'courier company %CITY%',
  'logistics company': 'logistics company %CITY%',
  'trades services': 'plumbing and heating company %CITY%',
  'healthcare admin': 'healthcare administration company %CITY%',
  'healthcare staffing agency': 'healthcare staffing agency %CITY%',
  consultants: 'management consultancy %CITY%',
  // Peer agencies — kept available, just last in priority.
  'marketing agency': 'marketing agency %CITY%',
  'web agency': 'web design agency %CITY%',
  'design studio': 'branding studio %CITY%',
};

export const DEFAULT_CITIES = [
  'London',
  'Manchester',
  'Birmingham',
  'Leeds',
  'Bristol',
  'Liverpool',
  'Glasgow',
  'Edinburgh',
  'Cardiff',
  'Newcastle',
] as const;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------
export interface QueryGenerationConfig {
  // Industries to draw from. Defaults to TARGET_INDUSTRIES.
  industries?: readonly string[];
  // Cities to pair with. Defaults to DEFAULT_CITIES.
  cities?: readonly string[];
  // Optional per-industry max query count. Industries not listed inherit
  // `defaultPerIndustry`.
  quotas?: Partial<Record<string, number>>;
  // Default per-industry quota when not specified in `quotas`.
  defaultPerIndustry?: number;
  // Ceiling on duplicate (industry × city) pairs. Defaults to 1 so we
  // never query the same pair twice in a single batch.
  perCityCap?: number;
  // Per-industry custom template ("%CITY%" placeholder). Falls back to
  // DEFAULT_INDUSTRY_TEMPLATES, then to "industry city".
  templates?: Partial<Record<string, string>>;
  // Total query cap across the batch — applied after per-industry quotas.
  totalCap?: number;
}

export interface GeneratedQuery extends DiscoveryQuery {
  // Concrete query string the connector will send. We compose it here so
  // tests can pin the exact wire form.
  queryString: string;
  // Source industry tag — survives through promotion so we can fill the
  // companies.industry column.
  industryTag: string;
  // Source city tag (canonical form) — same idea for location.
  cityTag: string;
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------
export function generateDiversifiedQueries(
  config: QueryGenerationConfig = {},
): GeneratedQuery[] {
  // Make all inputs deterministic before we iterate.
  const industries = [...(config.industries ?? TARGET_INDUSTRIES)]
    .map((i) => i.trim())
    .filter(Boolean)
    .sort();
  const cities = [...(config.cities ?? DEFAULT_CITIES)]
    .map((c) => c.trim())
    .filter(Boolean)
    .sort();
  if (industries.length === 0 || cities.length === 0) return [];

  const defaultPerIndustry = config.defaultPerIndustry ?? cities.length;
  const perCityCap = Math.max(1, config.perCityCap ?? 1);
  const totalCap = config.totalCap ?? Number.POSITIVE_INFINITY;

  // Round-robin pairing biases against any single industry running out of
  // cities before another one starts. We walk the industry list and pick
  // the next city in cycle, respecting both the per-industry quota and
  // the per-city-pair cap.
  const pairCount = new Map<string, number>(); // key = `${industry}|${city}`
  const industryCount = new Map<string, number>();
  const out: GeneratedQuery[] = [];

  // Each industry gets a city cursor we advance independently so two
  // industries don't both start at "London".
  const cursors = new Map<string, number>(industries.map((i, idx) => [i, idx % cities.length]));

  let safety = industries.length * cities.length * perCityCap * 2;
  while (out.length < totalCap && safety-- > 0) {
    let progressed = false;
    for (const industry of industries) {
      const quota = config.quotas?.[industry] ?? defaultPerIndustry;
      const used = industryCount.get(industry) ?? 0;
      if (used >= quota) continue;
      // Walk the city cursor until we find a pair under the cap.
      let attempts = cities.length;
      while (attempts-- > 0) {
        const cursor = cursors.get(industry) ?? 0;
        const city = cities[cursor];
        cursors.set(industry, (cursor + 1) % cities.length);
        const pairKey = `${industry}|${city}`;
        const pairUsed = pairCount.get(pairKey) ?? 0;
        if (pairUsed >= perCityCap) continue;
        pairCount.set(pairKey, pairUsed + 1);
        industryCount.set(industry, used + 1);
        out.push(buildQuery(industry, city, config));
        progressed = true;
        if (out.length >= totalCap) return out;
        break;
      }
    }
    if (!progressed) break; // every industry hit its quota
  }
  return out;
}

function buildQuery(
  industry: string,
  city: string,
  config: QueryGenerationConfig,
): GeneratedQuery {
  const template =
    config.templates?.[industry] ??
    DEFAULT_INDUSTRY_TEMPLATES[industry] ??
    `${industry} %CITY%`;
  const queryString = template.replace(/%CITY%/g, city).trim();
  return {
    industry,
    location: city,
    industryTag: industry,
    cityTag: city,
    queryString,
  };
}

// ---------------------------------------------------------------------------
// Helper: distribute a fixed total query budget across industries using a
// weight mix. Always returns integers that sum to <= total. Industries
// with zero weight get zero queries.
// ---------------------------------------------------------------------------
export function distributeQuota(
  total: number,
  mix: Record<string, number>,
): Record<string, number> {
  const weightSum = Object.values(mix).reduce((s, w) => s + Math.max(0, w), 0);
  if (weightSum <= 0 || total <= 0) {
    const empty: Record<string, number> = {};
    for (const k of Object.keys(mix)) empty[k] = 0;
    return empty;
  }
  // Floor allocate first, then distribute the remainder by descending
  // fractional part — keeps the result deterministic and balanced.
  const raw: Array<{ key: string; ideal: number; floor: number }> = [];
  let assigned = 0;
  for (const [key, w] of Object.entries(mix)) {
    const ideal = total * (Math.max(0, w) / weightSum);
    const floor = Math.floor(ideal);
    raw.push({ key, ideal, floor });
    assigned += floor;
  }
  raw.sort((a, b) => {
    const fa = a.ideal - a.floor;
    const fb = b.ideal - b.floor;
    if (fb !== fa) return fb - fa;
    return a.key.localeCompare(b.key);
  });
  let remainder = total - assigned;
  for (const item of raw) {
    if (remainder <= 0) break;
    item.floor += 1;
    remainder -= 1;
  }
  const out: Record<string, number> = {};
  for (const item of raw) out[item.key] = item.floor;
  return out;
}
