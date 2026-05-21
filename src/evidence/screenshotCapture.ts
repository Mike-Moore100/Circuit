import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index';
import type { CaptureResult, DomSnapshot } from './evidenceTypes';

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

interface CaptureOptions {
  url: string;
  outputDir: string;
  timeoutMs?: number;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function normaliseUrl(input: string): string {
  if (!input) return input;
  return /^https?:\/\//i.test(input) ? input : `https://${input}`;
}

// We import Playwright dynamically so this module can be loaded even when
// chromium isn't installed — capturePages will simply fail-safe.
async function loadChromium(): Promise<typeof import('playwright').chromium | null> {
  try {
    const mod = await import('playwright');
    return mod.chromium;
  } catch {
    return null;
  }
}

// Script source string for page.evaluate(). Passed as a string (rather than
// a function reference) because tsx/esbuild wraps named module-level
// functions with a `__name(...)` debug helper that doesn't exist in the
// browser context. Strings are evaluated raw.
const SNAPSHOT_SCRIPT_SRC = `
(function () {
  var CTA_RX = /(book|schedule|enquire|contact|get in touch|request a (quote|demo|call)|free consult|start (now|free|trial)|sign up|join|talk to|call us|email us|get started)/i;
  function visible(el) {
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    var style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;
    return true;
  }
  var buttons = Array.from(document.querySelectorAll(
    'button, a.btn, a[role="button"], input[type="submit"], a[href*="/contact"], a[href*="book"], a[href*="schedule"], a[href*="signup"], a[href*="sign-up"]'
  ));
  var visibleButtons = buttons.filter(visible);
  var ctaTexts = [];
  for (var i = 0; i < visibleButtons.length; i++) {
    var b = visibleButtons[i];
    var text = (b.textContent || '').replace(/\\s+/g, ' ').trim();
    if (!text) continue;
    if (CTA_RX.test(text) || /^(go|next|continue)$/i.test(text)) {
      ctaTexts.push(text.slice(0, 60));
      if (ctaTexts.length >= 8) break;
    }
  }
  var hasMailto = !!document.querySelector('a[href^="mailto:"]');
  var hasTel = !!document.querySelector('a[href^="tel:"]');
  var bodyText = ((document.body && document.body.innerText) || '').slice(0, 5000);
  var hasPhysicalAddressHint =
    /\\b(?:Suite|Floor|Avenue|Street|Road|Lane|Boulevard|Plaza)\\b/i.test(bodyText) ||
    /[A-Z]{1,2}\\d{1,2}\\s?\\d[A-Z]{2}/.test(bodyText);
  var copyMatch = bodyText.match(/©\\s?(\\d{4})|copyright\\s+(?:©\\s*)?(\\d{4})/i);
  var hasCopyrightYear = copyMatch ? Number(copyMatch[1] || copyMatch[2]) : null;
  return {
    title: document.title || null,
    htmlLength: document.documentElement.outerHTML.length,
    hasMetaViewport: !!document.querySelector('meta[name="viewport"]'),
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    h1Count: document.querySelectorAll('h1').length,
    buttonCount: visibleButtons.length,
    ctaTexts: ctaTexts,
    formCount: document.querySelectorAll('form').length,
    hasEmailInput: !!document.querySelector('input[type="email"]'),
    hasMailto: hasMailto,
    hasTel: hasTel,
    hasPhysicalAddressHint: hasPhysicalAddressHint,
    hasCopyrightYear: hasCopyrightYear,
    visibleBodyText: bodyText
  };
})()
`;

export async function capturePages({ url, outputDir, timeoutMs }: CaptureOptions): Promise<CaptureResult> {
  const startedAt = Date.now();
  const chromium = await loadChromium();
  if (!chromium) {
    return {
      url,
      desktopPath: null,
      mobilePath: null,
      desktop: null,
      mobile: null,
      errorMessage:
        'Playwright not available — run `npm install playwright && npx playwright install chromium`.',
      durationMs: Date.now() - startedAt,
    };
  }

  ensureDir(outputDir);
  const target = normaliseUrl(url);
  const pageTimeout = timeoutMs ?? config.evidence.timeoutMs;

  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    return {
      url,
      desktopPath: null,
      mobilePath: null,
      desktop: null,
      mobile: null,
      errorMessage: `Chromium launch failed: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - startedAt,
    };
  }

  let desktopPath: string | null = null;
  let mobilePath: string | null = null;
  let desktop: DomSnapshot | null = null;
  let mobile: DomSnapshot | null = null;
  let errorMessage: string | undefined;

  // ---- Desktop pass -----------------------------------------------------
  try {
    const ctx = await browser.newContext({
      viewport: DESKTOP_VIEWPORT,
      ignoreHTTPSErrors: true,
    });
    let consoleErrorCount = 0;
    const page = await ctx.newPage();
    page.on('pageerror', () => (consoleErrorCount += 1));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrorCount += 1;
    });
    const response = await page.goto(target, {
      timeout: pageTimeout,
      waitUntil: 'domcontentloaded',
    });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const ok = !!response && response.ok();
    desktopPath = path.join(outputDir, 'desktop.png');
    await page.screenshot({ path: desktopPath, fullPage: false });
    const raw = (await page.evaluate(SNAPSHOT_SCRIPT_SRC)) as Omit<
      DomSnapshot,
      'url' | 'finalUrl' | 'ok' | 'consoleErrorCount'
    >;
    desktop = {
      url: target,
      finalUrl: page.url(),
      ok,
      consoleErrorCount,
      ...raw,
    };
    await ctx.close();
  } catch (err) {
    errorMessage = `desktop: ${err instanceof Error ? err.message : String(err)}`;
    desktopPath = null;
  }

  // ---- Mobile pass ------------------------------------------------------
  try {
    const ctx = await browser.newContext({
      viewport: MOBILE_VIEWPORT,
      userAgent: MOBILE_UA,
      ignoreHTTPSErrors: true,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    let consoleErrorCount = 0;
    const page = await ctx.newPage();
    page.on('pageerror', () => (consoleErrorCount += 1));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrorCount += 1;
    });
    const response = await page.goto(target, {
      timeout: pageTimeout,
      waitUntil: 'domcontentloaded',
    });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const ok = !!response && response.ok();
    mobilePath = path.join(outputDir, 'mobile.png');
    await page.screenshot({ path: mobilePath, fullPage: false });
    const raw = (await page.evaluate(SNAPSHOT_SCRIPT_SRC)) as Omit<
      DomSnapshot,
      'url' | 'finalUrl' | 'ok' | 'consoleErrorCount'
    >;
    mobile = {
      url: target,
      finalUrl: page.url(),
      ok,
      consoleErrorCount,
      ...raw,
    };
    await ctx.close();
  } catch (err) {
    const msg = `mobile: ${err instanceof Error ? err.message : String(err)}`;
    errorMessage = errorMessage ? `${errorMessage}; ${msg}` : msg;
    mobilePath = null;
  }

  await browser.close().catch(() => {});

  return {
    url,
    desktopPath,
    mobilePath,
    desktop,
    mobile,
    errorMessage,
    durationMs: Date.now() - startedAt,
  };
}
