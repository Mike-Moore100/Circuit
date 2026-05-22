// Discovery service. Wraps src/discovery/discoveryScheduler.runDiscovery
// behind the same ServiceResult / ProgressCallback shape every other
// service follows. CLI, API routes, and any future scheduler call this
// — they never call discoveryScheduler directly.

import type { Database } from 'better-sqlite3';
import { getDb } from '../db/client';
import {
  getDiscoveryStats,
  listDiscoveryRuns,
  type DiscoveryRunRow,
} from '../db/repository';
import {
  buildDefaultQueryMatrix,
  runDiscovery,
} from '../discovery/discoveryScheduler';
import type {
  DiscoveryQuery,
  DiscoverySourceConnector,
} from '../discovery/discoveryTypes';
import {
  makeResult,
  NOOP_PROGRESS,
  type ProgressCallback,
  type ServiceResult,
} from './types';

export interface DiscoveryServiceOptions {
  queries?: DiscoveryQuery[];
  sources?: DiscoverySourceConnector[];
  maxPerQuery?: number;
  rateLimitMs?: number;
  validate?: boolean;
  validationTimeoutMs?: number;
  onProgress?: ProgressCallback;
  db?: Database;
  // Test injection.
  fetchImpl?: typeof fetch;
}

export interface DiscoveryServiceStats {
  rawFound: number;
  validDomains: number;
  deduped: number;
  rejected: number;
  runId: string;
}

export interface DiscoveryServiceItem {
  domain: string;
  businessName: string;
  sourceName: string;
  rawUrl: string;
}

export async function runDiscoveryBatch(
  options: DiscoveryServiceOptions = {},
): Promise<ServiceResult<DiscoveryServiceItem, DiscoveryServiceStats>> {
  const startedAt = new Date();
  const onProgress = options.onProgress ?? NOOP_PROGRESS;
  const db = options.db ?? getDb();
  const queries = options.queries ?? buildDefaultQueryMatrix();

  onProgress({
    level: 'info',
    code: 'discovery.start',
    message: `running ${queries.length} queries`,
    data: { queryCount: queries.length },
  });

  // Forward per-raw-row events to subscribers — useful for live UI.
  const result = await runDiscovery({
    queries,
    sources: options.sources,
    maxPerQuery: options.maxPerQuery,
    rateLimitMs: options.rateLimitMs,
    validate: options.validate,
    validationTimeoutMs: options.validationTimeoutMs,
    db,
    fetchImpl: options.fetchImpl,
    onRawDiscovery: (item) =>
      onProgress({
        level: 'info',
        code: 'discovery.raw',
        message: `${item.source}: ${item.businessName}`,
        data: {
          source: item.source,
          domain: item.extractedDomain,
        },
      }),
    onValidation: (val) =>
      onProgress({
        level: val.status === 'valid' ? 'success' : 'warn',
        code: `discovery.validation.${val.status}`,
        message: `${val.domain}: ${val.status}${val.reason ? ' — ' + val.reason : ''}`,
        data: {
          domain: val.domain,
          status: val.status,
          reason: val.reason ?? null,
        },
      }),
  });

  onProgress({
    level: 'info',
    code: 'discovery.done',
    message: `raw=${result.rawFound} valid=${result.validDomains} deduped=${result.deduped} rejected=${result.rejected}`,
    data: {
      rawFound: result.rawFound,
      valid: result.validDomains,
      deduped: result.deduped,
      rejected: result.rejected,
    },
  });

  return makeResult<DiscoveryServiceItem, DiscoveryServiceStats>({
    ok: result.errors.length === 0,
    startedAt,
    items: result.freshDomains.map((d) => ({
      domain: d.domain,
      businessName: d.businessName,
      sourceName: d.sourceName,
      rawUrl: d.rawUrl,
    })),
    stats: {
      rawFound: result.rawFound,
      validDomains: result.validDomains,
      deduped: result.deduped,
      rejected: result.rejected,
      runId: result.runId,
    },
    errors: result.errors,
  });
}

// Read-only helpers exposed for the dashboard and CLI.
export function getDiscoveryOverview(db: Database = getDb()): {
  stats: ReturnType<typeof getDiscoveryStats>;
  recentRuns: DiscoveryRunRow[];
} {
  return {
    stats: getDiscoveryStats(db),
    recentRuns: listDiscoveryRuns(db, 10),
  };
}
