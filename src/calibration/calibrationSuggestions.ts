// Calibration suggestions — convert detected patterns + signal
// performance into proposed knob changes.
//
// CRITICAL RULE (LOCKED): this module proposes, never applies. Every
// suggestion is a written instruction the operator follows by hand.

import { calibrationConfidence, type CalibrationSuggestion } from './calibrationTypes';
import type { DetectionResult } from './patternDetection';

const MIN_EVIDENCE = 3;

export function suggestCalibrations(
  detection: DetectionResult,
): CalibrationSuggestion[] {
  const out: CalibrationSuggestion[] = [];

  // 1. Signals with strong positive precision → boost their weight
  for (const s of detection.signals) {
    if (s.precision === null) continue;
    if (s.reviewedCount < MIN_EVIDENCE) continue;
    if (s.precision >= 0.75) {
      out.push({
        id: `boost.${s.signalName}`,
        knob: `signal.${s.signalName}.weight`,
        direction: 'increase',
        confidence: s.confidence,
        rationale: `Signal "${s.signalName}" was reviewed positively ${s.positiveOutcomes}/${s.reviewedCount} times (${Math.round(s.precision * 100)}% precision). Increasing its weight should sharpen routing.`,
        evidenceCount: s.reviewedCount,
      });
    } else if (s.precision <= 0.25) {
      out.push({
        id: `temper.${s.signalName}`,
        knob: `signal.${s.signalName}.weight`,
        direction: 'decrease',
        confidence: s.confidence,
        rationale: `Signal "${s.signalName}" was reviewed positively only ${s.positiveOutcomes}/${s.reviewedCount} times (${Math.round(s.precision * 100)}% precision). Reducing its weight should cut false routing.`,
        evidenceCount: s.reviewedCount,
      });
    }
  }

  // 2. Trust-barrier patterns with high FP count → raise the campaign's
  //    routing threshold for that shape.
  for (const p of detection.trustBarrierPatterns) {
    if (p.falsePositiveCount < 2) continue;
    const campaign = p.segments.campaign ?? 'global';
    out.push({
      id: `tb.${campaign}.${p.signature}`,
      knob: `${campaign}.trust_barrier.threshold`,
      direction: 'decrease', // lower acceptable trust-barrier ceiling
      confidence: calibrationConfidence(
        p.count,
        p.falsePositiveCount / p.count,
      ),
      rationale: `Pattern "${p.signature}" produced ${p.falsePositiveCount} false-positive reviews of ${p.count}. Lower the trust-barrier ceiling for ${campaign} on this shape.`,
      evidenceCount: p.count,
    });
  }

  // 3. High-value opportunity patterns → boost the matching campaign
  //    positives. We only emit when precision is very high (the
  //    operator's behaviour is unambiguous).
  for (const p of detection.opportunityPatterns) {
    if (p.count < MIN_EVIDENCE) continue;
    if (p.precision < 0.8) continue;
    const campaign = p.segments.campaign;
    if (!campaign) continue;
    out.push({
      id: `boost.${campaign}.${p.signature}`,
      knob: `${campaign}.positive_signals`,
      direction: 'increase',
      confidence: calibrationConfidence(p.count, (p.precision - 0.5) * 2),
      rationale: `"${p.signature}" reviewed positively ${p.positiveCount}/${p.count} times for ${campaign}. Boosting positive signals on this shape should surface more like it.`,
      evidenceCount: p.count,
    });
  }

  // Sort by confidence × evidence so the strongest, best-backed
  // suggestions surface first.
  out.sort(
    (a, b) => b.confidence * b.evidenceCount - a.confidence * a.evidenceCount,
  );
  return out;
}
