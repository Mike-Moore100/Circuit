import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../src/db/schema';
import {
  contactabilityForCompany,
  scoreContact,
} from '../src/contacts/contactConfidence';
import { discoverContactsForCompany } from '../src/contacts/contactDiscovery';
import type { DiscoveredContact } from '../src/contacts/contactTypes';
import { randomUUID } from 'node:crypto';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  // Apply Phase 8 + Phase 6 ALTERs that production runMigrations applies.
  const cols = [
    ['lead_scores', 'primary_campaign TEXT'],
    ['lead_scores', 'campaign_scores_json TEXT'],
    ['lead_scores', 'campaign_reasons_json TEXT'],
    ['lead_scores', 'primary_reason TEXT'],
    ['lead_scores', 'suggested_investigation TEXT'],
    ['contacts', 'contact_type TEXT'],
    ['contacts', 'source TEXT'],
    ['contacts', 'source_url TEXT'],
    ['contacts', 'email_type TEXT'],
    ['contacts', 'email_status TEXT'],
    ['contacts', 'role_confidence REAL'],
    ['contacts', 'email_confidence REAL'],
    ['contacts', 'overall_confidence REAL'],
    ['contacts', 'is_primary INTEGER NOT NULL DEFAULT 0'],
    ['contacts', 'discovered_at TEXT'],
  ];
  for (const [t, c] of cols) {
    try { db.exec(`ALTER TABLE ${t} ADD COLUMN ${c}`); } catch { /* duplicate */ }
  }
  return db;
}

function makeContact(overrides: Partial<DiscoveredContact> = {}): DiscoveredContact {
  return {
    name: 'Jane Smith',
    role: 'Founder & CEO',
    detectedRole: 'founder',
    email: 'jane.smith@acme.com',
    emailType: 'personal',
    emailStatus: 'extracted',
    linkedinUrl: null,
    sourceUrl: 'https://acme.com/about',
    roleConfidence: 95,
    emailConfidence: 85,
    overallConfidence: 0,
    isPrimary: false,
    ...overrides,
  };
}

describe('scoreContact', () => {
  it('rewards founder + personal extracted email with a high overall score', () => {
    const score = scoreContact(makeContact());
    expect(score).toBeGreaterThanOrEqual(85);
  });

  it('drops the score sharply when only a guessed email exists', () => {
    const score = scoreContact(
      makeContact({
        emailStatus: 'guessed',
      }),
    );
    // Guessed gets only 10 of the 35-point email-status band
    expect(score).toBeLessThan(80);
  });

  it('returns 0 for a no-email no-role contact', () => {
    const score = scoreContact({
      name: null,
      role: null,
      detectedRole: 'unknown',
      email: null,
      emailType: null,
      emailStatus: null,
      linkedinUrl: null,
      sourceUrl: '',
      roleConfidence: 0,
      emailConfidence: 0,
      overallConfidence: 0,
      isPrimary: false,
    });
    expect(score).toBe(0);
  });

  it('verified email beats extracted email', () => {
    const a = scoreContact(makeContact({ emailStatus: 'extracted' }));
    const b = scoreContact(makeContact({ emailStatus: 'verified' }));
    expect(b).toBeGreaterThan(a);
  });
});

describe('contactabilityForCompany', () => {
  it('takes the max contact score and boosts for fallback routes', () => {
    const score = contactabilityForCompany(
      [makeContact({ overallConfidence: 70 })],
      [
        { type: 'PHONE', value: '+44 20 7946 0958', sourceUrl: 'x', confidence: 80 },
        { type: 'CONTACT_FORM', value: 'https://acme.com/contact', sourceUrl: 'x', confidence: 75 },
      ],
    );
    expect(score).toBe(78);
  });

  it('falls back to route-only score when no contact exists', () => {
    const score = contactabilityForCompany(
      [],
      [{ type: 'CONTACT_FORM', value: 'x', sourceUrl: 'x', confidence: 75 }],
    );
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(40);
  });

  it('returns 0 for a company with no contacts and no routes', () => {
    expect(contactabilityForCompany([], [])).toBe(0);
  });
});

