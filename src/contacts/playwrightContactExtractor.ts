import { parse, type HTMLElement } from 'node-html-parser';
import { config } from '../config/index';
import { extractEmailsFromText } from './emailExtractor';
import { extractPhonesFromText } from './phoneExtractor';
import type { ContactPage } from './websiteContactExtractor';

const SPA_HOSTS = [
  'wix.com',
  'wixsite.com',
  'wixstudio.com',
  'wixstatic.com',
  'squarespace.com',
  'squarespace-cdn.com',
  'webflow.io',
  'webflow.com',
  'framer.website',
  'framer.app',
  'vercel.app',
  'netlify.app',
  'github.io',
];

const SPA_MARKERS = [
  '<div id="root">',
  '<div id="__next">',
  'data-reactroot',
  'data-svelte',
  '<div id="app">',
  'wix-image',
  'data-wix-',
  'data-sqs-',
  '__framer__',
  'data-framer',
  'webflow.com',
  '/_next/',
  '/_nuxt/',
];

const TARGET_PATHS = [
  '/contact',
  '/contact-us',
  '/about',
  '/about-us',
  '/team',
  '/our-team',
  '/meet-the-team',
  '/people',
  '/staff',
];

const FOLLOW_PATTERNS =
  /\/(contact|about|team|meet[-_]the[-_]team|our[-_]team|people|staff)(\/|$|\?|#)/i;

const DEFAULT_USER_AGENT =
  'CircuitContacts/0.1 (+lead-research bot; non-commercial; respect robots) Playwright';

// Inspect a static-crawled homepage and decide whether it's the kind of
// site we need Playwright to render. Used as a soft gate — combined with
// "static crawl returned nothing useful" in the orchestrator.
export function looksJsRendered(page: ContactPage): boolean {
  try {
    const host = new URL(page.finalUrl).hostname.toLowerCase();
    if (SPA_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return true;
  } catch {
    /* noop */
  }
  const preview = (page.rawHtmlPreview ?? '').toLowerCase();
  if (SPA_MARKERS.some((m) => preview.includes(m.toLowerCase()))) return true;
  // Empty-ish shell: very little visible text + nothing structured
  if (
    page.textContent.length < 800 &&
    page.forms.length === 0 &&
    page.links.filter((l) => l.rel === 'internal').length < 4
  ) {
    return true;
  }
  return false;
}

export function whyJsRendered(page: ContactPage): string {
  try {
    const host = new URL(page.finalUrl).hostname.toLowerCase();
    const hit = SPA_HOSTS.find((h) => host === h || host.endsWith(`.${h}`));
    if (hit) return `host ${host} matches ${hit}`;
  } catch {
    /* noop */
  }
  const preview = (page.rawHtmlPreview ?? '').toLowerCase();
  const marker = SPA_MARKERS.find((m) => preview.includes(m.toLowerCase()));
  if (marker) return `HTML marker "${marker}"`;
  if (
    page.textContent.length < 800 &&
    page.forms.length === 0 &&
    page.links.filter((l) => l.rel === 'internal').length < 4
  ) {
    return `thin shell — ${page.textContent.length} chars visible text`;
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Renderer abstraction — production uses Playwright, tests inject a fake.
// ---------------------------------------------------------------------------
export interface RenderInput {
  url: string;
  timeoutMs: number;
  userAgent: string;
}

export interface RenderedRaw {
  finalUrl: string;
  statusCode: number;
  ok: boolean;
  title: string | null;
  // The text the user actually sees AFTER JS has rendered. Important —
  // page.evaluate(() => document.body.innerText) gives us this, not the
  // raw HTML's textContent.
  visibleText: string;
  html: string;
}

export type PageRenderer = (input: RenderInput) => Promise<RenderedRaw | null>;

// ---------------------------------------------------------------------------
// Default renderer — dynamic-imports Playwright so the module loads even
// when chromium isn't installed (capture just returns null + logs).
// ---------------------------------------------------------------------------
async function loadChromium(): Promise<typeof import('playwright').chromium | null> {
  try {
    const mod = await import('playwright');
    return mod.chromium;
  } catch {
    return null;
  }
}

interface BrowserHandle {
  // Minimal subset of the Browser API we need — avoids importing types from
  // playwright at the top level (which would force every consumer to have
  // chromium installed for typechecking).
  newContext(opts: Record<string, unknown>): Promise<{
    newPage(): Promise<{
      goto(url: string, opts: Record<string, unknown>): Promise<{ ok(): boolean; status(): number } | null>;
      url(): string;
      title(): Promise<string>;
      content(): Promise<string>;
      evaluate<T>(fn: string): Promise<T>;
      waitForLoadState(state: string, opts: Record<string, unknown>): Promise<void>;
    }>;
    close(): Promise<void>;
  }>;
  close(): Promise<void>;
}

async function renderWithBrowser(
  browser: BrowserHandle,
  input: RenderInput,
): Promise<RenderedRaw | null> {
  let ctx: Awaited<ReturnType<BrowserHandle['newContext']>> | null = null;
  try {
    ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
      userAgent: input.userAgent,
    });
    const page = await ctx.newPage();
    const response = await page.goto(input.url, {
      timeout: input.timeoutMs,
      waitUntil: 'domcontentloaded',
    });
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
    const ok = !!response && response.ok();
    const statusCode = response ? response.status() : 0;
    const finalUrl = page.url();
    const title = await page.title().catch(() => null);
    const visibleText = await page.evaluate<string>(
      '(document.body && document.body.innerText) ? document.body.innerText : ""',
    );
    const html = await page.content();
    return {
      finalUrl,
      statusCode,
      ok,
      title: title ?? null,
      visibleText: (visibleText ?? '').slice(0, 10000),
      html,
    };
  } catch {
    return null;
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Convert a RenderedRaw into the same ContactPage shape the static crawl
// produces, so downstream extractors don't need a separate code path.
// ---------------------------------------------------------------------------
function toContactPage(raw: RenderedRaw, requestedUrl: string): ContactPage {
  const root = parse(raw.html, {
    blockTextElements: { script: false, style: false, noscript: false },
  });
  for (const node of root.querySelectorAll('script,style,noscript,template')) {
    node.remove();
  }
  let baseHost = '';
  try {
    baseHost = new URL(raw.finalUrl).host;
  } catch {
    /* noop */
  }
  const mailtoLinks = root
    .querySelectorAll('a[href^="mailto:"]')
    .map((a) => (a.getAttribute('href') ?? '').replace(/^mailto:/i, '').split('?')[0])
    .filter(Boolean);
  // Render-time visible text is the authoritative source for emails on
  // SPA pages — the raw HTML often has none until JS runs.
  const searchCorpus = `${raw.visibleText}\n${mailtoLinks.join('\n')}`;
  const emails = extractEmailsFromText(searchCorpus);
  const phones = extractPhonesFromText(raw.visibleText);
  const links = root.querySelectorAll('a[href]').map((a) => {
    const href = a.getAttribute('href') ?? '';
    let absolute = href;
    try {
      absolute = new URL(href, raw.finalUrl).toString();
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
    url: requestedUrl,
    finalUrl: raw.finalUrl,
    statusCode: raw.statusCode,
    ok: raw.ok,
    title: raw.title,
    textContent: raw.visibleText,
    emails,
    phones,
    links,
    forms,
    root: root as HTMLElement,
    rawHtmlLength: raw.html.length,
    rawHtmlPreview: raw.html.slice(0, 8 * 1024),
  };
}

// ---------------------------------------------------------------------------
// Crawl: render homepage + a bounded set of contact/about/team pages.
// Renderer is injected so tests can run without chromium.
// ---------------------------------------------------------------------------
export interface RenderedCrawlOptions {
  maxPages?: number;
  timeoutMs?: number;
  userAgent?: string;
  renderer?: PageRenderer;
}

export interface RenderedCrawlResult {
  pages: ContactPage[];
  errorMessage?: string;
  rendererAvailable: boolean;
}

function joinUrl(base: string, p: string): string {
  try {
    return new URL(p, base).toString();
  } catch {
    return p;
  }
}

export async function renderContactPagesForCompany(
  homepageUrl: string,
  options: RenderedCrawlOptions = {},
): Promise<RenderedCrawlResult> {
  const maxPages = options.maxPages ?? config.contactPlaywright.maxPagesPerCompany;
  const timeoutMs = options.timeoutMs ?? config.contactPlaywright.timeoutMs;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const normalised = /^https?:\/\//i.test(homepageUrl)
    ? homepageUrl
    : `https://${homepageUrl}`;

  // Test path / injected renderer ------------------------------------------
  if (options.renderer) {
    return crawlWithRenderer(normalised, maxPages, options.renderer, timeoutMs, userAgent);
  }

  // Production path: launch chromium once, render each page, close. --------
  const chromium = await loadChromium();
  if (!chromium) {
    return {
      pages: [],
      rendererAvailable: false,
      errorMessage:
        'Playwright/chromium not available. Run `npx playwright install chromium`.',
    };
  }

  let browser: BrowserHandle | null = null;
  try {
    browser = (await chromium.launch({ headless: true })) as unknown as BrowserHandle;
  } catch (err) {
    return {
      pages: [],
      rendererAvailable: false,
      errorMessage: `chromium launch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const renderer: PageRenderer = (input) => renderWithBrowser(browser!, input);
  try {
    return await crawlWithRenderer(normalised, maxPages, renderer, timeoutMs, userAgent);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function crawlWithRenderer(
  homepageUrl: string,
  maxPages: number,
  renderer: PageRenderer,
  timeoutMs: number,
  userAgent: string,
): Promise<RenderedCrawlResult> {
  const pages: ContactPage[] = [];
  const visited = new Set<string>();

  const home = await renderer({ url: homepageUrl, timeoutMs, userAgent });
  if (!home) {
    return {
      pages: [],
      rendererAvailable: true,
      errorMessage: 'homepage render returned null',
    };
  }
  visited.add(safePath(home.finalUrl));
  pages.push(toContactPage(home, homepageUrl));

  if (pages.length >= maxPages) {
    return { pages, rendererAvailable: true };
  }

  // Candidate URLs: linked internal contact/about/team pages first,
  // then blind-probe known target paths.
  const candidates: string[] = [];
  for (const link of pages[0].links) {
    if (link.rel !== 'internal') continue;
    try {
      const u = new URL(link.href);
      if (!FOLLOW_PATTERNS.test(u.pathname)) continue;
      const path = safePath(u.toString());
      if (visited.has(path)) continue;
      visited.add(path);
      candidates.push(u.toString());
    } catch {
      /* skip */
    }
  }
  for (const p of TARGET_PATHS) {
    if (visited.has(p)) continue;
    visited.add(p);
    candidates.push(joinUrl(home.finalUrl, p));
  }

  for (const url of candidates) {
    if (pages.length >= maxPages) break;
    const r = await renderer({ url, timeoutMs, userAgent });
    if (!r || !r.ok) continue;
    pages.push(toContactPage(r, url));
  }

  return { pages, rendererAvailable: true };
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/$/, '') || '/';
  } catch {
    return url;
  }
}
