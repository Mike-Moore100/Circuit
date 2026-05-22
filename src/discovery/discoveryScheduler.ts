// Discovery scheduler — query-matrix orchestrator. Takes a list of
// (industry × location) queries, a list of source connectors, runs them
// with polite rate limiting, dedupes the raw stream, validates each
// surviving domain lightly, and returns a structured result the
// downstream pipeline can promote into companies.

import type { Database } from 'better-sqlite3';
import { getDb } from '../db/client';
import {
  insertDiscoveryRun,
  insertRawDiscovery,
  updateDiscoveryRunStats,
} from '../db/repository';
import { duckDuckGoSerp } from './serpDiscovery';
import { yellDirectory } from './directoryDiscovery';
import { extractDomain } from './domainExtraction';
import {
  dedupeBatch,
  rejectExistingDomains,
} from './discoveryDeduper';
import { validateWebsite, type ValidationResult } from './websiteValidation';
import { config as appConfig } from '../config/index';
import type {
  DiscoveryQuery,
  DiscoverySourceConnector,
  RawDiscovery,
} from './discoveryTypes';

export interface ScheduleOptions {
  // The (industry × location) query matrix.
  queries: DiscoveryQuery[];
  // Which connectors to fire. Default = all free ones available.
  // FREE_SOURCE_MODE=1 strips any connector with isFree=false.
  sources?: DiscoverySourceConnector[];
  maxPerQuery?: number;
  // Politeness — minimum ms between successive HTTP requests.
  rateLimitMs?: number;
  // Validation knobs.
  validate?: boolean; // default true
  validationTimeoutMs?: number;
  // DB + progress.
  db?: Database;
  onRawDiscovery?: (item: RawDiscovery) => void;
  onValidation?: (result: ValidationResult) => void;
  // Injection for tests.
  fetchImpl?: typeof fetch;
}

export interface DiscoveryBatchResult {
  runId: string;
  source: string; // canonical "scheduler" label so callers can group runs
  startedAt: string;
  completedAt: string;
  rawFound: number;
  validDomains: number;
  deduped: number;
  rejected: number;
  errors: string[];
  // The validated, fresh, deduped subset — what the deeper pipeline
  // should chew on next.
  freshDomains: Array<{
    domain: string;
    businessName: string;
    sourceName: string;
    rawUrl: string;
    location: string | null;
    phone: string | null;
    industry: string | null;
    discoveryQuery: string | null;
    discoveryLocation: string | null;
  }>;
}

// Single source of truth for which free connectors ship by default.
function defaultSources(): DiscoverySourceConnector[] {
  return [duckDuckGoSerp, yellDirectory];
}

