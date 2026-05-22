// Phase 1 email confidence — disposable + free-provider detection.
//
// Static lists. The disposable set is curated from the well-known
// throwaway providers; we don't try to keep pace with every new
// .top mailbox service. The free-provider set covers the major
// consumer mailbox hosts — these are *not* disposable, but they
// score lower for business outreach.
//
// Pure functions, no I/O.

import { rootDomain } from './emailSyntax';

// Disposable / throwaway providers. Email addresses on these domains
// should be flagged as RISKY → INVALID (depending on the rest of the
// signals). We avoid a 10,000-line list — these are the prevalent
// ones we see in real corpora.
const DISPOSABLE_DOMAINS = new Set<string>([
  '10minutemail.com',
  '10minutemail.net',
  '20minutemail.com',
  'anonbox.net',
  'discard.email',
  'discardmail.com',
  'dispostable.com',
  'fakeinbox.com',
  'getairmail.com',
  'getnada.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.org',
  'guerrillamail.de',
  'guerrillamailblock.com',
  'inboxalias.com',
  'inboxbear.com',
  'jetable.org',
  'mailcatch.com',
  'mailinator.com',
  'mailinator.net',
  'mailnesia.com',
  'maildrop.cc',
  'mailtemp.info',
  'mintemail.com',
  'mohmal.com',
  'moakt.com',
  'mvrht.com',
  'mytemp.email',
  'mytrashmail.com',
  'nada.email',
  'pokemail.net',
  'sharklasers.com',
  'spam4.me',
  'tempinbox.com',
  'tempmail.com',
  'tempmail.io',
  'temp-mail.org',
  'tempmailaddress.com',
  'temporarymail.com',
  'throwam.com',
  'throwawaymail.com',
  'trashmail.com',
  'trashmail.net',
  'trbvm.com',
  'tutanota.com',
  'wegwerf-emails.de',
  'wegwerfemail.de',
  'yopmail.com',
  'yopmail.net',
  'zetmail.com',
]);

// Free consumer mailbox providers. These domains are valid email
// hosts — they just signal "personal address, not a business
// account". Lower confidence for B2B outreach but still usable.
const FREE_PROVIDER_DOMAINS = new Set<string>([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'ymail.com',
  'rocketmail.com',
  'outlook.com',
  'hotmail.com',
  'hotmail.co.uk',
  'live.com',
  'live.co.uk',
  'msn.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'mail.com',
  'gmx.com',
  'gmx.co.uk',
  'gmx.de',
  'zoho.com',
  'fastmail.com',
  'fastmail.fm',
  'tutanota.com',
  'tutanota.de',
  'hushmail.com',
  'ymail.co.uk',
  'btinternet.com',
  'sky.com',
  'virginmedia.com',
  'talktalk.net',
  'ntlworld.com',
  'blueyonder.co.uk',
]);

export function isDisposableDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  const lower = domain.toLowerCase().trim();
  if (DISPOSABLE_DOMAINS.has(lower)) return true;
  // Also check the registrable root — covers e.g. `foo.mailinator.com`.
  const root = rootDomain(lower);
  if (root && DISPOSABLE_DOMAINS.has(root)) return true;
  return false;
}

export function isFreeProviderDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  const lower = domain.toLowerCase().trim();
  if (FREE_PROVIDER_DOMAINS.has(lower)) return true;
  const root = rootDomain(lower);
  if (root && FREE_PROVIDER_DOMAINS.has(root)) return true;
  return false;
}

// Exposed for tests + the dashboard's "Why this scored this way"
// rendering — operators sometimes want to see the actual list.
export function disposableDomainCount(): number {
  return DISPOSABLE_DOMAINS.size;
}
export function freeProviderDomainCount(): number {
  return FREE_PROVIDER_DOMAINS.size;
}
