// Discovery → companies promoter. The cheap, deterministic side of the
// auto-promotion bridge.
//
// For every fresh validated discovery NOT already in qualification_queue:
//   - run the gate
//   - if PROMOTE: upsert companies row, enqueue as PENDING
//   - if SKIP: enqueue as SKIPPED (audit trail; no companies row)
//
// Returns a structured summary. No qualification work happens here —
// that's the job of the queue processor in promotionScheduler.ts.

import type { Database } from 'better-sqlite3';
import { getDb } from '../db/client';
import {
  listValidatedDiscoveriesAwaitingPromotion,
  upsertCompanyFromPromotion,
} from '../db/repository';
import { evaluatePromotion } from './qualificationGate';
import { enqueueQualification } from './promotionQueue';
import type { GateDecision } from './promotionTypes';
import {
  normaliseFromCandidates,
  type NormalizationResult,
} from '../discovery/industryNormalizer';

export interface PromotionRunOptions {
  // How many candidates to consider per run.
  limit?: number;
  // Tune the signal-threshold for this run (higher = more selective).
  signalThreshold?: number;
  db?: Database;
}

export interface PromotionItem {
  discoveryId: string;
  domain: string;
  businessName: string;
  decision: 'PROMOTE' | 'SKIP';
  signalScore: number;
  reason: string;
  companyId?: string;
}

export interface PromotionRunResult {
  considered: number;
  promoted: number;
  skipped: number;
  items: PromotionItem[];
  errors: string[];
}

export function promoteDiscoveryToCompanies(
  options: PromotionRunOptions = {},
): PromotionRunResult {
  const db = options.db ?? getDb();
  const candidates = listValidatedDiscoveriesAwaitingPromotion(db, options.limit ?? 500);
  const items: PromotionItem[] = [];
  const errors: string[] = [];
  let promoted = 0;
  let skipped = 0;

  for (const c of candidates) {
    if (!c.domain) continue;
    let decision: GateDecision;
    try {
      decision = evaluatePromotion(
        {
          discoveryId: c.id,
          domain: c.domain,
          businessName: c.business_name,
          title: c.title,
          snippet: c.snippet,
          source: c.source,
          phone: c.phone,
          location: c.location,
        },
        { threshold: options.signalThreshold },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${c.domain}: ${msg}`);
      continue;
    }

    if (decision.decision === 'PROMOTE') {
      try {
        // Phase 1 industry tagging — try each available field in
        // priority order. Discovery query is the strongest signal
        // (it's the operator's stated intent), title and snippet are
        // weaker because SERP results contain industry adjacents.
        const inferred: NormalizationResult = normaliseFromCandidates([
          { text: c.industry, source: 'query' },
          { text: c.discovery_query, source: 'query' },
          { text: c.title, source: 'title' },
          { text: c.snippet, source: 'snippet' },
          { text: c.business_name, source: 'name' },
        ]);
        const companyId = upsertCompanyFromPromotion(
          {
            name: c.business_name,
            domain: c.domain,
            websiteUrl: `https://${c.domain}`,
            source: c.source,
            location: c.location,
            industry: inferred.industry ?? null,
            discoveryQuery: c.discovery_query ?? null,
            discoveryLocation: c.discovery_location ?? c.location ?? null,
            industrySource: inferred.source ?? null,
            industryConfidence: inferred.industry ? inferred.confidence : null,
          },
          db,
        );
        enqueueQualification(
          {
            discoveryId: c.id,
            companyId,
            domain: c.domain,
            source: c.source,
            status: 'PENDING',
            priority: decision.signalScore,
            promotionReason: decision.primaryReason,
          },
          db,
        );
        promoted += 1;
        items.push({
          discoveryId: c.id,
          domain: c.domain,
          businessName: c.business_name,
          decision: 'PROMOTE',
          signalScore: decision.signalScore,
          reason: decision.primaryReason,
          companyId,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${c.domain}: promotion upsert: ${msg}`);
      }
    } else {
      try {
        enqueueQualification(
          {
            discoveryId: c.id,
            companyId: null,
            domain: c.domain,
            source: c.source,
            status: 'SKIPPED',
            priority: decision.signalScore,
            promotionReason: decision.primaryReason,
          },
          db,
        );
        skipped += 1;
        items.push({
          discoveryId: c.id,
          domain: c.domain,
          businessName: c.business_name,
          decision: 'SKIP',
          signalScore: decision.signalScore,
          reason: decision.primaryReason,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${c.domain}: skip enqueue: ${msg}`);
      }
    }
  }

  return {
    considered: candidates.length,
    promoted,
    skipped,
    items,
    errors,
  };
}
