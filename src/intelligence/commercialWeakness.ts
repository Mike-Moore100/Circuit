// Phase 1 Live Validation — deterministic commercial weakness detection.
// Distinct from operationalPainScoring (which surfaces technical
// friction) and trustBarrierScoring (which surfaces social-proof issues).
// This module looks specifically for commercial *positioning* gaps the
// operator can act on: unclear services, weak onboarding path, generic
// positioning, operational immaturity.
//
// Pure function, no AI. Returns an ordered list of weaknesses so the
// card / drawer can surface the strongest one without picking the
// "what to show" logic anywhere downstream.

import type {
  IntelligenceVerifiedSignal,
  OpportunityIntelligence,
} from './intelligenceTypes';

export type CommercialWeaknessKind =
  | 'unclear_service_structure'
  | 'weak_onboarding_flow'
  | 'generic_positioning'
  | 'operational_immaturity'
  | 'weak_differentiation'
  | 'weak_trust_signals';

export interface CommercialWeakness {
  kind: CommercialWeaknessKind;
  label: string;
  detail: string;
  severity: number; // 1–5; higher = stronger commercial signal
}

export interface CommercialWeaknessInputs {
  verifiedSignals: IntelligenceVerifiedSignal[];
  intelligence: OpportunityIntelligence | null;
  hasContactForm: boolean;
  hasBookingLink: boolean;
  hasWorkingWebsite: boolean;
  // Optional: the company name + tagline / industry, used to detect
  // generic positioning without any LLM dependency.
  companyName: string | null;
  industry: string | null;
}

function hasSignal(signals: IntelligenceVerifiedSignal[], type: string): boolean {
  return signals.some((s) => s.type === type);
}

// "Generic" here means the company name + industry combination reads as
// a category placeholder rather than a brand. We're conservative — only
// flag if the name literally contains the industry as a whole word, which
// catches "Digital Marketing Agency London" but not "Lumen Marketing".
function looksGenericName(name: string | null, industry: string | null): boolean {
  if (!name || !industry) return false;
  const lower = name.toLowerCase();
  const ind = industry.toLowerCase().trim();
  if (!ind) return false;
  // Whole-phrase match — "marketing agency" must appear as a contiguous
  // substring, not just both individual words floating around.
  return lower.includes(ind);
}

export function computeCommercialWeaknesses(
  inputs: CommercialWeaknessInputs,
): CommercialWeakness[] {
  const {
    verifiedSignals,
    intelligence,
    hasContactForm,
    hasBookingLink,
    hasWorkingWebsite,
    companyName,
    industry,
  } = inputs;
  const out: CommercialWeakness[] = [];

  // ---- Unclear service structure ---------------------------------------
  // A working website with no services page (and no multiple service
  // pages) is a real commercial signal — visitors can't tell what's on
  // offer. We don't flag this if the website never loaded; that's a
  // separate signal (operational_immaturity).
  if (
    hasWorkingWebsite &&
    !hasSignal(verifiedSignals, 'verified.has_services_page') &&
    !hasSignal(verifiedSignals, 'verified.has_multiple_service_pages')
  ) {
    out.push({
      kind: 'unclear_service_structure',
      label: 'Unclear service structure',
      detail: 'No services page detected — offering is hard to scan.',
      severity: 4,
    });
  }

  // ---- Weak onboarding / contact flow ----------------------------------
  // No clear capture path. We require a working website so this isn't
  // confused with a broken site.
  if (hasWorkingWebsite && !hasContactForm && !hasBookingLink) {
    out.push({
      kind: 'weak_onboarding_flow',
      label: 'Weak onboarding flow',
      detail: 'No form, no booking — buyers have no obvious next step.',
      severity: 5,
    });
  }

  // ---- Generic positioning --------------------------------------------
  if (looksGenericName(companyName, industry)) {
    out.push({
      kind: 'generic_positioning',
      label: 'Generic positioning',
      detail: 'Company name reads as a category placeholder.',
      severity: 3,
    });
  }

  // ---- Operational immaturity -----------------------------------------
  // Low digital maturity OR website-failed signals roll up here. Higher
  // severity when both apply.
  const lowMaturity = hasSignal(verifiedSignals, 'verified.low_digital_maturity');
  const failed = hasSignal(verifiedSignals, 'verified.website_failed');
  if (lowMaturity || failed) {
    out.push({
      kind: 'operational_immaturity',
      label: 'Operational immaturity',
      detail: failed
        ? 'Website failed to load — basic operational hygiene gap.'
        : 'Verified low digital maturity signals on the site.',
      severity: failed && lowMaturity ? 5 : failed ? 4 : 3,
    });
  }

  // ---- Weak differentiation -------------------------------------------
  // Hard to detect without LLM, but a likely_service_business with
  // generic-name + no automation language is a commercial signal we can
  // surface as a starting point.
  if (
    hasSignal(verifiedSignals, 'verified.likely_service_business') &&
    !hasSignal(verifiedSignals, 'verified.has_ai_automation_language') &&
    looksGenericName(companyName, industry)
  ) {
    out.push({
      kind: 'weak_differentiation',
      label: 'Weak differentiation',
      detail: 'Generic name + no specialist positioning visible on site.',
      severity: 3,
    });
  }

  // ---- Weak trust signals ---------------------------------------------
  // Lift this from the intelligence layer when present. We use a
  // conservative threshold to avoid double-counting against the
  // existing trust barrier surface.
  if (intelligence && intelligence.trustBarrier.score >= 55) {
    out.push({
      kind: 'weak_trust_signals',
      label: 'Weak trust signals',
      detail: 'Trust barrier elevated — proof-heavy approach will be needed.',
      severity: intelligence.trustBarrier.score >= 75 ? 4 : 3,
    });
  }

  // Deterministic ordering — severity desc, then kind alphabetical so
  // ties don't flicker between renders.
  out.sort((a, b) => {
    if (b.severity !== a.severity) return b.severity - a.severity;
    return a.kind.localeCompare(b.kind);
  });
  return out;
}

export function topCommercialWeaknesses(
  inputs: CommercialWeaknessInputs,
  n = 2,
): CommercialWeakness[] {
  return computeCommercialWeaknesses(inputs).slice(0, n);
}
