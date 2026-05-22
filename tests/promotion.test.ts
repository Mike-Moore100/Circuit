import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { SCHEMA_SQL } from '../src/db/schema';
import {
  evaluatePromotion,
  DEFAULT_SIGNAL_THRESHOLD,
} from '../src/promotion/qualificationGate';
import {
  ruleSpam,
  ruleEnterprise,
  ruleDomainShape,
  ruleIndustryFit,
  ruleHasPhone,
  ruleHasLocation,
  ruleHasSnippet,
} from '../src/promotion/promotionRules';
import { promoteDiscoveryToCompanies } from '../src/promotion/promoteDiscoveryToCompanies';
import {
  enqueueQualification,
  listQueue,
  transitionStatus,
} from '../src/promotion/promotionQueue';
import { processQualificationQueue } from '../src/promotion/promotionScheduler';
import type { PromotionInput } from '../src/promotion/promotionTypes';

// ---------------------------------------------------------------------------
// In-memory DB with the full schema (so the qualification_queue table is
// present and the deduper/upsert paths work).
// ---------------------------------------------------------------------------
function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}

function seedDiscovery(
  db: Database.Database,
  overrides: Partial<{
    domain: string;
    business: string;
    title: string | null;
    snippet: string | null;
    location: string | null;
    phone: string | null;
    source: string;
    status: string;
  }> = {},
): string {
  const id = randomUUID();
  // Need a run row first (FK).
  const runId = randomUUID();
  db.prepare(
    `INSERT OR IGNORE INTO discovery_runs (id, source, started_at)
     VALUES (?, 'serp.test', datetime('now'))`,
  ).run(runId);
  db.prepare(
    `INSERT INTO raw_discoveries
       (id, run_id, source, business_name, raw_url, extracted_domain, title,
        snippet, location, phone, discovered_at, validation_status, validation_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, NULL)`,
  ).run(
    id,
    runId,
    overrides.source ?? 'serp.test',
    overrides.business ?? 'Acme Studio',
    `https://${overrides.domain ?? 'acme.test'}`,
    overrides.domain ?? 'acme.test',
    overrides.title ?? 'Acme Studio · Design Agency in London',
    overrides.snippet ?? 'A design agency in London building brands for SMBs.',
    overrides.location ?? 'London',
    overrides.phone ?? '020 7946 0958',
    overrides.status ?? 'valid',
  );
  return id;
}

