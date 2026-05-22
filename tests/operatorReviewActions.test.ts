// Phase 1 Command Center — operator-tag persistence + type expansion.
// The lead_reviews table holds both the original calibration ratings and
// the new operator throughput tags; these tests pin down the contract.

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../src/db/schema';
import {
  deleteReviewTag,
  getReviewTagsByCompany,
  insertLeadReview,
} from '../src/db/repository';
import {
  CALIBRATION_REVIEW_TYPES,
  OPERATOR_REVIEW_TYPES,
  REVIEW_LABEL,
  REVIEW_TYPES,
  isCalibrationReview,
  isOperatorReview,
} from '../src/validation/types';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  // Two companies the tests can attach reviews to.
  for (const id of ['c1', 'c2']) {
    db.prepare(
      `INSERT INTO companies (id, name, domain, source, status, created_at, updated_at)
       VALUES (?, ?, ?, 'real_source', 'review', datetime('now'), datetime('now'))`,
    ).run(id, `Co ${id}`, `${id}.test`);
  }
  return db;
}

describe('REVIEW_TYPES expansion', () => {
  it('keeps the existing six calibration types', () => {
    for (const t of [
      'correct_campaign',
      'false_reject',
      'false_positive',
      'strong_opportunity',
      'weak_opportunity',
      'interesting_later',
    ]) {
      expect(CALIBRATION_REVIEW_TYPES).toContain(t);
    }
  });

  it('adds the seven new operator tag types', () => {
    for (const t of [
      'ignore',
      'revisit_later',
      'wrong_campaign',
      'high_trust_barrier',
      'likely_fast_close',
      'likely_high_value',
      'needs_manual_investigation',
    ]) {
      expect(OPERATOR_REVIEW_TYPES).toContain(t);
    }
  });

  it('the union has a human-readable label for every type', () => {
    for (const t of REVIEW_TYPES) {
      expect(REVIEW_LABEL[t]).toBeTruthy();
      expect(REVIEW_LABEL[t].length).toBeGreaterThan(0);
    }
  });

  it('classifier helpers route correctly', () => {
    expect(isCalibrationReview('strong_opportunity')).toBe(true);
    expect(isCalibrationReview('ignore')).toBe(false);
    expect(isOperatorReview('ignore')).toBe(true);
    expect(isOperatorReview('correct_campaign')).toBe(false);
  });
});

describe('getReviewTagsByCompany + deleteReviewTag', () => {
  it('groups multiple distinct tags per company into a set', () => {
    const db = makeDb();
    insertLeadReview(
      { companyId: 'c1', reviewType: 'likely_high_value' },
      db,
    );
    insertLeadReview(
      { companyId: 'c1', reviewType: 'likely_fast_close' },
      db,
    );
    insertLeadReview({ companyId: 'c2', reviewType: 'ignore' }, db);

    const tags = getReviewTagsByCompany(db);
    expect(tags.get('c1')).toEqual(new Set(['likely_high_value', 'likely_fast_close']));
    expect(tags.get('c2')).toEqual(new Set(['ignore']));
  });

  it('does not double-count duplicate tag inserts', () => {
    const db = makeDb();
    insertLeadReview({ companyId: 'c1', reviewType: 'ignore' }, db);
    insertLeadReview({ companyId: 'c1', reviewType: 'ignore' }, db);
    const tags = getReviewTagsByCompany(db);
    expect(tags.get('c1')?.size).toBe(1);
  });

  it('deleteReviewTag clears every row of that type for a company', () => {
    const db = makeDb();
    // Two inserts then delete — both rows should go.
    insertLeadReview({ companyId: 'c1', reviewType: 'ignore' }, db);
    insertLeadReview({ companyId: 'c1', reviewType: 'ignore' }, db);
    insertLeadReview({ companyId: 'c1', reviewType: 'likely_high_value' }, db);

    const removed = deleteReviewTag('c1', 'ignore', db);
    expect(removed).toBe(2);

    const tags = getReviewTagsByCompany(db);
    expect(tags.get('c1')).toEqual(new Set(['likely_high_value']));
  });

  it('returns 0 when there is nothing to remove (idempotent)', () => {
    const db = makeDb();
    expect(deleteReviewTag('c1', 'ignore', db)).toBe(0);
  });

  it('keeps tags isolated to their company', () => {
    const db = makeDb();
    insertLeadReview({ companyId: 'c1', reviewType: 'ignore' }, db);
    deleteReviewTag('c2', 'ignore', db);
    const tags = getReviewTagsByCompany(db);
    expect(tags.get('c1')).toEqual(new Set(['ignore']));
  });
});
