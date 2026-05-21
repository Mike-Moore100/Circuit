// Contact discovery — batch + single-lead variants. Pure orchestration:
// the per-lead engine lives in src/contacts/contactDiscovery.ts; this
// service wraps eligibility filtering, concurrency, and progress reporting
// so the same code path runs whether the caller is a CLI, an API route,
// or a future scheduler.

import type { Database } from 'better-sqlite3';
import { config } from '../config/index';
import { getDb } from '../db/client';
import {
  getAllCompanies,
  getLatestScore,
} from '../db/repository';
import {
  discoverContactsForCompany,
  type DiscoverContactsOptions,
} from '../contacts/contactDiscovery';
import type { ContactDiscoveryResult } from '../contacts/contactTypes';
import type { Campaign } from '../scoring/campaignTypes';
import {
  makeResult,
  NOOP_PROGRESS,
  type ProgressCallback,
  type ServiceResult,
} from './types';

export interface ContactDiscoveryBatchOptions {
  force?: boolean;
  limit?: number | null;
  onProgress?: ProgressCallback;
  db?: Database;
}

export interface ContactDiscoveryItem {
  companyId: string;
  companyName: string;
  status: 'ok' | 'cached' | 'failed';
  contactsFound: number;
  routesFound: number;
  contactabilityScore: number;
  playwrightRan: boolean;
  errorMessage?: string;
}

export interface ContactDiscoveryStats {
  attempted: number;
  ok: number;
  cached: number;
  failed: number;
  totalContacts: number;
  totalDirectEmails: number;
  playwrightInvocations: number;
}

// ---------------------------------------------------------------------------
// Eligibility — derives the candidate list from DB state. Single source of
// truth so CLIs, API routes, and schedulers all agree on what's eligible.
// ---------------------------------------------------------------------------
export interface EligibleCompany {
  id: string;
  name: string;
  websiteUrl: string;
  campaign: Campaign;
}

export function listEligibleForContactDiscovery(
  db: Database = getDb(),
): EligibleCompany[] {
  const allowedCampaigns = new Set<string>(config.contactDiscovery.allowedCampaigns);
  const allowedPriorities = new Set(config.contactDiscovery.allowedPriorities);
  const out: EligibleCompany[] = [];
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

// ---------------------------------------------------------------------------
// Single-lead variant — usable from a dashboard "re-discover" button.
// ---------------------------------------------------------------------------
export async function runContactDiscoveryForLead(
  opts: Omit<DiscoverContactsOptions, 'db'> & { db?: Database },
): Promise<ContactDiscoveryResult> {
  const db = opts.db ?? getDb();
  return discoverContactsForCompany({ ...opts, db });
}

// ---------------------------------------------------------------------------
// Batch variant — the orchestration that lived in scripts/discoverContacts.ts
// ---------------------------------------------------------------------------
export async function runContactDiscoveryBatch(
  options: ContactDiscoveryBatchOptions = {},
): Promise<ServiceResult<ContactDiscoveryItem, ContactDiscoveryStats>> {
  const startedAt = new Date();
  const onProgress = options.onProgress ?? NOOP_PROGRESS;
  const db = options.db ?? getDb();
  const force = options.force ?? false;
  const errors: string[] = [];

  const candidates = listEligibleForContactDiscovery(db);
  const target = options.limit ? candidates.slice(0, options.limit) : candidates;

  onProgress({
    level: 'info',
    code: 'batch.start',
    message: `${target.length} eligible companies`,
    data: {
      eligibleCount: target.length,
      force,
      concurrency: config.contactDiscovery.concurrency,
    },
  });

  const stats: ContactDiscoveryStats = {
    attempted: 0,
    ok: 0,
    cached: 0,
    failed: 0,
    totalContacts: 0,
    totalDirectEmails: 0,
    playwrightInvocations: 0,
  };
  const items: ContactDiscoveryItem[] = [];

  const concurrency = Math.max(
    1,
    Math.min(config.contactDiscovery.concurrency, target.length || 1),
  );
  let cursor = 0;

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= target.length) return;
        const company = target[i];
        stats.attempted += 1;
        try {
          const result = await discoverContactsForCompany({
            companyId: company.id,
            websiteUrl: company.websiteUrl,
            force,
            db,
          });
          const status = result.fromCache ? 'cached' : 'ok';
          if (result.fromCache) stats.cached += 1;
          else stats.ok += 1;
          stats.totalContacts += result.contacts.length;
          stats.totalDirectEmails += result.contacts.filter(
            (c) => c.email && c.emailStatus === 'extracted',
          ).length;
          if (result.playwrightRan) stats.playwrightInvocations += 1;
          items.push({
            companyId: company.id,
            companyName: company.name,
            status,
            contactsFound: result.contacts.length,
            routesFound: result.routes.length,
            contactabilityScore: result.contactabilityScore,
            playwrightRan: result.playwrightRan,
          });
          onProgress({
            level: 'success',
            code: 'lead.ok',
            message: `${company.name} — contacts=${result.contacts.length} routes=${result.routes.length}`,
            data: {
              companyId: company.id,
              status,
              contacts: result.contacts.length,
              routes: result.routes.length,
              contactabilityScore: result.contactabilityScore,
            },
          });
        } catch (err) {
          stats.failed += 1;
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`${company.name}: ${msg}`);
          items.push({
            companyId: company.id,
            companyName: company.name,
            status: 'failed',
            contactsFound: 0,
            routesFound: 0,
            contactabilityScore: 0,
            playwrightRan: false,
            errorMessage: msg,
          });
          onProgress({
            level: 'error',
            code: 'lead.failed',
            message: `${company.name}: ${msg}`,
            data: { companyId: company.id, error: msg },
          });
        }
      }
    }),
  );

  onProgress({
    level: 'info',
    code: 'batch.done',
    message: `crawled=${stats.ok} cached=${stats.cached} failed=${stats.failed}`,
    data: stats,
  });

  return makeResult<ContactDiscoveryItem, ContactDiscoveryStats>({
    ok: stats.failed === 0,
    startedAt,
    items,
    stats,
    errors,
  });
}
