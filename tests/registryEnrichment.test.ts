// Phase 1 — Companies House enrichment tests. Pure-function coverage
// for UK detection + signal derivation, plus end-to-end orchestrator
// behaviour using a fake provider so we never touch the real network.

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../src/db/schema';
import {
  detectUkContext,
  deriveSignals,
  nameCandidates,
  RegistryEnrichmentService,
} from '../src/enrichment/registryEnrichmentService';
import type {
  CompanyRegistryRecord,
  RegistryOfficer,
} from '../src/enrichment/companyRegistryTypes';
import type {
  CompaniesHouseProvider,
  SearchHit,
} from '../src/enrichment/companiesHouseProvider';
import { normaliseStatus } from '../src/enrichment/companiesHouseProvider';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  db.prepare(
    `INSERT INTO companies (id, name, domain, source, status, created_at, updated_at)
     VALUES ('c1', 'Lumen Accounting Ltd', 'lumen.test', 'serp.duckduckgo',
             'review', datetime('now'), datetime('now'))`,
  ).run();
  return db;
}

function officer(over: Partial<RegistryOfficer> = {}): RegistryOfficer {
  return {
    name: 'Jane Smith',
    role: 'director',
    appointedOn: '2018-01-01',
    resignedOn: null,
    isActive: true,
    ...over,
  };
}

function record(over: Partial<CompanyRegistryRecord> = {}): CompanyRegistryRecord {
  return {
    registryId: '12345678',
    registry: 'companies_house',
    companyName: 'Lumen Accounting Ltd',
    status: 'active',
    incorporationDate: '2010-01-01',
    sicCodes: ['69201'],
    registeredOfficeLocality: 'Leeds',
    registeredOfficeCountry: 'United Kingdom',
    officers: [officer()],
    filingsCurrent: true,
    ...over,
  };
}

// Fake provider — drives every code path without touching the network.
function fakeProvider(over: Partial<CompaniesHouseProvider> = {}): CompaniesHouseProvider {
  return {
    enabled: true,
    lastStatus: 200,
    lastError: null,
    async searchByName(name): Promise<SearchHit[]> {
      return [
        {
          companyNumber: '12345678',
          name: `${name} Ltd`,
          status: 'active',
          addressSnippet: 'Leeds',
          incorporationDate: '2010-01-01',
        },
      ];
    },
    async getProfile() {
      return {};
    },
    async getOfficers() {
      return [officer()];
    },
    async buildRecord() {
      return record();
    },
    ...over,
  };
}

