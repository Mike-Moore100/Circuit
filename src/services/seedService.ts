// Seed workflow service. Multi-step orchestration: reset DB → run pipeline
// → run evidence batch → recompute intelligence. Used by scripts/seed.ts;
// could also be triggered from the dashboard during development.

import { resetDb } from '../db/client';
import { runLeadSourcingPipeline } from '../pipeline/runLeadSourcingPipeline';
import { mockSourceConnector } from '../sources/index';
import { runEvidenceBatch } from './evidenceService';
import { recomputeAllIntelligence } from './intelligenceService';
import {
  makeResult,
  NOOP_PROGRESS,
  type ProgressCallback,
  type ServiceResult,
} from './types';

export interface SeedWorkflowOptions {
  // Skip the slow Playwright evidence pass — useful for fast iteration.
  skipEvidence?: boolean;
  onProgress?: ProgressCallback;
}

export interface SeedStats {
  fetched: number;
  accepted: number;
  rejected: number;
  priorities: { A: number; B: number; C: number; Reject: number };
  evidenceOk: number;
  evidencePartial: number;
  evidenceFailed: number;
  intelligenceComputed: number;
}

export async function runSeedWorkflow(
  options: SeedWorkflowOptions = {},
): Promise<ServiceResult<never, SeedStats>> {
  const startedAt = new Date();
  const onProgress = options.onProgress ?? NOOP_PROGRESS;
  const errors: string[] = [];

  onProgress({ level: 'info', code: 'reset', message: 'resetting database' });
  resetDb();

  onProgress({ level: 'info', code: 'pipeline.start', message: 'running pipeline against mock connector' });
  const summary = await runLeadSourcingPipeline({ sources: [mockSourceConnector] });
  onProgress({
    level: 'success',
    code: 'pipeline.done',
    message: `fetched=${summary.totalFetched} accepted=${summary.accepted} rejected=${summary.rejected}`,
    data: {
      fetched: summary.totalFetched,
      accepted: summary.accepted,
      rejected: summary.rejected,
      priorities: summary.byPriority,
    },
  });

  let evidenceOk = 0;
  let evidencePartial = 0;
  let evidenceFailed = 0;

  if (!options.skipEvidence) {
    onProgress({ level: 'info', code: 'evidence.start', message: 'extracting evidence on top leads' });
    const evidenceResult = await runEvidenceBatch({
      onProgress: (e) =>
        onProgress({
          ...e,
          // Prefix evidence sub-events so callers can disambiguate.
          code: `evidence.${e.code}`,
        }),
    });
    evidenceOk = evidenceResult.stats?.ok ?? 0;
    evidencePartial = evidenceResult.stats?.partial ?? 0;
    evidenceFailed = evidenceResult.stats?.failed ?? 0;
    errors.push(...evidenceResult.errors);
  } else {
    onProgress({ level: 'info', code: 'evidence.skipped', message: 'skipping evidence (--skip-evidence)' });
  }

  // Recompute intelligence so the post-evidence confidence sub-score lands.
  onProgress({ level: 'info', code: 'intel.start', message: 'recomputing intelligence' });
  const intelResult = await recomputeAllIntelligence({
    onProgress: (e) => onProgress({ ...e, code: `intel.${e.code}` }),
  });
  const intelligenceComputed = intelResult.stats?.ok ?? 0;
  errors.push(...intelResult.errors);

  return makeResult<never, SeedStats>({
    ok: errors.length === 0,
    startedAt,
    stats: {
      fetched: summary.totalFetched,
      accepted: summary.accepted,
      rejected: summary.rejected,
      priorities: summary.byPriority,
      evidenceOk,
      evidencePartial,
      evidenceFailed,
      intelligenceComputed,
    },
    errors,
  });
}
