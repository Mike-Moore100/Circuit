// Opportunity Intelligence service — pure orchestration around the
// existing computeOpportunityIntelligence engine. Used by the pipeline,
// the seed workflow, the dashboard (per-lead "recompute" action), and
// any future scheduler.

import type { Database } from 'better-sqlite3';
import { getDb } from '../db/client';
import {
  getAllCompanies,
  getLatestScore,
  upsertOpportunityIntelligence,
} from '../db/repository';
import type { Company } from '../types/index';
import { buildIntelligenceInputs } from '../intelligence/buildInputs';
import { computeOpportunityIntelligence } from '../intelligence/opportunityIntelligence';
import type {
  HumanAttentionPriority,
  OpportunityIntelligence,
} from '../intelligence/intelligenceTypes';
import type { Campaign } from '../scoring/campaignTypes';
import {
  makeResult,
  NOOP_PROGRESS,
  type ProgressCallback,
  type ServiceResult,
} from './types';

export interface IntelligenceItem {
  companyId: string;
  companyName: string;
  opportunityScore: number;
  humanAttentionPriority: HumanAttentionPriority;
}

export interface IntelligenceStats {
  attempted: number;
  ok: number;
  failed: number;
}

// ---------------------------------------------------------------------------
// Single lead — used by the pipeline's intelligence pass and the future
// dashboard "recompute this lead" button.
// ---------------------------------------------------------------------------
export function recomputeIntelligenceForLead(
  companyId: string,
  db: Database = getDb(),
): OpportunityIntelligence | null {
  const company = db
    .prepare('SELECT * FROM companies WHERE id = ?')
    .get(companyId) as Company | undefined;
  if (!company) return null;
  const score = getLatestScore(company.id, db);
  if (!score) return null;
  return runForCompany(company, score, db);
}

// ---------------------------------------------------------------------------
// Whole-DB recompute — used after evidence extraction (seed workflow) or
// after weight tuning when the operator wants every lead re-scored.
// ---------------------------------------------------------------------------
export async function recomputeAllIntelligence(
  options: { onProgress?: ProgressCallback; db?: Database } = {},
): Promise<ServiceResult<IntelligenceItem, IntelligenceStats>> {
  const startedAt = new Date();
  const onProgress = options.onProgress ?? NOOP_PROGRESS;
  const db = options.db ?? getDb();
  const errors: string[] = [];

  const companies = getAllCompanies(db);
  onProgress({
    level: 'info',
    code: 'batch.start',
    message: `recomputing ${companies.length} companies`,
    data: { total: companies.length },
  });

  const stats: IntelligenceStats = { attempted: 0, ok: 0, failed: 0 };
  const items: IntelligenceItem[] = [];

  for (const co of companies) {
    const score = getLatestScore(co.id, db);
    if (!score) continue;
    stats.attempted += 1;
    try {
      const intel = runForCompany(co, score, db);
      if (!intel) continue;
      items.push({
        companyId: intel.companyId,
        companyName: co.name,
        opportunityScore: intel.opportunityScore,
        humanAttentionPriority: intel.humanAttentionPriority,
      });
      stats.ok += 1;
    } catch (err) {
      stats.failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${co.name}: ${msg}`);
      onProgress({
        level: 'error',
        code: 'lead.failed',
        message: `${co.name}: ${msg}`,
        data: { companyId: co.id, error: msg },
      });
    }
  }

  onProgress({
    level: 'info',
    code: 'batch.done',
    message: `ok=${stats.ok} failed=${stats.failed}`,
    data: stats,
  });

  return makeResult<IntelligenceItem, IntelligenceStats>({
    ok: stats.failed === 0,
    startedAt,
    items,
    stats,
    errors,
  });
}

// ---------------------------------------------------------------------------
// Shared inner — single-company compute + persist.
// ---------------------------------------------------------------------------
type LatestScore = ReturnType<typeof getLatestScore>;

function runForCompany(
  company: Company,
  score: NonNullable<LatestScore>,
  db: Database,
): OpportunityIntelligence {
  const inputs = buildIntelligenceInputs(
    {
      companyId: company.id,
      companyName: company.name,
      industry: company.industry,
      location: company.location,
      websiteUrl: company.website_url,
      sizeEstimate: company.size_estimate,
      ruleScore: score.rule_score,
      intentScore: score.intent_score,
      finalScore: score.final_score,
      primaryCampaign: (score.primary_campaign ?? 'LOW_PRIORITY_NURTURE') as Campaign,
    },
    db,
  );
  const intel = computeOpportunityIntelligence(inputs);
  upsertOpportunityIntelligence(
    {
      companyId: intel.companyId,
      opportunityScore: intel.opportunityScore,
      humanAttentionPriority: intel.humanAttentionPriority,
      operationalPainScore: intel.operationalPain.score,
      buyingReadinessScore: intel.buyingReadiness.score,
      accessibilityScore: intel.accessibility.score,
      implementationFitScore: intel.implementationFit.score,
      trustBarrierScore: intel.trustBarrier.score,
      evidenceConfidenceScore: intel.evidenceConfidence.score,
      likelyProjectType: intel.likelyProjectType,
      estimatedProjectComplexity: intel.estimatedProjectComplexity,
      estimatedCommercialPotential: intel.estimatedCommercialPotential,
      payload: intel as unknown as Record<string, unknown>,
      computedAt: intel.computedAt,
    },
    db,
  );
  return intel;
}
