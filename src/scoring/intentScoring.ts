import type {
  CombinedScore,
  IntentScoreBreakdown,
  Priority,
  RawLead,
  RuleScoreBreakdown,
  ScoreReason,
} from '../types/index';
import { evaluateRules } from '../filters/ruleBasedFilter';
import { classifyCampaign } from './campaignClassifier';
import {
  FINAL_WEIGHTS,
  FOUNDER_ROLE_KEYWORDS,
  INTENT_COMPONENT_WEIGHTS,
  PRIORITY_THRESHOLDS,
  TRUST_BARRIER_PENALTY_MAX,
} from './scoringConfig';

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

function leadHaystack(lead: RawLead): string {
  return [
    lead.industry,
    lead.notes,
    lead.contactRole,
    ...lead.signals.map((s) => `${s.type}:${s.value}`),
  ]
    .filter(Boolean)
    .join(' | ')
    .toLowerCase();
}

interface ComponentResult {
  score: number;
  reasons: ScoreReason[];
}

function scoreUrgency(lead: RawLead, hay: string): ComponentResult {
  const reasons: ScoreReason[] = [];
  let score = 30; // baseline: little evidence
  if (/hiring|job post|now hiring|growing/i.test(hay)) {
    score += 35;
    reasons.push({ code: 'urgency_hiring', label: 'Active hiring signals', delta: 35 });
  }
  if (/admin overhead|customer support volume|backlog|behind on/i.test(hay)) {
    score += 25;
    reasons.push({ code: 'urgency_workload', label: 'Visible workload pressure', delta: 25 });
  }
  if (/reporting cadence|month-end|weekly report/i.test(hay)) {
    score += 15;
    reasons.push({ code: 'urgency_recurring', label: 'Recurring high-frequency work', delta: 15 });
  }
  return { score: clamp(score), reasons };
}

function scoreManualWorkload(lead: RawLead, hay: string): ComponentResult {
  const reasons: ScoreReason[] = [];
  let score = 20;
  const matches: string[] = [];
  for (const kw of [
    'manual data entry',
    'spreadsheets',
    'invoicing',
    'scheduling',
    'onboarding workflow',
    'lead intake',
    'customer support volume',
    'reporting cadence',
    'admin overhead',
  ]) {
    if (hay.includes(kw)) matches.push(kw);
  }
  if (matches.length > 0) {
    const bonus = Math.min(70, matches.length * 18);
    score += bonus;
    reasons.push({
      code: 'manual_workload',
      label: `Manual workload signals: ${matches.join(', ')}`,
      delta: bonus,
    });
  }
  // Verified signals from website inspection give explicit, higher-confidence
  // boosts.
  const verified = new Set(lead.signals.map((s) => s.type));
  if (verified.has('verified.has_manual_workflow_language')) {
    score += 25;
    reasons.push({
      code: 'manual_workload_verified',
      label: 'Verified manual-workflow phrasing on website',
      delta: 25,
    });
  }
  if (verified.has('verified.high_automation_fit')) {
    score += 15;
    reasons.push({
      code: 'automation_fit_verified',
      label: 'Verified automation-fit phrasing on website',
      delta: 15,
    });
  }
  return { score: clamp(score), reasons };
}

function scoreDecisionMakerAccess(lead: RawLead): ComponentResult {
  const reasons: ScoreReason[] = [];
  let score = 25;
  const role = lead.contactRole?.toLowerCase() ?? '';
  const isFounder = FOUNDER_ROLE_KEYWORDS.some((kw) => role.includes(kw));
  if (isFounder) {
    score += 45;
    reasons.push({
      code: 'dm_founder',
      label: `Founder/owner-level contact (${lead.contactRole})`,
      delta: 45,
    });
  }
  if (lead.contactEmail) {
    score += 20;
    reasons.push({ code: 'dm_email', label: 'Direct email available', delta: 20 });
  }
  if (lead.linkedinUrl) {
    score += 10;
    reasons.push({ code: 'dm_linkedin', label: 'LinkedIn handle available', delta: 10 });
  }
  const verified = new Set(lead.signals.map((s) => s.type));
  if (verified.has('verified.has_contact_form')) {
    score += 15;
    reasons.push({
      code: 'dm_contact_form',
      label: 'Verified contact form available',
      delta: 15,
    });
  }
  if (verified.has('verified.has_booking_link')) {
    score += 15;
    reasons.push({
      code: 'dm_booking',
      label: 'Verified booking / scheduling link',
      delta: 15,
    });
  }
  return { score: clamp(score), reasons };
}

