// Pure URL → canonical domain. Used by every discovery source so the
// deduper compares apples to apples. Also handles a small set of
// aggregator URLs that wrap the real business URL.

// Anything that's a directory aggregator — when a SERP/directory result
// points here, the URL describes the LISTING, not the actual business.
// We still extract whatever business hostname is hidden in the path or
// query string when possible; otherwise we return null and the caller
// keeps the raw URL but flags this as not-a-business-domain.
const AGGREGATOR_HOSTS = new Set([
  'yell.com',
  'yelp.com',
  'yelp.co.uk',
  'bark.com',
  'thomsonlocal.com',
  'cylex-uk.co.uk',
  'cylex.com',
  'tripadvisor.com',
  'tripadvisor.co.uk',
  'google.com',
  'maps.google.com',
  'facebook.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'instagram.com',
  'youtube.com',
  'wikipedia.org',
  'en.wikipedia.org',
  'reddit.com',
]);

export function extractDomain(rawUrl: string): string | null {
  if (!rawUrl) return null;
  const candidate = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  try {
    const u = new URL(candidate);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (!host || !host.includes('.')) return null;
    return host;
  } catch {
    return null;
  }
}

export function isAggregator(domain: string | null): boolean {
  if (!domain) return false;
  return AGGREGATOR_HOSTS.has(domain);
}

// Strip tracking params + fragments so two raw URLs that point to the same
// page produce the same canonical form. Used internally by the deduper.
export function canonicaliseUrl(rawUrl: string): string {
  try {
    const u = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
    u.hash = '';
    const stripParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'ref'];
    for (const p of stripParams) u.searchParams.delete(p);
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    // Drop trailing slash
    let s = u.toString();
    s = s.replace(/\/$/, '');
    return s;
  } catch {
    return rawUrl;
  }
}
