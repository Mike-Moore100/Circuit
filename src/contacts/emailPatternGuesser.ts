// Pattern-based email guessing. ALL guesses get EmailStatus = 'guessed' and a
// lower confidence — never marked verified, never sent to. The operator
// uses these as a starting point; a future verification provider may
// promote them to 'verified'.

export interface GuessedEmail {
  email: string;
  pattern: string;
}

export function guessEmailsForName(
  fullName: string,
  domain: string,
): GuessedEmail[] {
  if (!fullName || !domain) return [];
  const clean = domain
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');
  const parts = fullName
    .toLowerCase()
    .replace(/[^a-z\s-]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return [];
  const first = parts[0];
  const last = parts[parts.length - 1];
  const seen = new Set<string>();
  const out: GuessedEmail[] = [];

  const push = (local: string, pattern: string) => {
    const email = `${local}@${clean}`;
    if (seen.has(email)) return;
    seen.add(email);
    out.push({ email, pattern });
  };

  push(first, 'first');
  if (last && last !== first) {
    push(`${first}.${last}`, 'first.last');
    push(`${first[0]}${last}`, 'flast');
    push(`${first}${last}`, 'firstlast');
    push(`${first}.${last[0]}`, 'first.l');
    push(`${first[0]}.${last}`, 'f.last');
  }
  return out;
}

export const FALLBACK_LOCALS = ['hello', 'info', 'contact', 'enquiries'];

export function fallbackRoleEmails(domain: string): GuessedEmail[] {
  const clean = domain
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');
  return FALLBACK_LOCALS.map((local) => ({
    email: `${local}@${clean}`,
    pattern: `fallback:${local}`,
  }));
}
