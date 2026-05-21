import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { SCHEMA_SQL } from '../src/db/schema';
import {
  detectVisualIssues,
  summariseCtas,
} from '../src/evidence/detectVisualIssues';
import { extractOperationalEvidence } from '../src/evidence/extractOperationalEvidence';
import type { CaptureResult, DomSnapshot } from '../src/evidence/evidenceTypes';
import {
  clearLeadEvidence,
  getEvidenceForCompany,
  getEvidenceStats,
  insertLeadEvidence,
} from '../src/db/repository';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}

function seedCompany(db: Database.Database, name = 'Acme'): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO companies
       (id, name, domain, website_url, industry, location, size_estimate,
        source, source_url, status, created_at, updated_at)
     VALUES (?, ?, 'acme.example', 'https://acme.example', 'accounting',
             'London', 10, 'mock', NULL, 'review',
             datetime('now'), datetime('now'))`,
  ).run(id, name);
  return id;
}

function snapshot(overrides: Partial<DomSnapshot> = {}): DomSnapshot {
  return {
    url: 'https://acme.example',
    finalUrl: 'https://acme.example',
    ok: true,
    title: 'Acme',
    htmlLength: 5000,
    hasMetaViewport: true,
    scrollWidth: 1280,
    viewportWidth: 1280,
    h1Count: 1,
    buttonCount: 2,
    ctaTexts: ['Book a call', 'Contact us'],
    formCount: 1,
    hasEmailInput: true,
    hasMailto: true,
    hasTel: true,
    hasPhysicalAddressHint: true,
    hasCopyrightYear: new Date().getFullYear(),
    visibleBodyText: 'We help small bookkeeping firms grow. Get in touch.'.repeat(20),
    consoleErrorCount: 0,
    ...overrides,
  };
}

function capture(
  desktop: DomSnapshot | null = snapshot(),
  mobile: DomSnapshot | null = snapshot({ viewportWidth: 390, scrollWidth: 390 }),
  errorMessage?: string,
): CaptureResult {
  return {
    url: 'https://acme.example',
    desktopPath: desktop ? '/tmp/desktop.png' : null,
    mobilePath: mobile ? '/tmp/mobile.png' : null,
    desktop,
    mobile,
    errorMessage,
    durationMs: 1234,
  };
}

describe('detectVisualIssues', () => {
  it('flags page_failed_to_load when desktop snapshot is missing', () => {
    const issues = detectVisualIssues(capture(null, null, 'timeout'));
    expect(issues[0].code).toBe('page_failed_to_load');
  });

  it('flags no_visible_cta + no_visible_form when both are absent', () => {
    const issues = detectVisualIssues(
      capture(snapshot({ ctaTexts: [], buttonCount: 0, formCount: 0, hasEmailInput: false })),
    );
    expect(issues.some((i) => i.code === 'no_visible_cta')).toBe(true);
    expect(issues.some((i) => i.code === 'no_visible_form')).toBe(true);
  });

  it('flags missing meta viewport as a WEB_REBUILD signal', () => {
    const issues = detectVisualIssues(capture(snapshot({ hasMetaViewport: false })));
    const i = issues.find((x) => x.code === 'no_meta_viewport');
    expect(i).toBeDefined();
    expect(i?.campaign).toBe('WEB_REBUILD');
  });

  it('flags mobile horizontal overflow when scroll width exceeds viewport', () => {
    const issues = detectVisualIssues(
      capture(
        snapshot(),
        snapshot({ viewportWidth: 390, scrollWidth: 800 }),
      ),
    );
    expect(issues.some((i) => i.code === 'mobile_horizontal_overflow')).toBe(true);
  });

  it('does not flag overflow for the standard 8px render quirk', () => {
    const issues = detectVisualIssues(
      capture(
        snapshot(),
        snapshot({ viewportWidth: 390, scrollWidth: 392 }),
      ),
    );
    expect(issues.some((i) => i.code === 'mobile_horizontal_overflow')).toBe(false);
  });

  it('flags no_trust_signals when phone / email / address / copyright all absent', () => {
    const issues = detectVisualIssues(
      capture(
        snapshot({
          hasTel: false,
          hasMailto: false,
          hasPhysicalAddressHint: false,
          hasCopyrightYear: null,
        }),
      ),
    );
    expect(issues.some((i) => i.code === 'no_trust_signals')).toBe(true);
  });

  it('flags sparse_homepage when very little text is visible', () => {
    const issues = detectVisualIssues(
      capture(snapshot({ visibleBodyText: 'Coming soon' })),
    );
    expect(issues.some((i) => i.code === 'sparse_homepage')).toBe(true);
  });

  it('flags outdated_visual_quality when both stale copyright AND no viewport', () => {
    const issues = detectVisualIssues(
      capture(
        snapshot({
          hasMetaViewport: false,
          hasCopyrightYear: 2014,
        }),
      ),
    );
    expect(issues.some((i) => i.code === 'outdated_visual_quality')).toBe(true);
  });

  it('summariseCtas reports flags and unique CTA texts', () => {
    const out = summariseCtas(snapshot({ ctaTexts: ['Book a call', 'Contact us'] }));
    expect(out.ctaCount).toBe(2);
    expect(out.hasBookingLink).toBe(true);
    expect(out.hasContactLink).toBe(true);
  });

  it('summariseCtas returns zero counts for a null snapshot', () => {
    const out = summariseCtas(null);
    expect(out.ctaCount).toBe(0);
    expect(out.hasBookingLink).toBe(false);
  });

  it('produces no issues for a healthy snapshot', () => {
    const issues = detectVisualIssues(capture());
    // Healthy snapshots may have NO_VISIBLE_FORM or similar but the key
    // hard-fail ones should not fire.
    expect(issues.some((i) => i.code === 'page_failed_to_load')).toBe(false);
    expect(issues.some((i) => i.code === 'no_meta_viewport')).toBe(false);
    expect(issues.some((i) => i.code === 'mobile_horizontal_overflow')).toBe(false);
    expect(issues.some((i) => i.code === 'sparse_homepage')).toBe(false);
  });
});

describe('extractOperationalEvidence', () => {
  it('returns empty when there is no text', () => {
    const clues = extractOperationalEvidence(null);
    expect(clues).toEqual([]);
  });

  it('catches manual intake / coordination phrasing', () => {
    const text = `
      We handle client onboarding, take care of invoices, and schedule appointments.
      Our team manages your bookkeeping end-to-end.
    `;
    const clues = extractOperationalEvidence(snapshot({ visibleBodyText: text }));
    expect(clues.some((c) => c.code === 'manual_intake_language')).toBe(true);
  });

  it('does not invent clues from generic marketing copy', () => {
    const text = 'We are a creative agency that builds things.';
    const clues = extractOperationalEvidence(snapshot({ visibleBodyText: text }));
    expect(clues).toEqual([]);
  });

  it('confidence scales with multiple matches', () => {
    const one = extractOperationalEvidence(
      snapshot({ visibleBodyText: 'we handle bookkeeping' }),
    );
    const many = extractOperationalEvidence(
      snapshot({
        visibleBodyText:
          'we handle bookkeeping. we manage invoicing. client onboarding takes time. lead intake is manual.',
      }),
    );
    expect(many[0].confidence).toBeGreaterThan(one[0].confidence);
  });
});

describe('evidence persistence', () => {
  it('round-trips through insertLeadEvidence / getEvidenceForCompany', () => {
    const db = makeDb();
    const id = seedCompany(db);
    insertLeadEvidence(
      {
        companyId: id,
        evidenceType: 'summary',
        evidenceSummary: '2 visual issues',
        confidence: 72,
        screenshotPath: 'abc/desktop.png',
        mobileScreenshotPath: 'abc/mobile.png',
        metadata: { campaign: 'WEB_REBUILD' },
      },
      db,
    );
    insertLeadEvidence(
      {
        companyId: id,
        evidenceType: 'visual.no_meta_viewport',
        evidenceSummary: 'Missing viewport',
        confidence: 90,
        screenshotPath: null,
        mobileScreenshotPath: null,
        metadata: { campaign: 'WEB_REBUILD' },
      },
      db,
    );
    const rows = getEvidenceForCompany(id, db);
    expect(rows).toHaveLength(2);
    const stats = getEvidenceStats(db);
    expect(stats.companiesWithEvidence).toBe(1);
    expect(stats.withDesktopScreenshot).toBe(1);
    expect(stats.byType['visual.no_meta_viewport']).toBe(1);
  });

  it('clears existing rows on re-extract', () => {
    const db = makeDb();
    const id = seedCompany(db);
    insertLeadEvidence(
      {
        companyId: id,
        evidenceType: 'summary',
        evidenceSummary: 'first',
        confidence: 50,
        screenshotPath: null,
        mobileScreenshotPath: null,
        metadata: null,
      },
      db,
    );
    clearLeadEvidence(id, db);
    expect(getEvidenceForCompany(id, db)).toHaveLength(0);
  });
});
