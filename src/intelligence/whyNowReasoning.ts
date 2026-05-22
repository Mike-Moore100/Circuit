// Why-now reasoning — deterministic, pure function that turns the existing
// opportunity intelligence + verified signals into operator-scannable
// urgency reasons. No new model, no AI. Reads from what we've already
// computed elsewhere.
//
// Each signal carries a small numeric `weight` so the orchestrator can
// pick the top-K signals to show on the compact card without surfacing
// every minor reason. Weights are tuned by intuition, not learnt — that's
// what the calibration layer is for. We intentionally surface at most 3
// signals on the card (Hick's law) and let the drawer show the rest.
//
// What counts as a "why now" signal:
//   - scaling — growth signals (hiring, careers page, multiple service pages)
//   - weak_conversion — has website + visitors but no contact / booking
//   - hiring — careers page present, hiring keywords in content
//   - ops_complexity — multi-step workflow signals, ops_complexity hits
//   - low_digital_maturity — verified.low_digital_maturity, website failed
//   - trust_issues — high trust barrier score
//   - manual_workflows — verified.has_manual_workflow_language
//   - weak_automation — no automation language + likely_service_business
//
// All checks are local-only — no extra DB calls, no network — so the
// function is cheap to call per-card.

import type {
  OpportunityIntelligence,
  IntelligenceVerifiedSignal,
} from './intelligenceTypes';

export type WhyNowKind =
  | 'scaling'
  | 'weak_conversion'
  | 'hiring'
  | 'ops_complexity'
  | 'low_digital_maturity'
  | 'trust_issues'
  | 'manual_workflows'
  | 'weak_automation';

export interface WhyNowSignal {
  kind: WhyNowKind;
  label: string; // short, operator-scannable
  detail: string; // one-line explanation
  weight: number; // 1–5; higher = stronger urgency contribution
}

export interface WhyNowInputs {
  intelligence: OpportunityIntelligence;
  verifiedSignals: IntelligenceVerifiedSignal[];
  // The two contactability bits drive the weak-conversion signal — passing
  // them in keeps this module pure and database-free.
  hasContactForm: boolean;
  hasBookingLink: boolean;
  hasWorkingWebsite: boolean;
}

function hasSignal(
  signals: IntelligenceVerifiedSignal[],
  type: string,
): boolean {
  return signals.some((s) => s.type === type);
}

export function computeWhyNow(inputs: WhyNowInputs): WhyNowSignal[] {
  const { intelligence, verifiedSignals, hasContactForm, hasBookingLink, hasWorkingWebsite } =
    inputs;
  const out: WhyNowSignal[] = [];

  // ---- Scaling -----------------------------------------------------------
  // Multiple service pages + working website is a low-cost growth proxy.
  // We don't have hard hiring data without a careers page hit, so use
  // size + multiple-service-pages as a soft scaling signal too.
  const hasMultipleServices = hasSignal(verifiedSignals, 'verified.has_multiple_service_pages');
  const hasCareers = hasSignal(verifiedSignals, 'verified.has_careers_page');
  if (hasCareers) {
    out.push({
      kind: 'hiring',
      label: 'Hiring',
      detail: 'Careers page detected — actively growing the team.',
      weight: 4,
    });
  }
  if (hasMultipleServices && hasWorkingWebsite) {
    out.push({
      kind: 'scaling',
      label: 'Scaling',
      detail: 'Multiple service lines visible — broadening offering.',
      weight: 3,
    });
  }

  // ---- Weak conversion --------------------------------------------------
  // Has a website and visitors but nothing to capture them with. Strongest
  // when there's also no contact page on top of no form / booking.
  if (hasWorkingWebsite && !hasContactForm && !hasBookingLink) {
    const hasContactPage = hasSignal(verifiedSignals, 'verified.has_contact_page');
    out.push({
      kind: 'weak_conversion',
      label: 'Weak conversion',
      detail: hasContactPage
        ? 'Has contact page but no form or booking — visitors leak.'
        : 'No contact form, no booking link, no clear contact path.',
      weight: hasContactPage ? 3 : 5,
    });
  }

  // ---- Operational complexity ------------------------------------------
  // Either the implementation-fit scorer found ops_complexity, or pain
  // sub-score broke 60. We can read these off the existing intelligence
  // rather than re-running the heuristics.
  if (
    intelligence.implementationFit.signals.some((s) =>
      /multi.?step|ops.?complex/i.test(s),
    ) ||
    intelligence.operationalPain.score >= 60
  ) {
    out.push({
      kind: 'ops_complexity',
      label: 'Operational complexity',
      detail: 'Multi-step workflows visible — automation has room to land.',
      weight: 4,
    });
  }

  // ---- Low digital maturity --------------------------------------------
  if (
    hasSignal(verifiedSignals, 'verified.low_digital_maturity') ||
    hasSignal(verifiedSignals, 'verified.website_failed')
  ) {
    const websiteFailed = hasSignal(verifiedSignals, 'verified.website_failed');
    out.push({
      kind: 'low_digital_maturity',
      label: 'Low digital maturity',
      detail: websiteFailed
        ? 'Website failed to load — basic web hygiene gap.'
        : 'Verified low digital maturity signals on site.',
      weight: websiteFailed ? 5 : 3,
    });
  }

  // ---- Trust issues -----------------------------------------------------
  // Trust barrier is "higher = worse" — the inverted score from the trust
  // sub-scorer. Show this as urgency only when it's pronounced.
  if (intelligence.trustBarrier.score >= 60) {
    out.push({
      kind: 'trust_issues',
      label: 'Trust barrier',
      detail: 'Visible trust friction — proof-heavy approach will be needed.',
      weight: 2,
    });
  }

  // ---- Manual workflows -------------------------------------------------
  if (hasSignal(verifiedSignals, 'verified.has_manual_workflow_language')) {
    out.push({
      kind: 'manual_workflows',
      label: 'Manual workflows',
      detail: 'Site language describes manual / one-by-one processes.',
      weight: 4,
    });
  }

  // ---- Weak automation --------------------------------------------------
  // Service business that hasn't adopted automation language yet — high
  // tailwind for AI_AUTOMATION campaigns.
  if (
    hasSignal(verifiedSignals, 'verified.likely_service_business') &&
    !hasSignal(verifiedSignals, 'verified.has_ai_automation_language')
  ) {
    out.push({
      kind: 'weak_automation',
      label: 'No automation visible',
      detail: 'Service business with no AI / automation language yet.',
      weight: 3,
    });
  }

  // Stable sort by weight desc, then by kind for determinism. Determinism
  // matters because these strings end up in tests + the dashboard, and we
  // don't want two equal-weight signals to flicker between orders.
  out.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return a.kind.localeCompare(b.kind);
  });
  return out;
}

// Card-friendly variant: keep only the top N (default 3). The card itself
// can choose to render more if there's room, but it should *prefer* the
// top three so the operator can scan in 5–10 seconds.
export function topWhyNow(inputs: WhyNowInputs, n = 3): WhyNowSignal[] {
  return computeWhyNow(inputs).slice(0, n);
}
