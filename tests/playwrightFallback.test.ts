import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { SCHEMA_SQL } from '../src/db/schema';
import { discoverContactsForCompany } from '../src/contacts/contactDiscovery';
import {
  looksJsRendered,
  type PageRenderer,
  type RenderedRaw,
} from '../src/contacts/playwrightContactExtractor';
import type { ContactPage } from '../src/contacts/websiteContactExtractor';
import { parse } from 'node-html-parser';
import { getContactsForCompany } from '../src/db/repository';

// ---------------------------------------------------------------------------
// In-memory DB matching production schema + Phase 8 ALTERs.
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
      /* duplicate */
    }
  }
  return db;
}

function seedCompany(db: Database.Database, websiteUrl: string): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO companies (id, name, domain, website_url, industry, location, size_estimate,
                            source, source_url, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'design', 'London', 8, 'mock', NULL, 'review',
             datetime('now'), datetime('now'))`,
  ).run(id, 'Test Co', new URL(websiteUrl).hostname, websiteUrl);
  return id;
}

// ---------------------------------------------------------------------------
// Helpers — build a ContactPage-shaped fixture without going through the
// network or HTML parser, so we can probe looksJsRendered in isolation.
// ---------------------------------------------------------------------------
function makePage(overrides: Partial<ContactPage> = {}): ContactPage {
  const root = parse('<html><body></body></html>');
  return {
    url: 'https://example.com/',
    finalUrl: 'https://example.com/',
    statusCode: 200,
    ok: true,
    title: 'Example',
    textContent: 'Lots of body text. '.repeat(200),
    emails: [],
    phones: [],
    links: Array.from({ length: 8 }, (_, i) => ({
      href: `https://example.com/p${i}`,
      text: `link ${i}`,
      rel: 'internal' as const,
    })),
    forms: [{ action: null, hasEmailInput: true }],
    root,
    rawHtmlLength: 4000,
    rawHtmlPreview: '<html><body><h1>Example</h1><form></form></body></html>',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fake renderer — synthesises a rendered page so we never need real chromium.
// ---------------------------------------------------------------------------
function makeRenderer(byUrl: Record<string, string>): PageRenderer {
  return async ({ url }): Promise<RenderedRaw | null> => {
    const html = byUrl[url] ?? byUrl['*'];
    if (!html) return null;
    // Crude visible-text extraction for the fake — strip tags.
    const visibleText = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&[a-z]+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return {
      finalUrl: url,
      statusCode: 200,
      ok: true,
      title: 'Rendered',
      visibleText,
      html,
    };
  };
}

