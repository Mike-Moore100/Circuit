// Phase 1 — industry normalisation.
//
// Maps the messy industry strings that flow through discovery
// ("recruiters", "Staffing Agency", "Solicitor", "Bookkeeping",
// "Digital Marketing", etc.) onto a small, stable canonical set so
// every downstream layer (corpus health, scoring, dashboards) reads
// the same labels.
//
// Pure function — no I/O, no DB. Tested in isolation.
//
// Canonical labels intentionally match what queryGeneration /
// industryBalancing already use, so existing target pools light up
// the moment we start writing normalised values.

// ---------------------------------------------------------------------------
// The canonical set
// ---------------------------------------------------------------------------
export const CANONICAL_INDUSTRIES = [
  'accountants',
  'recruitment agency',
  'legal services',
  'estate agents',
  'property management',
  'consultants',
  'bookkeeping services',
  'healthcare admin',
  'healthcare staffing agency',
  'logistics company',
  'payroll services',
  'conveyancing solicitors',
  'marketing agency',
  'web agency',
  'design studio',
] as const;

export type CanonicalIndustry = (typeof CANONICAL_INDUSTRIES)[number];

export type InferenceSource =
  | 'query'      // came from the discovery query industry tag
  | 'title'     // matched against SERP title
  | 'snippet'   // matched against SERP snippet text
  | 'website'   // matched against fetched website text
  | 'name';     // matched against captured business name

export interface NormalizationResult {
  // null when nothing matched. The caller decides whether to fall
  // back to "(unknown)" — we never invent a label.
  industry: CanonicalIndustry | null;
  // 0–100. Higher = stronger evidence. Used by the backfill to record
  // *how* confident we are when we tag a row.
  confidence: number;
  // Which rule fired. Useful in tests + the debug surface.
  matchedRule: string | null;
  // Which input field gave us the match.
  source: InferenceSource | null;
}

// ---------------------------------------------------------------------------
// Rule table — order matters. The first regex that matches wins, so put
// the *most specific* rules first ("conveyancing solicitors" before
// "legal services"; "healthcare staffing" before "recruitment agency").
//
// Confidence here is the rule's default — the caller can apply
// per-source dampening (e.g. a website match is less trustworthy than
// a query tag).
// ---------------------------------------------------------------------------
interface Rule {
  industry: CanonicalIndustry;
  pattern: RegExp;
  rule: string;
  baseConfidence: number;
}

