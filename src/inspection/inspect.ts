import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { config } from '../config/index';
import { getDb } from '../db/client';
import {
  extractDomain,
  getInspectionByDomain,
  upsertInspection,
  type WebsiteInspectionRecord,
} from '../db/repository';
import { inspectWebsite, type InspectWebsiteOptions } from './websiteInspector';
import { extractSignalsFromPages } from './extractWebsiteSignals';
import type { InspectionResult, VerifiedSignal } from './types';

// Returns the persisted inspection record (cached or freshly fetched) plus
// the resolved signals for the caller to fold into the lead/scoring path.
export interface CachedOrFreshInspection {
  result: InspectionResult;
  record: WebsiteInspectionRecord;
}

export interface InspectAndCacheOptions extends InspectWebsiteOptions {
  companyId?: string | null;
  force?: boolean;
}

function isFresh(record: WebsiteInspectionRecord): boolean {
  const ttlMs = config.websiteInspection.cacheTtlDays * 24 * 60 * 60 * 1000;
  const age = Date.now() - new Date(record.fetched_at).getTime();
  return age < ttlMs;
}

function parseCachedSignals(record: WebsiteInspectionRecord): VerifiedSignal[] {
  try {
    const parsed = JSON.parse(record.signals_json) as VerifiedSignal[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function inspectAndCache(
  url: string | null | undefined,
  options: InspectAndCacheOptions = {},
  db: Database = getDb(),
): Promise<CachedOrFreshInspection | null> {
  const domain = url ? extractDomain(url) : null;

  // ---- Cache hit ---------------------------------------------------------
  if (!options.force && domain) {
    const cached = getInspectionByDomain(domain, db);
    if (cached && isFresh(cached)) {
      return {
        result: {
          url: cached.url,
          domain: cached.domain,
          status: cached.status as InspectionResult['status'],
          pages: [],
          signals: parseCachedSignals(cached),
          fetchedAt: cached.fetched_at,
          fromCache: true,
          errorMessage: cached.error_message ?? undefined,
          durationMs: 0,
        },
        record: cached,
      };
    }
  }

  // ---- Cache miss → real inspection -------------------------------------
  const live = await inspectWebsite(url, {
    timeoutMs: options.timeoutMs,
    maxPagesPerSite: options.maxPagesPerSite,
    fetchImpl: options.fetchImpl,
    userAgent: options.userAgent,
  });

  // Re-derive signals from pages in case the inspector path didn't populate
  // them (defensive — `inspectWebsite` already does this for the OK path).
  const signals =
    live.signals.length > 0 ? live.signals : extractSignalsFromPages(live.pages);

  const fingerprintSummary = live.pages.length
    ? JSON.stringify(
        live.pages.map((p) => ({
          url: p.url,
          finalUrl: p.finalUrl,
          statusCode: p.statusCode,
          title: p.title,
          metaDescription: p.metaDescription,
          internalLinkCount: p.links.filter((l) => l.rel === 'internal').length,
          formCount: p.forms.length,
        })),
      )
    : null;

  const record = upsertInspection(
    {
      companyId: options.companyId ?? null,
      url: live.url || url || '',
      domain,
      status: live.status,
      statusCode: live.pages[0]?.statusCode ?? null,
      title: live.pages[0]?.title ?? null,
      metaDescription: live.pages[0]?.metaDescription ?? null,
      contentLength: live.pages[0]?.rawHtmlPreview?.length ?? null,
      signalsJson: JSON.stringify(signals),
      fingerprintJson: fingerprintSummary,
      errorMessage: live.errorMessage ?? null,
    },
    db,
  );

  return {
    result: { ...live, signals, record_id: record.id } as InspectionResult & { record_id?: string },
    record,
  };
}

// Generic bounded-concurrency mapper. Avoids pulling in a `p-limit` dep.
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        results[i] = await fn(items[i], i);
      }
    }),
  );
  return results;
}
