import type { PageFingerprint, VerifiedSignal } from './types';
import { WEBSITE_SIGNAL } from './types';

// Phrase libraries — kept inline so they're easy to scan + tweak. Each
// match contributes a discrete signal; multiple matches on the same key
// upgrade confidence but only emit one signal per key.
const CONTACT_TEXT = ['contact us', 'get in touch', 'contact', 'enquire'];
const BOOKING_TEXT = [
  'book a call',
  'book a demo',
  'book now',
  'schedule a call',
  'schedule a demo',
  'book an appointment',
  'request a quote',
  'request a consultation',
  'free consultation',
];
const BOOKING_HOSTS = [
  'calendly.com',
  'savvycal.com',
  'cal.com',
  'hubspot.com/meetings',
  'acuityscheduling.com',
  'square.site/book',
  'setmore.com',
  'fresha.com',
];
const ECOMMERCE_TEXT = [
  'add to cart',
  'add to basket',
  'shop now',
  'shopping cart',
  'free shipping',
  'checkout',
];
const ECOMMERCE_HOST_HINTS = ['shopify.com', 'bigcommerce.com', 'squarespace.com'];
const SAAS_TEXT = [
  'sign up free',
  'start free trial',
  'free trial',
  'log in',
  'login',
  'pricing tier',
  'monthly plan',
  'per month',
  'per user',
];
const SERVICE_BUSINESS_TEXT = [
  'our services',
  'what we do',
  'we help',
  'our work',
  'case studies',
  'client portfolio',
];
const LOCAL_TEXT = [
  'serving',
  'based in',
  'opening hours',
  'open today',
  'visit our office',
  'visit our showroom',
];
const SUPPORT_TEXT = [
  'help center',
  'support center',
  'help centre',
  'support centre',
  'knowledge base',
  'faq',
  'frequently asked questions',
];
const MANUAL_WORKFLOW_TEXT = [
  'we handle',
  'we manage',
  'we coordinate',
  'we schedule',
  'we invoice',
  'we take care of',
  'we look after',
  'manual process',
  'manual workflow',
  'spreadsheet',
  'admin support',
  'back office',
];
// Strong signals that the lead IS an automation / AI agency themselves —
// these are competitors, not buyers, so we want a clean penalty.
const AI_PROVIDER_TEXT = [
  'we build ai',
  'we build agents',
  'ai consultancy',
  'ai consulting',
  'ai agency',
  'ai automation services',
  'machine learning consultancy',
  'we automate',
  'process automation services',
  'rpa services',
  'no-code automation',
  'workflow automation services',
  'we develop custom ai',
  'we ship ai',
  'ai-powered platform we sell',
];
const HIGH_FIT_TEXT = [
  'client onboarding',
  'client intake',
  'lead intake',
  'invoicing',
  'reporting cadence',
  'monthly reporting',
  'weekly reporting',
  'customer support',
  'support tickets',
  'admin overhead',
];

function any(text: string, needles: readonly string[]): string | null {
  for (const n of needles) {
    if (text.includes(n)) return n;
  }
  return null;
}

function manyMatchCount(text: string, needles: readonly string[]): number {
  let count = 0;
  for (const n of needles) if (text.includes(n)) count += 1;
  return count;
}

function buildSignal(
  type: string,
  value: string,
  confidence: number,
): VerifiedSignal {
  return { type, value, confidence };
}