function applyFreeMode(sources: DiscoverySourceConnector[]): DiscoverySourceConnector[] {
  if (!appConfig.freeSourceMode) return sources;
  return sources.filter((s) => s.isFree);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runDiscovery(
  opts: ScheduleOptions,
): Promise<DiscoveryBatchResult> {
  const db = opts.db ?? getDb();
  const sources = applyFreeMode(opts.sources ?? defaultSources());
  const rateLimitMs = opts.rateLimitMs ?? 1200;
  const maxPerQuery = opts.maxPerQuery ?? 25;
  const startedAt = new Date();
  const errors: string[] = [];

  // Persist run shell upfront so we can track partial progress.
  const sourceLabel = sources.map((s) => s.name).join(',') || 'none';
  const runId = insertDiscoveryRun(
    {
      source: sourceLabel,
      startedAt: startedAt.toISOString(),
    },
    db,
  );

  // ---- 1. Fan out the query matrix across all connectors ---------------
  // Stamp each raw row with the query's industry + location + the query
  // string itself. Connectors don't need to know about these fields —
  // we tag here so every connector inherits the behaviour automatically.
  const allRaw: RawDiscovery[] = [];
  for (const connector of sources) {
    for (const query of opts.queries) {
      const discoveryQueryString = [query.industry, query.location, ...(query.modifiers ?? [])]
        .filter(Boolean)
        .join(' ');
      try {
        const items = await connector.search(query, {
          maxResults: maxPerQuery,
          fetchImpl: opts.fetchImpl,
        });
        for (const item of items) {
          const tagged: RawDiscovery = {
            ...item,
            industry: item.industry ?? query.industry ?? null,
            discoveryQuery: item.discoveryQuery ?? discoveryQueryString,
            discoveryLocation: item.discoveryLocation ?? query.location ?? null,
          };
          allRaw.push(tagged);
          opts.onRawDiscovery?.(tagged);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${connector.name}/${query.industry}/${query.location}: ${msg}`);
      }
      if (rateLimitMs > 0) await delay(rateLimitMs);
    }
  }

  // ---- 2. In-batch dedupe ---------------------------------------------
  const inBatch = dedupeBatch(allRaw);

  // ---- 3. Cross-DB dedupe ---------------------------------------------
  const crossDb = rejectExistingDomains(inBatch.unique, db);

  // ---- 4. Validate the survivors --------------------------------------
  const valid: RawDiscovery[] = [];
  const invalid: RawDiscovery[] = [];
  if (opts.validate !== false) {
    for (const item of crossDb.fresh) {
      if (!item.extractedDomain) continue;
      // Already-flagged invalids (aggregator hosts, etc.) skip validation.
      if (item.validationStatus === 'invalid') {
        invalid.push(item);
        continue;
      }
      try {
        const result = await validateWebsite(item.extractedDomain, {
          timeoutMs: opts.validationTimeoutMs ?? 6000,
          fetchImpl: opts.fetchImpl,
        });
        opts.onValidation?.(result);
        if (result.status === 'valid') {
          valid.push({ ...item, validationStatus: 'valid' });
        } else {
          invalid.push({
            ...item,
            validationStatus: 'invalid',
            validationReason: result.reason ?? 'validation failed',
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        invalid.push({
          ...item,
          validationStatus: 'invalid',
          validationReason: `validator: ${msg}`,
        });
      }
      if (rateLimitMs > 0) await delay(Math.min(rateLimitMs, 600));
    }
  } else {
    // Skip validation entirely if the caller asked us to.
    for (const item of crossDb.fresh) {
      if (item.validationStatus === 'invalid') invalid.push(item);
      else valid.push({ ...item, validationStatus: 'valid' });
    }
  }

  // ---- 5. Persist every raw discovery ---------------------------------
  for (const row of [
    ...valid,
    ...invalid,
    ...inBatch.duplicates,
    ...crossDb.known,
    ...inBatch.unparseable,
  ]) {
    insertRawDiscovery({ runId, ...row }, db);
  }

  // ---- 6. Finish the run record ---------------------------------------
  const completedAt = new Date();
  const totalDuplicates = inBatch.duplicates.length + crossDb.known.length;
  updateDiscoveryRunStats(
    {
      id: runId,
      completedAt: completedAt.toISOString(),
      rawFound: allRaw.length,
      validDomains: valid.length,
      deduped: totalDuplicates,
      rejected: invalid.length + inBatch.unparseable.length,
      errors,
    },
    db,
  );

  return {
    runId,
    source: sourceLabel,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    rawFound: allRaw.length,
    validDomains: valid.length,
    deduped: totalDuplicates,
    rejected: invalid.length + inBatch.unparseable.length,
    errors,
    freshDomains: valid.map((v) => ({
      domain: v.extractedDomain ?? extractDomain(v.rawUrl) ?? '',
      businessName: v.businessName,
      sourceName: v.source,
      rawUrl: v.rawUrl,
      location: v.location,
      phone: v.phone,
      industry: v.industry ?? null,
      discoveryQuery: v.discoveryQuery ?? null,
      discoveryLocation: v.discoveryLocation ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Default query matrix — sensible UK/US SMB seed. Operator can override.
// ---------------------------------------------------------------------------
export const DEFAULT_INDUSTRIES = [
  'marketing agency',
  'design studio',
  'recruitment agency',
  'accountants',
  'estate agents',
  'legal services',
  'consultancy',
  'fitness studio',
  'dental practice',
  'plumber',
];

export const DEFAULT_LOCATIONS = [
  'London',
  'Manchester',
  'Birmingham',
  'Bristol',
  'Leeds',
  'Edinburgh',
  'Glasgow',
];

export function buildDefaultQueryMatrix(): DiscoveryQuery[] {
  const out: DiscoveryQuery[] = [];
  for (const industry of DEFAULT_INDUSTRIES) {
    for (const location of DEFAULT_LOCATIONS) {
      out.push({ industry, location });
    }
  }
  return out;
}
