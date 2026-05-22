// Phase 1 — verify the promotion bridge carries industry metadata from
// raw_discoveries onto companies, and that corpus health reads
// normalised labels (not raw "(unknown)") afterwards.

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { SCHEMA_SQL } from '../src/db/schema';
import {
  insertRawDiscovery,
  upsertCompanyFromPromotion,
} from '../src/db/repository';
import { computeCorpusHealth } from '../src/discovery/corpusHealth';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}

function seedDiscoveryRun(db: Database.Database): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO discovery_runs (id, source, started_at) VALUES (?, ?, datetime('now'))`,
  ).run(id, 'serp.duckduckgo');
  return id;
}

describe('insertRawDiscovery — Phase 1 metadata columns', () => {
  it('writes industry, discovery_query, discovery_location', () => {
    const db = makeDb();
    const runId = seedDiscoveryRun(db);
    insertRawDiscovery(
      {
        runId,
        source: 'serp.duckduckgo',
        businessName: 'Lumen Accounting',
        rawUrl: 'https://lumen.test',
        extractedDomain: 'lumen.test',
        title: 'Lumen Accounting — Leeds',
        snippet: 'Chartered accountants serving SMBs',
        location: 'Leeds',
        phone: null,
        discoveredAt: new Date().toISOString(),
        validationStatus: 'valid',
        validationReason: null,
        industry: 'accountants',
        discoveryQuery: 'accountants Leeds',
        discoveryLocation: 'Leeds',
      },
      db,
    );
    const row = db
      .prepare(
        'SELECT industry, discovery_query, discovery_location FROM raw_discoveries',
      )
      .get() as {
      industry: string | null;
      discovery_query: string | null;
      discovery_location: string | null;
    };
    expect(row.industry).toBe('accountants');
    expect(row.discovery_query).toBe('accountants Leeds');
    expect(row.discovery_location).toBe('Leeds');
  });
});

describe('upsertCompanyFromPromotion — industry persistence', () => {
  it('persists canonical industry + audit columns on first insert', () => {
    const db = makeDb();
    const id = upsertCompanyFromPromotion(
      {
        name: 'Lumen Accounting',
        domain: 'lumen.test',
        websiteUrl: 'https://lumen.test',
        source: 'serp.duckduckgo',
        location: 'Leeds',
        industry: 'accountants',
        discoveryQuery: 'accountants Leeds',
        discoveryLocation: 'Leeds',
        industrySource: 'query',
        industryConfidence: 92,
      },
      db,
    );
    const row = db
      .prepare(
        `SELECT industry, location, discovery_query, discovery_location,
                industry_source, industry_confidence
           FROM companies WHERE id = ?`,
      )
      .get(id) as {
      industry: string;
      location: string;
      discovery_query: string;
      discovery_location: string;
      industry_source: string;
      industry_confidence: number;
    };
    expect(row.industry).toBe('accountants');
    expect(row.discovery_query).toBe('accountants Leeds');
    expect(row.discovery_location).toBe('Leeds');
    expect(row.industry_source).toBe('query');
    expect(row.industry_confidence).toBe(92);
  });

  it('patches an existing untagged company without overwriting a hand-set value', () => {
    const db = makeDb();
    // First insert — no industry tag.
    const id = upsertCompanyFromPromotion(
      {
        name: 'Lumen Accounting',
        domain: 'lumen.test',
        websiteUrl: 'https://lumen.test',
        source: 'serp.duckduckgo',
        location: null,
      },
      db,
    );
    // Second pass — industry now known. Should patch through.
    upsertCompanyFromPromotion(
      {
        name: 'Lumen Accounting',
        domain: 'lumen.test',
        websiteUrl: 'https://lumen.test',
        source: 'serp.duckduckgo',
        location: 'Leeds',
        industry: 'accountants',
        industrySource: 'query',
        industryConfidence: 92,
      },
      db,
    );
    let row = db
      .prepare('SELECT industry FROM companies WHERE id = ?')
      .get(id) as { industry: string };
    expect(row.industry).toBe('accountants');

    // Now simulate an operator hand-edit and re-run the promotion —
    // the existing label must NOT be overwritten.
    db.prepare("UPDATE companies SET industry = 'legal services' WHERE id = ?").run(id);
    upsertCompanyFromPromotion(
      {
        name: 'Lumen Accounting',
        domain: 'lumen.test',
        websiteUrl: 'https://lumen.test',
        source: 'serp.duckduckgo',
        location: 'Leeds',
        industry: 'accountants',
        industrySource: 'query',
      },
      db,
    );
    row = db
      .prepare('SELECT industry FROM companies WHERE id = ?')
      .get(id) as { industry: string };
    expect(row.industry).toBe('legal services');
  });

  it('persists null industry when no metadata is supplied', () => {
    const db = makeDb();
    const id = upsertCompanyFromPromotion(
      {
        name: 'Anon Co',
        domain: 'anon.test',
        websiteUrl: 'https://anon.test',
        source: 'serp.duckduckgo',
        location: null,
      },
      db,
    );
    const row = db
      .prepare('SELECT industry, industry_source FROM companies WHERE id = ?')
      .get(id) as { industry: string | null; industry_source: string | null };
    expect(row.industry).toBeNull();
    expect(row.industry_source).toBeNull();
  });
});

describe('computeCorpusHealth — only (unknown) when truly missing', () => {
  it('does NOT bucket a tagged industry under "(unknown)"', () => {
    const report = computeCorpusHealth([
      { industry: 'accountants', source: 'a', primaryCampaign: null, sizeEstimate: null, opportunityScore: null },
      { industry: 'accountants', source: 'a', primaryCampaign: null, sizeEstimate: null, opportunityScore: null },
    ]);
    const unknown = report.industryDistribution.find((b) => b.bucket === '(unknown)');
    expect(unknown).toBeUndefined();
    const acc = report.industryDistribution.find((b) => b.bucket === 'accountants');
    expect(acc?.count).toBe(2);
  });

  it('buckets null industries as "(unknown)" without polluting target classifications', () => {
    const report = computeCorpusHealth([
      { industry: null, source: 'a', primaryCampaign: null, sizeEstimate: null, opportunityScore: null },
      { industry: 'accountants', source: 'a', primaryCampaign: null, sizeEstimate: null, opportunityScore: null },
    ]);
    expect(report.industryDistribution.some((b) => b.bucket === '(unknown)')).toBe(true);
    expect(
      report.industryBalance.classifications.some((c) => c.industry === '(unknown)'),
    ).toBe(false);
  });
});
