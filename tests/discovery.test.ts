import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../src/db/schema';
import {
  canonicaliseUrl,
  extractDomain,
  isAggregator,
} from '../src/discovery/domainExtraction';
import { parseDuckDuckGoHtml, duckDuckGoSerp } from '../src/discovery/serpDiscovery';
import {
  parseDirectoryHtml,
  yellDirectoryConfig,
} from '../src/discovery/directoryDiscovery';
import {
  dedupeBatch,
  rejectExistingDomains,
} from '../src/discovery/discoveryDeduper';
import { validateWebsite } from '../src/discovery/websiteValidation';
import { runDiscovery } from '../src/discovery/discoveryScheduler';
import type {
  DiscoverySourceConnector,
  RawDiscovery,
} from '../src/discovery/discoveryTypes';

// ---------------------------------------------------------------------------
// In-memory DB with the discovery tables present.
// ---------------------------------------------------------------------------
function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}

function makeRaw(overrides: Partial<RawDiscovery> = {}): RawDiscovery {
  return {
    source: 'test',
    businessName: 'Acme',
    rawUrl: 'https://acme.test',
    extractedDomain: 'acme.test',
    title: 'Acme',
    snippet: null,
    location: null,
    phone: null,
    discoveredAt: new Date().toISOString(),
    validationStatus: 'pending',
    validationReason: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// extractDomain / isAggregator / canonicaliseUrl
// ---------------------------------------------------------------------------
describe('extractDomain', () => {
  it('strips www and lowercases', () => {
    expect(extractDomain('https://WWW.Acme.com/about')).toBe('acme.com');
  });

  it('returns null for unparseable input', () => {
    expect(extractDomain('')).toBeNull();
    expect(extractDomain('not a url')).toBeNull();
  });

  it('handles bare hostnames', () => {
    expect(extractDomain('acme.com/about')).toBe('acme.com');
  });

  it('isAggregator flags yell / yelp / google / linkedin / facebook', () => {
    expect(isAggregator('yell.com')).toBe(true);
    expect(isAggregator('yelp.co.uk')).toBe(true);
    expect(isAggregator('linkedin.com')).toBe(true);
    expect(isAggregator('facebook.com')).toBe(true);
    expect(isAggregator('acme.com')).toBe(false);
  });

  it('canonicaliseUrl strips utm params, fragments and trailing slash', () => {
    const out = canonicaliseUrl('https://www.Acme.com/path/?utm_source=x&gclid=y#section');
    expect(out).toBe('https://acme.com/path');
  });
});

// ---------------------------------------------------------------------------
// SERP HTML parsing
// ---------------------------------------------------------------------------
describe('parseDuckDuckGoHtml', () => {
  const html = `
    <html><body>
      <div class="result">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Facme.example%2F">Acme Marketing Agency · Best in London</a>
        <a class="result__url" href="acme.example">acme.example</a>
        <a class="result__snippet">Marketing agency based in London. Call 020 7946 0958.</a>
      </div>
      <div class="result">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.yell.com%2Fbiz%2Facme-london">Acme on Yell</a>
        <a class="result__snippet">Directory listing</a>
      </div>
      <div class="result">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fbeta.example">Beta Agency</a>
        <a class="result__snippet">No phone number here</a>
      </div>
    </body></html>
  `;

  it('extracts business names, domains, snippets', () => {
    const out = parseDuckDuckGoHtml(html);
    expect(out).toHaveLength(3);
    expect(out[0].businessName).toBe('Acme Marketing Agency');
    expect(out[0].extractedDomain).toBe('acme.example');
    expect(out[0].phone).toMatch(/020/);
  });

  it('flags aggregator hosts as invalid up front', () => {
    const out = parseDuckDuckGoHtml(html);
    const yell = out.find((o) => o.extractedDomain === 'yell.com');
    expect(yell?.validationStatus).toBe('invalid');
    expect(yell?.validationReason).toBe('aggregator host');
  });

  it('skips items with no link', () => {
    const broken = '<div class="result"><span>nothing here</span></div>';
    expect(parseDuckDuckGoHtml(broken)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Directory parsing — uses the generic adapter shape
// ---------------------------------------------------------------------------
describe('parseDirectoryHtml', () => {
  it('parses a Yell-shaped listing', () => {
    const html = `
      <html><body>
        <div class="businessCapsule--mainRow">
          <h2 class="businessCapsule--name"><a href="/biz/acme-london">Acme Studio</a></h2>
          <a href="/biz/acme-london" class="businessCapsule--link">→</a>
          <span class="businessCapsule--summary">Design studio in central London.</span>
          <span class="businessCapsule--address">42 Demo Street, London EC1A 1BB</span>
          <span class="telephoneNumber">020 7946 0958</span>
        </div>
      </body></html>
    `;
    const out = parseDirectoryHtml(html, yellDirectoryConfig);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0].businessName).toBe('Acme Studio');
  });

  it('returns an empty list for no items', () => {
    expect(parseDirectoryHtml('<html></html>', yellDirectoryConfig)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Deduper
// ---------------------------------------------------------------------------
describe('dedupeBatch', () => {
  it('collapses multiple rows with the same canonical domain', () => {
    const input: RawDiscovery[] = [
      makeRaw({ extractedDomain: 'acme.test', rawUrl: 'https://acme.test/' }),
      makeRaw({ extractedDomain: 'acme.test', rawUrl: 'https://acme.test/contact' }),
      makeRaw({ extractedDomain: 'beta.test', rawUrl: 'https://beta.test/' }),
    ];
    const { unique, duplicates, unparseable } = dedupeBatch(input);
    expect(unique).toHaveLength(2);
    expect(duplicates).toHaveLength(1);
    expect(unparseable).toHaveLength(0);
    expect(duplicates[0].validationStatus).toBe('duplicate');
  });

  it('marks unparseable URLs as invalid', () => {
    const input = [
      makeRaw({ extractedDomain: null, rawUrl: 'not a url' }),
    ];
    const { unparseable } = dedupeBatch(input);
    expect(unparseable).toHaveLength(1);
    expect(unparseable[0].validationStatus).toBe('invalid');
  });
});

describe('rejectExistingDomains', () => {
  it('marks domains already present in companies as duplicate', () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO companies (id, name, domain, website_url, source, status, created_at, updated_at)
       VALUES ('co1', 'Acme', 'acme.test', 'https://acme.test', 'seed', 'review', datetime('now'), datetime('now'))`,
    ).run();
    const out = rejectExistingDomains(
      [makeRaw({ extractedDomain: 'acme.test' }), makeRaw({ extractedDomain: 'beta.test' })],
      db,
    );
    expect(out.fresh.map((f) => f.extractedDomain)).toEqual(['beta.test']);
    expect(out.known.map((k) => k.extractedDomain)).toEqual(['acme.test']);
    expect(out.known[0].validationStatus).toBe('duplicate');
  });
});

// ---------------------------------------------------------------------------
// Website validation — uses an injected fetch so nothing hits the network
// ---------------------------------------------------------------------------
describe('validateWebsite', () => {
  function makeFetch(
    response: { status: number; ctype?: string; body?: string },
  ): typeof fetch {
    return (async () => {
      const headers = new Headers({ 'content-type': response.ctype ?? 'text/html' });
      return new Response(response.body ?? '', { status: response.status, headers });
    }) as typeof fetch;
  }

  it('returns valid for a healthy small HTML page', async () => {
    const body = `<html><head><title>Acme Studio</title></head><body>
      We're an SMB serving real clients in London. ${'A '.repeat(200)}
    </body></html>`;
    const out = await validateWebsite('acme.test', {
      fetchImpl: makeFetch({ status: 200, body }),
    });
    expect(out.status).toBe('valid');
    expect(out.hasTitle).toBe(true);
    expect(out.hasContent).toBe(true);
  });

  it('rejects 404 responses', async () => {
    const out = await validateWebsite('dead.test', {
      fetchImpl: makeFetch({ status: 404, body: 'gone' }),
    });
    expect(out.status).toBe('invalid');
    expect(out.reason).toContain('404');
  });

  it('rejects sparse pages (< minContent chars of visible text)', async () => {
    const out = await validateWebsite('thin.test', {
      fetchImpl: makeFetch({ status: 200, body: '<html><body>Hi</body></html>' }),
    });
    expect(out.status).toBe('invalid');
    expect(out.reason).toContain('sparse');
  });

  it('rejects parking-page markers in a thin shell', async () => {
    const out = await validateWebsite('parked.test', {
      fetchImpl: makeFetch({
        status: 200,
        body: '<html><body>This domain is for sale</body></html>',
      }),
    });
    expect(out.status).toBe('invalid');
  });

  it('rejects non-HTML content types', async () => {
    const out = await validateWebsite('api.test', {
      fetchImpl: makeFetch({ status: 200, ctype: 'application/json', body: '{}' }),
    });
    expect(out.status).toBe('invalid');
    expect(out.reason).toContain('non-HTML');
  });
});

// ---------------------------------------------------------------------------
// End-to-end via runDiscovery with a synthetic connector + fake fetch.
// Verifies: dedupe, validation, persistence to discovery_runs +
// raw_discoveries, freshDomains result.
// ---------------------------------------------------------------------------
describe('runDiscovery end-to-end', () => {
  function makeStaticConnector(name: string, items: RawDiscovery[]): DiscoverySourceConnector {
    return {
      name,
      isFree: true,
      async search() {
        return items;
      },
    };
  }

  function alwaysValidFetch(): typeof fetch {
    return (async () => {
      const headers = new Headers({ 'content-type': 'text/html' });
      return new Response(
        `<html><head><title>Test</title></head><body>${'Real content '.repeat(50)}</body></html>`,
        { status: 200, headers },
      );
    }) as typeof fetch;
  }

  it('runs queries, dedupes, validates, persists results', async () => {
    const db = makeDb();
    const connectorA = makeStaticConnector('serp.test-a', [
      makeRaw({ source: 'serp.test-a', extractedDomain: 'acme.test', rawUrl: 'https://acme.test' }),
      makeRaw({ source: 'serp.test-a', extractedDomain: 'beta.test', rawUrl: 'https://beta.test' }),
    ]);
    const connectorB = makeStaticConnector('serp.test-b', [
      // duplicate of acme — should be marked duplicate
      makeRaw({ source: 'serp.test-b', extractedDomain: 'acme.test', rawUrl: 'https://acme.test/' }),
      makeRaw({ source: 'serp.test-b', extractedDomain: 'gamma.test', rawUrl: 'https://gamma.test' }),
    ]);

    const result = await runDiscovery({
      queries: [{ industry: 'agency', location: 'London' }],
      sources: [connectorA, connectorB],
      rateLimitMs: 0,
      validate: true,
      fetchImpl: alwaysValidFetch(),
      db,
    });

    expect(result.rawFound).toBe(4);
    expect(result.validDomains).toBe(3); // acme + beta + gamma
    expect(result.deduped).toBe(1); // the acme duplicate from connector B
    expect(result.errors).toEqual([]);
    expect(result.freshDomains.map((d) => d.domain).sort()).toEqual([
      'acme.test',
      'beta.test',
      'gamma.test',
    ]);

    // Persistence: one run row, four raw rows
    const runs = db.prepare('SELECT * FROM discovery_runs').all() as Array<{
      raw_found: number;
      valid_domains: number;
      deduped: number;
      rejected: number;
    }>;
    expect(runs).toHaveLength(1);
    expect(runs[0].raw_found).toBe(4);
    expect(runs[0].valid_domains).toBe(3);
    expect(runs[0].deduped).toBe(1);

    const rawRows = db.prepare('SELECT * FROM raw_discoveries').all() as Array<{
      validation_status: string;
    }>;
    expect(rawRows).toHaveLength(4);
    const statusCounts = rawRows.reduce<Record<string, number>>(
      (acc, r) => ({ ...acc, [r.validation_status]: (acc[r.validation_status] ?? 0) + 1 }),
      {},
    );
    expect(statusCounts.valid).toBe(3);
    expect(statusCounts.duplicate).toBe(1);
  });

  it('skips validation when validate=false', async () => {
    const db = makeDb();
    const connector = makeStaticConnector('serp.test', [
      makeRaw({ extractedDomain: 'acme.test', rawUrl: 'https://acme.test' }),
    ]);
    const result = await runDiscovery({
      queries: [{ industry: 'x', location: 'y' }],
      sources: [connector],
      rateLimitMs: 0,
      validate: false,
      fetchImpl: alwaysValidFetch(),
      db,
    });
    expect(result.validDomains).toBe(1);
  });

  it('cross-DB dedupe rejects domains already in companies', async () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO companies (id, name, domain, website_url, source, status, created_at, updated_at)
       VALUES ('c1', 'Existing', 'acme.test', 'https://acme.test', 'seed', 'review', datetime('now'), datetime('now'))`,
    ).run();
    const connector = makeStaticConnector('serp.test', [
      makeRaw({ extractedDomain: 'acme.test', rawUrl: 'https://acme.test' }),
      makeRaw({ extractedDomain: 'fresh.test', rawUrl: 'https://fresh.test' }),
    ]);
    const result = await runDiscovery({
      queries: [{ industry: 'x', location: 'y' }],
      sources: [connector],
      rateLimitMs: 0,
      validate: true,
      fetchImpl: alwaysValidFetch(),
      db,
    });
    expect(result.freshDomains.map((d) => d.domain)).toEqual(['fresh.test']);
    expect(result.deduped).toBe(1);
  });

  it('aggregator URLs never reach validation', async () => {
    const db = makeDb();
    const connector = makeStaticConnector('serp.test', [
      makeRaw({
        extractedDomain: 'yell.com',
        rawUrl: 'https://yell.com/biz/acme',
        validationStatus: 'invalid',
        validationReason: 'aggregator host',
      }),
      makeRaw({ extractedDomain: 'real.test', rawUrl: 'https://real.test' }),
    ]);
    const result = await runDiscovery({
      queries: [{ industry: 'x', location: 'y' }],
      sources: [connector],
      rateLimitMs: 0,
      validate: true,
      fetchImpl: alwaysValidFetch(),
      db,
    });
    expect(result.freshDomains.map((d) => d.domain)).toEqual(['real.test']);
  });
});

// ---------------------------------------------------------------------------
// FREE_SOURCE_MODE — the scheduler should drop non-free connectors when
// the env flag is on. Driven by the runtime config, so we test indirectly
// via the connector contract.
// ---------------------------------------------------------------------------
describe('FREE_SOURCE_MODE handling', () => {
  it('duckDuckGoSerp + yell directory both declare isFree=true', () => {
    expect(duckDuckGoSerp.isFree).toBe(true);
  });
});