function scoreBudgetLikelihood(lead: RawLead, hay: string): ComponentResult {
  const reasons: ScoreReason[] = [];
  let score = 30;
  const size = lead.sizeEstimate ?? 0;
  if (size >= 8 && size <= 50) {
    score += 35;
    reasons.push({
      code: 'budget_size',
      label: `Headcount (${size}) suggests workable budget`,
      delta: 35,
    });
  } else if (size >= 2 && size < 8) {
    score += 15;
    reasons.push({
      code: 'budget_small',
      label: `Headcount (${size}) suggests tight budget`,
      delta: 15,
    });
  } else if (size > 250) {
    score -= 10; // big company, long procurement
    reasons.push({
      code: 'budget_enterprise',
      label: 'Enterprise procurement risk',
      delta: -10,
    });
  }
  if (/paid ads|performance marketing|spending on/i.test(hay)) {
    score += 15;
    reasons.push({ code: 'budget_spend_signal', label: 'Already paying for growth tools', delta: 15 });
  }
  return { score: clamp(score), reasons };
}

function scoreAutomationFit(lead: RawLead, hay: string): ComponentResult {
  const reasons: ScoreReason[] = [];
  let score = 25;
  if (/lead intake|customer support|invoicing|scheduling|onboarding|reporting|data entry/i.test(hay)) {
    score += 50;
    reasons.push({
      code: 'fit_workflows',
      label: 'Workflows match agency’s automation strengths',
      delta: 50,
    });
  }
  if (/agency|consulting|saas|ecommerce|recruitment|marketing|accounting|real estate|legal/i.test(
    lead.industry ?? '',
  )) {
    score += 20;
    reasons.push({
      code: 'fit_industry',
      label: 'Industry is a known automation buyer',
      delta: 20,
    });
  }
  // Penalise hard if the lead IS itself an AI/automation provider — they're a
  // competitor, not a buyer.
  const verified = new Set(lead.signals.map((s) => s.type));
  if (verified.has('verified.has_ai_automation_language')) {
    score -= 40;
    reasons.push({
      code: 'fit_ai_provider',
      label: 'Lead is itself an AI/automation provider — competitor, not buyer',
      delta: -40,
    });
  }
  if (verified.has('verified.likely_service_business')) {
    score += 10;
    reasons.push({
      code: 'fit_service_business',
      label: 'Verified: service business',
      delta: 10,
    });
  }
  return { score: clamp(score), reasons };
}

function scoreImplementationSimplicity(lead: RawLead, hay: string): ComponentResult {
  const reasons: ScoreReason[] = [];
  let score = 60; // assume reasonable simplicity by default
  if (/heavy compliance|regulated|hipaa|pci|fda/i.test(hay)) {
    score -= 35;
    reasons.push({
      code: 'impl_compliance',
      label: 'Compliance burden complicates delivery',
      delta: -35,
    });
  }
  if ((lead.sizeEstimate ?? 0) > 100) {
    score -= 20;
    reasons.push({
      code: 'impl_size',
      label: 'Larger org → more stakeholders / approvals',
      delta: -20,
    });
  }
  if (/internal automation team|platform team/i.test(hay)) {
    score -= 15;
    reasons.push({
      code: 'impl_internal_team',
      label: 'Will be compared against in-house team',
      delta: -15,
    });
  }
  return { score: clamp(score), reasons };
}

