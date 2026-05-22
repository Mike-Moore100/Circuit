// Phase 1 Live Validation — outcome tracking persistence + enum integrity.

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../src/db/schema';
import {
  deleteLeadOutcome,
  getLatestOutcomeByCompany,
  getOutcomeDistribution,
  getOutcomesForCompany,
  insertLeadOutcome,
  listAllOutcomes,
} from '../src/db/repository';
import {
  OUTCOME_LABEL,
  OUTCOME_TONE,
  OUTCOME_TYPES,
  isOutcomeType,
} from '../src/validation/outcomeTypes';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  for (const id of ['c1', 'c2']) {
    db.prepare(
      `INSERT INTO companies (id, name, domain, source, status, created_at, updated_at)
       VALUES (?, ?, ?, 'real_source', 'review', datetime('now'), datetime('now'))`,
    ).run(id, `Co ${id}`, `${id}.test`);
  }
  return db;
}

describe('OUTCOME_TYPES enum', () => {
  it('covers every outcome the brief specifies', () => {
    for (const t of [
      'CONTACTED',
      'REPLIED',
      'INTERESTED',
      'NOT_INTERESTED',
      'BAD_FIT',
      'NO_RESPONSE',
      'MEETING_BOOKED',
      'STRONG_OPPORTUNITY',
      'WEAK_OPPORTUNITY',
    ]) {
      expect(OUTCOME_TYPES).toContain(t);
    }
  });

  it('has a label + tone for every type', () => {
    for (const t of OUTCOME_TYPES) {
      expect(OUTCOME_LABEL[t]).toBeTruthy();
      expect(['positive', 'negative', 'neutral']).toContain(OUTCOME_TONE[t]);
    }
  });

  it('isOutcomeType narrows correctly', () => {
    expect(isOutcomeType('CONTACTED')).toBe(true);
    expect(isOutcomeType('contacted')).toBe(false); // case-sensitive
    expect(isOutcomeType('UNKNOWN')).toBe(false);
  });
});

describe('lead_outcomes persistence', () => {
  it('inserts and reads back rows preserving order (DESC by created_at)', () => {
    const db = makeDb();
    const o1 = insertLeadOutcome({ companyId: 'c1', outcomeType: 'CONTACTED' }, db);
    // Tiny delay so the two timestamps differ.
    db.prepare("UPDATE lead_outcomes SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(o1.id);
    const o2 = insertLeadOutcome({ companyId: 'c1', outcomeType: 'REPLIED' }, db);
    db.prepare("UPDATE lead_outcomes SET created_at = '2026-01-02T00:00:00.000Z' WHERE id = ?").run(o2.id);

    const rows = getOutcomesForCompany('c1', db);
    expect(rows).toHaveLength(2);
    expect(rows[0].outcome_type).toBe('REPLIED'); // newest first
    expect(rows[1].outcome_type).toBe('CONTACTED');
  });

  it('stores notes when provided', () => {
    const db = makeDb();
    insertLeadOutcome(
      { companyId: 'c1', outcomeType: 'REPLIED', notes: 'asked for case studies' },
      db,
    );
    const [row] = getOutcomesForCompany('c1', db);
    expect(row.notes).toBe('asked for case studies');
  });

  it('deleteLeadOutcome removes one row and is idempotent', () => {
    const db = makeDb();
    const o = insertLeadOutcome({ companyId: 'c1', outcomeType: 'CONTACTED' }, db);
    expect(deleteLeadOutcome(o.id, db)).toBe(1);
    expect(deleteLeadOutcome(o.id, db)).toBe(0);
    expect(getOutcomesForCompany('c1', db)).toHaveLength(0);
  });

  it('getOutcomeDistribution groups by type', () => {
    const db = makeDb();
    insertLeadOutcome({ companyId: 'c1', outcomeType: 'CONTACTED' }, db);
    insertLeadOutcome({ companyId: 'c1', outcomeType: 'CONTACTED' }, db);
    insertLeadOutcome({ companyId: 'c2', outcomeType: 'INTERESTED' }, db);
    const dist = getOutcomeDistribution(db);
    expect(dist.CONTACTED).toBe(2);
    expect(dist.INTERESTED).toBe(1);
  });

  it('getLatestOutcomeByCompany returns the most recent row per company', () => {
    const db = makeDb();
    const a = insertLeadOutcome({ companyId: 'c1', outcomeType: 'CONTACTED' }, db);
    db.prepare("UPDATE lead_outcomes SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(a.id);
    const b = insertLeadOutcome({ companyId: 'c1', outcomeType: 'INTERESTED' }, db);
    db.prepare("UPDATE lead_outcomes SET created_at = '2026-01-02T00:00:00.000Z' WHERE id = ?").run(b.id);
    insertLeadOutcome({ companyId: 'c2', outcomeType: 'BAD_FIT' }, db);

    const map = getLatestOutcomeByCompany(db);
    expect(map.get('c1')?.outcome_type).toBe('INTERESTED');
    expect(map.get('c2')?.outcome_type).toBe('BAD_FIT');
  });

  it('listAllOutcomes respects the limit', () => {
    const db = makeDb();
    for (let i = 0; i < 5; i++) {
      insertLeadOutcome({ companyId: 'c1', outcomeType: 'CONTACTED' }, db);
    }
    expect(listAllOutcomes(db, { limit: 3 })).toHaveLength(3);
  });
});
