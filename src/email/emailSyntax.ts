// Phase 1 email confidence — syntax validation + parsing.
//
// We deliberately use a conservative regex rather than the full
// RFC 5322 monster: the goal is "is this plausibly an email a
// human typed?", not "is this technically a valid RFC literal?".

const EMAIL_RX = /^[a-z0-9._+%-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

export interface ParsedEmail {
  email: string;
  local: string;
  domain: string;
}

export function isValidEmailSyntax(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  if (!EMAIL_RX.test(trimmed)) return false;
  // Defensive: reject double-dot, leading/trailing dot, etc.
  const [local, domain] = trimmed.split('@');
  if (!local || !domain) return false;
  if (local.startsWith('.') || local.endsWith('.')) return false;
  if (local.includes('..')) return false;
  if (domain.startsWith('.') || domain.endsWith('.')) return false;
  if (domain.includes('..')) return false;
  return true;
}

export function parseEmail(raw: string | null | undefined): ParsedEmail | null {
  if (!isValidEmailSyntax(raw)) return null;
  const email = raw!.trim().toLowerCase();
  const [local, domain] = email.split('@');
  return { email, local, domain };
}

// Strip subdomains down to the registrable host. Conservative — we
// don't try to follow the full PSL; we just collapse common cases
// (`mail.acme.test` → `acme.test`). The DNS check still operates on
// the original domain, this is purely for "does the email match the
// business's domain" comparisons.
export function rootDomain(domain: string | null | undefined): string | null {
  if (!domain) return null;
  const lower = domain.toLowerCase().trim();
  if (lower.length === 0) return null;
  // Strip a single subdomain layer when it looks safe — i.e. there
  // are at least 3 segments AND the trailing two segments make sense
  // as a registrable host (e.g. .co.uk, .com).
  const parts = lower.split('.');
  if (parts.length >= 3) {
    const last2 = parts.slice(-2).join('.');
    const last3 = parts.slice(-3).join('.');
    // Common UK two-level TLDs — keep the last 3 segments.
    if (/\.(co|org|gov|ac|me)\.uk$/.test(last3)) return last3;
    // Default: keep the last 2 (handles .com, .io, .ai, .net, etc.).
    return last2;
  }
  return lower;
}