function scoreTrustBarrierPenalty(lead: RawLead, hay: string): ComponentResult {
  const reasons: ScoreReason[] = [];
  let penalty = 0;
  // We have no public track record yet → larger / more conservative buyers
  // are higher-risk to win.
  if ((lead.sizeEstimate ?? 0) > 50) {
    penalty += 15;
    reasons.push({
      code: 'trust_size',
      label: 'Conservative buyer — no track record to point at',
      delta: -15,
    });
  }
  if (/legal|law firm|banking|insurance/i.test(lead.industry ?? '')) {
    penalty += 10;
    reasons.push({
      code: 'trust_industry',
      label: 'Trust-sensitive industry',
      delta: -10,
    });
  }
  if (/heavy compliance|regulated/i.test(hay)) {
    penalty += 5;
    reasons.push({
      code: 'trust_compliance',
      label: 'Compliance posture raises vendor bar',
      delta: -5,
    });
  }
  return { score: Math.min(TRUST_BARRIER_PENALTY_MAX, penalty), reasons };
}

export function evaluateIntent(lead: RawLead): IntentScoreBreakdown {
  const hay = leadHaystack(lead);
  const urgency = scoreUrgency(lead, hay);
  const manualWorkload = scoreManualWorkload(lead, hay);
  const decisionMakerAccess = scoreDecisionMakerAccess(lead);
  const budgetLikelihood = scoreBudgetLikelihood(lead, hay);
  const automationFit = scoreAutomationFit(lead, hay);
  const implementationSimplicity = scoreImplementationSimplicity(lead, hay);
  const trust = scoreTrustBarrierPenalty(lead, hay);

  const weighted =
    urgency.score * INTENT_COMPONENT_WEIGHTS.urgency +
    manualWorkload.score * INTENT_COMPONENT_WEIGHTS.manualWorkload +
    decisionMakerAccess.score * INTENT_COMPONENT_WEIGHTS.decisionMakerAccess +
    budgetLikelihood.score * INTENT_COMPONENT_WEIGHTS.budgetLikelihood +
    automationFit.score * INTENT_COMPONENT_WEIGHTS.automationFit +
    implementationSimplicity.score * INTENT_COMPONENT_WEIGHTS.implementationSimplicity;

  const intentScore = clamp(Math.round(weighted - trust.score));

  return {
    intentScore,
    reasons: [
      ...urgency.reasons,
      ...manualWorkload.reasons,
      ...decisionMakerAccess.reasons,
      ...budgetLikelihood.reasons,
      ...automationFit.reasons,
      ...implementationSimplicity.reasons,
      ...trust.reasons,
    ],
    components: {
      urgency: urgency.score,
      manualWorkload: manualWorkload.score,
      decisionMakerAccess: decisionMakerAccess.score,
      budgetLikelihood: budgetLikelihood.score,
      automationFit: automationFit.score,
      implementationSimplicity: implementationSimplicity.score,
      trustBarrierRisk: -trust.score,
    },
  };
}

export function priorityFor(finalScore: number): Priority {
  if (finalScore >= PRIORITY_THRESHOLDS.A) return 'A';
  if (finalScore >= PRIORITY_THRESHOLDS.B) return 'B';
  if (finalScore >= PRIORITY_THRESHOLDS.C) return 'C';
  return 'Reject';
}

export function combineScores(
  rule: RuleScoreBreakdown,
  intent: IntentScoreBreakdown,
  lead: RawLead,
): CombinedScore {
  const finalScore = clamp(
    Math.round(rule.ruleScore * FINAL_WEIGHTS.rule + intent.intentScore * FINAL_WEIGHTS.intent),
  );
  const campaign = classifyCampaign(lead, rule, intent);
  return {
    rule,
    intent,
    finalScore,
    priority: priorityFor(finalScore),
    campaign,
  };
}

export function scoreLead(lead: RawLead): CombinedScore {
  const rule = evaluateRules(lead);
  const intent = evaluateIntent(lead);
  return combineScores(rule, intent, lead);
}
