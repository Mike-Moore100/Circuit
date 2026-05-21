import type {
  DomSnapshot,
  OperationalClue,
  OperationalClueCode,
} from './evidenceTypes';

// Phrase libraries — focused on signal an SMB might write on their
// own homepage when describing their workload. Kept lower-case so the
// matcher can do a single normalised pass.
const PHRASE_BANK: Record<
  OperationalClueCode,
  { label: string; phrases: string[]; weight: number }
> = {
  manual_intake_language: {
    label: 'Manual intake / coordination language',
    weight: 80,
    phrases: [
      'we handle',
      'we manage',
      'we coordinate',
      'we schedule',
      'we take care of',
      'we look after',
      'we invoice',
      'we process',
      'client onboarding',
      'client intake',
      'lead intake',
    ],
  },
  admin_overhead_language: {
    label: 'Admin overhead phrasing',
    weight: 70,
    phrases: [
      'admin overhead',
      'administrative tasks',
      'spreadsheets',
      'manual data entry',
      'back office',
      'paperwork',
      'manual reporting',
    ],
  },
  recurring_reporting_cadence: {
    label: 'Recurring reporting cadence',
    weight: 65,
    phrases: [
      'monthly reporting',
      'weekly reporting',
      'reporting cadence',
      'month-end',
      'quarterly review',
      'weekly check-in',
      'weekly update',
      'monthly newsletter',
    ],
  },
  service_complexity: {
    label: 'Service complexity / many offerings',
    weight: 55,
    phrases: [
      'our services include',
      'services we offer',
      'we provide',
      'multiple services',
      'specialist services',
      'we offer the full',
    ],
  },
  no_automation_indicators: {
    label: 'No automation / no tooling language',
    weight: 60,
    phrases: [
      'no software needed',
      'no apps required',
      'just call us',
      'speak to a human',
      'old-fashioned service',
    ],
  },
  repetitive_inquiry_flow: {
    label: 'Repetitive inquiry flow',
    weight: 70,
    phrases: [
      'common questions',
      'frequently asked',
      'inquiries we receive',
      'enquiries we get',
      'most asked',
      'typical questions',
    ],
  },
};

function findPhrases(corpus: string, phrases: string[]): string[] {
  const hits: string[] = [];
  for (const p of phrases) {
    if (corpus.includes(p)) hits.push(p);
  }
  return hits;
}

export function extractOperationalEvidence(
  snapshot: DomSnapshot | null,
): OperationalClue[] {
  if (!snapshot) return [];
  const corpus = (snapshot.visibleBodyText ?? '').toLowerCase();
  if (!corpus) return [];

  const out: OperationalClue[] = [];
  for (const code of Object.keys(PHRASE_BANK) as OperationalClueCode[]) {
    const bank = PHRASE_BANK[code];
    const evidence = findPhrases(corpus, bank.phrases);
    if (evidence.length === 0) continue;
    // Confidence scales with how many phrases hit, capped at the bank weight.
    const confidence = Math.min(
      bank.weight,
      30 + (evidence.length - 1) * 12 + Math.min(40, bank.weight - 30),
    );
    out.push({
      code,
      label: bank.label,
      confidence,
      evidence: evidence.slice(0, 5),
    });
  }
  return out;
}
