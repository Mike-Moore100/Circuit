import { describe, it, expect } from 'vitest';
import { extractSignalsFromPages } from '../src/inspection/extractWebsiteSignals';
import { inspectWebsite } from '../src/inspection/websiteInspector';
import { WEBSITE_SIGNAL } from '../src/inspection/types';
import { parse } from 'node-html-parser';
import type { PageFingerprint } from '../src/inspection/types';

function fpFromHtml(url: string, html: string, statusCode = 200): PageFingerprint {
  const root = parse(html);
  const baseHost = new URL(url).host;
  const links = root.querySelectorAll('a[href]').map((a) => {
    const href = a.getAttribute('href') ?? '';
    let absolute = href;
    try {
      absolute = new URL(href, url).toString();
    } catch {
      // noop
    }
    let rel: 'internal' | 'external' = 'external';
    try {
      rel = new URL(absolute).host === baseHost ? 'internal' : 'external';
    } catch {
      rel = 'external';
    }
    return { href: absolute, text: (a.text ?? '').toLowerCase().trim(), rel };
  });
  const forms = root.querySelectorAll('form').map((f) => {
    const inputs = f.querySelectorAll('input,textarea');
    const hasEmailInput = inputs.some((i) =>
      (i.getAttribute('type') ?? '').toLowerCase() === 'email',
    );
    return { action: f.getAttribute('action') ?? null, hasEmailInput, inputCount: inputs.length };
  });
  for (const node of root.querySelectorAll('script,style,noscript')) node.remove();
  return {
    url,
    finalUrl: url,
    statusCode,
    title: root.querySelector('title')?.text ?? null,
    metaDescription:
      root.querySelector('meta[name="description"]')?.getAttribute('content') ?? null,
    visibleText: root.text.replace(/\s+/g, ' ').trim().toLowerCase(),
    links,
    forms,
    rawHtmlPreview: html.slice(0, 1024),
  };
}

describe('extractSignalsFromPages', () => {
  it('emits the right signals for a typical service-business homepage', () => {
    const html = `
      <html>
        <head><title>Acme Bookkeeping</title>
          <meta name="description" content="We handle bookkeeping, invoicing and admin for small businesses">
        </head>
        <body>
          <h1>We help small businesses</h1>
          <p>Our services include client onboarding, invoicing, and monthly reporting.</p>
          <a href="/services">Our services</a>
          <a href="/services/payroll">Payroll services</a>
          <a href="/services/tax">Tax services</a>
          <a href="/contact">Contact us</a>
          <a href="https://calendly.com/acme/intro">Book a call</a>
          <a href="/careers">Careers</a>
          <form action="/contact">
            <input type="text" name="name" />
            <input type="email" name="email" />
            <textarea name="message"></textarea>
            <button type="submit">Send</button>
          </form>
        </body>
      </html>`;
    const signals = extractSignalsFromPages([fpFromHtml('https://acme.example', html)]);
    const types = signals.map((s) => s.type);
    expect(types).toContain(WEBSITE_SIGNAL.WEBSITE_LOADS);
    expect(types).toContain(WEBSITE_SIGNAL.HAS_CONTACT_PAGE);
    expect(types).toContain(WEBSITE_SIGNAL.HAS_CONTACT_FORM);
    expect(types).toContain(WEBSITE_SIGNAL.HAS_BOOKING_LINK);
    expect(types).toContain(WEBSITE_SIGNAL.HAS_SERVICES_PAGE);
    expect(types).toContain(WEBSITE_SIGNAL.HAS_MULTIPLE_SERVICE_PAGES);
    expect(types).toContain(WEBSITE_SIGNAL.HAS_CAREERS_PAGE);
    expect(types).toContain(WEBSITE_SIGNAL.HAS_MANUAL_WORKFLOW_LANGUAGE);
    expect(types).toContain(WEBSITE_SIGNAL.HIGH_AUTOMATION_FIT);
    expect(types).toContain(WEBSITE_SIGNAL.LIKELY_SERVICE_BUSINESS);
  });

  it('flags AI/automation provider language as a penalty signal', () => {
    const html = `
      <html><head><title>Foo AI</title></head>
      <body>
        We build AI agents and process automation services for enterprises.
        AI consultancy and machine learning consultancy at scale.
      </body></html>`;
    const signals = extractSignalsFromPages([fpFromHtml('https://foo.example', html)]);
    expect(signals.map((s) => s.type)).toContain(
      WEBSITE_SIGNAL.HAS_AI_AUTOMATION_LANGUAGE,
    );
  });

  it('flags low digital maturity for tiny one-pagers', () => {
    const html = `<html><head><title>Tiny</title></head><body>hi</body></html>`;
    const signals = extractSignalsFromPages([fpFromHtml('https://tiny.example', html)]);
    expect(signals.map((s) => s.type)).toContain(WEBSITE_SIGNAL.LOW_DIGITAL_MATURITY);
  });

  it('detects ecommerce signals via text and host hints', () => {
    const html = `
      <html><body>
      <a href="https://shop.example/cart">View cart</a>
      <button>Add to cart</button>
      <a href="https://shopify.com/some-shop">Powered by Shopify</a>
      </body></html>`;
    const signals = extractSignalsFromPages([fpFromHtml('https://shop.example', html)]);
    expect(signals.map((s) => s.type)).toContain(WEBSITE_SIGNAL.HAS_ECOMMERCE_SIGNALS);
  });

  it('returns no signals for an empty page set', () => {
    expect(extractSignalsFromPages([])).toEqual([]);
  });
});

