import type { Database } from 'better-sqlite3';
import { config } from '../config/index';
import { getDb } from '../db/client';
import {
  extractDomain,
  insertContactRoute,
  insertOrUpdateContact,
  getContactsForCompany,
  getContactRoutesForCompany,
} from '../db/repository';
import { contactabilityForCompany, scoreContact } from './contactConfidence';
import {
  classifyEmail,
  emailMatchesName,
  type ExtractedEmail,
} from './emailExtractor';
import {
  fallbackRoleEmails,
  guessEmailsForName,
} from './emailPatternGuesser';
import { detectDecisionMakers, type DetectedPerson } from './decisionMakerDetector';
import {
  crawlContactPages,
  type ContactPage,
} from './websiteContactExtractor';
import {
  looksJsRendered,
  renderContactPagesForCompany,
  whyJsRendered,
  type PageRenderer,
} from './playwrightContactExtractor';
import type {
  ContactDiscoveryResult,
  ContactSource,
  DiscoveredContact,
  DiscoveredRoute,
} from './contactTypes';

const CACHE_FRESH_DAYS = 14;

function isCacheFresh(iso: string): boolean {
  const age = Date.now() - new Date(iso).getTime();
  return age < CACHE_FRESH_DAYS * 24 * 60 * 60 * 1000;
}

function emptyResult(
  companyId: string,
  startedAt: number,
  errorMessage?: string,
): ContactDiscoveryResult {
  return {
    companyId,
    contacts: [],
    routes: [],
    contactabilityScore: 0,
    pagesCrawled: 0,
    staticPagesCrawled: 0,
    playwrightPagesCrawled: 0,
    playwrightRan: false,
    playwrightReason: errorMessage ?? 'not attempted',
    fromCache: false,
    durationMs: Date.now() - startedAt,
    errorMessage,
  };
}

export interface DiscoverContactsOptions {
  companyId: string;
  websiteUrl: string | null;
  force?: boolean;
  db?: Database;
  // Injection point for tests — bypasses Playwright entirely.
  playwrightRenderer?: PageRenderer;
}

// ---------------------------------------------------------------------------
// Gate the fallback strictly. Returns "should we run it?" + reason string.
// ---------------------------------------------------------------------------
function fallbackDecision(
  staticPages: ContactPage[],
  staticDms: DetectedPerson[],
  staticEmails: Map<string, unknown>,
): { run: boolean; reason: string } {
  if (!config.contactPlaywright.enabled) {
    return { run: false, reason: 'CONTACT_PLAYWRIGHT_FALLBACK_ENABLED=0' };
  }
  if (staticPages.length === 0) {
    return { run: false, reason: 'no static homepage to inspect' };
  }
  const namedDms = staticDms.length;
  const emailCount = staticEmails.size;
  if (namedDms === 0 && emailCount === 0) {
    return { run: true, reason: 'static crawl found 0 contacts' };
  }
  const homepage = staticPages[0];
  // Trigger the fallback for JS-rendered shells only when the static crawl
  // produced zero named decision-makers. If we already have at least one
  // named person, the cheap static path is good enough — no Playwright cost.
  if (namedDms === 0 && looksJsRendered(homepage)) {
    return {
      run: true,
      reason: `JS-rendered shell — ${whyJsRendered(homepage)}`,
    };
  }
  return {
    run: false,
    reason: `static crawl sufficient (${namedDms} named DM, ${emailCount} email)`,
  };
}

// ---------------------------------------------------------------------------
// Aggregator — given a set of pages tagged with their source, produce the
// canonical maps the rest of the orchestrator consumes.
// ---------------------------------------------------------------------------
interface SourcedEmail extends ExtractedEmail {
  sourceUrl: string;
  source: 'static' | 'playwright';
}
interface SourcedDm extends DetectedPerson {
  source: 'static' | 'playwright';
}
interface SourcedPhone {
  value: string;
  sourceUrl: string;
  source: 'static' | 'playwright';
}

