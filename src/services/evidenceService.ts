// Evidence extraction service — same shape as contactDiscoveryService.
// Per-lead engine: src/evidence/evidenceScoring.ts. This service wraps
// eligibility + sequential iteration (Playwright is heavy; we don't run
// it concurrently).

import type { Database } from 'better-sqlite3';
import { config } from '../config/index';
import { getDb } from '../db/client';
import { getAllCompanies, getLatestScore } from '../db/repository';
import {
  extractEvidenceForCompany,
  type ExtractEvidenceOptions,
} from '../evidence/evidenceScoring';
import type { LeadEvidence } from '../evidence/evidenceTypes';
import type { Campaign } from '../scoring/campaignTypes';
import {
  makeResult,
  NOOP_PROGRESS,
  type ProgressCallback,
  type ServiceResult,
} from './types';

export interface EvidenceBatchOptions {
  force?: boolean;
  limit?: number | null;
  onProgress?: ProgressCallback;
  db?: Database;
}

export interface EvidenceBatchItem {
  companyId: string;
  companyName: string;
  campaign: Campaign;
  status: 'ok' | 'partial' | 'failed';
  evidenceConfidence: number;
  visualIssueCount: number;
  operationalClueCount: number;
  desktopScreenshot: boolean;
  mobileScreenshot: boolean;
  errorMessage?: string;
}

export interface EvidenceBatchStats {
  attempted: number;
  ok: number;
  partial: number;
  failed: number;
  desktopScreenshots: number;
  mobileScreenshots: number;
}

export interface EligibleEvidenceCompany {
  id: string;
  name: string;
  websiteUrl: string;
  campaign: Campaign;
}

export function listEligibleForEvidence(
  db: Database = getDb(),
): EligibleEvidenceCompany[] {
  const allowedCampaigns = new Set<string>(config.evidence.allowedCampaigns);
  const allowedPriorities = new Set(config.evidence.allowedPriorities);
  const out: EligibleEvidenceCompany[] = [];
  for (const c of getAllCompanies(db)) {
    if (!c.website_url) continue;
    const score = getLatestScore(c.id, db);
    if (!score) continue;
    const campaign = (score.primary_campaign ?? 'LOW_PRIORITY_NURTURE') as Campaign;
    if (!allowedCampaigns.has(campaign)) continue;
    if (!allowedPriorities.has(score.priority as 'A' | 'B' | 'C')) continue;
    out.push({ id: c.id, name: c.name, websiteUrl: c.website_url, campaign });
  }
  return out;
}

// Single-lead variant — for a dashboard "re-capture" button.
export async function runEvidenceForLead(
  opts: ExtractEvidenceOptions,
): Promise<LeadEvidence> {
  return extractEvidenceForCompany(opts);
}

// Batch variant — orchestration moved out of scripts/extractEvidence.ts.
export async function runEvidenceBatch(
  options: EvidenceBatchOptions = {},
): Promise<ServiceResult<EvidenceBatchItem, EvidenceBatchStats>> {
  const startedAt = new Date();
  const onProgress = options.onProgress ?? NOOP_PROGRESS;
  const db = options.db ?? getDb();
  const force = options.force ?? false;
  const errors: string[] = [];

  if (!config.evidence.enabled) {
    onProgress({
      level: 'warn',
      code: 'batch.disabled',
      message: 'Evidence extraction disabled (EVIDENCE_ENABLED=0)',
    });
    return makeResult<EvidenceBatchItem, EvidenceBatchStats>({
      ok: true,
      startedAt,
      items: [],
      stats: { attempted: 0, ok: 0, partial: 0, failed: 0, desktopScreenshots: 0, mobileScreenshots: 0 },
    });
  }

  const candidates = listEligibleForEvidence(db);
  const cap = config.evidence.maxLeadsPerRun;
  const target = candidates.slice(0, options.limit ?? cap);

  onProgress({
    level: 'info',
    code: 'batch.start',
    message: `${target.length} eligible companies (force=${force}, cap=${cap})`,
    data: { eligibleCount: target.length, force, cap },
  });

  const items: EvidenceBatchItem[] = [];
  const stats: EvidenceBatchStats = {
    attempted: 0,
    ok: 0,
    partial: 0,
    failed: 0,
    desktopScreenshots: 0,
    mobileScreenshots: 0,
  };

  for (const co of target) {
    stats.attempted += 1;
    try {
      const result = await extractEvidenceForCompany({
        companyId: co.id,
        websiteUrl: co.websiteUrl,
        campaign: co.campaign,
        force,
        db,
      });
      const desktop = !!result.desktopScreenshotPath;
      const mobile = !!result.mobileScreenshotPath;
      if (desktop) stats.desktopScreenshots += 1;
      if (mobile) stats.mobileScreenshots += 1;
      const status: EvidenceBatchItem['status'] = result.errorMessage ? 'partial' : 'ok';
      if (result.errorMessage) stats.partial += 1;
      else stats.ok += 1;
      items.push({
        companyId: co.id,
        companyName: co.name,
        campaign: co.campaign,
        status,
        evidenceConfidence: result.evidenceConfidence,
        visualIssueCount: result.visualIssues.length,
        operationalClueCount: result.operationalClues.length,
        desktopScreenshot: desktop,
        mobileScreenshot: mobile,
        errorMessage: result.errorMessage,
      });
      onProgress({
        level: status === 'ok' ? 'success' : 'warn',
        code: `lead.${status}`,
        message: `${co.name} — conf=${result.evidenceConfidence} issues=${result.visualIssues.length} clues=${result.operationalClues.length}`,
        data: {
          companyId: co.id,
          campaign: co.campaign,
          evidenceConfidence: result.evidenceConfidence,
          errorMessage: result.errorMessage,
        },
      });
    } catch (err) {
      stats.failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${co.name}: ${msg}`);
      items.push({
        companyId: co.id,
        companyName: co.name,
        campaign: co.campaign,
        status: 'failed',
        evidenceConfidence: 0,
        visualIssueCount: 0,
        operationalClueCount: 0,
        desktopScreenshot: false,
        mobileScreenshot: false,
        errorMessage: msg,
      });
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
    message: `ok=${stats.ok} partial=${stats.partial} failed=${stats.failed}`,
    data: stats,
  });

  return makeResult<EvidenceBatchItem, EvidenceBatchStats>({
    ok: stats.failed === 0,
    startedAt,
    items,
    stats,
    errors,
  });
}
