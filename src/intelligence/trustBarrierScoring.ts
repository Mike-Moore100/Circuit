// Trust barrier — how hard will this prospect be to convince? Higher score
// here is WORSE — it's a penalty on the composite. The pattern: enterprise
// signals, internal engineering capability, existing automation maturity,
// highly technical industries.
//
// This score never adds to the composite directly; opportunityIntelligence
// SUBTRACTS it with a weight.

import { clamp100, type IntelligenceInputs, type SubScore } from './intelligenceTypes';

const TECHNICAL_INDUSTRY_KEYWORDS = [
  'software',
  'saas',
  'platform',
  'ai',
  'ml',
  'machine learning',
  'data science',
  'devops',
  'cloud',
  'infrastructure',
  'cybersecurity',
  'developer tools',
  'engineering',
];

const ENTERPRISE_INDUSTRY_KEYWORDS = [
  'enterprise',
  'global',
  'multinational',
  'corporate',
  'consulting (big 4)',
  'fortune 500',
];

export function scoreTrustBarrier(inputs: IntelligenceInputs): SubScore {
  const reasons: SubScore['reasons'] = [];
  const signals: string[] = [];
  let score = 0;

  // Size — enterprise scale → bigger trust barrier
  const size = inputs.sizeEstimate ?? 0;
  if (size > 250) {
    score += 35;
    reasons.push({
      code: 'enterprise_headcount',
      label: `Headcount ${size} — enterprise procurement gate`,
      delta: 35,
    });
    signals.push(`Enterprise scale (${size})`);
  } else if (size > 100) {
    score += 18;
    reasons.push({
      code: 'large_smb',
      label: `Headcount ${size} — sales cycle will be long`,
      delta: 18,
    });
  } else if (size > 50) {
    score += 8;
    reasons.push({
      code: 'mid_smb',
      label: `Headcount ${size} — likely some procurement process`,
      delta: 8,
    });
  }

  // Technical industry — they likely build it themselves
  const industry = (inputs.industry ?? '').toLowerCase();
  if (TECHNICAL_INDUSTRY_KEYWORDS.some((k) => industry.includes(k))) {
    score += 25;
    reasons.push({
      code: 'technical_industry',
      label: `Technical industry "${industry}" — internal capability assumed`,
      delta: 25,
    });
    signals.push('Technical industry');
  }

  if (ENTERPRISE_INDUSTRY_KEYWORDS.some((k) => industry.includes(k))) {
    score += 25;
    reasons.push({
      code: 'enterprise_industry',
      label: `Industry "${industry}" implies enterprise procurement`,
      delta: 25,
    });
  }

  // Verified signal — AI/automation language on their OWN site means
  // they're already familiar with the space. Higher bar to differentiate.
  const aiLang = inputs.verifiedSignals.find(
    (s) => s.type === 'verified.has_ai_automation_language',
  );
  if (aiLang) {
    score += 15;
    reasons.push({
      code: 'existing_automation_pitch',
      label: 'Site already pitches AI/automation — competitive landscape',
      delta: 15,
    });
    signals.push('Already pitches automation');
  }

  // Strong existing presence (multiple paid tools surfaced) — they invest
  // already, but they also have vendor preferences and entrenched stacks.
  const paidToolIndicators = [
    inputs.hasBookingLink,
    inputs.hasLinkedIn,
    inputs.operationalClues.some((c) => c.code === 'service_complexity'),
  ].filter(Boolean).length;
  if (paidToolIndicators >= 3) {
    score += 10;
    reasons.push({
      code: 'mature_stack',
      label: 'Mature tool stack visible — likely vendor preferences',
      delta: 10,
    });
  }

  // Title flags: detected roles that imply layers between us and the buyer
  const hasExecGate = inputs.contacts.some((c) =>
    /vp|svp|head of|director of/i.test(c.role ?? ''),
  );
  const hasFounder = inputs.contacts.some((c) =>
    ['founder', 'co_founder', 'owner', 'ceo'].includes(c.detectedRole),
  );
  if (hasExecGate && !hasFounder) {
    score += 8;
    reasons.push({
      code: 'exec_gate',
      label: 'Senior gatekeeper present, no direct founder access',
      delta: 8,
    });
  }

  reasons.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return {
    score: clamp100(score),
    reasons: reasons.slice(0, 8),
    signals,
  };
}
