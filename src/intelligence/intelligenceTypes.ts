// Circuit — opportunity intelligence layer.
//
// Architecture rule: every scoring module is a deterministic, pure function
// over an IntelligenceInputs bundle. No AI in the scoring path. AI may
// enrich evidence elsewhere, but it never controls these scores.

export type HumanAttentionPriority =
  | 'IMMEDIATE'
  | 'HIGH'
  | 'MEDIUM'
  | 'LOW'
  | 'IGNORE';

export type LikelyProjectType =
  | 'AI_AUTOMATION'
  | 'WEB_REBUILD'
  | 'FUNNEL_OPTIMIZATION'
  | 'LOCAL_DIGITAL_UPGRADE'
  | 'NURTURE'
  | 'UNCLEAR';

export type ProjectComplexity = 'LOW' | 'MEDIUM' | 'HIGH';
export type CommercialPotential = 'LOW' | 'MEDIUM' | 'HIGH';

// Single shape used by every scorer's reason list — keeps the dashboard's
// reason-list component dumb.
export interface IntelReason {
  code: string; // stable identifier — never localised, never displayed
  label: string; // human-readable explanation, displayed verbatim
  delta: number; // signed contribution to the sub-score
}

// What every sub-scorer returns. `score` is 0–100. `reasons` carries the
// individual deltas so the dashboard can show "why this number". `signals`
// is the strongest qualitative signals — short strings the operator can
// scan ("named founder reachable", "no mobile viewport").
export interface SubScore {
  score: number;
  reasons: IntelReason[];
  signals: string[];
}

// ---------------------------------------------------------------------------
// Inputs — the single canonical bundle every scorer reads from.
// Compiled once per lead by opportunityIntelligence.ts so the scorers stay
// pure and the I/O layer stays in one place.
// ---------------------------------------------------------------------------
export interface IntelligenceContactInput {
  name: string | null;
  role: string | null;
  email: string | null;
  emailStatus: string | null; // 'extracted' | 'guessed' | 'verified' | null
  source: string | null; // 'static' | 'playwright' | 'guessed' | 'inferred' | 'source-feed'
  detectedRole: string; // 'founder' | 'owner' | 'managing_director' | ... | 'unknown'
  isPrimary: boolean;
}

export interface IntelligenceVerifiedSignal {
  type: string; // e.g. 'verified.has_working_website'
  value: string;
}

export interface IntelligenceVisualIssue {
  code: string;
  confidence: number;
  campaign: string; // 'WEB_REBUILD' | 'FUNNEL_OPTIMIZATION' | 'AI_AUTOMATION' | 'ANY'
}

export interface IntelligenceOperationalClue {
  code: string;
  confidence: number;
  evidence: string[];
}

export interface IntelligenceInputs {
  companyId: string;
  companyName: string;
  industry: string | null;
  location: string | null;
  websiteUrl: string | null;
  sizeEstimate: number | null;

  // From the rule-and-intent scoring pass
  ruleScore: number;
  intentScore: number;
  finalScore: number;
  primaryCampaign: string;

  // From website inspection
  inspectionAttempted: boolean;
  inspectionOk: boolean;
  verifiedSignals: IntelligenceVerifiedSignal[];

  // From contact discovery
  contacts: IntelligenceContactInput[];
  hasPhone: boolean;
  hasContactForm: boolean;
  hasBookingLink: boolean;
  hasLinkedIn: boolean;

  // From evidence extraction (may be empty if extract:evidence hasn't run)
  hasDesktopScreenshot: boolean;
  hasMobileScreenshot: boolean;
  visualIssues: IntelligenceVisualIssue[];
  operationalClues: IntelligenceOperationalClue[];
  evidenceComputedAt: string | null;
}

// ---------------------------------------------------------------------------
// Output — what the orchestrator produces and we persist.
// ---------------------------------------------------------------------------
export interface OpportunityIntelligence {
  companyId: string;
  computedAt: string;

  // Top-line
  opportunityScore: number; // 0-100, weighted composite
  humanAttentionPriority: HumanAttentionPriority;

  // Six sub-scores
  operationalPain: SubScore;
  buyingReadiness: SubScore;
  accessibility: SubScore;
  implementationFit: SubScore;
  trustBarrier: SubScore; // HIGHER = WORSE (penalty)
  evidenceConfidence: SubScore;

  // Explainability — assembled by the orchestrator from the sub-scores
  opportunityReasons: string[];
  riskFactors: string[];
  strongestSignals: string[];
  weakestSignals: string[];

  // Shape of the work — deterministic, not AI
  likelyProjectType: LikelyProjectType;
  estimatedProjectComplexity: ProjectComplexity;
  estimatedCommercialPotential: CommercialPotential;
}

// Bound a value to [0, 100] and round — used everywhere in scoring.
export function clamp100(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}
