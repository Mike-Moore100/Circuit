// Lightweight website validation — does this domain resolve to something
// that looks like a real business homepage? No deep inspection. HEAD where
// possible, fall back to a tiny GET, check for parking-page / dead-site
// markers.

const DEFAULT_USER_AGENT =
  'CircuitDiscovery/0.1 (+lead-research bot; non-commercial; respect robots)';

const PARKING_MARKERS = [
  'this domain is for sale',
  'buy this domain',
  'domain parked',
  'parked free',
  'sedoparking',
  'godaddy parking',
  'expired domain',
  'coming soon',
  'site under construction',
  'website coming soon',
  'default web page',
  'apache2 default page',
  'nginx welcome',
  'it works!',
  'this site can’t be reached',
];

export interface ValidationResult {
  domain: string;
  status: 'valid' | 'invalid';
  reason?: string;
  responseCode: number;
  contentLength: number;
  hasTitle: boolean;
  hasContent: boolean;
  durationMs: number;
}

export interface ValidationOptions {
  timeoutMs?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  minContentChars?: number;
}

function invalid(
  domain: string,
  reason: string,
  partial: Partial<ValidationResult>,
  startedAt: number,
): ValidationResult {
  return {
    domain,
    status: 'invalid',
    reason,
    responseCode: partial.responseCode ?? 0,
    contentLength: partial.contentLength ?? 0,
    hasTitle: partial.hasTitle ?? false,
    hasContent: partial.hasContent ?? false,
    durationMs: Date.now() - startedAt,
  };
}

export async function validateWebsite(
  domain: string,
  options: ValidationOptions = {},
): Promise<ValidationResult> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 6000;
  const ua = options.userAgent ?? DEFAULT_USER_AGENT;
  const minContent = options.minContentChars ?? 200;
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `https://${domain.replace(/^https?:\/\//, '')}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Try GET (small read) — many sites reject HEAD or return wrong status.
    const res = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': ua,
        Accept: 'text/html',
      },
    });
    const responseCode = res.status;
    if (!res.ok) {
      return invalid(domain, `HTTP ${responseCode}`, { responseCode }, startedAt);
    }
    const ctype = (res.headers.get('content-type') ?? '').toLowerCase();
    if (!ctype.includes('html')) {
      return invalid(domain, `non-HTML content-type: ${ctype}`, { responseCode }, startedAt);
    }
    // Read only the first 16KB to keep memory tiny.
    const body = await readBounded(res, 16 * 1024);
    const lower = body.toLowerCase();
    const titleMatch = body.match(/<title[^>]*>([^<]{0,200})<\/title>/i);
    const hasTitle = !!titleMatch && titleMatch[1].trim().length > 0;
    const visibleText = lower
      .replace(/<script[\s\S]*?<\/script>/g, ' ')
      .replace(/<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<[^>]+>/g, ' ');
    const visibleLen = visibleText.replace(/\s+/g, ' ').trim().length;
    if (visibleLen < minContent) {
      return invalid(
        domain,
        `sparse content (${visibleLen} chars)`,
        { responseCode, contentLength: visibleLen, hasTitle },
        startedAt,
      );
    }
    for (const marker of PARKING_MARKERS) {
      if (lower.includes(marker) && visibleLen < 800) {
        return invalid(
          domain,
          `parking / placeholder page (matched "${marker}")`,
          { responseCode, contentLength: visibleLen, hasTitle },
          startedAt,
        );
      }
    }
    return {
      domain,
      status: 'valid',
      responseCode,
      contentLength: visibleLen,
      hasTitle,
      hasContent: visibleLen >= minContent,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err ?? 'unknown error');
    return invalid(domain, msg, {}, startedAt);
  } finally {
    clearTimeout(timer);
  }
}

// Read at most `cap` bytes from a Response body. Keeps memory tiny on
// large pages (we only ever need the first KB or two for validation).
async function readBounded(res: Response, cap: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return await res.text().then((t) => t.slice(0, cap));
  const decoder = new TextDecoder();
  let accumulated = '';
  let received = 0;
  while (received < cap) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    accumulated += decoder.decode(value, { stream: true });
    if (accumulated.length >= cap) {
      accumulated = accumulated.slice(0, cap);
      break;
    }
  }
  try {
    reader.cancel();
  } catch {
    /* ignore */
  }
  return accumulated;
}
