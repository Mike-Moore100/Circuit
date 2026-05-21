import type { Campaign } from '../scoring/campaignTypes';
import type { ReviewType } from '../validation/types';

export interface ReviewPattern {
  // What the operator said
  reviewType: ReviewType;
  // What the system said before that
  previousCampaign: Campaign;
  // Number of leads that match this exact pair
  count: number;
  // The leads themselves (capped, just for the operator to spot-check)
  sampleCompanies: string[];
  // Average opportunity score across the matching leads
  avgOpportunityScore: number;
  // Average final score (rule + intent) across the matching leads
  avgFinalScore: number;
}

export interface CalibrationSuggestion {
  // A stable identifier so the same suggestion isn't repeated across runs
  id: string;
  // What to change
  target: 'campaign_weight' | 'rule_weight' | 'verified_signal_weight' | 'threshold';
  // The specific knob, e.g. 'WEB_REBUILD.verified.website_failed' or
  // 'priority_floor.WEB_REBUILD'
  knob: string;
  // Suggested adjustment direction in plain English
  direction: 'decrease' | 'increase';
  // Operator-facing explanation
  rationale: string;
  // How much evidence backs this — number of reviews that drove it
  evidenceCount: number;
  // Confidence in the suggestion itself (0-100)
  confidence: number;
}

export interface FeedbackInsight {
  // Short headline e.g. "WEB_REBUILD is over-routing — 3 false positives in a row"
  headline: string;
  // 1-2 sentence narrative
  detail: string;
  // 'warning' | 'opportunity' | 'info'
  tone: 'warning' | 'opportunity' | 'info';
  // For tracking — counts of reviews that produced this insight
  reviewCount: number;
}

export interface LearningReport {
  generatedAt: string;
  totalReviews: number;
  reviewCounts: Record<ReviewType, number>;
  patterns: ReviewPattern[];
  suggestions: CalibrationSuggestion[];
  insights: FeedbackInsight[];
}