describe('discoverContactsForCompany', () => {
  // We stub fetch with a tiny static HTML to keep tests offline.
  const fakeHomepage = `
    <html><head><title>Acme Bookkeeping</title></head>
    <body>
      <header><a href="/contact">Contact us</a></header>
      <section class="team">
        <h3>Jane Smith</h3>
        <p>Founder &amp; CEO</p>
        <h3>Tom Ainsworth</h3>
        <p>Managing Director</p>
      </section>
      <footer>
        Reach us at hello@acme.example.
        Phone: +44 20 7946 0958.
      </footer>
    </body></html>
  `;
  const fakeContactPage = `
    <html><body>
      <form><input type="email" name="email" /></form>
      <a href="https://calendly.com/acme/intro">Book a call</a>
      <a href="https://linkedin.com/company/acme">LinkedIn</a>
    </body></html>
  `;

  function makeFetch(): typeof fetch {
    return (async (url: string | URL | Request) => {
      const u = typeof url === 'string' ? url : (url as URL).toString();
      if (u.includes('/contact')) {
        return new Response(fakeContactPage, { status: 200, headers: { 'content-type': 'text/html' } });
      }
      return new Response(fakeHomepage, { status: 200, headers: { 'content-type': 'text/html' } });
    }) as typeof fetch;
  }

  function seedCompany(db: Database.Database, name = 'Acme'): string {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO companies
         (id, name, domain, website_url, industry, location, size_estimate,
          source, source_url, status, created_at, updated_at)
       VALUES
         (?, ?, 'acme.example', 'https://acme.example', 'accounting',
          'London', 12, 'mock', NULL, 'review',
          datetime('now'), datetime('now'))`,
    ).run(id, name);
    return id;
  }

  it('finds DM contacts, classifies emails, and persists routes', async () => {
    // Inject a fake fetch via the module under test — the crawler reads
    // options.fetchImpl, which we pass through via the orchestrator path.
    // We exercise the orchestrator via a custom crawl call by mocking
    // global fetch in this test.
    const original = global.fetch;
    global.fetch = makeFetch();
    try {
      const db = makeDb();
      const companyId = seedCompany(db);
      const result = await discoverContactsForCompany({
        companyId,
        websiteUrl: 'https://acme.example',
        db,
      });

      // At least two DMs found
      const names = result.contacts.map((c) => c.name).filter(Boolean);
      expect(names).toContain('Jane Smith');
      expect(names).toContain('Tom Ainsworth');

      // hello@ email captured + classified
      const hello = result.contacts.find((c) => c.email === 'hello@acme.example');
      expect(hello?.emailStatus).toBe('extracted');
      expect(hello?.emailType).toBe('info');

      // A primary contact is chosen, founder over director
      const primary = result.contacts.find((c) => c.isPrimary);
      expect(primary?.name).toBe('Jane Smith');

      // Routes
      const routeTypes = new Set(result.routes.map((r) => r.type));
      expect(routeTypes.has('EMAIL')).toBe(true);
      expect(routeTypes.has('PHONE')).toBe(true);
      expect(routeTypes.has('CONTACT_FORM')).toBe(true);
      expect(routeTypes.has('BOOKING_LINK')).toBe(true);
      expect(routeTypes.has('LINKEDIN')).toBe(true);
      expect(routeTypes.has('GENERAL_CONTACT_PAGE')).toBe(true);
    } finally {
      global.fetch = original;
    }
  });

  it('falls back to role-style emails when nothing is found and a DM has no email', async () => {
    const original = global.fetch;
    global.fetch = (async () =>
      new Response(
        `<html><body><h3>Sam Owner</h3><p>Owner</p></body></html>`,
        { status: 200, headers: { 'content-type': 'text/html' } },
      )) as typeof fetch;
    try {
      const db = makeDb();
      const companyId = seedCompany(db, 'Sole Trader');
      const result = await discoverContactsForCompany({
        companyId,
        websiteUrl: 'https://sole.example',
        db,
      });
      // The DM should have a guessed email at this point
      const sam = result.contacts.find((c) => c.name === 'Sam Owner');
      expect(sam?.email).toMatch(/^sam(\.owner)?@sole\.example$/);
      expect(sam?.emailStatus).toBe('guessed');
    } finally {
      global.fetch = original;
    }
  });

  it('returns an empty result when the homepage cannot load', async () => {
    const original = global.fetch;
    global.fetch = (async () => new Response('boom', { status: 500 })) as typeof fetch;
    try {
      const db = makeDb();
      const companyId = seedCompany(db, 'Broken');
      const result = await discoverContactsForCompany({
        companyId,
        websiteUrl: 'https://broken.example',
        db,
      });
      expect(result.contacts).toHaveLength(0);
      expect(result.routes).toHaveLength(0);
      expect(result.contactabilityScore).toBe(0);
    } finally {
      global.fetch = original;
    }
  });

  it('skips when websiteUrl is missing', async () => {
    const db = makeDb();
    const companyId = seedCompany(db, 'No site');
    const result = await discoverContactsForCompany({
      companyId,
      websiteUrl: null,
      db,
    });
    expect(result.errorMessage).toMatch(/no website/i);
  });
});
