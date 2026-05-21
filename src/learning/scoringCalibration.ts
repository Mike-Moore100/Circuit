// Translate review patterns into operator-facing calibration suggestions.
// CRITICAL RULE: this module proposes, never applies. The operator has to
// edit weights manually after reviewing the rationale.

import type { CalibrationSuggestion, ReviewPattern } from './learningTypes';

// We need at least this many reviews of one shape before suggesting a
// system-wide change. Two reviews are coincidence; five are signal.
const MIN_EVIDENCE_THRESHOLD = 3;

// Per review pattern → up to 1 suggestion. Each suggestion uses a stable
// `id` so the dashboard can dedupe across runs.
export function suggestCalibrations(
  patterns: ReviewPattern[],
): CalibrationSuggestion[] {
  const suggestions: CalibrationSuggestion[] = [];

  for (const p of patterns) {
    if (p.count < MIN_EVIDENCE_THRESHOLD) continue;

    // FALSE POSITIVE: system accepted into a campaign, operator says it
    // shouldn't have been. The campaign's routing threshold is too loose
    // OR a positive signal is over-weighted.
    if (p.reviewType === 'false_positive') {
      const conf = Math.min(95, 40 + p.count * 10);
      suggestions.push({
        id: `fp.${p.previousCampaign}`,
        target: 'campaign_weight',
        knob: `${p.previousCampaign}.threshold`,
        direction: 'increase',
        rationale: `${p.count} ${p.previousCampaign} leads marked as not real fits — raise the routing threshold or temper the dominant signal. Sample: ${p.sampleCompanies.slice(0, 3).join(', ')}`,
        evidenceCount: p.count,
        confidence: conf,
      });
    }

    // FALSE REJECT: system rejected (or under-scored), operator says
    // should be pursued. The reject path or hard-reject signals are too
    // aggressive.
    if (p.reviewType === 'false_reject') {
      const conf = Math.min(95, 40 + p.count * 10);
      suggestions.push({
        id: `fr.${p.previousCampaign}`,
        target: 'rule_weight',
        knob: `reject_penalty.${p.previousCampaign}`,
        direction: 'decrease',
        rationale: `${p.count} leads operator says were wrongly rejected/down-scored — soften the reject path or the penalty that pulled them under. Sample: ${p.sampleCompanies.slice(0, 3).join(', ')}`,
        evidenceCount: p.count,
        confidence: conf,
      });
    }

    // STRONG OPPORTUNITY but low avg opportunity score → the model is
    // under-scoring this shape of lead. Suggest boosting the campaign's
    // positive signals.
    if (
      p.reviewType === 'strong_opportunity' &&
      p.avgOpportunityScore > 0 &&
      p.avgOpportunityScore < 65
    ) {
      suggestions.push({
        id: `strong.${p.previousCampaign}`,
        target: 'campaign_weight',
        knob: `${p.previousCampaign}.positive_signals`,
        direction: 'increase',
        rationale: `Operator marked ${p.count} ${p.previousCampaign} leads as Strong Opportunity, but the model only gave them avg opportunity score ${p.avgOpportunityScore}. Boost the positive signals for this campaign.`,
        evidenceCount: p.count,
        confidence: Math.min(90, 35 + p.count * 10),
      });
    }
  }

  // Sort by confidence × evidence
  suggestions.sort((a, b) => b.confidence * b.evidenceCount - a.confidence * a.evidenceCount);
  return suggestions;
}
