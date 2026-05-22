import type { Campaign } from '../scoring/campaignTypes';

// ---------------------------------------------------------------------------
// Reviewer feedback. Two related categories share the same `lead_reviews`
// table, distinguished by `kind`:
//
//   - 'calibration' tags teach the scoring system whether the routing was
//     correct. They feed the calibration loop and pattern detection.
//   - 'operator' tags are throughput annotations from the Opportunity
//     Command Center — they explain *why* an operator marked something
//     ignore / revisit / fast-close, etc. They feed dashboards but not
//     the scoring loop.
//
// Both are persisted as rows in lead_reviews so the historical timeline
// is preserved. Multiple operator tags can coexist on a single lead.
// ---------------------------------------------------------------------------
export const CALIBRATION_REVIEW_TYPES = [
  'correct_campaign',
  'false_reject',
  'false_positive',
  'strong_opportunity',
  'weak_opportunity',
  'interesting_later',
] as const;

export const OPERATOR_REVIEW_TYPES = [
  'ignore',
  'revisit_later',
  'wrong_campaign',
  'high_trust_barrier',
  'likely_fast_close',
  'likely_high_value',
  'needs_manual_investigation',
] as const;

export const REVIEW_TYPES = [
  ...CALIBRATION_REVIEW_TYPES,
  ...OPERATOR_REVIEW_TYPES,
] as const;

export type CalibrationReviewType = (typeof CALIBRATION_REVIEW_TYPES)[number];
export type OperatorReviewType = (typeof OPERATOR_REVIEW_TYPES)[number];
export type ReviewType = (typeof REVIEW_TYPES)[number];

export const REVIEW_LABEL: Record<ReviewType, string> = {
  correct_campaign: 'Correct campaign',
  strong_opportunity: 'Strong opportunity',
  weak_opportunity: 'Weak opportunity',
  interesting_later: 'Interesting later',
  false_reject: 'Wrongly rejected',
  false_positive: 'Wrongly accepted',
  ignore: 'Ignore',
  revisit_later: 'Revisit later',
  wrong_campaign: 'Wrong campaign',
  high_trust_barrier: 'High trust barrier',
  likely_fast_close: 'Likely fast close',
  likely_high_value: 'Likely high value',
  needs_manual_investigation: 'Needs investigation',
};

// One-line tooltips shown on hover — explain what each rating means so
// the operator doesn't have to guess.
export const REVIEW_HINT: Record<ReviewType, string> = {
  correct_campaign: 'The campaign assigned is right.',
  strong_opportunity: 'High-value lead — chase soon.',
  weak_opportunity: 'Real fit but low-value — nurture only.',
  interesting_later: 'Park for now; revisit when more signal exists.',
  false_reject: 'System rejected this lead but it should have been pursued.',
  false_positive: 'System accepted this lead but it isn’t a real fit.',
  ignore: 'Skip this opportunity for now — not worth chasing.',
  revisit_later: 'Park for a future review pass.',
  wrong_campaign: 'The campaign assignment is wrong — re-route.',
  high_trust_barrier: 'Will need heavy proof / social validation to close.',
  likely_fast_close: 'Cheap to win — pursue immediately.',
  likely_high_value: 'Large potential project size if landed.',
  needs_manual_investigation: 'Worth a few minutes of manual research before deciding.',
};

export function isCalibrationReview(type: string): type is CalibrationReviewType {
  return (CALIBRATION_REVIEW_TYPES as readonly string[]).includes(type);
}

export function isOperatorReview(type: string): type is OperatorReviewType {
  return (OPERATOR_REVIEW_TYPES as readonly string[]).includes(type);
}

// ---------------------------------------------------------------------------
// Metric aggregates surfaced on the dashboard and CLIs.
// ---------------------------------------------------------------------------
export interface CampaignMetric {
  campaign: Campaign;
  total: number;
  avgFinalScore: number;
  reviewCounts: Record<ReviewType, number>;
  reviewedTotal: number;
  // Rates are 0–1 floats. Undefined means "no reviews yet — can't tell."
  falseRejectRate: number | null;
  falsePositiveRate: number | null;
  correctRate: number | null;
}

export interface SourceQuality {
  source: string;
  totalLeads: number;
  byCampaign: Record<Campaign, number>;
  avgFinalScore: number;
  inspectionFailureRate: number | null;
  strongOpportunities: number;
  reviewedRejects: number;
}

export interface TopReason {
  code: string;
  label: string;
  count: number;
  totalDelta: number;
}

// A lead the operator should sanity-check — possibly mis-routed.
export interface FalseRejectCandidate {
  companyId: string;
  company: string;
  primaryCampaign: Campaign;
  finalScore: number;
  flagReason: string;
  evidence: string[];
}

export interface ValidationSnapshot {
  generatedAt: string;
  campaignMetrics: CampaignMetric[];
  sourceQuality: SourceQuality[];
  topCampaignReasons: Record<Campaign, TopReason[]>;
  topRejectionReasons: TopReason[];
  falseRejectCandidates: FalseRejectCandidate[];
  reviewTotals: Record<ReviewType, number>;
}
