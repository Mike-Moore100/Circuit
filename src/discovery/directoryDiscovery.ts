// Directory discovery — modular adapter for free directory listings
// (Yellow Pages, Yelp-style sites, niche industry directories).
//
// Architecture: one generic adapter, configured per directory. Adding a
// new directory is a config object, not new code.
//
// Production note: many directories actively block scrapers. The default
// connector set is intentionally minimal and uses very polite rate
// limits. Aggressive use should switch to a paid SERP provider that
// resolves the domains for you.

import { parse } from 'node-html-parser';
import { extractDomain, isAggregator } from './domainExtraction';
import type {
  DiscoveryQuery,
  DiscoverySourceConnector,
  RawDiscovery,
  SearchOptions,
} from './discoveryTypes';

// Real-browser UA is required — most directories return a 200 placeholder
// or 403 to self-identifying bot UAs. We stay polite via long rate-limits
// + small per-query caps; this is small-scale operator-driven discovery.
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

export interface DirectoryConfig {
  name: string; // e.g. 'directory.yell'
  isFree: boolean;
  // URL template — supports {industry} and {location} placeholders.
  searchUrlTemplate: string;
  // CSS selectors for parsing.
  selectors: {
    listItem: string;
    businessName: string;
    businessUrl: string; // attribute holding the outbound business URL
    snippet?: string;
    location?: string;
    phone?: string;
  };
  // Some directories embed the real business URL in a tracking redirect.
  // Pass a function that unwraps it; default = identity.
  unwrapBusinessUrl?: (raw: string) => string;
}

function fillTemplate(tpl: string, q: DiscoveryQuery): string {
  return tpl
    .replace(/{industry}/g, encodeURIComponent(q.industry))
    .replace(/{location}/g, encodeURIComponent(q.location));
}

// Generic parser — works for any directory whose listings follow a
// standard list-item layout. The selectors object configures the rest.
export function parseDirectoryHtml(
  html: string,
  config: DirectoryConfig,
): RawDiscovery[] {
  const root = parse(html);
  const items = root.querySelectorAll(config.selectors.listItem);
  const out: RawDiscovery[] = [];
  for (const el of items) {
    const nameEl = el.querySelector(config.selectors.businessName);
    const urlEl = el.querySelector(config.selectors.businessUrl);
    if (!nameEl || !urlEl) continue;
    const businessName = (nameEl.text ?? '').replace(/\s+/g, ' ').trim();
    const rawHref = urlEl.getAttribute('href') ?? '';
    const rawUrl = (config.unwrapBusinessUrl ?? ((s) => s))(rawHref);
    if (!rawUrl || !businessName) continue;
    const domain = extractDomain(rawUrl);
    const snippet = config.selectors.snippet
      ? (el.querySelector(config.selectors.snippet)?.text ?? '').replace(/\s+/g, ' ').trim() || null
      : null;
    const location = config.selectors.location
      ? (el.querySelector(config.selectors.location)?.text ?? '').replace(/\s+/g, ' ').trim() || null
      : null;
    const phone = config.selectors.phone
      ? (el.querySelector(config.selectors.phone)?.text ?? '').replace(/\s+/g, ' ').trim() || null
      : null;
    const aggregator = isAggregator(domain);
    out.push({
      source: config.name,
      businessName: businessName.slice(0, 120),
      rawUrl,
      extractedDomain: domain,
      title: businessName,
      snippet,
      location,
      phone,
      discoveredAt: new Date().toISOString(),
      validationStatus: aggregator || !domain ? 'invalid' : 'pending',
      validationReason: aggregator ? 'aggregator host' : !domain ? 'unparseable URL' : null,
    });
  }
  return out;
}

// Build a connector from a directory config. The result implements the
// DiscoverySourceConnector contract.
export function buildDirectoryConnector(
  config: DirectoryConfig,
): DiscoverySourceConnector {
  return {
    name: config.name,
    isFree: config.isFree,
    async search(query: DiscoveryQuery, options: SearchOptions = {}): Promise<RawDiscovery[]> {
      const maxResults = options.maxResults ?? 30;
      const timeoutMs = options.timeoutMs ?? 12000;
      const ua = options.userAgent ?? DEFAULT_USER_AGENT;
      const fetchImpl = options.fetchImpl ?? fetch;

      const url = fillTemplate(config.searchUrlTemplate, query);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(url, {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal,
          headers: {
            'User-Agent': ua,
            Accept: 'text/html',
          },
        });
        if (!res.ok) return [];
        const html = await res.text();
        const parsed = parseDirectoryHtml(html, config);
        return parsed.slice(0, maxResults);
      } catch {
        return [];
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Example connector — Yell.com (UK Yellow Pages) shape. Public listings.
// Adapter only; real-world use needs polite rate-limiting and respect
// for robots.txt. Connector is FREE in the FREE_SOURCE_MODE sense; the
// underlying directory has its own terms.
// ---------------------------------------------------------------------------
export const yellDirectoryConfig: DirectoryConfig = {
  name: 'directory.yell',
  isFree: true,
  searchUrlTemplate:
    'https://www.yell.com/ucs/UcsSearchAction.do?keywords={industry}&location={location}',
  selectors: {
    listItem: '[data-testid="search-result"], .businessCapsule--mainRow',
    businessName: 'h2, .businessCapsule--name',
    businessUrl: 'a[href*="/biz/"]',
    snippet: '.businessCapsule--summary, .businessCapsule--strapline',
    location: '.businessCapsule--address',
    phone: '.business--telephoneNumber, .telephoneNumber',
  },
};

export const yellDirectory = buildDirectoryConnector(yellDirectoryConfig);
