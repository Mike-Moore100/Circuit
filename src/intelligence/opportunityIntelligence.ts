// Opportunity Intelligence — orchestrator. Compiles inputs, calls the six
// sub-scorers, computes the composite opportunity score, classifies human
// attention priority, and assembles the operator-facing explanation.
//
// Everything here is deterministic. AI never controls these numbers; it
// may enrich the signals that feed in, but the math is auditable.

import { scoreAccessibility } from './accessibilityScoring';
import { scoreBuyingReadiness } from './buyingReadinessScoring';
import { scoreEvidenceConfidence } from './evidenceConfidenceScoring';
import { scoreImplementationFit } from './implementationFitScoring';
import { scoreOperationalPain } from './operationalPainScoring';
import { scoreTrustBarrier } from './trustBarrierScoring';
import { rankHumanAttention } from './humanAttentionRanking';
import {
  clamp100,
  type CommercialPotential,
  type IntelligenceInputs,
  type LikelyProjectType,
  type OpportunityIntelligence,
  type ProjectComplexity,
  type SubScore,
} from './intelligenceTypes';

// ---------------------------------------------------------------------------
// Weighted composite. Pain + buying readiness drive the top line; trust
// barrier subtracts; evidence confidence acts as a multiplier so low-
// confidence opportunities collapse toward the middle, not the top.
// ---------------------------------------------------------------------------
const WEIGHTS = {
  pain: 0.3,
  readiness: 0.25,
  accessibility: 0.15,
  fit: 0.2,
  trust: 0.15, // SUBTRACTED
};

function combineScores(subs: {
  pain: SubScore;
  readiness: SubScore;
  accessibility: SubScore;
  fit: SubScore;
  trust: SubScore;
  confidence: SubScore;
}): number {
  const raw =
    WEIGHTS.pain * subs.pain.score +
    WEIGHTS.readiness * subs.readiness.score +
    WEIGHTS.accessibility * subs.accessibility.score +
    WEIGHTS.fit * subs.fit.score -
    WEIGHTS.trust * subs.trust.score;
  // Confidence multiplier in [0.6, 1.0] — never zero (a lead with no
  // evidence still gets a partial read; we just don't trust the top end).
  const confMul = 0.6 + 0.4 * (subs.confidence.score / 100);
  return clamp100(raw * confMul);
}

// ---------------------------------------------------------------------------
// Likely project type — favour the campaign if confident, fall back to
// pain shape. Pure deterministic mapping.
// ---------------------------------------------------------------------------
function inferProjectType(
  inputs: IntelligenceInputs,
  pain: SubScore,
  fit: SubScore,
): LikelyProjectType {
  if (fit.score < 35) return 'UNCLEAR';
  switch (inputs.primaryCampaign) {
    case 'AI_AUTOMATION':
      return 'AI_AUTOMATION';
    case 'WEB_REBUILD':
      return 'WEB_REBUILD';
    case 'FUNNEL_OPTIMIZATION':
      return 'FUNNEL_OPTIMIZATION';
    case 'LOCAL_DIGITAL_UPGRADE':
      return 'LOCAL_DIGITAL_UPGRADE';
    case 'LOW_PRIORITY_NURTURE':
      return 'NURTURE';
    case 'REJECT':
      return 'UNCLEAR';
    default:
      return pain.score >= 50 ? 'WEB_REBUILD' : 'UNCLEAR';
  }
}

function inferProjectComplexity(
  inputs: IntelligenceInputs,
  pain: SubScore,
): ProjectComplexity {
  const size = inputs.sizeEstimate ?? 0;
  // Many concrete pain items → bigger scope
  const issueCount = inputs.visualIssues.length + inputs.operationalClues.length;
  if (size > 100 || issueCount >= 7 || pain.score >= 80) return 'HIGH';
  if (size > 25 || issueCount >= 4 || pain.score >= 55) return 'MEDIUM';
  return 'LOW';
}

function inferCommercialPotential(
  inputs: IntelligenceInputs,
  readiness: SubScore,
  fit: SubScore,
): CommercialPotential {
  const size = inputs.sizeEstimate ?? 0;
  if (readiness.score >= 60 && fit.score >= 60 && size >= 10) return 'HIGH';
  if (readiness.score >= 45 && fit.score >= 45) return 'MEDIUM';
  return 'LOW';
}

