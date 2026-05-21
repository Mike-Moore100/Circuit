import type { Campaign } from '../scoring/campaignTypes';

// ---------------------------------------------------------------------------
// Reviewer feedback — six discrete actions the operator can take on a lead
// to teach the system whether its routing was correct.
// ---------------------------------------------------------------------------
export const REVIEW_TYPES = [
  'correct_campaign',
  'false_reject',
  'false_positive',
  'strong_opportunity',
  'weak_opportunity',
  'interesting_later',
] as const;

export type ReviewType = (typeof REVIEW_TYPES)[number];

export const REVIEW_LABEL: Record<ReviewType, string> = {
  correct_campaign: 'Correct campaign',
  false_reject: 'False reject',
  false_positive: 'False positive',
  strong_opportunity: 'Strong opportunity',
  weak_opportunity: 'Weak opportunity',
  interesting_later: 'Interesting later',
};

export const REVIEW_HINT: Record<ReviewType, string> = {
  correct_campaign: 'Routing was right.',
  false_reject: 'Rejected but should not have been — operator override.',
  false_positive: 'Accepted but should not have been — over-routed.',
  strong_opportunity: 'High-value lead worth chasing soon.',
  weak_opportunity: 'Real but low-value — nurture only.',
  interesting_later: 'Park; revisit when more signal exists.',
};

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
