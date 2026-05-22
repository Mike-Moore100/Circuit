// Composes all promotion rules into a single PROMOTE / SKIP decision.
// Pure function — no I/O. DB-aware checks (already-in-companies,
// already-recently-processed) belong in promoteDiscoveryToCompanies.

import { ALL_RULES } from './promotionRules';
import type { GateDecision, PromotionInput } from './promotionTypes';

// Minimum total signal score required to promote. Tunable. Higher = more
// selective. Vetoes always SKIP regardless of score.
export const DEFAULT_SIGNAL_THRESHOLD = 6;

export function evaluatePromotion(
  input: PromotionInput,
  options: { threshold?: number } = {},
): GateDecision {
  const threshold = options.threshold ?? DEFAULT_SIGNAL_THRESHOLD;
  const results = ALL_RULES.map((rule) => rule(input));

  // Veto → immediate SKIP. Use the first veto as the primary reason.
  const firstVeto = results.find((r) => r.veto);
  if (firstVeto) {
    return {
      decision: 'SKIP',
      primaryReason: firstVeto.label,
      reasons: results,
      signalScore: results.reduce((acc, r) => acc + r.score, 0),
    };
  }

  // No vetoes — compose the score and compare to threshold.
  const signalScore = results.reduce((acc, r) => acc + r.score, 0);
  if (signalScore >= threshold) {
    // Pick the highest-score reason as primary, falling back to a
    // friendly default if every rule contributed equally.
    const positive = results.filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
    const primaryReason = positive[0]?.label ?? 'Met minimum signal threshold';
    return {
      decision: 'PROMOTE',
      primaryReason,
      reasons: results,
      signalScore,
    };
  }

  // Below threshold — soft SKIP.
  return {
    decision: 'SKIP',
    primaryReason: `Signal score ${signalScore} below threshold ${threshold}`,
    reasons: results,
    signalScore,
  };
}