function makeInput(overrides: Partial<PromotionInput> = {}): PromotionInput {
  return {
    discoveryId: 'd1',
    domain: 'acme.test',
    businessName: 'Acme Studio',
    title: 'Acme Studio · Design Agency in London',
    snippet: 'A design agency in London building brands for SMBs.',
    source: 'serp.test',
    phone: '020 7946 0958',
    location: 'London',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Individual rule tests
// ---------------------------------------------------------------------------
describe('promotion rules', () => {
  it('ruleSpam vetoes gambling / pharma / adult / fraud / SEO-spam patterns', () => {
    expect(ruleSpam(makeInput({ snippet: 'Best online casino, click here' })).veto).toBe(true);
    expect(ruleSpam(makeInput({ snippet: 'Free Viagra prescriptions' })).veto).toBe(true);
    expect(ruleSpam(makeInput({ snippet: 'Crypto signals + airdrops daily' })).veto).toBe(true);
    expect(ruleSpam(makeInput({ snippet: 'Click here to earn $500 a day' })).veto).toBe(true);
  });

  it('ruleSpam returns no-veto for normal SMB copy', () => {
    expect(ruleSpam(makeInput()).veto).toBe(false);
  });

  it('ruleEnterprise vetoes Fortune-list / multinational / NYSE patterns', () => {
    expect(
      ruleEnterprise(makeInput({ snippet: 'A Fortune 500 enterprise platform' })).veto,
    ).toBe(true);
    expect(
      ruleEnterprise(makeInput({ snippet: 'Global leader in multinational consulting' })).veto,
    ).toBe(true);
    expect(
      ruleEnterprise(makeInput({ snippet: 'NASDAQ: ACME — public limited company' })).veto,
    ).toBe(true);
  });

  it('ruleDomainShape vetoes junk TLDs', () => {
    expect(ruleDomainShape(makeInput({ domain: 'foo.xyz' })).veto).toBe(true);
    expect(ruleDomainShape(makeInput({ domain: 'foo.click' })).veto).toBe(true);
    expect(ruleDomainShape(makeInput({ domain: 'foo.tk' })).veto).toBe(true);
  });

  it('ruleDomainShape vetoes excessive dashes / length', () => {
    expect(
      ruleDomainShape(makeInput({ domain: 'a-b-c-d-e-superlongdomain.com' })).veto,
    ).toBe(true);
    expect(
      ruleDomainShape(makeInput({ domain: 'reallyextremelyverylongdomainnamefornospecificreason.com' })).veto,
    ).toBe(true);
  });

  it('ruleIndustryFit scores industry keyword matches in title/snippet/name', () => {
    const out = ruleIndustryFit(
      makeInput({
        snippet: 'design agency and marketing consultancy serving SMBs',
        businessName: 'Acme Studio',
      }),
    );
    expect(out.score).toBeGreaterThanOrEqual(6);
  });

  it('ruleHasPhone / ruleHasLocation / ruleHasSnippet are pure additive signals', () => {
    expect(ruleHasPhone(makeInput()).score).toBe(4);
    expect(ruleHasPhone(makeInput({ phone: null })).score).toBe(0);
    expect(ruleHasLocation(makeInput()).score).toBe(4);
    expect(ruleHasSnippet(makeInput()).score).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Gate composition
// ---------------------------------------------------------------------------
describe('evaluatePromotion', () => {
  it('promotes a clean SMB-shaped discovery', () => {
    const out = evaluatePromotion(makeInput());
    expect(out.decision).toBe('PROMOTE');
    expect(out.signalScore).toBeGreaterThanOrEqual(DEFAULT_SIGNAL_THRESHOLD);
  });

  it('SKIPs spam outright with veto reason', () => {
    const out = evaluatePromotion(
      makeInput({ snippet: 'Best online casino sites for 2026' }),
    );
    expect(out.decision).toBe('SKIP');
    expect(out.primaryReason.toLowerCase()).toContain('spam');
  });

  it('SKIPs enterprise leads with veto reason', () => {
    const out = evaluatePromotion(
      makeInput({
        title: 'Acme — Fortune 500 enterprise platform',
        snippet: 'Multinational consulting at scale',
      }),
    );
    expect(out.decision).toBe('SKIP');
    expect(out.primaryReason.toLowerCase()).toContain('enterprise');
  });

  it('SKIPs leads below the signal threshold (no industry / no phone / no location)', () => {
    const out = evaluatePromotion(
      makeInput({
        title: null,
        snippet: null,
        phone: null,
        location: null,
        businessName: 'Acme',
      }),
    );
    expect(out.decision).toBe('SKIP');
    expect(out.primaryReason.toLowerCase()).toContain('threshold');
  });

  it('honours a custom threshold', () => {
    // Default threshold is 6; raise to 50 and the same input now SKIPs.
    const out = evaluatePromotion(makeInput(), { threshold: 50 });
    expect(out.decision).toBe('SKIP');
  });
});

// ---------------------------------------------------------------------------
// promoteDiscoveryToCompanies (DB-aware)
// ---------------------------------------------------------------------------
describe('promoteDiscoveryToCompanies', () => {
  it('promotes a fresh validated discovery into companies + queue', () => {
    const db = makeDb();
    seedDiscovery(db);
    const result = promoteDiscoveryToCompanies({ db });
    expect(result.promoted).toBe(1);
    expect(result.skipped).toBe(0);
    const queue = listQueue({}, db);
    expect(queue).toHaveLength(1);
    expect(queue[0].status).toBe('PENDING');
    const companies = db.prepare('SELECT * FROM companies').all();
    expect(companies).toHaveLength(1);
  });

  it('writes a SKIPPED queue row for vetoed discoveries (audit trail)', () => {
    const db = makeDb();
    seedDiscovery(db, {
      domain: 'casino.test',
      title: 'Best online casino 2026',
      snippet: 'click here to win',
    });
    const result = promoteDiscoveryToCompanies({ db });
    expect(result.skipped).toBe(1);
    expect(result.promoted).toBe(0);
    const queue = listQueue({}, db);
    expect(queue).toHaveLength(1);
    expect(queue[0].status).toBe('SKIPPED');
    // No companies row for skipped leads.
    const companies = db.prepare('SELECT * FROM companies').all();
    expect(companies).toHaveLength(0);
  });

  it('never re-evaluates a domain already in the queue (duplicate prevention)', () => {
    const db = makeDb();
    seedDiscovery(db);
    promoteDiscoveryToCompanies({ db });
    // Second pass — no new fresh discoveries, no new queue rows.
    const result2 = promoteDiscoveryToCompanies({ db });
    expect(result2.considered).toBe(0);
    expect(result2.promoted).toBe(0);
  });

  it('skips raw_discoveries with validation_status != valid', () => {
    const db = makeDb();
    seedDiscovery(db, { domain: 'bad.test', status: 'invalid' });
    const result = promoteDiscoveryToCompanies({ db });
    expect(result.considered).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Queue lifecycle
// ---------------------------------------------------------------------------
describe('queue lifecycle', () => {
  it('enqueue → transition → list reflects status changes', () => {
    const db = makeDb();
    enqueueQualification(
      {
        discoveryId: null,
        companyId: null,
        domain: 'acme.test',
        source: 'serp.test',
        status: 'PENDING',
        priority: 10,
        promotionReason: 'test',
      },
      db,
    );
    expect(listQueue({ status: 'PENDING' }, db)).toHaveLength(1);
    transitionStatus('acme.test', 'PROCESSING', {}, db);
    expect(listQueue({ status: 'PROCESSING' }, db)).toHaveLength(1);
    // Insert a real company so the FK constraint on company_id passes.
    db.prepare(
      `INSERT INTO companies (id, name, domain, website_url, source, status, created_at, updated_at)
       VALUES ('co1', 'Acme', 'acme.test', 'https://acme.test', 'test', 'review', datetime('now'), datetime('now'))`,
    ).run();
    transitionStatus('acme.test', 'PROMOTED', { companyId: 'co1' }, db);
    const promoted = listQueue({ status: 'PROMOTED' }, db);
    expect(promoted).toHaveLength(1);
    expect(promoted[0].companyId).toBe('co1');
  });

  it('upsert keys on domain — a re-promotion does not create duplicate queue rows', () => {
    const db = makeDb();
    enqueueQualification(
      {
        discoveryId: null,
        companyId: null,
        domain: 'acme.test',
        source: 'serp.test',
        status: 'PENDING',
        priority: 5,
        promotionReason: 'first',
      },
      db,
    );
    enqueueQualification(
      {
        discoveryId: null,
        companyId: null,
        domain: 'acme.test',
        source: 'serp.test',
        status: 'PENDING',
        priority: 10,
        promotionReason: 'second',
      },
      db,
    );
    const rows = listQueue({}, db);
    expect(rows).toHaveLength(1);
    expect(rows[0].priority).toBe(10);
    expect(rows[0].promotionReason).toBe('second');
  });
});

// ---------------------------------------------------------------------------
// processQualificationQueue — error isolation
// ---------------------------------------------------------------------------
describe('processQualificationQueue', () => {
  it('marks PENDING rows without a company id as FAILED and continues', async () => {
    const db = makeDb();
    enqueueQualification(
      {
        discoveryId: null,
        companyId: null, // intentionally missing
        domain: 'orphan.test',
        source: 'serp.test',
        status: 'PENDING',
        priority: 5,
        promotionReason: 'test',
      },
      db,
    );
    const result = await processQualificationQueue({ db, rateLimitMs: 0 });
    expect(result.attempted).toBe(1);
    expect(result.failed).toBe(1);
    const failed = listQueue({ status: 'FAILED' }, db);
    expect(failed).toHaveLength(1);
  });

  it('processes 0 items when the queue is empty', async () => {
    const db = makeDb();
    const result = await processQualificationQueue({ db, rateLimitMs: 0 });
    expect(result.attempted).toBe(0);
    expect(result.promoted).toBe(0);
    expect(result.failed).toBe(0);
  });
});
