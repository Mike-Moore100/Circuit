// Promotion service — service-shaped wrapper around the promotion +
// qualification stages. Same ServiceResult / ProgressCallback contract
// every other Circuit service uses. CLIs, API routes, dashboards, and
// future schedulers all consume this.

import type { Database } from 'better-sqlite3';
import { getDb } from '../db/client';
import { getQualificationQueueStats, listQualificationQueue } from '../db/repository';
import {
  promoteDiscoveryToCompanies,
  type PromotionItem,
  type PromotionRunResult,
} from '../promotion/promoteDiscoveryToCompanies';
import {
  processQualificationQueue,
  type QualificationProcessorResult,
} from '../promotion/promotionScheduler';
import {
  makeResult,
  NOOP_PROGRESS,
  type ProgressCallback,
  type ServiceResult,
} from './types';

export interface PromotionServiceOptions {
  // Cap the number of fresh discoveries the gate considers in this run.
  limit?: number;
  // Tune the signal-threshold (higher = more selective). Optional.
  signalThreshold?: number;
  // If true, also process the qualification queue after promotion.
  processQueue?: boolean;
  // Queue processor caps.
  queueLimit?: number;
  queueRateLimitMs?: number;
  onProgress?: ProgressCallback;
  db?: Database;
}

export interface PromotionServiceStats {
  considered: number;
  promoted: number;
  skipped: number;
  qualificationAttempted: number;
  qualificationPromoted: number;
  qualificationFailed: number;
}

export async function runPromotionBatch(
  options: PromotionServiceOptions = {},
): Promise<ServiceResult<PromotionItem, PromotionServiceStats>> {
  const startedAt = new Date();
  const onProgress = options.onProgress ?? NOOP_PROGRESS;
  const db = options.db ?? getDb();
  const errors: string[] = [];

  onProgress({
    level: 'info',
    code: 'promotion.start',
    message: 'evaluating fresh validated discoveries',
  });

  let promotion: PromotionRunResult;
  try {
    promotion = promoteDiscoveryToCompanies({
      limit: options.limit,
      signalThreshold: options.signalThreshold,
      db,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return makeResult<PromotionItem, PromotionServiceStats>({
      ok: false,
      startedAt,
      items: [],
      stats: {
        considered: 0,
        promoted: 0,
        skipped: 0,
        qualificationAttempted: 0,
        qualificationPromoted: 0,
        qualificationFailed: 0,
      },
      errors: [`promotion: ${msg}`],
    });
  }

  errors.push(...promotion.errors);

  for (const item of promotion.items) {
    onProgress({
      level: item.decision === 'PROMOTE' ? 'success' : 'info',
      code: `promotion.${item.decision.toLowerCase()}`,
      message: `${item.domain}: ${item.decision} — ${item.reason} (score ${item.signalScore})`,
      data: {
        domain: item.domain,
        decision: item.decision,
        signalScore: item.signalScore,
        reason: item.reason,
      },
    });
  }

  onProgress({
    level: 'info',
    code: 'promotion.done',
    message: `considered=${promotion.considered} promoted=${promotion.promoted} skipped=${promotion.skipped}`,
    data: {
      considered: promotion.considered,
      promoted: promotion.promoted,
      skipped: promotion.skipped,
    },
  });

  let qualification: QualificationProcessorResult = {
    attempted: 0,
    promoted: 0,
    failed: 0,
    errors: [],
  };

  if (options.processQueue) {
    onProgress({
      level: 'info',
      code: 'qualification.start',
      message: 'processing qualification queue',
    });
    try {
      qualification = await processQualificationQueue({
        limit: options.queueLimit,
        rateLimitMs: options.queueRateLimitMs,
        db,
        onProgress: (event) =>
          onProgress({
            level:
              event.status === 'PROMOTED'
                ? 'success'
                : event.status === 'FAILED'
                ? 'error'
                : 'info',
            code: `qualification.${event.status.toLowerCase()}`,
            message: `${event.domain}: ${event.status}${event.reason ? ' — ' + event.reason : ''}`,
            data: event,
          }),
      });
      errors.push(...qualification.errors);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`qualification: ${msg}`);
    }
    onProgress({
      level: 'info',
      code: 'qualification.done',
      message: `attempted=${qualification.attempted} promoted=${qualification.promoted} failed=${qualification.failed}`,
      data: qualification,
    });
  }

  return makeResult<PromotionItem, PromotionServiceStats>({
    ok: errors.length === 0,
    startedAt,
    items: promotion.items,
    stats: {
      considered: promotion.considered,
      promoted: promotion.promoted,
      skipped: promotion.skipped,
      qualificationAttempted: qualification.attempted,
      qualificationPromoted: qualification.promoted,
      qualificationFailed: qualification.failed,
    },
    errors,
  });
}

// Read-only — used by the dashboard + CLI.
export function getPromotionOverview(db: Database = getDb()): {
  stats: ReturnType<typeof getQualificationQueueStats>;
  recent: ReturnType<typeof listQualificationQueue>;
} {
  return {
    stats: getQualificationQueueStats(db),
    recent: listQualificationQueue({ limit: 20 }, db),
  };
}
