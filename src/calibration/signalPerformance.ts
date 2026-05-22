// Signal performance — for every signal that's attached to at least one
// reviewed lead, compute precision/recall against the operator's
// labels. The output drives both the dashboard's per-signal table and
// the calibration-suggestions module's knob choices.
//
// Pure(ish): takes the pre-joined CalibrationLeadRow[] from the
// repository helper, returns a typed performance array. No I/O here.

import type { CalibrationLeadRow } from '../db/repository';
import { calibrationConfidence, type SignalPerformance } from './calibrationTypes';

const POSITIVE_REVIEWS = new Set([
  'correct_campaign',
  'strong_opportunity',
  'weak_opportunity',
  'interesting_later',
]);

interface SignalCounter {
  reviewed: number;
  positive: number;
  negative: number;
  fp: number;
  fr: number;
}

function emptyCounter(): SignalCounter {
  return { reviewed: 0, positive: 0, negative: 0, fp: 0, fr: 0 };
}

// Parse the SQLite GROUP_CONCAT'd JSON array of signal types into a
// regular JS array. Returns [] for null/invalid.
function parseSignals(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? (arr as string[]) : [];
  } catch {
    return [];
  }
}

// What "signals" we surface as having performance. We deliberately treat
// the campaign label + a couple of accessibility flags as signals too —
// the operator wants to know "are leads with direct email reviewed
// positively?" as much as "is verified.has_working_website precise?".
function collectSignalsForRow(row: CalibrationLeadRow): string[] {
  const out: string[] = [];
  for (const t of parseSignals(row.signal_types_json)) out.push(t);
  if (row.previous_campaign) out.push(`campaign.${row.previous_campaign}`);
  if (row.has_phone) out.push('access.has_phone');
  if (row.has_direct_email) out.push('access.has_direct_email');
  return out;
}

export function computeSignalPerformance(
  rows: CalibrationLeadRow[],
): SignalPerformance[] {
  const counters = new Map<string, SignalCounter>();
  for (const row of rows) {
    const signals = collectSignalsForRow(row);
    for (const sig of signals) {
      let c = counters.get(sig);
      if (!c) {
        c = emptyCounter();
        counters.set(sig, c);
      }
      c.reviewed += 1;
      if (POSITIVE_REVIEWS.has(row.review_type)) c.positive += 1;
      if (row.review_type === 'false_positive') {
        c.negative += 1;
        c.fp += 1;
      }
      if (row.review_type === 'false_reject') c.fr += 1;
    }
  }

  const out: SignalPerformance[] = [];
  const updatedAt = new Date().toISOString();
  for (const [name, c] of counters) {
    const denom = c.positive + c.negative;
    const precision = denom > 0 ? c.positive / denom : null;
    // Effect size is how far from 0.5 (coin flip) the precision is.
    // |precision - 0.5| * 2 → [0,1]. Saturates at perfect signal.
    const effect =
      precision !== null ? Math.min(1, Math.abs(precision - 0.5) * 2) : 0;
    out.push({
      signalName: name,
      reviewedCount: c.reviewed,
      positiveOutcomes: c.positive,
      negativeOutcomes: c.negative,
      falsePositiveCount: c.fp,
      falseRejectCount: c.fr,
      precision,
      confidence: calibrationConfidence(c.reviewed, effect),
      updatedAt,
    });
  }
  // Sort by sample size × confidence so the dashboard's top-N is useful.
  out.sort(
    (a, b) =>
      b.confidence * b.reviewedCount - a.confidence * a.reviewedCount,
  );
  return out;
}
