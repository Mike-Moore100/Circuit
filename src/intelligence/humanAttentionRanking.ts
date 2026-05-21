// Translate a composite opportunity score + sub-scores into a coarse
// "should a human look at this?" bucket. Deterministic, explainable,
// designed for the operator's first-glance scan.

import type {
  HumanAttentionPriority,
  IntelligenceInputs,
  SubScore,
} from './intelligenceTypes';

export interface AttentionInput {
  opportunityScore: number;
  pain: SubScore;
  readiness: SubScore;
  accessibility: SubScore;
  fit: SubScore;
  trust: SubScore;
  confidence: SubScore;
  inputs: IntelligenceInputs;
}

export interface AttentionResult {
  priority: HumanAttentionPriority;
  reason: string;
}

export function rankHumanAttention(input: AttentionInput): AttentionResult {
  const { opportunityScore, pain, readiness, accessibility, trust, confidence, inputs } = input;

  // Hard floors that override anything else.
  if (inputs.primaryCampaign === 'REJECT') {
    return { priority: 'IGNORE', reason: 'Lead routed as REJECT' };
  }
  if (trust.score >= 75) {
    return {
      priority: 'IGNORE',
      reason: 'Trust barrier too high — enterprise / technical fit mismatch',
    };
  }

  // IMMEDIATE: very strong signal AND we can actually reach them AND
  // the evidence backs it up. Thresholds calibrated against the
  // achievable max of ~90 — the composite is intentionally hard to
  // saturate so IMMEDIATE stays rare.
  if (
    opportunityScore >= 70 &&
    accessibility.score >= 55 &&
    confidence.score >= 55 &&
    pain.score >= 50
  ) {
    return {
      priority: 'IMMEDIATE',
      reason: 'High opportunity + reachable contact + strong evidence',
    };
  }

  // HIGH: strong opportunity, decent reachability OR confidence — operator
  // should look this week.
  if (opportunityScore >= 55 && (accessibility.score >= 45 || confidence.score >= 55)) {
    return {
      priority: 'HIGH',
      reason: 'Strong opportunity; reach or evidence backs it up',
    };
  }

  // MEDIUM: real signal but a missing pillar. Worth attention when slots open.
  if (opportunityScore >= 40 && readiness.score >= 30) {
    return {
      priority: 'MEDIUM',
      reason: 'Real opportunity but missing one pillar (reach / evidence / pain depth)',
    };
  }

  // LOW: alive but not interesting yet.
  if (opportunityScore >= 25) {
    return {
      priority: 'LOW',
      reason: 'Background-watch — revisit when more signal exists',
    };
  }

  return { priority: 'IGNORE', reason: 'Composite opportunity too low' };
}