function aggregatePages(
  pages: ContactPage[],
  source: 'static' | 'playwright',
): {
  emails: SourcedEmail[];
  phones: SourcedPhone[];
  dms: SourcedDm[];
} {
  const emails: SourcedEmail[] = [];
  const phones: SourcedPhone[] = [];
  const dms: SourcedDm[] = [];
  for (const page of pages) {
    for (const e of page.emails) {
      emails.push({ ...e, sourceUrl: page.url, source });
    }
    for (const p of page.phones) {
      phones.push({ value: p, sourceUrl: page.url, source });
    }
    for (const dm of detectDecisionMakers(page.root, page.textContent, page.url)) {
      dms.push({ ...dm, source });
    }
  }
  return { emails, phones, dms };
}

// ---------------------------------------------------------------------------
export async function discoverContactsForCompany(
  opts: DiscoverContactsOptions,
): Promise<ContactDiscoveryResult> {
  const db = opts.db ?? getDb();
  const startedAt = Date.now();

  if (!config.contactDiscovery.enabled) {
    return emptyResult(opts.companyId, startedAt, 'discovery disabled');
  }
  if (!opts.websiteUrl) {
    return emptyResult(opts.companyId, startedAt, 'no website on lead');
  }

  // Cache: if we have fresh contacts persisted, return them as-is.
  if (!opts.force) {
    const existing = getContactsForCompany(opts.companyId, db);
    const fresh = existing.find(
      (c) => c.discovered_at && isCacheFresh(c.discovered_at),
    );
    if (fresh) {
      const cachedContacts = existing.map(rowToDiscoveredContact);
      const cachedRoutes = getContactRoutesForCompany(opts.companyId, db).map(
        rowToDiscoveredRoute,
      );
      return {
        companyId: opts.companyId,
        contacts: cachedContacts,
        routes: cachedRoutes,
        contactabilityScore: contactabilityForCompany(cachedContacts, cachedRoutes),
        pagesCrawled: 0,
        staticPagesCrawled: 0,
        playwrightPagesCrawled: 0,
        playwrightRan: false,
        playwrightReason: 'cache hit',
        fromCache: true,
        durationMs: Date.now() - startedAt,
      };
    }
  }

  // ---- 1. Static crawl --------------------------------------------------
  let staticPages: ContactPage[] = [];
  try {
    staticPages = await crawlContactPages(opts.websiteUrl);
  } catch (err) {
    return emptyResult(
      opts.companyId,
      startedAt,
      err instanceof Error ? err.message : String(err),
    );
  }

  const staticAgg = aggregatePages(staticPages, 'static');
  const staticEmailMap = new Map<string, SourcedEmail>();
  for (const e of staticAgg.emails) {
    if (!staticEmailMap.has(e.email)) staticEmailMap.set(e.email, e);
  }
  const staticDmByName = dedupeDmsByName(staticAgg.dms);

  // ---- 2. Decide on Playwright fallback ---------------------------------
  const decision = fallbackDecision(staticPages, [...staticDmByName.values()], staticEmailMap);
  let renderedPages: ContactPage[] = [];
  let playwrightError: string | undefined;
  let playwrightRan = false;
  if (decision.run) {
    playwrightRan = true;
    try {
      const result = await renderContactPagesForCompany(opts.websiteUrl, {
        renderer: opts.playwrightRenderer,
      });
      renderedPages = result.pages;
      if (result.errorMessage) playwrightError = result.errorMessage;
    } catch (err) {
      playwrightError = err instanceof Error ? err.message : String(err);
    }
  }

  const renderedAgg = aggregatePages(renderedPages, 'playwright');

  // If neither crawler returned a single page, this is a network-dead lead.
  // Bail out with an empty result rather than fabricating fallback emails.
  if (staticPages.length === 0 && renderedPages.length === 0) {
    return emptyResult(opts.companyId, startedAt, 'no pages reachable');
  }

  // ---- 3. Merge --------------------------------------------------------
  // Static wins on dedup ties (it's cheaper + already canonical).
  const emailByAddr = new Map<string, SourcedEmail>(staticEmailMap);
  for (const e of renderedAgg.emails) {
    if (!emailByAddr.has(e.email)) emailByAddr.set(e.email, e);
  }
  const dmByName = new Map(staticDmByName);
  for (const dm of renderedAgg.dms) {
    const key = dm.name.toLowerCase();
    const existing = dmByName.get(key);
    if (!existing || dm.roleConfidence > existing.roleConfidence) {
      dmByName.set(key, dm);
    }
  }
  const phoneByDigits = new Map<string, SourcedPhone>();
  for (const p of [...staticAgg.phones, ...renderedAgg.phones]) {
    const digits = p.value.replace(/[^\d]/g, '');
    if (!phoneByDigits.has(digits)) phoneByDigits.set(digits, p);
  }

  // ---- 4. Build contacts ------------------------------------------------
  const contacts: DiscoveredContact[] = [];

  // 4a. DMs paired with matched emails
  for (const dm of dmByName.values()) {
    const match = Array.from(emailByAddr.values()).find((e) =>
      emailMatchesName(e.local, dm.name),
    );
    contacts.push({
      name: dm.name,
      role: dm.role,
      detectedRole: dm.detectedRole,
      email: match?.email ?? null,
      emailType: match ? classifyEmail(match.local) : null,
      emailStatus: match ? 'extracted' : null,
      linkedinUrl: null,
      sourceUrl: dm.sourceUrl,
      source: dm.source,
      roleConfidence: dm.roleConfidence,
      emailConfidence: match ? 85 : 0,
      overallConfidence: 0,
      isPrimary: false,
    });
  }

  // 4b. General / role emails not paired with a DM
  for (const info of emailByAddr.values()) {
    if (contacts.some((c) => c.email === info.email)) continue;
    contacts.push({
      name: null,
      role: null,
      detectedRole: 'unknown',
      email: info.email,
      emailType: info.type,
      emailStatus: 'extracted',
      linkedinUrl: null,
      sourceUrl: info.sourceUrl,
      source: info.source,
      roleConfidence: 0,
      emailConfidence: info.type === 'personal' ? 70 : 55,
      overallConfidence: 0,
      isPrimary: false,
    });
  }

  // 4c. Pattern-guess emails for DMs we couldn't pair
  const domain = extractDomain(opts.websiteUrl);
  if (domain) {
    for (const c of contacts) {
      if (c.email || !c.name) continue;
      const guesses = guessEmailsForName(c.name, domain);
      if (guesses.length > 0) {
        c.email = guesses[0].email;
        c.emailType = 'personal';
        c.emailStatus = 'guessed';
        c.emailConfidence = 35;
        // c.source is left as 'static' or 'playwright' — the NAME was
        // discovered there; only the email is guessed.
      }
    }
  }

  // 4d. Fallback role emails if we still have nothing
  const anyEmail = contacts.some((c) => c.email);
  if (!anyEmail && domain) {
    for (const guess of fallbackRoleEmails(domain).slice(0, 2)) {
      contacts.push({
        name: null,
        role: null,
        detectedRole: 'unknown',
        email: guess.email,
        emailType: 'info',
        emailStatus: 'guessed',
        linkedinUrl: null,
        sourceUrl: (staticPages[0] ?? renderedPages[0])?.url ?? opts.websiteUrl,
        source: 'inferred',
        roleConfidence: 0,
        emailConfidence: 25,
        overallConfidence: 0,
        isPrimary: false,
      });
    }
  }

  // ---- 5. Score + pick primary ----------------------------------------
  for (const c of contacts) c.overallConfidence = scoreContact(c);
  contacts.sort((a, b) => b.overallConfidence - a.overallConfidence);
  if (contacts[0]) contacts[0].isPrimary = true;

  // ---- 6. Routes -------------------------------------------------------
  const routes: DiscoveredRoute[] = [];
  for (const c of contacts) {
    if (!c.email) continue;
    routes.push({
      type: 'EMAIL',
      value: c.email,
      sourceUrl: c.sourceUrl,
      confidence: c.emailConfidence,
    });
  }
  for (const p of phoneByDigits.values()) {
    routes.push({ type: 'PHONE', value: p.value, sourceUrl: p.sourceUrl, confidence: 80 });
  }
  const allPages = [...staticPages, ...renderedPages];
  for (const page of allPages) {
    if (page.forms.some((f) => f.hasEmailInput)) {
      routes.push({
        type: 'CONTACT_FORM',
        value: page.url,
        sourceUrl: page.url,
        confidence: 75,
      });
      break;
    }
  }
  for (const page of allPages) {
    const booking = page.links.find((l) =>
      /calendly\.com|cal\.com|savvycal\.com|acuityscheduling\.com|hubspot\.com\/meetings|setmore\.com|fresha\.com/i.test(
        l.href,
      ),
    );
    if (booking) {
      routes.push({
        type: 'BOOKING_LINK',
        value: booking.href,
        sourceUrl: page.url,
        confidence: 80,
      });
      break;
    }
  }
  for (const page of allPages) {
    const li = page.links.find((l) =>
      /linkedin\.com\/(?:company|in|school)\//i.test(l.href),
    );
    if (li) {
      routes.push({
        type: 'LINKEDIN',
        value: li.href,
        sourceUrl: page.url,
        confidence: 70,
      });
      break;
    }
  }
  const contactPage = allPages.find((p) => /\/contact/i.test(p.url));
  if (contactPage) {
    routes.push({
      type: 'GENERAL_CONTACT_PAGE',
      value: contactPage.url,
      sourceUrl: contactPage.url,
      confidence: 60,
    });
  }

  const contactabilityScore = contactabilityForCompany(contacts, routes);

  // ---- 7. Persist ------------------------------------------------------
  for (const c of contacts) {
    insertOrUpdateContact(opts.companyId, c, db);
  }
  for (const r of routes) {
    insertContactRoute(opts.companyId, r, db);
  }

  return {
    companyId: opts.companyId,
    contacts,
    routes,
    contactabilityScore,
    pagesCrawled: staticPages.length + renderedPages.length,
    staticPagesCrawled: staticPages.length,
    playwrightPagesCrawled: renderedPages.length,
    playwrightRan,
    playwrightReason: decision.reason,
    playwrightError,
    fromCache: false,
    durationMs: Date.now() - startedAt,
  };
}

