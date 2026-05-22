// Narrative insights — turn the raw pattern detector output into
// operator-facing CalibrationInsight rows. Each insight has a stable
// id so re-runs deduplicate; the dashboard surfaces top-confidence ones.

import { randomUUID } from 'node:crypto';
import { calibrationConfidence, type CalibrationInsight } from './calibrationTypes';
import type { DetectionResult } from './patternDetection';

// Minimum sample size before we'll narrativise a finding. Without enough
// evidence the insight is just noise.
const NARRATIVE_MIN_SAMPLE = 3;

export function deriveInsights(detection: DetectionResult): CalibrationInsight[] {
  const out: CalibrationInsight[] = [];
  const now = new Date().toISOString();

  // 1. High-value patterns — recurring positive shapes
  for (const p of detection.opportunityPatterns) {
    if (p.count < NARRATIVE_MIN_SAMPLE) continue;
    if (p.precision < 0.6) continue;
    const effect = (p.precision - 0.5) * 2;
    const conf = calibrationConfidence(p.count, effect);
    out.push({
      id: `high_value.${stableHash(p.signature)}`,
      type: 'high_value_pattern',
      title: `${p.signature} consistently reviewed positively`,
      description: `${p.positiveCount} of ${p.count} reviewed leads in this shape were marked positively (${Math.round(p.precision * 100)}% precision). Avg opportunity score ${p.avgOpportunityScore}. Sample: ${p.sampleCompanies.slice(0, 3).join(', ')}.`,
      confidence: conf,
      evidence: {
        sampleCompanies: p.sampleCompanies,
        metrics: {
          precisionPct: Math.round(p.precision * 100),
          sampleSize: p.count,
          avgOpportunityScore: p.avgOpportunityScore,
        },
      },
      createdAt: now,
    });
  }

  // 2. False-positive patterns — recurring "system said yes, operator said no"
  for (const p of detection.trustBarrierPatterns) {
    if (p.falsePositiveCount < 2) continue;
    const conf = calibrationConfidence(p.count, p.falsePositiveCount / p.count);
    out.push({
      id: `fp_pattern.${stableHash(p.signature)}`,
      type: 'false_positive_pattern',
      title: `${p.signature} keeps being marked wrongly accepted`,
      description: `${p.falsePositiveCount} of ${p.count} leads in this shape were flagged false_positive by the operator. Trust-barrier score averaged ${p.avgTrustBarrierScore}. Sample: ${p.sampleCompanies.slice(0, 3).join(', ')}.`,
      confidence: conf,
      evidence: {
        sampleCompanies: p.sampleCompanies,
        metrics: {
          falsePositiveCount: p.falsePositiveCount,
          sampleSize: p.count,
          avgTrustBarrier: p.avgTrustBarrierScore,
        },
      },
      createdAt: now,
    });
  }

  // 3. Signal-strength insights — signals with strong precision
  for (const s of detection.signals) {
    if (s.reviewedCount < NARRATIVE_MIN_SAMPLE) continue;
    if (s.precision === null) continue;
    if (Math.abs(s.precision - 0.5) < 0.2) continue; // weak signal — skip
    const direction = s.precision >= 0.5 ? 'positively' : 'negatively';
    out.push({
      id: `signal.${stableHash(s.signalName)}`,
      type: 'signal_strength',
      title: `${s.signalName} predicts review outcome ${direction}`,
      description: `${s.positiveOutcomes} positive vs ${s.negativeOutcomes} negative reviews when this signal is present (${Math.round(s.precision * 100)}% precision, ${s.reviewedCount} samples).`,
      confidence: s.confidence,
      evidence: {
        sampleCompanies: [],
        metrics: {
          precisionPct: Math.round(s.precision * 100),
          sampleSize: s.reviewedCount,
          positiveOutcomes: s.positiveOutcomes,
          negativeOutcomes: s.negativeOutcomes,
        },
      },
      createdAt: now,
    });
  }

  // 4. Trust-barrier trend — single insight if there's a dominant pattern
  const topTrust = detection.trustBarrierPatterns
    .filter((p) => p.count >= NARRATIVE_MIN_SAMPLE)
    .sort((a, b) => b.count - a.count)[0];
  if (topTrust && topTrust.count >= NARRATIVE_MIN_SAMPLE) {
    out.push({
      id: `trust_trend.${stableHash(topTrust.signature)}`,
      type: 'trust_barrier_trend',
      title: `Dominant trust-barrier shape: ${topTrust.signature}`,
      description: `${topTrust.count} reviewed leads carrying high trust-barrier traits. Worth tuning the trust-barrier weight for this segment.`,
      confidence: calibrationConfidence(topTrust.count, 0.5),
      evidence: {
        sampleCompanies: topTrust.sampleCompanies,
        metrics: { sampleSize: topTrust.count },
      },
      createdAt: now,
    });
  }

  // Sort by confidence DESC so the dashboard shows strongest first.
  out.sort((a, b) => b.confidence - a.confidence);
  return out;
}

// Stable, deterministic short hash for signature strings — only used to
// build CalibrationInsight ids so re-runs over the same data dedupe.
function stableHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}
