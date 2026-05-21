import { parse, type HTMLElement } from 'node-html-parser';
import { config } from '../config/index';
import { extractEmailsFromText, type ExtractedEmail } from './emailExtractor';
import { extractPhonesFromText } from './phoneExtractor';

// Pages the SMB contact discovery layer will try to fetch, in priority
// order. Homepage is always fetched first; subsequent paths only fire if
// linked from the homepage OR if the path probe succeeds.
const TARGET_PATHS = [
  '/contact',
  '/contact-us',
  '/contact_us',
  '/contact.html',
  '/about',
  '/about-us',
  '/team',
  '/our-team',
  '/meet-the-team',
  '/people',
  '/staff',
];

const FOLLOW_PATTERNS = /\/(contact|about|team|meet[-_]the[-_]team|our[-_]team|people|staff)(\/|$|\?|#)/i;

const DEFAULT_USER_AGENT =
  'CircuitContacts/0.1 (+lead-research bot; non-commercial; respect robots)';

export interface ContactPage {
  url: string;
  finalUrl: string;
  statusCode: number;
  ok: boolean;
  title: string | null;
  textContent: string;
  emails: ExtractedEmail[];
  phones: string[];
  links: Array<{ href: string; text: string; rel: 'internal' | 'external' }>;
  forms: Array<{ action: string | null; hasEmailInput: boolean }>;
  root: HTMLElement;
  rawHtmlLength: number;
  errorMessage?: string;
}

async function fetchHtml(
  url: string,
  options: { timeoutMs: number; userAgent: string; fetchImpl: typeof fetch },
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
    return {
      ok: false,
      statusCode: 0,
      finalUrl: url,
      html: '',
      error: err instanceof Error ? err.message : String(err ?? 'unknown error'),
    };
  } finally {
    clearTimeout(timer);
  }
}

function parsePage(rawUrl: string, finalUrl: string, statusCode: number, html: string): ContactPage {
  const root = parse(html, {
    blockTextElements: { script: false, style: false, noscript: false },
  });
  for (const node of root.querySelectorAll('script,style,noscript,template')) {
    node.remove();
  }
  const title = root.querySelector('title')?.text?.trim() || null;
  // Insert whitespace between block / inline boundaries so that adjacent
  // elements don't get concatenated into pseudo-words (e.g. "USAhello@x.co").
  // We do this by reading text element-by-element and joining with spaces
  // rather than relying on the plain `root.text` concat.
  const textContent = collectTextWithSeparators(root);

  // Also include mailto: hrefs as candidates — they're often hidden from
  // visible text but present in source.
  const mailtoLinks = root
    .querySelectorAll('a[href^="mailto:"]')
    .map((a) => (a.getAttribute('href') ?? '').replace(/^mailto:/i, '').split('?')[0])
    .filter(Boolean);

  const searchCorpus = `${textContent}\n${mailtoLinks.join('\n')}`;
  const emails = extractEmailsFromText(searchCorpus);
  const phones = extractPhonesFromText(textContent);

  let baseHost = '';
  try {
    baseHost = new URL(finalUrl).host;
  } catch {
    /* noop */
  }
  const links = root.querySelectorAll('a[href]').map((a) => {
    const href = a.getAttribute('href') ?? '';
    let absolute = href;
    try {
      absolute = new URL(href, finalUrl).toString();
    } catch {
      /* leave as-is */
    }
    let rel: 'internal' | 'external' = 'external';
    try {
      rel = new URL(absolute).host === baseHost ? 'internal' : 'external';
    } catch {
      rel = 'external';
    }
    return {
      href: absolute,
      text: (a.text ?? '').replace(/\s+/g, ' ').trim(),
      rel,
    };
  });

  const forms = root.querySelectorAll('form').map((f) => {
    const inputs = f.querySelectorAll('input,textarea');
    const hasEmailInput = inputs.some((i) => {
      const type = (i.getAttribute('type') ?? '').toLowerCase();
      const name = (i.getAttribute('name') ?? '').toLowerCase();
      const placeholder = (i.getAttribute('placeholder') ?? '').toLowerCase();
      return type === 'email' || /email|e-mail/.test(`${name} ${placeholder}`);
    });
    return {
      action: f.getAttribute('action') ?? null,
      hasEmailInput,
    };
  });

  return {
    url: rawUrl,
    finalUrl,
    statusCode,
    ok: statusCode >= 200 && statusCode < 400,
    title,
    textContent,
    emails,
    phones,
    links,
    forms,
    root,
    rawHtmlLength: html.length,
  };
}

// Concatenate descendant text nodes, inserting a space between any two
// elements so adjacent inline siblings don't fuse into pseudo-words.
function collectTextWithSeparators(node: HTMLElement): string {
  const parts: string[] = [];
  walk(node, parts);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function walk(node: HTMLElement, parts: string[]): void {
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      // Text node
      const text = child.text;
      if (text && text.trim()) parts.push(text);
    } else if (child.nodeType === 1) {
      walk(child as HTMLElement, parts);
      // A trailing separator after each element ensures sibling boundaries.
      parts.push(' ');
    }
  }
}

function joinUrl(base: string, path: string): string {
  try {
    return new URL(path, base).toString();
  } catch {
    return path;
  }
}

export interface CrawlOptions {
  maxPages?: number;
  timeoutMs?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
}

export async function crawlContactPages(
  homepageUrl: string,
  options: CrawlOptions = {},
): Promise<ContactPage[]> {
  const maxPages = options.maxPages ?? config.contactDiscovery.maxPagesPerSite;
  const timeoutMs = options.timeoutMs ?? config.contactDiscovery.timeoutMs;
  const userAgent = options.userAgent ?? config.contactDiscovery.userAgent ?? DEFAULT_USER_AGENT;
  const fetchImpl = options.fetchImpl ?? fetch;

  const normalised = /^https?:\/\//i.test(homepageUrl)
    ? homepageUrl
    : `https://${homepageUrl}`;

  const pages: ContactPage[] = [];

  // 1. Homepage
  const home = await fetchHtml(normalised, { timeoutMs, userAgent, fetchImpl });
  if (home.ok) {
    pages.push(parsePage(normalised, home.finalUrl, home.statusCode, home.html));
  } else {
    return pages; // No homepage → bail. Caller decides how to handle.
  }

  // 2. Build candidate list: linked + probe.
  const visited = new Set<string>([new URL(normalised).pathname]);
  const candidates: string[] = [];
  for (const link of pages[0].links) {
    if (link.rel !== 'internal') continue;
    try {
      const u = new URL(link.href);
      if (!FOLLOW_PATTERNS.test(u.pathname)) continue;
      if (visited.has(u.pathname)) continue;
      visited.add(u.pathname);
      candidates.push(u.toString());
    } catch {
      /* skip */
    }
  }
  // Also blind-probe target paths the homepage didn't explicitly link to.
  for (const p of TARGET_PATHS) {
    if (visited.has(p)) continue;
    visited.add(p);
    candidates.push(joinUrl(home.finalUrl, p));
  }

  // 3. Fetch up to (maxPages - 1) follow-ups, stop early on 404s.
  for (const url of candidates) {
    if (pages.length >= maxPages) break;
    const page = await fetchHtml(url, { timeoutMs, userAgent, fetchImpl });
    if (!page.ok) continue;
    pages.push(parsePage(url, page.finalUrl, page.statusCode, page.html));
  }

  return pages;
}
