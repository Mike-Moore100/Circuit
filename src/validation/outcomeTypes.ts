// Phase 1 Live Validation — commercial outcome tracking. This is NOT
// outreach automation. It's a tracking log so the operator can record
// what happened after they actually contacted a lead, and so we can
// measure whether the opportunity intelligence layer surfaced
// commercially valuable leads.
//
// Outcomes are append-only — multiple rows per company are expected
// (e.g. CONTACTED on day 1, REPLIED on day 3, INTERESTED on day 5).
// We always show the full timeline; "latest outcome" is just the most
// recent row.

export const OUTCOME_TYPES = [
  'CONTACTED',
  'REPLIED',
  'INTERESTED',
  'NOT_INTERESTED',
  'BAD_FIT',
  'NO_RESPONSE',
  'MEETING_BOOKED',
  'STRONG_OPPORTUNITY',
  'WEAK_OPPORTUNITY',
] as const;

export type OutcomeType = (typeof OUTCOME_TYPES)[number];

export const OUTCOME_LABEL: Record<OutcomeType, string> = {
  CONTACTED: 'Contacted',
  REPLIED: 'Replied',
  INTERESTED: 'Interested',
  NOT_INTERESTED: 'Not interested',
  BAD_FIT: 'Bad fit',
  NO_RESPONSE: 'No response',
  MEETING_BOOKED: 'Meeting booked',
  STRONG_OPPORTUNITY: 'Strong opportunity',
  WEAK_OPPORTUNITY: 'Weak opportunity',
};

// Operator-facing one-liner shown as tooltip / inline hint. We keep these
// short so the validation surface stays scannable.
export const OUTCOME_HINT: Record<OutcomeType, string> = {
  CONTACTED: 'I sent the first message / made the first call.',
  REPLIED: 'They responded — any response counts here.',
  INTERESTED: 'They expressed interest in talking further.',
  NOT_INTERESTED: 'They explicitly declined.',
  BAD_FIT: 'After contact, this turned out not to be a fit.',
  NO_RESPONSE: 'No reply after a reasonable follow-up window.',
  MEETING_BOOKED: 'A scheduled call / meeting is on the calendar.',
  STRONG_OPPORTUNITY: 'Post-contact confirmation that this is genuinely strong.',
  WEAK_OPPORTUNITY: 'Post-contact confirmation that this is weaker than ranked.',
};

// Tone bucket — drives the colour of the chip in the timeline and the
// agreement metric. "positive" outcomes mean the operator confirmed the
// system was right to rank highly; "negative" means it was wrong;
// "neutral" is data we can't yet judge against the ranking.
export type OutcomeTone = 'positive' | 'negative' | 'neutral';

export const OUTCOME_TONE: Record<OutcomeType, OutcomeTone> = {
  CONTACTED: 'neutral',
  REPLIED: 'neutral',
  INTERESTED: 'positive',
  NOT_INTERESTED: 'negative',
  BAD_FIT: 'negative',
  NO_RESPONSE: 'neutral',
  MEETING_BOOKED: 'positive',
  STRONG_OPPORTUNITY: 'positive',
  WEAK_OPPORTUNITY: 'negative',
};

export function isOutcomeType(s: string): s is OutcomeType {
  return (OUTCOME_TYPES as readonly string[]).includes(s);
}