const RULES: Rule[] = [
  // ---- the brief's specific examples come first --------------------
  {
    industry: 'conveyancing solicitors',
    pattern: /\bconveyanc(ing|er|y)\b/i,
    rule: 'conveyancing',
    baseConfidence: 95,
  },
  {
    industry: 'healthcare staffing agency',
    pattern: /\b(healthcare|medical|nursing|nurse|locum|clinical)\s+(staffing|recruitment|agency)/i,
    rule: 'healthcare_staffing',
    baseConfidence: 95,
  },
  {
    industry: 'healthcare admin',
    pattern: /\b(healthcare\s+admin|medical\s+admin|clinic\s+management|gp\s+practice\s+management)\b/i,
    rule: 'healthcare_admin',
    baseConfidence: 90,
  },
  {
    industry: 'payroll services',
    pattern: /\bpayroll\b/i,
    rule: 'payroll',
    baseConfidence: 92,
  },
  {
    industry: 'bookkeeping services',
    pattern: /\bbook[\s-]?keep(ing|er|ers)?\b/i,
    rule: 'bookkeeping',
    baseConfidence: 92,
  },
  {
    industry: 'accountants',
    // covers "accountant", "accountants", "accountancy", "chartered accountants"
    pattern: /\b(chartered\s+)?accountan(t|ts|cy)\b/i,
    rule: 'accountants',
    baseConfidence: 92,
  },
  {
    industry: 'property management',
    pattern: /\b(property|building|block)\s+(management|managers)\b/i,
    rule: 'property_management',
    baseConfidence: 92,
  },
  {
    industry: 'estate agents',
    pattern: /\b(estate\s+agents?|lettings\s+agents?|realtor|realty)\b/i,
    rule: 'estate_agents',
    baseConfidence: 92,
  },
  {
    industry: 'recruitment agency',
    // "recruitment agency", "recruiters", "staffing agency", "talent agency"
    pattern: /\b(recruit(ment|er|ers)?|staffing\s+agency|talent\s+(agency|firm))\b/i,
    rule: 'recruitment',
    baseConfidence: 92,
  },
  {
    industry: 'legal services',
    // "solicitor", "law firm", "legal services", "barrister", "attorneys"
    pattern: /\b(solicitor|solicitors|law\s+firm|legal\s+services|legal\s+firm|barrister|attorney|attorneys|legal\s+practice)\b/i,
    rule: 'legal',
    baseConfidence: 92,
  },
  {
    industry: 'logistics company',
    pattern: /\b(logistics|freight|haulage|fulfillment|fulfilment|warehousing)\b/i,
    rule: 'logistics',
    baseConfidence: 90,
  },
  // ---- agencies — peer industries; specific before generic ---------
  {
    industry: 'web agency',
    pattern: /\b(web\s+(agency|design|development)|webdev|web\s+studio)\b/i,
    rule: 'web_agency',
    baseConfidence: 90,
  },
  {
    industry: 'marketing agency',
    // catches "marketing agency", "digital marketing", "PPC agency",
    // "SEO agency", "advertising agency", "creative agency",
    // "communications agency" (PR), "pr agency", "brand agency".
    pattern: /\b(digital\s+marketing|marketing\s+(and\s+communications\s+)?agency|advertising\s+agency|creative\s+(marketing\s+)?agency|communications\s+agency|pr\s+agency|ppc\s+agency|seo\s+agency|brand\s+agency)\b/i,
    rule: 'marketing',
    baseConfidence: 88,
  },
  {
    industry: 'design studio',
    pattern: /\b(design\s+studio|branding\s+studio)\b/i,
    rule: 'design_studio',
    baseConfidence: 88,
  },
  {
    industry: 'consultants',
    // generic catch-all — keep last among professional services.
    pattern: /\b(consultan(t|ts|cy)|consulting\s+firm|management\s+consultants?)\b/i,
    rule: 'consultants',
    baseConfidence: 80,
  },
];

// Per-source dampening: a match in the website body is less trustworthy
// than a match coming from the discovery query tag. We multiply the
// rule's baseConfidence by these factors.
const SOURCE_WEIGHT: Record<InferenceSource, number> = {
  query: 1.0,
  title: 0.9,
  snippet: 0.7,
  name: 0.7,
  website: 0.6,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function normaliseIndustry(
  input: string | null | undefined,
  source: InferenceSource = 'query',
): NormalizationResult {
  if (!input || typeof input !== 'string') {
    return { industry: null, confidence: 0, matchedRule: null, source: null };
  }
  const text = input.toLowerCase();
  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      const weight = SOURCE_WEIGHT[source] ?? 1.0;
      return {
        industry: rule.industry,
        confidence: Math.round(rule.baseConfidence * weight),
        matchedRule: rule.rule,
        source,
      };
    }
  }
  return { industry: null, confidence: 0, matchedRule: null, source: null };
}

// Convenience: run normalisation across multiple candidate strings in
// priority order. Returns the first non-null match. Used by the
// backfill (query → title → snippet → name → website).
export function normaliseFromCandidates(
  candidates: Array<{ text: string | null | undefined; source: InferenceSource }>,
): NormalizationResult {
  for (const c of candidates) {
    const r = normaliseIndustry(c.text, c.source);
    if (r.industry) return r;
  }
  return { industry: null, confidence: 0, matchedRule: null, source: null };
}

// Check helper — used by industryBalancing / corpus health to detect
// whether a value coming out of the DB is already canonical or
// whether it needs normalisation again.
export function isCanonicalIndustry(s: string | null | undefined): boolean {
  if (!s) return false;
  return (CANONICAL_INDUSTRIES as readonly string[]).includes(s);
}
