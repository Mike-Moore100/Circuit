import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index';
import type { ReviewQueueRow } from '../types/index';
import { detectCandidateFalseRejects } from './falseRejectDetector';
import {
  computeCampaignMetrics,
  computeReviewTotals,
  computeSourceQuality,
  computeTopReasons,
} from './metrics';
import type { Database } from 'better-sqlite3';
import type { ValidationSnapshot } from './types';

function ensureValidationDir(): string {
  const dir = path.resolve(config.outputDir, '..', 'validation');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function buildValidationSnapshot(
  rows: ReviewQueueRow[],
  db?: Database,
): ValidationSnapshot {
  const campaignMetrics = computeCampaignMetrics(db);
  const sourceQuality = computeSourceQuality(db);
  const topReasons = computeTopReasons(db);
  const reviewTotals = computeReviewTotals(db);
  const falseRejectCandidates = detectCandidateFalseRejects(rows);
  return {
    generatedAt: new Date().toISOString(),
    campaignMetrics,
    sourceQuality,
    topCampaignReasons: topReasons.byCampaign,
    topRejectionReasons: topReasons.trueRejections,
    falseRejectCandidates,
    reviewTotals,
  };
}

export interface ValidationExport {
  snapshotPath: string;
  topOpportunitiesPath: string;
  falseRejectsPath: string;
  sourceQualityPath: string;
}

export function writeValidationExports(
  rows: ReviewQueueRow[],
  snapshot: ValidationSnapshot,
): ValidationExport {
  const dir = ensureValidationDir();
  const topOpportunities = rows
    .filter((r) => r.primaryCampaign !== 'REJECT')
    .slice(0, 50)
    .map((r) => ({
      companyId: r.companyId,
      company: r.company,
      website: r.website,
      industry: r.industry,
      location: r.location,
      source: r.source,
      primaryCampaign: r.primaryCampaign,
      finalScore: r.finalScore,
      ruleScore: r.ruleScore,
      intentScore: r.intentScore,
      primaryReason: r.primaryReason,
      suggestedNextStep: r.suggestedNextStep,
      campaignScores: r.campaignScores,
    }));

  const snapshotPath = path.join(dir, 'snapshot.json');
  const topOpportunitiesPath = path.join(dir, 'top-opportunities.json');
  const falseRejectsPath = path.join(dir, 'false-rejects.json');
  const sourceQualityPath = path.join(dir, 'source-quality.json');

  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
  fs.writeFileSync(topOpportunitiesPath, JSON.stringify(topOpportunities, null, 2));
  fs.writeFileSync(
    falseRejectsPath,
    JSON.stringify(snapshot.falseRejectCandidates, null, 2),
  );
  fs.writeFileSync(
    sourceQualityPath,
    JSON.stringify(snapshot.sourceQuality, null, 2),
  );

  return {
    snapshotPath,
    topOpportunitiesPath,
    falseRejectsPath,
    sourceQualityPath,
  };
}
