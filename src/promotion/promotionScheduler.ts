// Promotion + qualification orchestrator. Two distinct stages:
//
//   1. promoteDiscoveryToCompanies() — cheap, fast, deterministic.
//      Reads validated discoveries, runs the gate, upserts companies +
//      enqueues qualification rows. Returns immediately.
//
//   2. processQualificationQueue() — picks up PENDING items, runs the
//      qualification services (inspection → contacts → intelligence)
//      with per-item error isolation. Evidence is intentionally skipped
//      here because it's Playwright-heavy and the operator runs it
//      separately via npm run extract:evidence.
//
// The two stages are split so that high-volume promotion never blocks on
// slow per-lead qualification, and so the operator (or a future
// scheduler) can pace qualification independently.

import type { Database } from 'better-sqlite3';
import { getDb } from '../db/client';
import { inspectAndCache } from '../inspection/inspect';
import { discoverContactsForCompany } from '../contacts/contactDiscovery';
import { recomputeIntelligenceForLead } from '../services/intelligenceService';
import { scoreLead } from '../scoring/intentScoring';
import { persistScore } from '../db/repository';
import type { RawLead } from '../types/index';
import {
  promoteDiscoveryToCompanies,
  type PromotionRunOptions,
  type PromotionRunResult,
} from './promoteDiscoveryToCompanies';
import {
  listPendingDomains,
  transitionStatus,
} from './promotionQueue';
import type { QualificationStatus } from './promotionTypes';

// ---------------------------------------------------------------------------
// Stage 2: process the queue. Pick up PENDING items and walk them through
// the qualification services. Per-item try/catch — one bad lead never
// kills the loop.
// ---------------------------------------------------------------------------
export interface QualificationProcessorOptions {
  // Max items to take from the queue per run.
  limit?: number;
  // Pause between items (ms) — gentle for upstream sites we hit.
  rateLimitMs?: number;
  db?: Database;
  onProgress?: (event: { domain: string; status: QualificationStatus; reason?: string }) => void;
}

export interface QualificationProcessorResult {
  attempted: number;
  promoted: number; // moved PENDING → PROMOTED
  failed: number;   // moved PENDING → FAILED (kept for diagnostics)
  errors: string[];
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function processQualificationQueue(
  options: QualificationProcessorOptions = {},
): Promise<QualificationProcessorResult> {
  const db = options.db ?? getDb();
  const limit = options.limit ?? 25;
  const rateLimitMs = options.rateLimitMs ?? 800;
  const errors: string[] = [];
  let promoted = 0;
  let failed = 0;

  const items = listPendingDomains(limit, db);
  for (const item of items) {
    if (!item.companyId) {
      // PENDING without a company id shouldn't happen — but be safe.
      transitionStatus(item.domain, 'FAILED', { errorMessage: 'no company id on queue row' }, db);
      failed += 1;
      continue;
    }

    transitionStatus(item.domain, 'PROCESSING', {}, db);
    options.onProgress?.({ domain: item.domain, status: 'PROCESSING' });

    try {
      // ---- inspection ---------------------------------------------------
      await inspectAndCache(`https://${item.domain}`, {}, db);

      // ---- contacts -----------------------------------------------------
      await discoverContactsForCompany({
        companyId: item.companyId,
        websiteUrl: `https://${item.domain}`,
        db,
      });

      // ---- scoring (rule + intent + campaign) ---------------------------
      // Promoted-from-discovery companies don't go through the regular
      // sourcing pipeline so they have no lead_scores row yet. We build a
      // synthetic RawLead from what we know about the company + the
      // signals the inspector just persisted, then run the same scoring
      // chain the pipeline uses.
      await scorePromotedLead(item.companyId, item.domain, db);

      // ---- intelligence -------------------------------------------------
      recomputeIntelligenceForLead(item.companyId, db);

      transitionStatus(item.domain, 'PROMOTED', { companyId: item.companyId }, db);
      options.onProgress?.({ domain: item.domain, status: 'PROMOTED' });
      promoted += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${item.domain}: ${msg}`);
      transitionStatus(item.domain, 'FAILED', { errorMessage: msg }, db);
      options.onProgress?.({ domain: item.domain, status: 'FAILED', reason: msg });
      failed += 1;
    }

    if (rateLimitMs > 0) await delay(rateLimitMs);
  }

  return {
    attempted: items.length,
    promoted,
    failed,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Score a promoted company by synthesising the RawLead shape the pipeline's
// scoring stack expects. Inspection has already run by this point so the
// signals table carries verified.* rows; we lift those into the synthetic
// lead's signals array and let the existing scoring code do its job.
// ---------------------------------------------------------------------------
async function scorePromotedLead(
  companyId: string,
  domain: string,
  db: Database,
): Promise<void> {
  const company = db
    .prepare('SELECT * FROM companies WHERE id = ?')
    .get(companyId) as
    | {
        name: string;
        website_url: string | null;
        industry: string | null;
        location: string | null;
        size_estimate: number | null;
        source: string;
      }
    | undefined;
  if (!company) return;

  // Lift inspection signals into the lead so rule + intent + campaign
  // see them. We use confidence=1 because inspection signals are
  // verified-by-machine rather than fuzzy source signals.
  const signals = db
    .prepare(
      `SELECT type, value, confidence FROM signals
       WHERE company_id = ?`,
    )
    .all(companyId) as Array<{ type: string; value: string; confidence: number }>;

  const lead: RawLead = {
    companyName: company.name,
    websiteUrl: company.website_url,
    industry: company.industry,
    location: company.location,
    sizeEstimate: company.size_estimate,
    source: company.source,
    sourceUrl: `https://${domain}`,
    contactName: null,
    contactRole: null,
    contactEmail: null,
    linkedinUrl: null,
    notes: null,
    signals: signals.map((s) => ({
      type: s.type,
      value: s.value,
      confidence: s.confidence,
    })),
  };

  // scoreLead chains evaluateRules + evaluateIntent + classifyCampaign +
  // combineScores. Same code path the regular pipeline uses.
  const combined = scoreLead(lead);
  persistScore(companyId, combined, db);
}

// ---------------------------------------------------------------------------
// Convenience: one call that promotes new discoveries AND processes the
// queue. Useful for CLI / API "do everything" entry points.
// ---------------------------------------------------------------------------
export async function promoteAndProcess(
  options: PromotionRunOptions & QualificationProcessorOptions = {},
): Promise<{ promotion: PromotionRunResult; qualification: QualificationProcessorResult }> {
  const promotion = promoteDiscoveryToCompanies(options);
  const qualification = await processQualificationQueue(options);
  return { promotion, qualification };
}
