// Phase 12 — Discovery → Qualification auto-promotion bridge.
//
// Architecture rule: promotion is the cheap, deterministic gate between
// "found a business" and "deeply qualify it". Promotion costs ~0; the
// qualification pipeline (inspection, contacts, evidence, intelligence)
// is the expensive bit and runs only on promoted candidates.

export type QualificationStatus =
  | 'PENDING' // promoted into the queue, qualification hasn't started
  | 'PROCESSING' // qualification services running
  | 'PROMOTED' // qualification complete, lead is in companies + scored
  | 'SKIPPED' // gate rejected the discovery, never entered companies
  | 'FAILED'; // qualification pipeline errored — keep for diagnostics

// What the gate sees. Strictly the fields we already have at discovery
// time — no DB lookups, no network calls, no AI.
export interface PromotionInput {
  discoveryId: string;
  domain: string;
  businessName: string;
  title: string | null;
  snippet: string | null;
  source: string;
  phone: string | null;
  location: string | null;
}

// Single rule's verdict. Pure data, no side effects.
export interface RuleResult {
  // Stable identifier — never localised, never displayed.
  code: string;
  // Human-readable explanation surfaced in the dashboard / debug CLI.
  label: string;
  // Did this rule veto promotion? (Some rules are pure scoring, never
  // veto — those return veto:false even when score is negative.)
  veto: boolean;
  // Signed contribution to the signal threshold (gate composes these).
  score: number;
}

// The composed decision. The promoter writes this to qualification_queue.
export interface GateDecision {
  decision: 'PROMOTE' | 'SKIP';
  // Top-line reason — the most important single contributor.
  primaryReason: string;
  // Full breakdown for explainability.
  reasons: RuleResult[];
  // Total signal score (signed). Used for queue priority ordering.
  signalScore: number;
}

// Queue row shape that the dashboard / API surfaces.
export interface QualificationQueueRow {
  id: string;
  discoveryId: string | null;
  companyId: string | null;
  domain: string;
  source: string;
  status: QualificationStatus;
  priority: number;
  promotionReason: string;
  createdAt: string;
  updatedAt: string;
}
