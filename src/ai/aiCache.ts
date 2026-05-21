import { createHash } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '../db/client';
import { buildHashableInput } from './buildAnalysisPrompt';
import type { AiAnalysisResult, FeedbackStatus, PromptInput } from './aiTypes';

export interface CachedAnalysisRow {
  id: string;
  company_id: string;
  prompt_version: string;
  input_hash: string;
  ai_provider: string;
  model: string;
  summary: string | null;
  confidence: number | null;
  operational_pain_points_json: string | null;
  automation_opportunities_json: string | null;
  estimated_business_impact_json: string | null;
  likely_buyer_json: string | null;
  urgency_json: string | null;
  proof_angles_json: string | null;
  risks_json: string | null;
  raw_response_json: string | null;
  tokens_input: number;
  tokens_cached: number;
  tokens_output: number;
  estimated_cost: number;
  feedback_status: FeedbackStatus;
  feedback_notes: string | null;
  feedback_updated_at: string | null;
  status: 'ok' | 'failed';
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export function hashPromptInput(input: PromptInput): string {
  return createHash('sha256').update(buildHashableInput(input)).digest('hex');
}

export function findCachedAnalysis(
  companyId: string,
  inputHash: string,
  db: Database = getDb(),
): CachedAnalysisRow | undefined {
  return db
    .prepare(
      'SELECT * FROM ai_analyses WHERE company_id = ? AND input_hash = ? LIMIT 1',
    )
    .get(companyId, inputHash) as CachedAnalysisRow | undefined;
}

export function getLatestAnalysisForCompany(
  companyId: string,
  db: Database = getDb(),
): CachedAnalysisRow | undefined {
  return db
    .prepare(
      'SELECT * FROM ai_analyses WHERE company_id = ? ORDER BY created_at DESC LIMIT 1',
    )
    .get(companyId) as CachedAnalysisRow | undefined;
}

export function rowToAnalysis(row: CachedAnalysisRow): AiAnalysisResult | null {
  if (row.status !== 'ok' || !row.summary) return null;
  try {
    return {
      summary: row.summary,
      confidence: row.confidence ?? 0,
      operationalPainPoints: row.operational_pain_points_json
        ? JSON.parse(row.operational_pain_points_json)
        : [],
      automationOpportunities: row.automation_opportunities_json
        ? JSON.parse(row.automation_opportunities_json)
        : [],
      likelyBuyer: row.likely_buyer_json
        ? JSON.parse(row.likely_buyer_json)
        : { role: 'unknown', reasoning: '', confidence: 0 },
      urgencyAssessment: row.urgency_json
        ? JSON.parse(row.urgency_json)
        : { level: 'low', reasoning: '' },
      proofAngles: row.proof_angles_json ? JSON.parse(row.proof_angles_json) : [],
      risksOrObjections: row.risks_json ? JSON.parse(row.risks_json) : [],
    } as AiAnalysisResult;
  } catch {
    return null;
  }
}