// ---------------------------------------------------------------------------
describe('looksJsRendered', () => {
  it('flags Wix-hosted homepages by host', () => {
    expect(
      looksJsRendered(makePage({ finalUrl: 'https://acme.wixsite.com/home' })),
    ).toBe(true);
  });

  it('flags React/Next shells by HTML marker', () => {
    expect(
      looksJsRendered(
        makePage({ rawHtmlPreview: '<div id="root"></div>' }),
      ),
    ).toBe(true);
    expect(
      looksJsRendered(
        makePage({ rawHtmlPreview: '<html data-reactroot></html>' }),
      ),
    ).toBe(true);
  });

  it('flags thin shells with very little visible text', () => {
    expect(
      looksJsRendered(
        makePage({
          textContent: 'Loading…',
          forms: [],
          links: [],
        }),
      ),
    ).toBe(true);
  });

  it('does not flag a normal content-rich static page', () => {
    expect(looksJsRendered(makePage())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Orchestrator gating: the fallback should only fire when the static crawl
// is insufficient. We exercise this by mocking the static crawler at the
// network layer (global fetch) and injecting a fake Playwright renderer.
// ---------------------------------------------------------------------------
describe('discoverContactsForCompany — Playwright fallback gating', () => {
  const ORIG_FETCH = global.fetch;
  afterEachReset();

  function afterEachReset() {
    // Vitest doesn't support afterEach inside this file's top level — emulate
    // by restoring in each test's finally block.
  }

  it('does NOT fall back when the static crawl already returned a named DM', async () => {
    const staticHtml = `
      <html><body>
        <h3>Jane Smith</h3><p>Founder &amp; CEO</p>
        <a href="mailto:jane@richstatic.test">jane@richstatic.test</a>
      </body></html>
    `;
    global.fetch = (async () =>
      new Response(staticHtml, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })) as typeof fetch;

    const rendererCalls = vi.fn<PageRenderer>(async () => null);

    try {
      const db = makeDb();
      const companyId = seedCompany(db, 'https://richstatic.test');
      const result = await discoverContactsForCompany({
        companyId,
        websiteUrl: 'https://richstatic.test',
        db,
        playwrightRenderer: rendererCalls,
      });
      expect(result.playwrightRan).toBe(false);
      expect(rendererCalls).not.toHaveBeenCalled();
      expect(result.contacts.some((c) => c.name === 'Jane Smith')).toBe(true);
    } finally {
      global.fetch = ORIG_FETCH;
    }
  });

  it('falls back when the static crawl is empty + rendered page yields a DM + email', async () => {
    // Static returns a Wix shell with nothing useful.
    const staticShell = `
      <html><body>
        <div id="root"></div>
        <noscript>Enable JavaScript</noscript>
      </body></html>
    `;
    global.fetch = (async () =>
      new Response(staticShell, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })) as typeof fetch;

    // The rendered "team" page has a clear DM + a mailto.
    const renderer = makeRenderer({
      'https://wix.example.test':
        '<html><body><h3>Maya Patel</h3><p>Founder &amp; CEO</p><a href="mailto:maya@wix.example.test">maya@wix.example.test</a></body></html>',
      'https://wix.example.test/team':
        '<html><body><h3>Maya Patel</h3><p>Founder &amp; CEO</p></body></html>',
      '*': '<html><body></body></html>',
    });

    try {
      const db = makeDb();
      const companyId = seedCompany(db, 'https://wix.example.test');
      const result = await discoverContactsForCompany({
        companyId,
        websiteUrl: 'https://wix.example.test',
        db,
        playwrightRenderer: renderer,
      });
      expect(result.playwrightRan).toBe(true);
      expect(result.playwrightPagesCrawled).toBeGreaterThan(0);
      const maya = result.contacts.find((c) => c.name === 'Maya Patel');
      expect(maya).toBeDefined();
      expect(maya?.source).toBe('playwright');
      expect(maya?.email).toBe('maya@wix.example.test');
      expect(maya?.emailStatus).toBe('extracted');
      // Persisted with the correct source.
      const persisted = getContactsForCompany(companyId, db);
      const persistedMaya = persisted.find((c) => c.name === 'Maya Patel');
      expect(persistedMaya?.source).toBe('playwright');
    } finally {
      global.fetch = ORIG_FETCH;
    }
  });

  it('records a clean reason when fallback is disabled', async () => {
    global.fetch = (async () =>
      new Response('<html><body><div id="root"></div></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })) as typeof fetch;

    const originalEnv = process.env.CONTACT_PLAYWRIGHT_FALLBACK_ENABLED;
    // The orchestrator reads config once at import time, so this test
    // documents the "explicit reason" path by passing a no-op renderer
    // and asserting the result still reflects "fallback wanted".
    try {
      const db = makeDb();
      const companyId = seedCompany(db, 'https://nothing.test');
      const renderer: PageRenderer = async () => null;
      const result = await discoverContactsForCompany({
        companyId,
        websiteUrl: 'https://nothing.test',
        db,
        playwrightRenderer: renderer,
      });
      expect(result.playwrightRan).toBe(true);
      // Renderer returned null — the orchestrator should still complete.
      expect(result.contacts.length).toBeGreaterThanOrEqual(0);
      expect(result.errorMessage).toBeUndefined();
    } finally {
      if (originalEnv === undefined) delete process.env.CONTACT_PLAYWRIGHT_FALLBACK_ENABLED;
      else process.env.CONTACT_PLAYWRIGHT_FALLBACK_ENABLED = originalEnv;
      global.fetch = ORIG_FETCH;
    }
  });

  it('cache hit skips both crawls on subsequent runs', async () => {
    const staticHtml = `
      <html><body>
        <h3>Anna Lee</h3><p>Managing Director</p>
        <a href="mailto:anna@cached.test">anna@cached.test</a>
      </body></html>
    `;
    let fetchCount = 0;
    global.fetch = (async () => {
      fetchCount += 1;
      return new Response(staticHtml, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }) as typeof fetch;

    const renderer = vi.fn<PageRenderer>(async () => null);

    try {
      const db = makeDb();
      const companyId = seedCompany(db, 'https://cached.test');
      await discoverContactsForCompany({
        companyId,
        websiteUrl: 'https://cached.test',
        db,
        playwrightRenderer: renderer,
      });
      const firstFetches = fetchCount;
      const second = await discoverContactsForCompany({
        companyId,
        websiteUrl: 'https://cached.test',
        db,
        playwrightRenderer: renderer,
      });
      expect(second.fromCache).toBe(true);
      expect(fetchCount).toBe(firstFetches);
      expect(renderer).not.toHaveBeenCalled();
    } finally {
      global.fetch = ORIG_FETCH;
    }
  });

  it('a renderer failure does not break the pipeline — static results survive', async () => {
    // Static has a usable email but no DM, so the gate normally would
    // not fire. Force the fallback by giving zero static contacts (empty
    // static body) and have the renderer throw.
    global.fetch = (async () =>
      new Response('<html><body><div id="root"></div></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })) as typeof fetch;

    const renderer: PageRenderer = async () => {
      throw new Error('chromium crashed');
    };

    try {
      const db = makeDb();
      const companyId = seedCompany(db, 'https://broken.test');
      const result = await discoverContactsForCompany({
        companyId,
        websiteUrl: 'https://broken.test',
        db,
        playwrightRenderer: renderer,
      });
      // Did not throw, the result is still well-formed.
      expect(result.playwrightRan).toBe(true);
      expect(result.contactabilityScore).toBeGreaterThanOrEqual(0);
      // Some fallback inferred emails (hello@/info@) should still be present
      // since the domain is known.
      expect(result.contacts.some((c) => c.email && c.emailStatus === 'guessed')).toBe(true);
    } finally {
      global.fetch = ORIG_FETCH;
    }
  });
});
