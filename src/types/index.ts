import { z } from 'zod';

// ---------------------------------------------------------------------------
// Signal: anything observed about a company that may inform scoring.
// ---------------------------------------------------------------------------
export const SignalSchema = z.object({
  type: z.string().min(1),
  value: z.string(),
  confidence: z.number().min(0).max(100),
});
export type Signal = z.infer<typeof SignalSchema>;

// ---------------------------------------------------------------------------
// RawLead: normalized output of every SourceConnector.
// ---------------------------------------------------------------------------
export const RawLeadSchema = z.object({
  companyName: z.string().min(1),
  websiteUrl: z.string().nullable(),
  industry: z.string().nullable(),
  location: z.string().nullable(),
  sizeEstimate: z.number().int().nonnegative().nullable(),
  source: z.string().min(1),
  sourceUrl: z.string().nullable(),
  contactName: z.string().nullable(),
  contactRole: z.string().nullable(),
  contactEmail: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  notes: z.string().nullable(),
  signals: z.array(SignalSchema).default([]),
});
export type RawLead = z.infer<typeof RawLeadSchema>;

// ---------------------------------------------------------------------------
// Source connector contract.
// ---------------------------------------------------------------------------
export const SourceFetchOptionsSchema = z
  .object({
    limit: z.number().int().positive().optional(),
    industry: z.string().optional(),
    location: z.string().optional(),
    query: z.string().optional(),
  })
  .passthrough();
// Source-specific connectors (e.g. Google Maps) accept additional fields like
// `categories` or `maxSearches`; allow them through the structural type so
// callers don't need a cast at every site.
export type SourceFetchOptions = z.infer<typeof SourceFetchOptionsSchema> & {
  [key: string]: unknown;
};

export interface SourceFetchResult {
  leads: RawLead[];
  apiCalls: number;
  errors: string[];
  // Optional metadata that the source wants persisted on the run record
  // (e.g. categories searched, locations swept).
  params?: Record<string, unknown>;
}

export interface SourceConnector {
  name: string;
  fetchLeads(options?: SourceFetchOptions): Promise<SourceFetchResult>;
}

// Legacy alias kept so any external code importing SourceResult still
// compiles; new code should use SourceFetchResult.
export type SourceResult = SourceFetchResult & { source: string; fetchedAt: string };

// Persisted source run record.
export const SourceRunSchema = z.object({
  id: z.string().uuid(),
  source: z.string(),
  status: z.enum(['running', 'completed', 'failed']),
  started_at: z.string(),
  completed_at: z.string().nullable(),
  leads_found: z.number().int().nonnegative(),
  leads_accepted: z.number().int().nonnegative(),
  leads_rejected: z.number().int().nonnegative(),
  api_calls: z.number().int().nonnegative(),
  errors_json: z.string().nullable(),
  params_json: z.string().nullable(),
});
export type SourceRun = z.infer<typeof SourceRunSchema>;

// ---------------------------------------------------------------------------
// Persisted entities.
// ---------------------------------------------------------------------------
export const CompanySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  domain: z.string().nullable(),
  website_url: z.string().nullable(),
  industry: z.string().nullable(),
  location: z.string().nullable(),
  size_estimate: z.number().int().nonnegative().nullable(),
  source: z.string(),
  source_url: z.string().nullable(),
  status: z.enum(['new', 'scored', 'review', 'rejected', 'archived']),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Company = z.infer<typeof CompanySchema>;

export const ContactSchema = z.object({
  id: z.string().uuid(),
  company_id: z.string().uuid(),
  name: z.string().nullable(),
  role: z.string().nullable(),
  email: z.string().nullable(),
  linkedin_url: z.string().nullable(),
  confidence: z.number().min(0).max(100).nullable(),
  created_at: z.string(),
});
export type Contact = z.infer<typeof ContactSchema>;

export const PersistedSignalSchema = SignalSchema.extend({
  id: z.string().uuid(),
  company_id: z.string().uuid(),
  source: z.string(),
  created_at: z.string(),
});
export type PersistedSignal = z.infer<typeof PersistedSignalSchema>;

export type Priority = 'A' | 'B' | 'C' | 'Reject';

export interface ScoreReason {
  code: string;
  label: string;
  delta: number; // signed contribution to the score
  weight?: number;
}

export const LeadScoreSchema = z.object({
  id: z.string().uuid(),
  company_id: z.string().uuid(),
  rule_score: z.number(),
  intent_score: z.number(),
  final_score: z.number(),
  priority: z.enum(['A', 'B', 'C', 'Reject']),
  reasons_json: z.string(),
  created_at: z.string(),
});
export type LeadScore = z.infer<typeof LeadScoreSchema>;

export const ReviewItemSchema = z.object({
  id: z.string().uuid(),
  company_id: z.string().uuid(),
  status: z.enum(['queued', 'investigating', 'contacted', 'rejected']),
  priority: z.enum(['A', 'B', 'C', 'Reject']),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ReviewItem = z.infer<typeof ReviewItemSchema>;

// ---------------------------------------------------------------------------
// Score breakdown surfaced to callers (not persisted in the same shape; the
// persisted form is JSON-stringified into lead_scores.reasons_json).
// ---------------------------------------------------------------------------
export interface RuleScoreBreakdown {
  ruleScore: number; // 0–100
  pass: boolean;
  reasons: ScoreReason[];
  rejectionReasons: ScoreReason[];
}

export interface IntentScoreBreakdown {
  intentScore: number; // 0–100
  reasons: ScoreReason[];
  components: {
    urgency: number;
    manualWorkload: number;
    decisionMakerAccess: number;
    budgetLikelihood: number;
    automationFit: number;
    implementationSimplicity: number;
    trustBarrierRisk: number; // negative pressure already applied
  };
}

// Campaign segmentation lives in src/scoring/campaignTypes.ts; re-exported
// here so consumers can import it from the same place as the other types.
export type {
  Campaign,
  CampaignClassification,
} from '../scoring/campaignTypes';
export {
  CAMPAIGN_VALUES,
  CAMPAIGN_LABEL,
  CAMPAIGN_DESCRIPTION,
} from '../scoring/campaignTypes';

export interface CombinedScore {
  rule: RuleScoreBreakdown;
  intent: IntentScoreBreakdown;
  finalScore: number;
  priority: Priority;
  // Phase 6: campaign segmentation. The pipeline always fills these in;
  // legacy DB rows may have them as null until backfilled.
  campaign: import('../scoring/campaignTypes').CampaignClassification;
}

// View model used by the dashboard and the JSON/CSV exports.
export interface ReviewQueueRow {
  companyId: string;
  company: string;
  website: string | null;
  industry: string | null;
  location: string | null;
  sizeEstimate: number | null;
  source: string;
  ruleScore: number;
  intentScore: number;
  finalScore: number;
  priority: Priority;
  status: ReviewItem['status'];
  reasons: ScoreReason[];
  // True disqualifiers only — populated when the campaign is REJECT.
  rejectionReasons: ScoreReason[];
  likelyPainPoints: string[];
  suggestedNextStep: string;
  updatedAt: string;
  // Phase 6
  primaryCampaign: import('../scoring/campaignTypes').Campaign;
  campaignScores: Record<
    import('../scoring/campaignTypes').Campaign,
    number
  >;
  primaryReason: string;
}
