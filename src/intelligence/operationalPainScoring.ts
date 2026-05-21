// Operational pain — how broken is the operator's day-to-day surface?
// Higher score means more visible pain → bigger commercial opportunity
// to fix. Reads from inspection + evidence + operational clues. Pure.

import { clamp100, type IntelligenceInputs, type SubScore } from './intelligenceTypes';

// Weight table for visual-issue codes. The same code can apply across
// campaigns — the weight here is the "structural pain" weight, distinct
// from the campaign-fit weight in the scoring pass.
const VISUAL_PAIN: Record<string, { weight: number; label: string }> = {
  page_failed_to_load: { weight: 26, label: 'Homepage failed to load' },
  broken_rendering: { weight: 18, label: 'JavaScript errors during render' },
  no_meta_viewport: { weight: 14, label: 'Missing mobile viewport — site is not responsive' },
  mobile_horizontal_overflow: { weight: 14, label: 'Mobile content overflows the viewport' },
  no_visible_cta: { weight: 12, label: 'No visible call-to-action on homepage' },
  no_contact_path: { weight: 14, label: 'No reachable contact path' },
  no_visible_form: { weight: 6, label: 'No form on the homepage' },
  no_trust_signals: { weight: 8, label: 'No phone / address / copyright signals' },
  no_h1: { weight: 6, label: 'No <h1> on the page' },
  sparse_homepage: { weight: 10, label: 'Sparse homepage — looks placeholder' },
  outdated_visual_quality: { weight: 12, label: 'Stacked outdated-build hints' },
};

// Operational-clue weights for AI_AUTOMATION-style pain. These are language
// signals (manual intake phrasing etc) — additive on top of structural pain.
const CLUE_PAIN: Record<string, { weight: number; label: string }> = {
  manual_intake_language: { weight: 10, label: 'Manual intake / coordination language on site' },
  admin_overhead_language: { weight: 8, label: 'Admin overhead phrasing on site' },
  recurring_reporting_cadence: { weight: 8, label: 'Recurring reporting cadence in copy' },
  repetitive_inquiry_flow: { weight: 8, label: 'Repetitive inquiry flow language' },
  service_complexity: { weight: 6, label: 'Multiple / complex services described' },
  no_automation_indicators: { weight: 6, label: 'Explicit "no software" / manual-only language' },
};

// Verified-signal corroboration — these come from the inspector and back
// up what evidence saw. Smaller weights because they may double-count.
const VERIFIED_PAIN: Record<string, { weight: number; label: string }> = {
  'verified.website_failed': { weight: 10, label: 'Verified: website did not load' },
  'verified.low_digital_maturity': { weight: 6, label: 'Verified: low digital maturity' },
  'verified.has_ai_automation_language': {
    weight: 4,
    label: 'Verified: AI/automation language on site',
  },
};

export function scoreOperationalPain(inputs: IntelligenceInputs): SubScore {
  const reasons: SubScore['reasons'] = [];
  const signals: string[] = [];
  let score = 0;

  for (const issue of inputs.visualIssues) {
    const w = VISUAL_PAIN[issue.code];
    if (!w) continue;
    // Scale by per-issue confidence so a 30%-conf signal moves the score less.
    const contribution = Math.round((w.weight * issue.confidence) / 100);
    if (contribution <= 0) continue;
    score += contribution;
    reasons.push({
      code: `visual.${issue.code}`,
      label: w.label,
      delta: contribution,
    });
    if (signals.length < 5) signals.push(w.label);
  }

  for (const clue of inputs.operationalClues) {
    const w = CLUE_PAIN[clue.code];
    if (!w) continue;
    const contribution = Math.round((w.weight * clue.confidence) / 100);
    if (contribution <= 0) continue;
    score += contribution;
    reasons.push({
      code: `operational.${clue.code}`,
      label: w.label,
      delta: contribution,
    });
    if (signals.length < 5) signals.push(w.label);
  }

  for (const s of inputs.verifiedSignals) {
    const w = VERIFIED_PAIN[s.type];
    if (!w) continue;
    // Verified signals are present/absent — no confidence to scale by.
    score += w.weight;
    reasons.push({ code: s.type, label: w.label, delta: w.weight });
    if (signals.length < 5) signals.push(w.label);
  }

  // Cap pain at 100. Sort reasons by absolute contribution so the top of
  // the list explains the bulk of the score.
  reasons.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return {
    score: clamp100(score),
    reasons: reasons.slice(0, 8),
    signals,
  };
}
