// Buying readiness — is this business currently active, growing, and
// equipped to actually buy services? Distinct from pain — a high-pain
// business with no money isn't a customer.

import { clamp100, type IntelligenceInputs, type SubScore } from './intelligenceTypes';

const HIGH_INTENT_INDUSTRIES = new Set([
  'marketing agency',
  'design studio',
  'creative agency',
  'consulting',
  'fitness studio',
  'wellness clinic',
  'dental practice',
  'medical practice',
  'accounting',
  'legal services',
  'real estate',
  'recruiting',
  'staffing',
  'property',
  'home services',
  'plumbing',
  'electrician',
  'hvac',
  'landscaping',
  'cleaning services',
]);

export function scoreBuyingReadiness(inputs: IntelligenceInputs): SubScore {
  const reasons: SubScore['reasons'] = [];
  const signals: string[] = [];
  let score = 0;

  // Active business — site loaded and rendered something real
  const siteLoaded = inputs.verifiedSignals.some(
    (s) => s.type === 'verified.has_working_website',
  );
  if (siteLoaded) {
    score += 22;
    reasons.push({
      code: 'site_working',
      label: 'Site loads and renders — business is active',
      delta: 22,
    });
    signals.push('Active website');
  }

  // Headcount in the right band. Sole-trader = lower readiness; mid SMB =
  // peak buying band; large company = different sales motion.
  const size = inputs.sizeEstimate ?? 0;
  if (size >= 6 && size <= 40) {
    score += 18;
    reasons.push({
      code: 'sweet_spot_size',
      label: `Headcount ${size} sits in the SMB buying sweet spot`,
      delta: 18,
    });
    signals.push(`Headcount ${size}`);
  } else if (size >= 3 && size < 6) {
    score += 8;
    reasons.push({
      code: 'small_active',
      label: `Headcount ${size} — small but real`,
      delta: 8,
    });
  } else if (size > 40 && size <= 100) {
    score += 10;
    reasons.push({
      code: 'large_smb',
      label: `Headcount ${size} — larger SMB, longer sales cycle`,
      delta: 10,
    });
  } else if (size > 0 && size < 3) {
    score -= 4;
    reasons.push({
      code: 'solo',
      label: 'Solo / hobby-scale operator',
      delta: -4,
    });
  }

  // Industry that's known to spend on growth services
  const industry = (inputs.industry ?? '').toLowerCase();
  if (HIGH_INTENT_INDUSTRIES.has(industry)) {
    score += 14;
    reasons.push({
      code: 'high_intent_industry',
      label: `Industry "${industry}" routinely buys growth services`,
      delta: 14,
    });
    signals.push(`Industry: ${industry}`);
  }

  // Multiple services / service complexity in the homepage copy hints at
  // a real operating business (vs a single-page coming-soon site).
  const hasServiceComplexity = inputs.operationalClues.some(
    (c) => c.code === 'service_complexity',
  );
  if (hasServiceComplexity) {
    score += 10;
    reasons.push({
      code: 'service_complexity',
      label: 'Multiple services described — real operating business',
      delta: 10,
    });
  }

  // Forms / booking / contact paths = they expect inbound, i.e. they
  // already invest in lead capture (and would invest more for better tools).
  if (inputs.hasContactForm) {
    score += 8;
    reasons.push({
      code: 'has_form',
      label: 'Has a contact form — expects inbound',
      delta: 8,
    });
  }
  if (inputs.hasBookingLink) {
    score += 10;
    reasons.push({
      code: 'has_booking',
      label: 'Has a booking link — already using paid scheduling tooling',
      delta: 10,
    });
    signals.push('Pays for scheduling tools');
  }

  // LinkedIn company page = mature enough to maintain presence
  if (inputs.hasLinkedIn) {
    score += 4;
    reasons.push({
      code: 'linkedin',
      label: 'Maintains a company LinkedIn presence',
      delta: 4,
    });
  }

  // Mobile-responsive site = recent investment
  const hasViewport = !inputs.visualIssues.some((v) => v.code === 'no_meta_viewport');
  if (hasViewport && inputs.inspectionOk) {
    score += 6;
    reasons.push({
      code: 'modern_site',
      label: 'Mobile-responsive site — recent investment in presence',
      delta: 6,
    });
  }

  reasons.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return {
    score: clamp100(score),
    reasons: reasons.slice(0, 8),
    signals,
  };
}