// ---------------------------------------------------------------------------
// UK detection
// ---------------------------------------------------------------------------
describe('detectUkContext', () => {
  it('flags a .co.uk domain as UK', () => {
    expect(
      detectUkContext({ domain: 'lumen.co.uk', location: null, discoveryLocation: null }).isUk,
    ).toBe(true);
  });

  it('flags a registered UK city as UK', () => {
    expect(
      detectUkContext({ domain: null, location: null, discoveryLocation: 'London' }).isUk,
    ).toBe(true);
  });

  it('flags free-text "United Kingdom" or "UK" location as UK', () => {
    expect(
      detectUkContext({ domain: null, location: 'Manchester, UK', discoveryLocation: null }).isUk,
    ).toBe(true);
    expect(
      detectUkContext({ domain: null, location: 'United Kingdom', discoveryLocation: null }).isUk,
    ).toBe(true);
  });

  it('does NOT flag a .com domain with no UK location as UK', () => {
    const out = detectUkContext({
      domain: 'lumen.com',
      location: 'New York, NY',
      discoveryLocation: 'New York',
    });
    expect(out.isUk).toBe(false);
  });

  it('does NOT flag a US city alone', () => {
    expect(
      detectUkContext({ domain: 'lumen.io', location: 'Austin', discoveryLocation: null }).isUk,
    ).toBe(false);
  });

  it('trusts the registered office country when supplied', () => {
    expect(
      detectUkContext({
        domain: 'lumen.com',
        location: 'Austin',
        discoveryLocation: 'Austin',
        registeredOfficeCountry: 'United Kingdom',
      }).isUk,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// normaliseStatus
// ---------------------------------------------------------------------------
describe('nameCandidates — SERP cleanup', () => {
  it('strips "Welcome to" prefix', () => {
    expect(nameCandidates('Welcome to Pablo', null)).toContain('Pablo');
  });

  it('strips ": Creative marketing…" tagline', () => {
    expect(
      nameCandidates('Brandnation: Creative marketing and communications agency', null),
    ).toContain('Brandnation');
  });

  it('strips "29 Best …" SERP-list prefix', () => {
    const out = nameCandidates('29 Best Accountants in Birmingham', null);
    expect(out.some((c) => /accountants/i.test(c))).toBe(true);
  });

  it('falls back to the domain root when name is just "Home"', () => {
    expect(nameCandidates('Home', 'downendbookkeeping.co.uk')).toContain('downendbookkeeping');
  });

  it('always includes the original name as a fallback', () => {
    expect(nameCandidates('Lumen Accounting Ltd', null)).toContain('Lumen Accounting Ltd');
  });

  it('dedupes when cleaned matches original', () => {
    const out = nameCandidates('Lumen', 'lumen.co.uk');
    // "lumen" the domain root should not duplicate "Lumen" the name.
    const lowered = out.map((s) => s.toLowerCase());
    const unique = new Set(lowered);
    expect(unique.size).toBe(lowered.length);
  });
});

describe('normaliseStatus', () => {
  it.each<[string | null, string]>([
    ['active', 'active'],
    ['dissolved', 'dissolved'],
    ['in liquidation', 'liquidation'],
    ['receivership', 'administration'],
    ['voluntary-arrangement', 'inactive'],
    [null, 'unknown'],
    ['something weird', 'unknown'],
  ])('"%s" → %s', (input, expected) => {
    expect(normaliseStatus(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Signal derivation
// ---------------------------------------------------------------------------
describe('deriveSignals', () => {
  it('returns high confidence for an active mature company with filings + directors', () => {
    const now = new Date('2026-01-01');
    const s = deriveSignals(record({ incorporationDate: '2010-01-01' }), now);
    expect(s.isActive).toBe(true);
    expect(s.legitimacyConfidence).toBe('high');
    expect(s.companyAgeYears).toBeGreaterThanOrEqual(15);
    expect(s.directorsFound).toBe(1);
    expect(s.notes.some((n) => /Active on the UK register/.test(n))).toBe(true);
  });

  it('penalises dissolved companies with low confidence', () => {
    const s = deriveSignals(record({ status: 'dissolved' }), new Date('2026-01-01'));
    expect(s.isActive).toBe(false);
    expect(s.legitimacyConfidence).toBe('low');
    expect(s.notes.some((n) => /Dissolved/.test(n))).toBe(true);
  });

  it('penalises liquidation + administration as low confidence', () => {
    expect(
      deriveSignals(record({ status: 'liquidation' }), new Date('2026-01-01'))
        .legitimacyConfidence,
    ).toBe('low');
    expect(
      deriveSignals(record({ status: 'administration' }), new Date('2026-01-01'))
        .legitimacyConfidence,
    ).toBe('low');
  });

  it('drops confidence to medium when filings are overdue', () => {
    const s = deriveSignals(
      record({ incorporationDate: '2010-01-01', filingsCurrent: false }),
      new Date('2026-01-01'),
    );
    expect(s.legitimacyConfidence).toBe('medium');
    expect(s.notes.some((n) => /Filings overdue/.test(n))).toBe(true);
  });

  it('reports null age for missing incorporation date', () => {
    const s = deriveSignals(record({ incorporationDate: null }), new Date('2026-01-01'));
    expect(s.companyAgeYears).toBeNull();
  });

  it('does not count resigned officers as active directors', () => {
    const s = deriveSignals(
      record({
        officers: [
          officer(),
          officer({ name: 'Old Director', resignedOn: '2020-01-01', isActive: false }),
        ],
      }),
      new Date('2026-01-01'),
    );
    expect(s.directorsFound).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Orchestrator behaviour
// ---------------------------------------------------------------------------
describe('RegistryEnrichmentService', () => {
  it('skips a non-UK lead with outcome=skipped_non_uk', async () => {
    const db = makeDb();
    const service = new RegistryEnrichmentService({
      provider: fakeProvider(),
      db,
      now: () => new Date('2026-01-01'),
      enabled: true,
    });
    const out = await service.enrichCompany({
      companyId: 'c1',
      name: 'US Co',
      domain: 'us.com',
      location: 'Austin',
      discoveryLocation: null,
    });
    expect(out.outcome).toBe('skipped_non_uk');
    expect(out.record).toBeNull();
    expect(out.signals).toBeNull();
  });

  it('enriches a UK lead and persists the record + signals', async () => {
    const db = makeDb();
    const service = new RegistryEnrichmentService({
      provider: fakeProvider(),
      db,
      now: () => new Date('2026-01-01'),
      enabled: true,
    });
    const out = await service.enrichCompany({
      companyId: 'c1',
      name: 'Lumen Accounting',
      domain: 'lumen.co.uk',
      location: 'Leeds',
      discoveryLocation: 'Leeds',
    });
    expect(out.outcome).toBe('enriched');
    expect(out.record?.registryId).toBe('12345678');
    expect(out.signals?.isActive).toBe(true);
    expect(out.signals?.legitimacyConfidence).toBe('high');

    // Cache check — pulling again returns cache_hit_fresh.
    const second = await service.enrichCompany({
      companyId: 'c1',
      name: 'Lumen Accounting',
      domain: 'lumen.co.uk',
      location: 'Leeds',
      discoveryLocation: 'Leeds',
    });
    expect(second.outcome).toBe('skipped_cache_hit_fresh');
    expect(second.record?.registryId).toBe('12345678');
  });

  it('skips with no_key outcome when provider is disabled', async () => {
    process.env.COMPANIES_HOUSE_ENABLED = '1';
    const db = makeDb();
    const service = new RegistryEnrichmentService({
      provider: { ...fakeProvider(), enabled: false },
      db,
      now: () => new Date('2026-01-01'),
      enabled: true,
    });
    const out = await service.enrichCompany({
      companyId: 'c1',
      name: 'Lumen Accounting',
      domain: 'lumen.co.uk',
      location: 'Leeds',
      discoveryLocation: 'Leeds',
    });
    expect(out.outcome).toBe('skipped_no_key');
  });

  it('returns skipped_no_match when search returns nothing', async () => {
    process.env.COMPANIES_HOUSE_ENABLED = '1';
    const db = makeDb();
    const service = new RegistryEnrichmentService({
      provider: fakeProvider({ searchByName: async () => [] }),
      db,
      now: () => new Date('2026-01-01'),
      enabled: true,
    });
    const out = await service.enrichCompany({
      companyId: 'c1',
      name: 'Lumen Accounting',
      domain: 'lumen.co.uk',
      location: 'Leeds',
      discoveryLocation: 'Leeds',
    });
    expect(out.outcome).toBe('skipped_no_match');
  });

  it('returns skipped_no_match when search hits do not pass the name-overlap floor', async () => {
    process.env.COMPANIES_HOUSE_ENABLED = '1';
    const db = makeDb();
    const service = new RegistryEnrichmentService({
      provider: fakeProvider({
        searchByName: async () => [
          {
            companyNumber: '99999999',
            name: 'Totally Different Holdings Ltd',
            status: 'active',
            addressSnippet: null,
            incorporationDate: null,
          },
        ],
      }),
      db,
      now: () => new Date('2026-01-01'),
      enabled: true,
    });
    const out = await service.enrichCompany({
      companyId: 'c1',
      name: 'Lumen Accounting',
      domain: 'lumen.co.uk',
      location: 'Leeds',
      discoveryLocation: 'Leeds',
    });
    expect(out.outcome).toBe('skipped_no_match');
  });

  it('returns outcome=error when the API returns 401 (bad key)', async () => {
    const db = makeDb();
    const service = new RegistryEnrichmentService({
      provider: {
        ...fakeProvider(),
        searchByName: async () => [],
        lastStatus: 401,
        lastError: 'Companies House returned 401 — check COMPANIES_HOUSE_API_KEY',
      },
      db,
      now: () => new Date('2026-01-01'),
      enabled: true,
    });
    const out = await service.enrichCompany({
      companyId: 'c1',
      name: 'Lumen Accounting',
      domain: 'lumen.co.uk',
      location: 'Leeds',
      discoveryLocation: 'Leeds',
    });
    expect(out.outcome).toBe('error');
    expect(out.reason).toMatch(/401|auth/i);
  });

  it('records error outcome safely when profile fetch fails', async () => {
    process.env.COMPANIES_HOUSE_ENABLED = '1';
    const db = makeDb();
    const service = new RegistryEnrichmentService({
      provider: fakeProvider({ buildRecord: async () => null }),
      db,
      now: () => new Date('2026-01-01'),
      enabled: true,
    });
    const out = await service.enrichCompany({
      companyId: 'c1',
      name: 'Lumen Accounting',
      domain: 'lumen.co.uk',
      location: 'Leeds',
      discoveryLocation: 'Leeds',
    });
    expect(out.outcome).toBe('error');
    expect(out.record).toBeNull();
  });

  it('--force bypasses UK gating', async () => {
    process.env.COMPANIES_HOUSE_ENABLED = '1';
    const db = makeDb();
    const service = new RegistryEnrichmentService({
      provider: fakeProvider(),
      db,
      now: () => new Date('2026-01-01'),
      enabled: true,
    });
    const out = await service.enrichCompany({
      companyId: 'c1',
      name: 'Lumen Accounting',
      domain: 'lumen.com',
      location: 'Austin',
      discoveryLocation: 'Austin',
      force: true,
    });
    expect(out.outcome).toBe('enriched');
  });
});