export function extractSignalsFromPages(pages: PageFingerprint[]): VerifiedSignal[] {
  if (pages.length === 0) return [];

  const signals: VerifiedSignal[] = [];
  const seen = new Set<string>();
  const add = (s: VerifiedSignal) => {
    if (seen.has(s.type)) return;
    seen.add(s.type);
    signals.push(s);
  };

  // Combine corpora across all fetched pages.
  const combinedText = pages.map((p) => p.visibleText).join(' \n ');
  const titleText = pages.map((p) => p.title ?? '').join(' \n ').toLowerCase();
  const metaText = pages.map((p) => p.metaDescription ?? '').join(' \n ').toLowerCase();
  const allText = `${combinedText} \n ${titleText} \n ${metaText}`;
  const allLinks = pages.flatMap((p) => p.links);
  const allForms = pages.flatMap((p) => p.forms);

  // WEBSITE_LOADS — always true here since we have at least one page.
  add(
    buildSignal(WEBSITE_SIGNAL.WEBSITE_LOADS, 'homepage rendered successfully', 100),
  );

  // ---- Internal pages ---------------------------------------------------
  const internalLinks = allLinks.filter((l) => l.rel === 'internal');
  const contactLink = internalLinks.find(
    (l) => /\/contact($|\/|\?|#)/i.test(l.href) || any(l.text, CONTACT_TEXT),
  );
  if (contactLink) add(buildSignal(WEBSITE_SIGNAL.HAS_CONTACT_PAGE, contactLink.href, 90));

  const serviceLinks = internalLinks.filter((l) =>
    /\/services?(\/|$|\?|#)/i.test(l.href) || /our services|what we do/.test(l.text),
  );
  if (serviceLinks.length >= 1) {
    add(
      buildSignal(WEBSITE_SIGNAL.HAS_SERVICES_PAGE, serviceLinks[0].href, 85),
    );
  }
  if (serviceLinks.length >= 3) {
    add(
      buildSignal(
        WEBSITE_SIGNAL.HAS_MULTIPLE_SERVICE_PAGES,
        `${serviceLinks.length} service pages linked`,
        80,
      ),
    );
  }

  const careersLink = internalLinks.find((l) =>
    /\/(careers?|jobs|hiring)(\/|$|\?|#)/i.test(l.href) ||
    /careers|hiring|join the team|we['’]re hiring|now hiring/.test(l.text),
  );
  if (careersLink) {
    add(buildSignal(WEBSITE_SIGNAL.HAS_CAREERS_PAGE, careersLink.href, 85));
  }

  const supportLink = internalLinks.find((l) =>
    /\/(help|support|knowledge-base|faq)(\/|$|\?|#)/i.test(l.href) ||
    any(l.text, SUPPORT_TEXT),
  );
  if (supportLink || any(allText, SUPPORT_TEXT)) {
    add(
      buildSignal(
        WEBSITE_SIGNAL.HAS_SUPPORT_OR_HELP,
        supportLink?.href ?? 'support/help language in content',
        70,
      ),
    );
  }

  // ---- Contact form (form with email-like input) ------------------------
  const contactForm = allForms.find((f) => f.hasEmailInput);
  if (contactForm) {
    add(
      buildSignal(
        WEBSITE_SIGNAL.HAS_CONTACT_FORM,
        contactForm.action ?? 'form with email input present',
        90,
      ),
    );
  }

  // ---- Booking / scheduling ---------------------------------------------
  const bookingTextHit = any(allText, BOOKING_TEXT);
  const bookingLink = allLinks.find((l) =>
    BOOKING_HOSTS.some((h) => l.href.includes(h)) || any(l.text, BOOKING_TEXT),
  );
  if (bookingLink || bookingTextHit) {
    add(
      buildSignal(
        WEBSITE_SIGNAL.HAS_BOOKING_LINK,
        bookingLink?.href ?? `text: "${bookingTextHit}"`,
        80,
      ),
    );
  }

  // ---- Ecommerce indicators --------------------------------------------
  const ecommerceTextHit = manyMatchCount(allText, ECOMMERCE_TEXT);
  const ecommerceHostHit = allLinks.some((l) =>
    ECOMMERCE_HOST_HINTS.some((h) => l.href.includes(h)),
  );
  if (ecommerceTextHit >= 1 || ecommerceHostHit) {
    add(
      buildSignal(
        WEBSITE_SIGNAL.HAS_ECOMMERCE_SIGNALS,
        `text hits=${ecommerceTextHit}, host hint=${ecommerceHostHit}`,
        80,
      ),
    );
  }

  // ---- Service business / SaaS / local SMB classification --------------
  const serviceHits = manyMatchCount(allText, SERVICE_BUSINESS_TEXT) + serviceLinks.length;
  if (serviceHits >= 2) {
    add(
      buildSignal(
        WEBSITE_SIGNAL.LIKELY_SERVICE_BUSINESS,
        `service-business signals (${serviceHits})`,
        80,
      ),
    );
  }
  const saasHits = manyMatchCount(allText, SAAS_TEXT);
  if (saasHits >= 2) {
    add(buildSignal(WEBSITE_SIGNAL.LIKELY_SAAS, `saas signals (${saasHits})`, 70));
  }
  const localHits = manyMatchCount(allText, LOCAL_TEXT);
  if (localHits >= 1) {
    add(
      buildSignal(WEBSITE_SIGNAL.LIKELY_LOCAL_SMB, `local-SMB language (${localHits})`, 65),
    );
  }

  // ---- Manual workflow / automation-fit language ----------------------
  const manualHits = manyMatchCount(allText, MANUAL_WORKFLOW_TEXT);
  if (manualHits >= 1) {
    add(
      buildSignal(
        WEBSITE_SIGNAL.HAS_MANUAL_WORKFLOW_LANGUAGE,
        `manual-workflow phrases (${manualHits})`,
        75,
      ),
    );
  }
  const highFitHits = manyMatchCount(allText, HIGH_FIT_TEXT);
  if (highFitHits >= 1) {
    add(
      buildSignal(
        WEBSITE_SIGNAL.HIGH_AUTOMATION_FIT,
        `automation-fit phrases (${highFitHits})`,
        75,
      ),
    );
  }

  // ---- AI/automation provider (competitor) ----------------------------
  const aiHits = manyMatchCount(allText, AI_PROVIDER_TEXT);
  if (aiHits >= 1) {
    add(
      buildSignal(
        WEBSITE_SIGNAL.HAS_AI_AUTOMATION_LANGUAGE,
        `AI/automation provider phrases (${aiHits})`,
        85,
      ),
    );
  }

  // ---- Low digital maturity heuristic ---------------------------------
  // Very short visible text + few links is a proxy for thin / single-page
  // sites with little to integrate against.
  const totalText = combinedText.length;
  const totalLinks = internalLinks.length;
  if (totalText < 600 && totalLinks < 6) {
    add(
      buildSignal(
        WEBSITE_SIGNAL.LOW_DIGITAL_MATURITY,
        `${totalText}b text, ${totalLinks} internal links`,
        70,
      ),
    );
  }

  return signals;
}
