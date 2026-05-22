// Phase 1 — system status banner tests. Pure-function tests over the
// "what banners do we surface for which registry_enrichments state".

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../src/db/schema';
import { upsertRegistryEnrichment } from '../src/db/repository';

// Tiny helper that bypasses the file-backed getDb in systemStatus.ts.
// We exercise the same SQL the service uses but against our in-memory
// connection — replicates the banner logic without coupling the test
// to the file system.

function mostRecentAuthError(db: Database.Database): string | null {
  const row = db
    .prepare(
      `SELECT reason FROM registry_enrichments
        WHERE outcome = 'error'
        ORDER BY fetched_at DESC
        LIMIT 1`,
    )
    .get() as { reason: string } | undefined;
  if (!row) return null;
  return /401|403|auth/i.test(row.reason) ? row.reason : null;
}

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  db.prepare(
    `INSERT INTO companies (id, name, domain, source, status, created_at, updated_at)
     VALUES ('c1', 'Lumen', 'lumen.co.uk', 'serp.duckduckgo',
             'review', datetime('now'), datetime('now'))`,
  ).run();
  return db;
}

describe('Companies House auth banner trigger logic', () => {
  it('does not fire when there are no registry errors', () => {
    const db = makeDb();
    expect(mostRecentAuthError(db)).toBeNull();
  });

  it('does not fire for a non-auth error (e.g. network)', () => {
    const db = makeDb();
    upsertRegistryEnrichment(
      {
        companyId: 'c1',
        registry: 'companies_house',
        outcome: 'error',
        recordJson: null,
        signalsJson: null,
        reason: 'fetch failed: connection reset',
        fetchedAt: '2026-05-22T10:00:00.000Z',
      },
      db,
    );
    expect(mostRecentAuthError(db)).toBeNull();
  });

  it('fires when the most-recent error is a 401', () => {
    const db = makeDb();
    upsertRegistryEnrichment(
      {
        companyId: 'c1',
        registry: 'companies_house',
        outcome: 'error',
        recordJson: null,
        signalsJson: null,
        reason: 'Companies House returned 401 — check COMPANIES_HOUSE_API_KEY',
        fetchedAt: '2026-05-22T10:00:00.000Z',
      },
      db,
    );
    expect(mostRecentAuthError(db)).toMatch(/401/);
  });

  it('clears when a more-recent enrichment succeeded', () => {
    const db = makeDb();
    // First — auth fails.
    upsertRegistryEnrichment(
      {
        companyId: 'c1',
        registry: 'companies_house',
        outcome: 'error',
        recordJson: null,
        signalsJson: null,
        reason: 'Companies House returned 401 — check COMPANIES_HOUSE_API_KEY',
        fetchedAt: '2026-05-22T10:00:00.000Z',
      },
      db,
    );
    // Later — same lead enriched successfully (e.g. new key). The
    // upsert replaces the row in place, so the auth error is gone.
    upsertRegistryEnrichment(
      {
        companyId: 'c1',
        registry: 'companies_house',
        outcome: 'enriched',
        recordJson: '{}',
        signalsJson: '{}',
        reason: 'matched',
        fetchedAt: '2026-05-22T11:00:00.000Z',
      },
      db,
    );
    expect(mostRecentAuthError(db)).toBeNull();
  });
});
