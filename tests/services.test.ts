import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { SCHEMA_SQL } from '../src/db/schema';
import { recomputeAllIntelligence } from '../src/services/intelligenceService';
import {
  listEligibleForContactDiscovery,
} from '../src/services/contactDiscoveryService';
import {
  listEligibleForEvidence,
} from '../src/services/evidenceService';
import type { ProgressEvent } from '../src/services/types';

// ---------------------------------------------------------------------------
// In-memory DB matching production schema + the ALTERs runMigrations runs.
// ---------------------------------------------------------------------------
function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  for (const sql of [
    'ALTER TABLE lead_scores ADD COLUMN primary_campaign TEXT',
    'ALTER TABLE lead_scores ADD COLUMN campaign_scores_json TEXT',
    'ALTER TABLE lead_scores ADD COLUMN campaign_reasons_json TEXT',
    'ALTER TABLE lead_scores ADD COLUMN primary_reason TEXT',
    'ALTER TABLE lead_scores ADD COLUMN suggested_investigation TEXT',
    'ALTER TABLE contacts ADD COLUMN contact_type TEXT',
    'ALTER TABLE contacts ADD COLUMN source TEXT',
    'ALTER TABLE contacts ADD COLUMN source_url TEXT',
    'ALTER TABLE contacts ADD COLUMN email_type TEXT',
    'ALTER TABLE contacts ADD COLUMN email_status TEXT',
    'ALTER TABLE contacts ADD COLUMN role_confidence REAL',
    'ALTER TABLE contacts ADD COLUMN email_confidence REAL',
    'ALTER TABLE contacts ADD COLUMN overall_confidence REAL',
    'ALTER TABLE contacts ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE contacts ADD COLUMN discovered_at TEXT',
  ]) {
    try {
      db.exec(sql);
    } catch {
      /* duplicate column */
    }
  }
  return db;
}

function seedCompany(
  db: Database.Database,
  name: string,
  options: {
    primaryCampaign?: string;
    priority?: string;
    website?: string | null;
    size?: number;
    industry?: string;
  } = {},
): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO companies
       (id, name, domain, website_url, industry, location, size_estimate,
        source, source_url, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'London', ?, 'mock', NULL, 'review',
             datetime('now'), datetime('now'))`,
  ).run(
    id,
    name,
    options.website ? new URL(options.website).hostname : null,
    options.website ?? null,
    options.industry ?? 'marketing agency',
    options.size ?? 10,
  );
  db.prepare(
    `INSERT INTO lead_scores
       (id, company_id, rule_score, intent_score, final_score, priority, reasons_json, created_at, primary_campaign)
     VALUES (?, ?, 80, 70, 75, ?, '{}', datetime('now'), ?)`,
  ).run(
    randomUUID(),
    id,
    options.priority ?? 'A',
    options.primaryCampaign ?? 'AI_AUTOMATION',
  );
  return id;
}

// ---------------------------------------------------------------------------
// Eligibility filters
// ---------------------------------------------------------------------------
describe('eligibility filters', () => {
  it('listEligibleForContactDiscovery includes priority A AI_AUTOMATION leads with a website', () => {
    const db = makeDb();
    seedCompany(db, 'Acme', { primaryCampaign: 'AI_AUTOMATION', website: 'https://acme.test' });
    const out = listEligibleForContactDiscovery(db);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Acme');
  });

  it('excludes leads with no website', () => {
    const db = makeDb();
    seedCompany(db, 'No site', { primaryCampaign: 'AI_AUTOMATION', website: null });
    expect(listEligibleForContactDiscovery(db)).toEqual([]);
  });

  it('excludes priority C leads (allowed list is A,B)', () => {
    const db = makeDb();
    seedCompany(db, 'C lead', { priority: 'C', website: 'https://c.test' });
    expect(listEligibleForContactDiscovery(db)).toEqual([]);
  });

  it('excludes REJECT-routed leads', () => {
    const db = makeDb();
    seedCompany(db, 'Rejected', {
      primaryCampaign: 'REJECT',
      website: 'https://rejected.test',
    });
    expect(listEligibleForContactDiscovery(db)).toEqual([]);
  });

  it('listEligibleForEvidence applies the same shape of filter', () => {
    const db = makeDb();
    seedCompany(db, 'EvCo', {
      primaryCampaign: 'WEB_REBUILD',
      website: 'https://ev.test',
    });
    expect(listEligibleForEvidence(db).map((c) => c.name)).toEqual(['EvCo']);
  });
});

// ---------------------------------------------------------------------------
// Intelligence batch service
// ---------------------------------------------------------------------------
describe('recomputeAllIntelligence', () => {
  it('emits start + done progress events and per-lead items', async () => {
    const db = makeDb();
    seedCompany(db, 'Lead A', { primaryCampaign: 'AI_AUTOMATION', website: 'https://a.test' });
    seedCompany(db, 'Lead B', { primaryCampaign: 'WEB_REBUILD', website: 'https://b.test' });

    const events: ProgressEvent[] = [];
    const result = await recomputeAllIntelligence({
      db,
      onProgress: (e) => events.push(e),
    });

    expect(result.ok).toBe(true);
    expect(events[0].code).toBe('batch.start');
    expect(events[events.length - 1].code).toBe('batch.done');
    expect(result.items).toHaveLength(2);
    expect(result.stats!.ok).toBe(2);
    expect(result.stats!.failed).toBe(0);
  });

  it('items carry opportunity score and priority for every lead', async () => {
    const db = makeDb();
    seedCompany(db, 'Lead A', { primaryCampaign: 'AI_AUTOMATION', website: 'https://a.test' });
    const result = await recomputeAllIntelligence({ db });
    expect(result.items?.[0].opportunityScore).toBeGreaterThanOrEqual(0);
    expect(result.items?.[0].opportunityScore).toBeLessThanOrEqual(100);
    expect(['IMMEDIATE', 'HIGH', 'MEDIUM', 'LOW', 'IGNORE']).toContain(
      result.items?.[0].humanAttentionPriority,
    );
  });

  it('NOOP progress callback is the default and does not throw', async () => {
    const db = makeDb();
    seedCompany(db, 'Lead A', { primaryCampaign: 'AI_AUTOMATION', website: 'https://a.test' });
    // No onProgress provided — the service must still complete.
    const result = await recomputeAllIntelligence({ db });
    expect(result.ok).toBe(true);
  });

  it('returns a structured result with durationMs and ISO timestamps', async () => {
    const db = makeDb();
    seedCompany(db, 'Lead A', { primaryCampaign: 'AI_AUTOMATION', website: 'https://a.test' });
    const result = await recomputeAllIntelligence({ db });
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
