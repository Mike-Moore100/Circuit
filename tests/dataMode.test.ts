// Phase 14.1 — data mode invariants.
// We can't easily flip the config mid-test (it's read at module load),
// so these tests focus on the deterministic shape:
//   - schema columns exist
//   - mock connector declares DEMO
//   - filtering helpers produce the right SQL
//   - upserts default to REAL but accept DEMO/TEST when passed

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../src/db/schema';
import { dataModeWhere, visibleOrigins } from '../src/db/dataMode';
import { mockSourceConnector } from '../src/sources/mockSourceConnector';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}

describe('data mode helpers', () => {
  it('visibleOrigins returns at least REAL in any mode', () => {
    const o = visibleOrigins();
    expect(o).toContain('REAL');
  });

  it('dataModeWhere produces a valid IN clause', () => {
    const where = dataModeWhere('c');
    expect(where).toContain("c.data_origin IN (");
    expect(where).toContain("'REAL'");
  });
});

describe('schema — data_origin + source_type', () => {
  it('the companies table has both columns', () => {
    const db = makeDb();
    const cols = db.prepare('PRAGMA table_info(companies)').all() as Array<{
      name: string;
    }>;
    const names = new Set(cols.map((c) => c.name));
    expect(names.has('data_origin')).toBe(true);
    expect(names.has('source_type')).toBe(true);
  });

  it('inserting without data_origin defaults to REAL', () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO companies (id, name, domain, source, status, created_at, updated_at)
       VALUES ('c1', 'Acme', 'acme.test', 'real_source', 'review',
               datetime('now'), datetime('now'))`,
    ).run();
    const row = db.prepare("SELECT data_origin FROM companies WHERE id = 'c1'").get() as {
      data_origin: string;
    };
    expect(row.data_origin).toBe('REAL');
  });

  it('inserting with explicit DEMO sticks', () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO companies (id, name, domain, source, status, created_at, updated_at,
                              data_origin, source_type)
       VALUES ('c2', 'MockCo', 'mock.test', 'mock', 'review',
               datetime('now'), datetime('now'), 'DEMO', 'MOCK_SOURCE')`,
    ).run();
    const row = db.prepare("SELECT data_origin, source_type FROM companies WHERE id = 'c2'").get() as {
      data_origin: string;
      source_type: string;
    };
    expect(row.data_origin).toBe('DEMO');
    expect(row.source_type).toBe('MOCK_SOURCE');
  });
});

describe('mock connector tagging', () => {
  it('mockSourceConnector declares DEMO origin', () => {
    expect(mockSourceConnector.dataOrigin).toBe('DEMO');
  });

  it('mockSourceConnector still produces leads (not gated at fetch time)', async () => {
    const result = await mockSourceConnector.fetchLeads();
    expect(result.leads.length).toBeGreaterThan(0);
  });
});

describe('repository filtering', () => {
  it('getAllCompanies filters out DEMO rows by default (REAL mode)', async () => {
    const { getAllCompanies } = await import('../src/db/repository');
    const db = makeDb();
    db.prepare(
      `INSERT INTO companies (id, name, domain, source, status, created_at, updated_at, data_origin)
       VALUES ('real', 'RealCo', 'real.test', 'gm', 'review', datetime('now'), datetime('now'), 'REAL'),
              ('demo', 'DemoCo', 'demo.test', 'mock', 'review', datetime('now'), datetime('now'), 'DEMO')`,
    ).run();
    const out = getAllCompanies(db);
    const names = out.map((c) => c.name);
    expect(names).toContain('RealCo');
    expect(names).not.toContain('DemoCo');
  });

  it('getAllCompanies({includeAll:true}) returns both', async () => {
    const { getAllCompanies } = await import('../src/db/repository');
    const db = makeDb();
    db.prepare(
      `INSERT INTO companies (id, name, domain, source, status, created_at, updated_at, data_origin)
       VALUES ('real', 'RealCo', 'real.test', 'gm', 'review', datetime('now'), datetime('now'), 'REAL'),
              ('demo', 'DemoCo', 'demo.test', 'mock', 'review', datetime('now'), datetime('now'), 'DEMO')`,
    ).run();
    const out = getAllCompanies(db, { includeAll: true });
    expect(out.map((c) => c.name).sort()).toEqual(['DemoCo', 'RealCo']);
  });
});
