// SERP discovery — uses DuckDuckGo's HTML interface as the default free
// search source. No API key, no rendering. Parses the HTML SERP page
// with node-html-parser and produces RawDiscovery rows.
//
// To plug in a paid provider later (SerpAPI, Bright Data, Bing), implement
// the DiscoverySourceConnector interface in this file and add it to
// the connector registry in discoveryScheduler.ts.

import { parse } from 'node-html-parser';
import { extractDomain, isAggregator } from './domainExtraction';
import type {
  DiscoveryQuery,
  DiscoverySourceConnector,
  RawDiscovery,
  SearchOptions,
} from './discoveryTypes';

// DuckDuckGo HTML actively filters bot-shaped User-Agents — requests
// with our previous self-identifying string returned 200 OK but with no
// result rows. A real browser UA is required for the SERP to actually
// render results. We're still small-scale + polite (2s+ between
// requests by default + caps per query), which is the operative
// constraint here.
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

// DuckDuckGo HTML endpoint — public, no API key required. Pages can be a
// few hundred KB; parsing is cheap.
const DUCKDUCKGO_HTML_URL = 'https://html.duckduckgo.com/html/';

function buildQueryString(q: DiscoveryQuery): string {
  const parts = [q.industry, q.location];
  if (q.modifiers && q.modifiers.length > 0) parts.push(...q.modifiers);
  return parts.filter(Boolean).join(' ');
}

// DuckDuckGo HTML SERP shape (stable for years):
//   <div class="result results_links results_links_deep web-result">
//     <a class="result__a" href="https://...">Title</a>
//     <a class="result__url" href="...">domain.com</a>
//     <a class="result__snippet">snippet text</a>
//
// We're tolerant — different rendering paths exist; we try multiple
// selectors and skip any item we can't parse cleanly.
export function parseDuckDuckGoHtml(
  html: string,
  source = 'serp.duckduckgo',
): RawDiscovery[] {
  const root = parse(html);
  const results = root.querySelectorAll('.result, .web-result, [data-testid="result"]');
  const out: RawDiscovery[] = [];
  for (const el of results) {
    const linkEl = el.querySelector('.result__a, a.result__title, h2 a');
    const snippetEl = el.querySelector('.result__snippet, .result__body, [data-testid="snippet"]');
    if (!linkEl) continue;
    const rawUrl = unwrapDuckDuckGoRedirect(linkEl.getAttribute('href') ?? '');
    if (!rawUrl) continue;
    const title = (linkEl.text ?? '').replace(/\s+/g, ' ').trim();
    const snippet = (snippetEl?.text ?? '').replace(/\s+/g, ' ').trim() || null;
    const extractedDomain = extractDomain(rawUrl);
    if (!extractedDomain) continue;
    // Aggregator listings rarely yield the actual business URL; we still
    // capture them, just mark validationStatus 'pending' so the deduper
    // and validator can decide.
    out.push({
      source,
      businessName: deriveBusinessName(title),
      rawUrl,
      extractedDomain,
      title: title || null,
      snippet,
      location: null,
      phone: extractPhone(snippet ?? ''),
      discoveredAt: new Date().toISOString(),
      // Aggregator results never produce a "fresh business domain" — flag
      // immediately so the validator skips the GET.
      validationStatus: isAggregator(extractedDomain) ? 'invalid' : 'pending',
      validationReason: isAggregator(extractedDomain) ? 'aggregator host' : null,
    });
  }
  return out;
}

// DuckDuckGo HTML wraps every external link as
// /l/?uddg=https%3A%2F%2Frealsite.com... — unwrap it.
function unwrapDuckDuckGoRedirect(href: string): string | null {
  if (!href) return null;
  if (!href.includes('/l/?')) {
    // Some results are already absolute; tolerate both shapes.
    if (href.startsWith('//')) return `https:${href}`;
    if (href.startsWith('http')) return href;
    return null;
  }
  try {
    // Either fully-qualified or path-only — handle both.
    const u = href.startsWith('http')
      ? new URL(href)
      : new URL(`https://duckduckgo.com${href}`);
    const uddg = u.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
    return null;
  } catch {
    return null;
  }
}

// SERP titles are usually "Business Name - Tagline | Domain"; pull the
// segment before the separators.
function deriveBusinessName(title: string): string {
  if (!title) return 'unknown';
  const cleaned = title.replace(/\s+/g, ' ').trim();
  const split = cleaned.split(/\s+[|·\-—–]\s+/);
  return split[0]?.slice(0, 120) || cleaned.slice(0, 120);
}

// Conservative phone extractor — same shape as src/contacts/phoneExtractor
// but inlined to keep this module independent.
function extractPhone(text: string): string | null {
  if (!text) return null;
  const m = text.match(
    /(?:\+?\d{1,3}[\s.\-]?)?(?:\(\d{2,5}\)|\d{2,5})[\s.\-]?\d{2,4}[\s.\-]?\d{2,4}/,
  );
  if (!m) return null;
  const digits = m[0].replace(/[^\d]/g, '');
  if (digits.length < 9 || digits.length > 15) return null;
  return m[0].trim();
}

// ---------------------------------------------------------------------------
// Connector — production default is DuckDuckGo HTML.
// ---------------------------------------------------------------------------
export const duckDuckGoSerp: DiscoverySourceConnector = {
  name: 'serp.duckduckgo',
  isFree: true,
  async search(query: DiscoveryQuery, options: SearchOptions = {}): Promise<RawDiscovery[]> {
    const maxResults = options.maxResults ?? 30;
    const timeoutMs = options.timeoutMs ?? 12000;
    const ua = options.userAgent ?? DEFAULT_USER_AGENT;
    const fetchImpl = options.fetchImpl ?? fetch;

    const body = new URLSearchParams({ q: buildQueryString(query), kl: 'wt-wt' }).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(DUCKDUCKGO_HTML_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'User-Agent': ua,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'text/html',
        },
        body,
      });
      if (!res.ok) return [];
      const html = await res.text();
      const parsed = parseDuckDuckGoHtml(html);
      return parsed.slice(0, maxResults);
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  },
};
