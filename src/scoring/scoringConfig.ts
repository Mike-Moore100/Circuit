// Centralised, tweakable thresholds + weights. Everything that influences a
// score should be referenced from here so we can sweep values during tuning
// without grepping the codebase.

export const PRIORITY_THRESHOLDS = {
  A: 85,
  B: 70,
  C: 60,
} as const;

// Industry classification — used by both rule filter and intent scoring.
export const TARGET_INDUSTRIES = [
  'recruitment',
  'recruiting',
  'staffing',
  'marketing agency',
  'marketing',
  'digital agency',
  'advertising agency',
  'accounting',
  'bookkeeping',
  'real estate',
  'property',
  'property management',
  'legal',
  'law firm',
  'consulting',
  'consultancy',
  'ecommerce',
  'e-commerce',
  'saas',
  'software as a service',
  'local services',
] as const;

export const BAD_FIT_INDUSTRIES = [
  'restaurant',
  'cafe',
  'food service',
  'hospitality',
  'enterprise software',
  'big tech',
  'fortune 500',
  'pharmaceutical',
  'banking',
  'aerospace',
  'defense',
] as const;

// Roles likely to be the decision maker for a sub-50 person business.
export const FOUNDER_ROLE_KEYWORDS = [
  'founder',
  'co-founder',
  'ceo',
  'owner',
  'managing director',
  'md',
  'principal',
  'partner',
  'director',
  'head of',
] as const;

export const OPERATIONAL_COMPLEXITY_SIGNALS = [
  'multi-step workflow',
  'manual data entry',
  'spreadsheets',
  'reporting cadence',
  'admin overhead',
  'customer support volume',
  'lead intake',
  'invoicing',
  'scheduling',
  'onboarding workflow',
] as const;

export const COMMERCIAL_INTENT_SIGNALS = [
  'lead capture form',
  'contact form',
  'book a call',
  'pricing page',
  'paid ads',
  'newsletter signup',
  'demo request',
] as const;

// ---------------------------------------------------------------------------
// Rule-based filter weights. These are *signed deltas* applied to a base of
// 50 so the score lives in [0, 100] without clamping surprises.
// ---------------------------------------------------------------------------
export const RULE_WEIGHTS = {
  // Positive
  IDEAL_HEADCOUNT: 18, // 5–25
  GOOD_HEADCOUNT: 10, // 2–4 or 26–50
  TARGET_INDUSTRY: 14,
  HAS_WEBSITE: 6,
  FOUNDER_REACHABLE: 10,
  OPERATIONAL_COMPLEXITY: 8,
  COMMERCIAL_INTENT: 6,
  AUTOMATABLE_WORKLOAD: 8,
  // Negative
  ENTERPRISE_PENALTY: -50,
  NO_WEBSITE_PENALTY: -25,
  BAD_FIT_INDUSTRY_PENALTY: -45,
  HOBBY_PROJECT_PENALTY: -40,
  INTERNAL_AUTOMATION_TEAM_PENALTY: -25,
  IRRELEVANT_INDUSTRY_PENALTY: -20,
  HEAVY_COMPLIANCE_PENALTY: -15,

  // ---- Verified (Phase 3, derived from real website inspection) -------
  VERIFIED_WEBSITE_LOADS: 4,
  VERIFIED_HAS_CONTACT_PAGE: 4,
  VERIFIED_HAS_CONTACT_FORM: 8,
  VERIFIED_HAS_BOOKING_LINK: 10,
  VERIFIED_HAS_SERVICES_PAGE: 5,
  VERIFIED_HAS_MULTIPLE_SERVICE_PAGES: 4,
  VERIFIED_HAS_CAREERS_PAGE: 5,
  VERIFIED_HAS_SUPPORT_OR_HELP: 5,
  VERIFIED_HAS_ECOMMERCE_SIGNALS: 6,
  VERIFIED_HAS_MANUAL_WORKFLOW_LANGUAGE: 8,
  VERIFIED_HIGH_AUTOMATION_FIT: 8,
  VERIFIED_LIKELY_SERVICE_BUSINESS: 4,
  VERIFIED_LIKELY_SAAS: 4,
  VERIFIED_LIKELY_LOCAL_SMB: 3,
  // Penalties
  VERIFIED_WEBSITE_FAILED: -30,
  VERIFIED_AI_AUTOMATION_PROVIDER_PENALTY: -45,
  VERIFIED_LOW_DIGITAL_MATURITY: -12,
} as const;

export const RULE_BASE_SCORE = 50;
export const RULE_PASS_THRESHOLD = 50; // anything < this is dropped before intent scoring

// ---------------------------------------------------------------------------
// Intent / opportunity scoring weights. Components are calculated 0–100 each
// then combined with these weights (sum should be ~1.0; trust_barrier is
// applied as a subtractive penalty).
// ---------------------------------------------------------------------------
export const INTENT_COMPONENT_WEIGHTS = {
  urgency: 0.18,
  manualWorkload: 0.2,
  decisionMakerAccess: 0.18,
  budgetLikelihood: 0.14,
  automationFit: 0.18,
  implementationSimplicity: 0.12,
} as const;

export const TRUST_BARRIER_PENALTY_MAX = 25; // max points deducted from intent

// ---------------------------------------------------------------------------
// Final score combiner. Final = ruleWeight * rule + intentWeight * intent.
// Rule score is weighted slightly higher because for Phase 1 we trust
// hand-tuned rules more than the heuristic intent estimate.
// ---------------------------------------------------------------------------
export const FINAL_WEIGHTS = {
  rule: 0.55,
  intent: 0.45,
} as const;
