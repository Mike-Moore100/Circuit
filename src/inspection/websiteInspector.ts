import { parse, type HTMLElement } from 'node-html-parser';
import { config } from '../config/index';
import { extractDomain } from '../db/repository';
import type { InspectionResult, PageFingerprint } from './types';
import { extractSignalsFromPages } from './extractWebsiteSignals';

const DEFAULT_USER_AGENT =
  'CircuitInspector/0.1 (+lead-research bot; non-commercial; respect robots)';

// Lightweight HTTP page fetcher with timeout + redirect handling. We trust
// the global fetch (Node 18+) and rely on AbortController for timeouts.
async function fetchPage(
  url: string,
  options: { timeoutMs: number; fetchImpl: typeof fetch; userAgent: string },
): Promise<{ ok: boolean; statusCode: number; finalUrl: string; html: string; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await options.fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': options.userAgent,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en',
      },
    });
    const html = await response.text();
    return {
      ok: response.ok,
      statusCode: response.status,
      finalUrl: response.url || url,
      html,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err ?? 'unknown error');
    return { ok: false, statusCode: 0, finalUrl: url, html: '', error: message };
  } finally {
    clearTimeout(timer);
  }
}

function normaliseUrl(input: string): string {
  if (!input) return input;
  if (/^https?:\/\//i.test(input)) return input;
  return `https://${input}`;
}

function visibleTextFrom(root: HTMLElement): string {
  // node-html-parser doesn't have a true "innerText", but stripping scripts +
  // styles and reading textContent is close enough for keyword matching.
  for (const node of root.querySelectorAll('script,style,noscript,template')) {
    node.remove();
  }
  return root.text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function extractFingerprint(rawUrl: string, finalUrl: string, statusCode: number, html: string): PageFingerprint {
  const root = parse(html, {
    blockTextElements: { script: false, style: false, noscript: false },
  });
  const title = root.querySelector('title')?.text?.trim() || null;
  const metaDescription =
    root
      .querySelector('meta[name="description"]')
      ?.getAttribute('content')
      ?.trim() ?? null;

  const baseHost = new URL(finalUrl).host;
  const links = root.querySelectorAll('a[href]').map((a) => {
    const href = a.getAttribute('href') ?? '';
    let absolute = href;
    try {
      absolute = new URL(href, finalUrl).toString();
    } catch {
      // ignore malformed hrefs
    }
    let rel: 'internal' | 'external' = 'external';
    try {
      rel = new URL(absolute).host === baseHost ? 'internal' : 'external';
    } catch {
      rel = 'external';
    }
    return {
      href: absolute,
      text: (a.text ?? '').replace(/\s+/g, ' ').trim().toLowerCase(),
      rel,
    };
  });

  const forms = root.querySelectorAll('form').map((f) => {
    const inputs = f.querySelectorAll('input,textarea');
    const hasEmailInput = inputs.some((i) => {
      const type = (i.getAttribute('type') ?? '').toLowerCase();
      const name = (i.getAttribute('name') ?? '').toLowerCase();
      const placeholder = (i.getAttribute('placeholder') ?? '').toLowerCase();
      const id = (i.getAttribute('id') ?? '').toLowerCase();
      return (
        type === 'email' ||
        /email|e-mail/.test(`${name} ${placeholder} ${id}`)
      );
    });
    return {
      action: f.getAttribute('action') ?? null,
      hasEmailInput,
      inputCount: inputs.length,
    };
  });

  return {
    url: rawUrl,
    finalUrl,
    statusCode,
    title,
    metaDescription,
    visibleText: visibleTextFrom(root),
    links,
    forms,
    rawHtmlPreview: html.slice(0, 4096),
  };
}

const FOLLOW_PATTERNS: Array<{ key: string; rx: RegExp }> = [
  { key: 'contact', rx: /(^|\/)contact($|\/|-|\.)/i },
  { key: 'services', rx: /(^|\/)(services?|what-we-do|capabilities|offerings)($|\/)/i },
  { key: 'pricing', rx: /(^|\/)(pricing|plans)($|\/)/i },
  { key: 'careers', rx: /(^|\/)(careers?|jobs|hiring|join-us|work-with-us)($|\/)/i },
  { key: 'about', rx: /(^|\/)about($|\/|-us)/i },
];

function pickFollowLinks(homepage: PageFingerprint, max: number): string[] {
  if (max <= 0) return [];
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const pattern of FOLLOW_PATTERNS) {
    if (ordered.length >= max) break;
    for (const link of homepage.links) {
      if (link.rel !== 'internal') continue;
      try {
        const u = new URL(link.href);
        if (!pattern.rx.test(u.pathname) && !pattern.rx.test(link.text)) continue;
        const key = `${u.host}${u.pathname}`;
        if (seen.has(key)) continue;
        seen.add(key);
        ordered.push(u.toString());
        if (ordered.length >= max) break;
      } catch {
        continue;
      }
    }
  }
  return ordered;
}

export interface InspectWebsiteOptions {
  timeoutMs?: number;
  maxPagesPerSite?: number;
  fetchImpl?: typeof fetch;
  userAgent?: string;
}

export async function inspectWebsite(
  rawUrl: string | null | undefined,
  options: InspectWebsiteOptions = {},
): Promise<InspectionResult> {
  const startedAt = Date.now();
  const url = rawUrl ? normaliseUrl(rawUrl) : '';
  const domain = url ? extractDomain(url) : null;

  // Disabled / missing URL fast paths.
  if (!config.websiteInspection.enabled) {
    return baseResult(url, domain, 'disabled', [], startedAt, 'inspection disabled');
  }
  if (!url) {
    return baseResult('', null, 'skipped', [], startedAt, 'no URL on lead');
  }
  if (config.websiteInspection.usePlaywright) {
    return baseResult(url, domain, 'failed', [], startedAt, 'playwright path not implemented yet');
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const userAgent = options.userAgent ?? config.websiteInspection.userAgent ?? DEFAULT_USER_AGENT;
  const timeoutMs = options.timeoutMs ?? config.websiteInspection.timeoutMs;
  const maxPages = options.maxPagesPerSite ?? config.websiteInspection.maxPagesPerSite;

  // 1. Homepage
  const homepage = await fetchPage(url, { timeoutMs, fetchImpl, userAgent });
  if (!homepage.ok || homepage.statusCode === 0) {
    return baseResult(
      url,
      domain,
      homepage.statusCode === 0 ? 'failed' : 'failed',
      [
        {
          type: 'verified.website_failed',
          value: homepage.error
            ? `fetch failed: ${homepage.error}`
            : `HTTP ${homepage.statusCode}`,
          confidence: 95,
        },
      ],
      startedAt,
      homepage.error ?? `HTTP ${homepage.statusCode}`,
    );
  }

  const fingerprints: PageFingerprint[] = [
    extractFingerprint(url, homepage.finalUrl, homepage.statusCode, homepage.html),
  ];

  // 2. Optional follow-ups (contact / services / careers etc.)
  const followLinks = pickFollowLinks(fingerprints[0], maxPages - 1);
  for (const next of followLinks) {
    const page = await fetchPage(next, { timeoutMs, fetchImpl, userAgent });
    if (!page.ok || page.statusCode === 0) continue;
    fingerprints.push(extractFingerprint(next, page.finalUrl, page.statusCode, page.html));
  }

  const signals = extractSignalsFromPages(fingerprints);

  return {
    url,
    domain,
    status: 'ok',
    pages: fingerprints,
    signals,
    fetchedAt: new Date().toISOString(),
    fromCache: false,
    durationMs: Date.now() - startedAt,
  };
}

function baseResult(
  url: string,
  domain: string | null,
  status: InspectionResult['status'],
  signals: InspectionResult['signals'],
  startedAt: number,
  errorMessage?: string,
): InspectionResult {
  return {
    url,
    domain,
    status,
    pages: [],
    signals,
    fetchedAt: new Date().toISOString(),
    fromCache: false,
    errorMessage,
    durationMs: Date.now() - startedAt,
  };
}