describe('inspectWebsite — fetch failure paths', () => {
  it('returns a website_failed signal when fetch throws', async () => {
    const fakeFetch: typeof fetch = async () => {
      throw new Error('ECONNREFUSED 127.0.0.1');
    };
    const result = await inspectWebsite('https://nope.example', {
      fetchImpl: fakeFetch,
      timeoutMs: 50,
      maxPagesPerSite: 1,
    });
    expect(result.status).toBe('failed');
    expect(result.signals.map((s) => s.type)).toContain(
      WEBSITE_SIGNAL.WEBSITE_FAILED_TO_LOAD,
    );
  });

  it('returns failed for non-2xx responses', async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response('Server Error', { status: 503 });
    const result = await inspectWebsite('https://broken.example', {
      fetchImpl: fakeFetch,
      timeoutMs: 1000,
      maxPagesPerSite: 1,
    });
    expect(result.status).toBe('failed');
    expect(result.signals[0].type).toBe(WEBSITE_SIGNAL.WEBSITE_FAILED_TO_LOAD);
  });

  it('parses a happy-path 200 response and returns rich signals', async () => {
    const html = `
      <html><head><title>Lumen</title></head>
      <body>
        <h1>Marketing for SMBs</h1>
        <p>Our services include client onboarding and weekly reporting.</p>
        <a href="/services">Services</a>
        <a href="/services/ppc">PPC</a>
        <a href="/services/seo">SEO</a>
        <a href="/contact">Contact</a>
        <form><input type="email" /></form>
      </body></html>`;
    const fakeFetch: typeof fetch = async () =>
      new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
    const result = await inspectWebsite('https://lumen.example', {
      fetchImpl: fakeFetch,
      timeoutMs: 1000,
      maxPagesPerSite: 1,
    });
    expect(result.status).toBe('ok');
    expect(result.pages).toHaveLength(1);
    const types = result.signals.map((s) => s.type);
    expect(types).toContain(WEBSITE_SIGNAL.WEBSITE_LOADS);
    expect(types).toContain(WEBSITE_SIGNAL.HAS_CONTACT_PAGE);
    expect(types).toContain(WEBSITE_SIGNAL.HAS_CONTACT_FORM);
    expect(types).toContain(WEBSITE_SIGNAL.HAS_MULTIPLE_SERVICE_PAGES);
  });

  it('returns "skipped" for null / empty URLs without crashing', async () => {
    const r1 = await inspectWebsite(null);
    expect(r1.status).toBe('skipped');
    const r2 = await inspectWebsite('');
    expect(r2.status).toBe('skipped');
  });
});