// ---------------------------------------------------------------------------
// Explanation assembly — pull the top reasons from each sub-score into
// the operator-facing "why" lists.
// ---------------------------------------------------------------------------
function explain(subs: {
  pain: SubScore;
  readiness: SubScore;
  accessibility: SubScore;
  fit: SubScore;
  trust: SubScore;
  confidence: SubScore;
}): {
  opportunityReasons: string[];
  riskFactors: string[];
  strongestSignals: string[];
  weakestSignals: string[];
} {
  // Positive reasons across the four "good" sub-scores.
  const positives = [
    ...subs.pain.reasons.filter((r) => r.delta > 0),
    ...subs.readiness.reasons.filter((r) => r.delta > 0),
    ...subs.accessibility.reasons.filter((r) => r.delta > 0),
    ...subs.fit.reasons.filter((r) => r.delta > 0),
  ]
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 5)
    .map((r) => r.label);

  // Negative reasons — including the trust-barrier contributions and any
  // negatives that landed on the other sub-scores.
  const negatives = [
    ...subs.trust.reasons.map((r) => ({ ...r, delta: r.delta })),
    ...subs.fit.reasons.filter((r) => r.delta < 0),
    ...subs.readiness.reasons.filter((r) => r.delta < 0),
    ...subs.accessibility.reasons.filter((r) => r.delta < 0),
    ...subs.confidence.reasons.filter((r) => r.delta < 0),
  ]
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 5)
    .map((r) => r.label);

  // Strongest signals — operator-scannable strings already produced by the
  // sub-scorers. Dedupe via Set to avoid the same word twice.
  const strong = Array.from(
    new Set([
      ...subs.pain.signals,
      ...subs.readiness.signals,
      ...subs.accessibility.signals,
      ...subs.fit.signals,
    ]),
  ).slice(0, 6);

  // Weakest — sub-scores that are below 30
  const weakLabels: string[] = [];
  if (subs.pain.score < 30) weakLabels.push('Low visible pain');
  if (subs.readiness.score < 30) weakLabels.push('Low buying readiness');
  if (subs.accessibility.score < 30) weakLabels.push('Hard to reach');
  if (subs.fit.score < 30) weakLabels.push('Unclear implementation fit');
  if (subs.confidence.score < 30) weakLabels.push('Low evidence confidence');
  if (subs.trust.score >= 50) weakLabels.push('High trust barrier');

  return {
    opportunityReasons: positives,
    riskFactors: negatives,
    strongestSignals: strong,
    weakestSignals: weakLabels,
  };
}

// ---------------------------------------------------------------------------
// Main entry — pure function of IntelligenceInputs.
// ---------------------------------------------------------------------------
export function computeOpportunityIntelligence(
  inputs: IntelligenceInputs,
): OpportunityIntelligence {
  const pain = scoreOperationalPain(inputs);
  const readiness = scoreBuyingReadiness(inputs);
  const accessibility = scoreAccessibility(inputs);
  const fit = scoreImplementationFit(inputs);
  const trust = scoreTrustBarrier(inputs);
  const confidence = scoreEvidenceConfidence(inputs);

  const opportunityScore = combineScores({
    pain,
    readiness,
    accessibility,
    fit,
    trust,
    confidence,
  });

  const attention = rankHumanAttention({
    opportunityScore,
    pain,
    readiness,
    accessibility,
    fit,
    trust,
    confidence,
    inputs,
  });

  const explained = explain({ pain, readiness, accessibility, fit, trust, confidence });

  return {
    companyId: inputs.companyId,
    computedAt: new Date().toISOString(),
    opportunityScore,
    humanAttentionPriority: attention.priority,
    operationalPain: pain,
    buyingReadiness: readiness,
    accessibility,
    implementationFit: fit,
    trustBarrier: trust,
    evidenceConfidence: confidence,
    opportunityReasons: explained.opportunityReasons,
    riskFactors: explained.riskFactors,
    strongestSignals: explained.strongestSignals,
    weakestSignals: explained.weakestSignals,
    likelyProjectType: inferProjectType(inputs, pain, fit),
    estimatedProjectComplexity: inferProjectComplexity(inputs, pain),
    estimatedCommercialPotential: inferCommercialPotential(inputs, readiness, fit),
  };
}
