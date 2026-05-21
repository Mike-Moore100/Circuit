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
import { classifyEmail, emailMatchesName, type ExtractedEmail } from './emailExtractor';
import {
  fallbackRoleEmails,
  guessEmailsForName,
} from './emailPatternGuesser';
import { detectDecisionMakers, type DetectedPerson } from './decisionMakerDetector';
import { crawlContactPages, type ContactPage } from './websiteContactExtractor';
import type {
  ContactDiscoveryResult,
  DiscoveredContact,
  DiscoveredRoute,
} from './contactTypes';

const CACHE_FRESH_DAYS = 14; // re-run discovery for the same company at most every 2 weeks

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
}

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

  // Cache check — if we have contacts persisted recently, return them.
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
        fromCache: true,
        durationMs: Date.now() - startedAt,
      };
    }
  }

  let pages: ContactPage[] = [];
  try {
    pages = await crawlContactPages(opts.websiteUrl);
  } catch (err) {
    return emptyResult(
      opts.companyId,
      startedAt,
      err instanceof Error ? err.message : String(err),
    );
  }

  if (pages.length === 0) {
    return emptyResult(opts.companyId, startedAt, 'no pages reachable');
  }

  // ---- Aggregate emails across all pages -------------------------------
  const allEmails = new Map<string, ExtractedEmail & { sourceUrl: string }>();
  for (const page of pages) {
    for (const e of page.emails) {
      if (!allEmails.has(e.email)) {
        allEmails.set(e.email, { ...e, sourceUrl: page.url });
      }
    }
  }

  // ---- Aggregate phones (de-dupe by digits) ----------------------------
  const phones = new Map<string, { value: string; sourceUrl: string }>();
  for (const page of pages) {
    for (const p of page.phones) {
      const digits = p.replace(/[^\d]/g, '');
      if (!phones.has(digits)) phones.set(digits, { value: p, sourceUrl: page.url });
    }
  }

  // ---- Detect decision-makers ------------------------------------------
  const dms: DetectedPerson[] = [];
  for (const page of pages) {
    for (const p of detectDecisionMakers(page.root, page.textContent, page.url)) {
      dms.push(p);
    }
  }
  // Dedupe DMs by name (case-insensitive); keep highest-confidence row.
  const dmByName = new Map<string, DetectedPerson>();
  for (const dm of dms) {
    const key = dm.name.toLowerCase();
    const existing = dmByName.get(key);
    if (!existing || dm.roleConfidence > existing.roleConfidence) {
      dmByName.set(key, dm);
    }
  }

  // ---- Build contacts: pair DMs with emails by name match -------------
  const contacts: DiscoveredContact[] = [];
  for (const dm of dmByName.values()) {
    const match = Array.from(allEmails.values()).find((e) =>
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
      roleConfidence: dm.roleConfidence,
      emailConfidence: match ? 85 : 0,
      overallConfidence: 0,
      isPrimary: false,
    });
  }

  // ---- Add general / role emails that didn't pair with a DM -----------
  for (const info of allEmails.values()) {
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
      roleConfidence: 0,
      emailConfidence: info.type === 'personal' ? 70 : 55,
      overallConfidence: 0,
      isPrimary: false,
    });
  }

  // ---- Pattern-guess emails for DMs with no direct email --------------
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
      }
    }
  }

  // ---- If still nothing, add fallback role emails as last resort ------
  const hasEmail = contacts.some((c) => c.email);
  if (!hasEmail && domain) {
    for (const guess of fallbackRoleEmails(domain).slice(0, 2)) {
      contacts.push({
        name: null,
        role: null,
        detectedRole: 'unknown',
        email: guess.email,
        emailType: 'info',
        emailStatus: 'guessed',
        linkedinUrl: null,
        sourceUrl: pages[0].url,
        roleConfidence: 0,
        emailConfidence: 25,
        overallConfidence: 0,
        isPrimary: false,
      });
    }
  }

  // ---- Compute confidences + pick primary -----------------------------
  for (const c of contacts) {
    c.overallConfidence = scoreContact(c);
  }
  contacts.sort((a, b) => b.overallConfidence - a.overallConfidence);
  if (contacts[0]) contacts[0].isPrimary = true;

  // ---- Routes ---------------------------------------------------------
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
  for (const p of phones.values()) {
    routes.push({ type: 'PHONE', value: p.value, sourceUrl: p.sourceUrl, confidence: 80 });
  }
  for (const page of pages) {
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
  for (const page of pages) {
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
  for (const page of pages) {
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
  const contactPage = pages.find((p) => /\/contact/i.test(p.url));
  if (contactPage) {
    routes.push({
      type: 'GENERAL_CONTACT_PAGE',
      value: contactPage.url,
      sourceUrl: contactPage.url,
      confidence: 60,
    });
  }

  const contactabilityScore = contactabilityForCompany(contacts, routes);

  // ---- Persist --------------------------------------------------------
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
    pagesCrawled: pages.length,
    fromCache: false,
    durationMs: Date.now() - startedAt,
  };
}

// ---------------------------------------------------------------------------
// Helpers — map persisted rows back to the DiscoveredContact / Route shape.
// ---------------------------------------------------------------------------
function rowToDiscoveredContact(row: {
  name: string | null;
  role: string | null;
  email: string | null;
  email_type: string | null;
  email_status: string | null;
  linkedin_url: string | null;
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
