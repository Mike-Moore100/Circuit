// RecommendationCard — one calibration tweak + the evidence that
// backs it. No charts, no per-axis breakouts. Just the action line
// + the why.

import type { CalibrationRecommendation } from '../../src/validation/patternInsights';

interface Props {
  recommendation: CalibrationRecommendation;
}

export function RecommendationCard({ recommendation }: Props) {
  return (
    <article className="rec-card">
      <p className="rec-card-text">
        <span className="rec-card-arrow" aria-hidden>→</span>
        <strong>{recommendation.text}</strong>
      </p>
      <p className="rec-card-rationale">{recommendation.rationale}</p>
      <span className="rec-card-evidence">based on {recommendation.evidenceCount} reviewed leads</span>
    </article>
  );
}
