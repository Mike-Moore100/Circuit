// Phase 1 Live Validation — operator agreement metrics. Measures whether
// the opportunity intelligence layer is surfacing genuinely good leads
// by comparing what the system ranked highly against what the operator
// chose to validate.
//
// Definitions used here:
//
//   "high score"  — opportunity_score ≥ 60 (Top 40% by design)
//   "low score"   — opportunity_score < 30 (Bottom third by design)
//   "approval"    — operator tagged would_contact, high_commercial_potential,
//                   strong_pain, likely_high_value, or strong_opportunity
//   "rejection"   — operator tagged would_not_contact, low_commercial_potential,
//                   weak_pain, ignore, or false_positive
//
// We deliberately keep the thresholds and tag-sets in one place so the
// definitions are explicit. The dashboard and the CLI both read from
// this module — single source of truth for what "agreement" means.
//
// Pure function — no DB calls, no I/O. The caller fetches the rows.

export interface CalibrationLeadInput {
  companyId: string;
  opportunityScore: number;
  // Distinct review tags ever applied to this lead — any combination of
  // calibration + operator types is fine; the metrics filter what they
  // care about.
  reviewTags: Set<string>;
}

export const APPROVAL_TAGS = new Set<string>([
  'would_contact',
  'high_commercial_potential',
  'strong_pain',
  'likely_high_value',
  'strong_opportunity',
  // correct_campaign means the operator confirmed the system's routing;
  // we treat it as a soft approval.
  'correct_campaign',
]);

export const REJECTION_TAGS = new Set<string>([
  'would_not_contact',
  'low_commercial_potential',
  'weak_pain',
  'ignore',
  'false_positive',
]);

export const HIGH_SCORE_THRESHOLD = 60;
export const LOW_SCORE_THRESHOLD = 30;

export interface OperatorAgreementMetrics {
  // Volume of reviewed leads — anything with at least one tag.
  totalReviewed: number;
  totalHighScore: number;
  totalLowScore: number;

  // Counts
  highScoreApproved: number; // ✅ correct positive
  highScoreRejected: number; // ❌ false positive
  lowScoreApproved: number; // ❌ false negative
  lowScoreRejected: number; // ✅ correct negative

  // Rates — null when the denominator is zero (not enough data).
  operatorAgreementRate: number | null; // approved / reviewed
  operatorDisagreementRate: number | null; // rejected / reviewed
  falsePositiveRate: number | null; // highScoreRejected / totalHighScore
  falseNegativeRate: number | null; // lowScoreApproved / totalLowScore

  // Ranking confidence — a single 0–100 quality score derived from the
  // agreement and false-rate signals so dashboards have one number to
  // show. 100 = perfect, 0 = inverted. Returns null when there's not
  // enough reviewed data to compute meaningfully (< 5 reviewed).
  rankingConfidence: number | null;
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

export function computeOperatorAgreement(
  leads: CalibrationLeadInput[],
): OperatorAgreementMetrics {
  let totalReviewed = 0;
  let totalHighScore = 0;
  let totalLowScore = 0;
  let highApproved = 0;
  let highRejected = 0;
  let lowApproved = 0;
  let lowRejected = 0;
  let anyApproved = 0;
  let anyRejected = 0;

  for (const lead of leads) {
    const approved = setIntersects(lead.reviewTags, APPROVAL_TAGS);
    const rejected = setIntersects(lead.reviewTags, REJECTION_TAGS);
    if (!approved && !rejected) continue;
    totalReviewed += 1;
    if (approved) anyApproved += 1;
    if (rejected) anyRejected += 1;

    if (lead.opportunityScore >= HIGH_SCORE_THRESHOLD) {
      totalHighScore += 1;
      if (approved) highApproved += 1;
      if (rejected) highRejected += 1;
    } else if (lead.opportunityScore < LOW_SCORE_THRESHOLD) {
      totalLowScore += 1;
      if (approved) lowApproved += 1;
      if (rejected) lowRejected += 1;
    }
  }

  const rankingConfidence = computeRankingConfidence({
    totalReviewed,
    totalHighScore,
    totalLowScore,
    highApproved,
    highRejected,
    lowApproved,
    lowRejected,
  });

  return {
    totalReviewed,
    totalHighScore,
    totalLowScore,
    highScoreApproved: highApproved,
    highScoreRejected: highRejected,
    lowScoreApproved: lowApproved,
    lowScoreRejected: lowRejected,
    operatorAgreementRate: rate(anyApproved, totalReviewed),
    operatorDisagreementRate: rate(anyRejected, totalReviewed),
    falsePositiveRate: rate(highRejected, totalHighScore),
    falseNegativeRate: rate(lowApproved, totalLowScore),
    rankingConfidence,
  };
}

// Distinct from "agreement rate" — this composite gives one number that
// rewards high-score leads being approved AND low-score leads being
// rejected. We weight both ends so a system that just approves
// everything doesn't score 100.
function computeRankingConfidence(counts: {
  totalReviewed: number;
  totalHighScore: number;
  totalLowScore: number;
  highApproved: number;
  highRejected: number;
  lowApproved: number;
  lowRejected: number;
}): number | null {
  if (counts.totalReviewed < 5) return null;

  // High-score quality: of all high-score reviews, what fraction were
  // approved (the desired outcome).
  const highTotal = counts.highApproved + counts.highRejected;
  const highQuality = highTotal === 0 ? null : counts.highApproved / highTotal;

  // Low-score quality: of all low-score reviews, what fraction were
  // rejected (also the desired outcome — we correctly de-prioritised
  // these).
  const lowTotal = counts.lowApproved + counts.lowRejected;
  const lowQuality = lowTotal === 0 ? null : counts.lowRejected / lowTotal;

  // Weighted average. If either end has no data, we fall back to the
  // other side; that's why we tolerate nulls here.
  if (highQuality === null && lowQuality === null) return null;
  if (lowQuality === null) return Math.round((highQuality ?? 0) * 100);
  if (highQuality === null) return Math.round(lowQuality * 100);
  // Weight high-score quality more heavily — false positives are more
  // expensive in this product than false negatives because the operator
  // would have spent time on them.
  const score = highQuality * 0.6 + lowQuality * 0.4;
  return Math.round(score * 100);
}

function setIntersects(a: Set<string>, b: Set<string>): boolean {
  for (const v of a) if (b.has(v)) return true;
  return false;
}
