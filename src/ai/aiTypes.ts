import { z } from 'zod';

// Bump when the prompt or input shape changes — old cache entries are
// effectively invalidated because the hash changes.
export const PROMPT_VERSION = 'v1.0.0';

// ---------------------------------------------------------------------------
// AI output schema — STRICT JSON. Anything we persist must pass this check.
// ---------------------------------------------------------------------------
export const PainPointSchema = z.object({
  title: z.string().min(1),
  description: z.string(),
  confidence: z.number().min(0).max(100),
  evidence: z.array(z.string()).default([]),
});

export const OpportunitySchema = z.object({
  title: z.string().min(1),
  description: z.string(),
  businessImpact: z.string(),
  implementationComplexity: z.enum(['low', 'medium', 'high']),
  confidence: z.number().min(0).max(100),
});

export const LikelyBuyerSchema = z.object({
  role: z.string(),
  reasoning: z.string(),
  confidence: z.number().min(0).max(100),
});

export const UrgencySchema = z.object({
  level: z.enum(['low', 'medium', 'high']),
  reasoning: z.string(),
});

export const ProofAngleSchema = z.object({
  title: z.string().min(1),
  description: z.string(),
});

export const AiAnalysisResultSchema = z.object({
  summary: z.string(),
  confidence: z.number().min(0).max(100),
  operationalPainPoints: z.array(PainPointSchema).default([]),
  automationOpportunities: z.array(OpportunitySchema).default([]),
  likelyBuyer: LikelyBuyerSchema,
  urgencyAssessment: UrgencySchema,
  proofAngles: z.array(ProofAngleSchema).default([]),
  risksOrObjections: z.array(z.string()).default([]),
});
export type AiAnalysisResult = z.infer<typeof AiAnalysisResultSchema>;

// ---------------------------------------------------------------------------
// Compact prompt input — what we send to the model. This is the canonical
// "shape" that feeds the cache hash.
// ---------------------------------------------------------------------------
export interface PromptCompanyContext {
  companyName: string;
  industry: string | null;
  location: string | null;
  websiteUrl: string | null;
  source: string;
  sizeEstimate: number | null;
}

export interface PromptScoring {
  finalScore: number;
  ruleScore: number;
  intentScore: number;
  priority: 'A' | 'B' | 'C' | 'Reject';
  reasons: Array<{ label: string; delta: number }>;
  rejectionReasons: Array<{ label: string; delta: number }>;
}

export interface PromptVerifiedSignal {
  type: string;
  value: string;
  confidence: number;
}

export interface PromptContact {
  name: string | null;
  role: string | null;
  email: string | null;
}

export interface PromptInput {
  promptVersion: string;
  company: PromptCompanyContext;
  scoring: PromptScoring;
  verifiedSignals: PromptVerifiedSignal[];
  homepageSnippet: string | null;
  contact: PromptContact | null;
}

// ---------------------------------------------------------------------------
// Provider contract
// ---------------------------------------------------------------------------
export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

export interface ProviderResult {
  rawJson: string;
  usage: ProviderUsage;
  estimatedCostUsd: number;
  provider: string;
  model: string;
}

export interface AiProvider {
  name: string;
  model: string;
  generate(systemPrompt: string, userPrompt: string): Promise<ProviderResult>;
}

// ---------------------------------------------------------------------------
// Engine output (per-lead result returned to callers)
// ---------------------------------------------------------------------------
export type AnalysisStatus =
  | 'ok'
  | 'cache_hit'
  | 'skipped_budget'
  | 'skipped_priority'
  | 'skipped_disabled'
  | 'failed';

export interface EngineAnalysisOutcome {
  companyId: string;
  status: AnalysisStatus;
  analysisId?: string;
  result?: AiAnalysisResult;
  usage?: ProviderUsage;
  estimatedCostUsd?: number;
  provider?: string;
  model?: string;
  inputHash?: string;
  errorMessage?: string;
  fromCache?: boolean;
}

export type FeedbackStatus =
  | 'pending'
  | 'useful'
  | 'not_useful'
  | 'hallucination'
  | 'approved'
  | 'rejected';