function dedupeDmsByName(dms: SourcedDm[]): Map<string, SourcedDm> {
  const out = new Map<string, SourcedDm>();
  for (const dm of dms) {
    const key = dm.name.toLowerCase();
    const existing = out.get(key);
    if (!existing || dm.roleConfidence > existing.roleConfidence) out.set(key, dm);
  }
  return out;
}

function rowToDiscoveredContact(row: {
  name: string | null;
  role: string | null;
  email: string | null;
  email_type: string | null;
  email_status: string | null;
  linkedin_url: string | null;
  source: string | null;
  source_url: string | null;
  role_confidence: number | null;
  email_confidence: number | null;
  overall_confidence: number | null;
  is_primary: number | null;
}): DiscoveredContact {
  return {
    name: row.name,
    role: row.role,
    detectedRole: 'unknown',
    email: row.email,
    emailType: row.email_type as DiscoveredContact['emailType'],
    emailStatus: row.email_status as DiscoveredContact['emailStatus'],
    linkedinUrl: row.linkedin_url,
    sourceUrl: row.source_url ?? '',
    source: (row.source as ContactSource) ?? 'static',
    roleConfidence: row.role_confidence ?? 0,
    emailConfidence: row.email_confidence ?? 0,
    overallConfidence: row.overall_confidence ?? 0,
    isPrimary: Boolean(row.is_primary),
  };
}

function rowToDiscoveredRoute(row: {
  route_type: string;
  value: string;
  source_url: string | null;
  confidence: number | null;
}): DiscoveredRoute {
  return {
    type: row.route_type as DiscoveredRoute['type'],
    value: row.value,
    sourceUrl: row.source_url ?? '',
    confidence: row.confidence ?? 0,
  };
}
