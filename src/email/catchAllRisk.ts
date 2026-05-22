// Phase 1 email confidence — catch-all risk heuristic.
//
// "Catch-all" means a domain accepts mail for *any* local-part —
// `anything@example.com` returns 250 OK at SMTP. That's useful info
// because it means a *guessed* email can't be distinguished from a
// real one just by it being deliverable.
//
// The only reliable way to detect catch-all is via SMTP probing,
// which the brief explicitly forbids. So we use a domain-level
// heuristic instead:
//
//   "If we already have N+ emails persisted on this domain that
//    came from guessed sources AND all passed syntax, treat the
//    domain as catch-all-suspect."
//
// This is conservative — false positives are fine because a
// "catch-all suspect" only knocks confidence, not validity.

export interface CatchAllRiskInput {
  domain: string;
  // From the existing contacts table — how many emails on this
  // exact domain were persisted with email_status='guessed'.
  guessedEmailCount: number;
  // Total contacts on this domain (including extracted + verified).
  totalEmailCount: number;
}

export interface CatchAllRiskResult {
  isRisk: boolean;
  reason: string | null;
}

// Threshold tuned by intuition not data — for a 10-50 lead corpus
// "3 or more guessed emails on the same domain" is a strong signal
// that pattern-guessing has produced multiple "valid-shaped" emails
// against the same mail server.
const GUESSED_EMAIL_THRESHOLD = 3;

export function detectCatchAllRisk(input: CatchAllRiskInput): CatchAllRiskResult {
  if (input.guessedEmailCount >= GUESSED_EMAIL_THRESHOLD) {
    return {
      isRisk: true,
      reason: `Domain has ${input.guessedEmailCount} guessed emails persisted — likely accepts catch-all mail`,
    };
  }
  // Edge case: domain with many emails but disproportionately many
  // are guessed. If > 60% of the persisted emails are guessed AND
  // total > 5, flag as suspect.
  if (
    input.totalEmailCount > 5 &&
    input.guessedEmailCount / input.totalEmailCount > 0.6
  ) {
    return {
      isRisk: true,
      reason: 'Most contacts on this domain were guessed — domain may accept catch-all mail',
    };
  }
  return { isRisk: false, reason: null };
}
