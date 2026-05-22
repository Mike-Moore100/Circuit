// Phase 14 — Calibration Intelligence layer.
//
// Architecture rule (LOCKED): calibration NEVER auto-adjusts scoring.
// It detects patterns, surfaces insights, and proposes knob changes
// the operator can apply by hand. No autonomous learning loops.
//
// This module sits ON TOP of /src/learning. learning gives us the raw
// review-pattern aggregations; calibration is the deeper, evidence-
// backed analysis that turns those aggregations into operator-facing
// intelligence.

import type { Campaign } from '../scoring/campaignTypes';
import type { ReviewType } from '../validation/types';

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------
export type InsightType =
  | 'high_value_pattern' // repeats produce strong_opportunity reviews
  | 'rejection_pattern' // repeats are operator-rejected
  | 'false_positive_pattern' // repeats are wrongly accepted
  | 'false_reject_pattern' // repeats are wrongly rejected
  | 'signal_strength' // a signal predicts review outcome well
  | 'scoring_drift' // system disagrees with operator at scale
  | 'trust_barrier_trend'; // a trust-barrier pattern is recurring

export interface CalibrationInsight {
  id: string; // stable identifier so the dashboard can dedupe across runs
  type: InsightType;
  title: string; // short headline rendered verbatim
  description: string; // 1-2 sentence narrative
  // 0-100. Combines effect size with sample size — small samples should
  // produce low confidence even when the pattern looks clean.
  confidence: number;
  evidence: {
    sampleCompanies: string[];
    metrics?: Record<string, number>;
  };
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Signal performance — per-signal precision across reviews.
// A "signal" here is anything we can attach to a lead: verified signals,
// visual issues, operational clues, campaign label, accessibility flags.
// ---------------------------------------------------------------------------
export interface SignalPerformance {
  signalName: string; // e.g. 'verified.has_working_website' or 'campaign.AI_AUTOMATION'
  // Total leads that carried this signal AND have been reviewed.
  reviewedCount: number;
  // Reviews that were positive about the routing: correct_campaign,
  // strong_opportunity, weak_opportunity, interesting_later.
  positiveOutcomes: number;
  // Reviews that were negative: false_positive.
  negativeOutcomes: number;
  // Operator overrides: signal present but system rejected the lead.
  falseRejectCount: number;
  // Signal present on a wrongly-accepted lead.
  falsePositiveCount: number;
  // positive / (positive + negative). null when sample too small.
  precision: number | null;
  // 0-100. Logistic curve over sample size + |precision-0.5|.
  confidence: number;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Opportunity patterns — recurring (industry × size × campaign × access)
// combinations that produce strong_opportunity reviews.
// ---------------------------------------------------------------------------
export type SizeBand = '<5' | '5-15' | '16-50' | '51-150' | '150+';

export interface OpportunityPatternSegments {
  industry?: string;
  sizeBand?: SizeBand;
  campaign?: Campaign;
  hasPhone?: boolean;
  hasDirectEmail?: boolean;
}

export interface OpportunityPattern {
  // Human-readable signature: "marketing agency · 5-15 · has direct email"
  signature: string;
  segments: OpportunityPatternSegments;
  // Total leads matching this signature that have been reviewed.
  count: number;
  // Reviewed as correct_campaign or strong_opportunity.
  positiveCount: number;
  // Reviewed as strong_opportunity specifically.
  strongCount: number;
  // Reviewed as false_positive.
  falsePositiveCount: number;
  // positive / total — 0..1.
  precision: number;
  avgOpportunityScore: number;
  sampleCompanies: string[];
}

// ---------------------------------------------------------------------------
// Trust barrier patterns — recurring shapes of leads the system thinks
// are HIGH but the operator marks REJECT / false_positive.
// ---------------------------------------------------------------------------
export interface TrustBarrierPatternSegments {
  industryKeyword?: string;
  sizeBand?: SizeBand;
  campaign?: Campaign;
}

export interface TrustBarrierPattern {
  signature: string;
  segments: TrustBarrierPatternSegments;
  count: number;
  avgTrustBarrierScore: number;
  rejectCount: number; // operator rejections
  falsePositiveCount: number; // wrongly accepted
  sampleCompanies: string[];
}

// ---------------------------------------------------------------------------
// Scoring drift — does the system AGREE with the operator at scale?
// ---------------------------------------------------------------------------
export interface ScoringDriftReport {
  totalReviews: number;
  // % of reviews where the operator confirmed routing (correct_campaign
  // + strong_opportunity + interesting_later).
  agreementRate: number;
  falsePositiveRate: number;
  falseRejectRate: number;
  byCampaign: Array<{
    campaign: Campaign;
    reviewed: number;
    agreement: number; // 0..1
    falsePositive: number; // 0..1
    falseReject: number; // 0..1
  }>;
}

// ---------------------------------------------------------------------------
// Suggestions — the proposed knob changes. Operator applies by hand.
// ---------------------------------------------------------------------------
export interface CalibrationSuggestion {
  id: string;
  knob: string; // e.g. 'WEB_REBUILD.signal.verified.website_failed.weight'
  direction: 'increase' | 'decrease';
  // 0-100. Matches CalibrationInsight.confidence.
  confidence: number;
  rationale: string;
  evidenceCount: number;
}

// ---------------------------------------------------------------------------
// Snapshot — the full calibration report. One row in calibration_runs.
// ---------------------------------------------------------------------------
export interface CalibrationSnapshot {
  generatedAt: string;
  totalReviews: number;
  reviewCounts: Record<ReviewType, number>;
  signalPerformance: SignalPerformance[];
  opportunityPatterns: OpportunityPattern[];
  trustBarrierPatterns: TrustBarrierPattern[];
  insights: CalibrationInsight[];
  suggestions: CalibrationSuggestion[];
  drift: ScoringDriftReport;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Confidence in [0, 100] from sample size + signal strength. Small samples
// + ambiguous signal → low. Large samples + clean signal → high.
// Pure function, no I/O.
export function calibrationConfidence(
  sampleSize: number,
  effectSize: number,
): number {
  if (sampleSize <= 0) return 0;
  // Sample saturation — 30 samples is "we believe this".
  const sampleScore = Math.min(1, sampleSize / 30);
  // Effect size is |precision - 0.5| * 2, mapped to [0,1]. Effect of 1
  // means perfect signal; 0 means coin flip.
  const effectScore = Math.max(0, Math.min(1, Math.abs(effectSize)));
  return Math.round(100 * Math.sqrt(sampleScore * effectScore));
}

export function sizeBandFor(headcount: number | null | undefined): SizeBand {
  if (headcount === null || headcount === undefined || headcount < 5) return '<5';
  if (headcount <= 15) return '5-15';
  if (headcount <= 50) return '16-50';
  if (headcount <= 150) return '51-150';
  return '150+';
}
