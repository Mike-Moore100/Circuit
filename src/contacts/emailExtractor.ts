import type { EmailType } from './contactTypes';

// Permissive but bounded. The lookarounds prevent false positives where
// HTML stripping has run two words together (e.g. inline elements like
// `<span>USA</span><a>hello@x.co</a><span>START</span>` flattening to
// `USAhello@x.coSTART` — without the boundaries we'd extract
// `usahello@x.costart`).
const EMAIL_REGEX =
  /(?<![a-zA-Z0-9._%+-])[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,12}(?![a-zA-Z])/g;

// Local-parts that map to known role-style mailboxes. Anything else falls
// back to "personal" only when the local looks like a plausible human
// name; otherwise it's "role_based".
const SPECIFIC_TYPE: Record<string, EmailType> = {
  info: 'info',
  hello: 'info',
  hi: 'info',
  contact: 'info',
  contacts: 'info',
  enquiries: 'info',
  inquiry: 'info',
  inquiries: 'info',
  office: 'general',
  team: 'general',
  general: 'general',
  admin: 'general',
  reception: 'general',
  support: 'support',
  help: 'support',
  helpdesk: 'support',
  customer: 'support',
  sales: 'sales',
  partnerships: 'sales',
  business: 'sales',
  bizdev: 'sales',
};

const BANNED_DOMAINS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'domain.com',
  'yourdomain.com',
  'website.com',
  'sentry.io',
  'sentry-next.wixpress.com',
  'wix.com',
  'wixstudio.com',
]);

export interface ExtractedEmail {
  email: string;
  local: string;
  domain: string;
  type: EmailType;
}

function plausibleName(local: string): boolean {
  // Letters-only + optional single dot. Personal locals are usually short
  // ("jane") or first.last ("jane.smith"). Long single-word locals like
  // "newsletter" or "marketing" are role-style and should NOT match.
  if (local.length < 3 || local.length > 24) return false;
  if (!/^[a-z]+(\.[a-z]+)?$/.test(local)) return false;
  // If there's no dot AND the local is longer than 8 chars, it's almost
  // certainly a role/topic word rather than a first name.
  if (!local.includes('.') && local.length > 8) return false;
  return true;
}

export function classifyEmail(local: string): EmailType {
  const l = local.toLowerCase();
  if (SPECIFIC_TYPE[l]) return SPECIFIC_TYPE[l];
  if (plausibleName(l)) return 'personal';
  return 'role_based';
}

export function extractEmailsFromText(text: string): ExtractedEmail[] {
  const matches = text.match(EMAIL_REGEX) ?? [];
  const seen = new Set<string>();
  const out: ExtractedEmail[] = [];
  for (const raw of matches) {
    const email = raw.toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    const [local, domain] = email.split('@');
    if (!local || !domain) continue;
    if (BANNED_DOMAINS.has(domain)) continue;
    if (local.length > 64 || domain.length > 253) continue;
    // Skip image-embedded / hash-y local parts (e.g. sentry css urls)
    if (/[^a-zA-Z0-9._%+-]/.test(local)) continue;
    out.push({
      email,
      local,
      domain,
      type: classifyEmail(local),
    });
  }
  return out;
}

// Cross-reference an email's local part with a detected decision-maker name.
// e.g. local "jane" or "jane.smith" matches the name "Jane Smith".
export function emailMatchesName(local: string, fullName: string): boolean {
  const parts = fullName
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return false;
  const first = parts[0];
  const last = parts[parts.length - 1];
  const l = local.toLowerCase();
  return (
    l === first ||
    l === `${first}.${last}` ||
    l === `${first[0]}${last}` ||
    l === `${first}${last}` ||
    l === `${first}_${last}` ||
    l === `${first}${last[0]}`
  );
}
