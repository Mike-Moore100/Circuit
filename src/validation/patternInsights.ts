// Phase 1 Validation refactor — pattern detection + calibration
// recommendations. Pure functions over an array of "validation
// leads" (one row per scored company with the relevant joins
// already done by the caller). No DB, no I/O.
//
// Outputs are operator-facing strings. Each carries an `evidence`
// counter so the UI can show "based on N reviews" instead of a
// soft assertion.

import { APPROVAL_TAGS, REJECTION_TAGS } from './operatorAgreement';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------
export interface ValidationLead {
  companyId: string;
  industry: string | null;
  opportunityScore: number;
  primaryCampaign: string | null;
  hasNamedDmEmail: boolean;
  hasGuessedOnlyEmail: boolean;
  hasContactForm: boolean;
  hasBookingLink: boolean;
  trustBarrier: number;
  reviewTags: Set<string>;
  outcomeTags: Set<string>;
}

export type InsightKind =
  | 'strongest_industry'
  | 'weakest_industry'
  | 'false_positive'
  | 'false_reject'
  | 'signal_pattern';

export interface PatternInsight {
  kind: InsightKind;
  text: string;
  evidenceLabel: string;
  evidenceCount: number;
}

export interface CalibrationRecommendation {
  text: string;
  rationale: string;
  evidenceCount: number;
}

// ---------------------------------------------------------------------------
// Thresholds — exposed so dashboards can show "based on >= N reviews"
// in the same vocabulary the detector uses.
// ---------------------------------------------------------------------------
export const MIN_REVIEWS_PER_INDUSTRY = 3;
export const STRONG_APPROVAL_RATE = 0.7;
export const STRONG_REJECTION_RATE = 0.6;
export const HIGH_SCORE = 60;
export const LOW_SCORE = 30;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function hasApproval(lead: ValidationLead): boolean {
  for (const t of lead.reviewTags) if (APPROVAL_TAGS.has(t)) return true;
  return false;
}
function hasRejection(lead: ValidationLead): boolean {
  for (const t of lead.reviewTags) if (REJECTION_TAGS.has(t)) return true;
  return false;
}
function isReviewed(lead: ValidationLead): boolean {
  return lead.reviewTags.size > 0;
}

interface IndustryRoll {
  industry: string;
  reviewed: number;
  approved: number;
  rejected: number;
  approvalRate: number; // 0–1
  rejectionRate: number;
}

function rollUpByIndustry(leads: ValidationLead[]): IndustryRoll[] {
  const byIndustry = new Map<string, IndustryRoll>();
  for (const lead of leads) {
    if (!lead.industry) continue;
    if (!isReviewed(lead)) continue;
    let r = byIndustry.get(lead.industry);
    if (!r) {
      r = {
        industry: lead.industry,
        reviewed: 0,
        approved: 0,
        rejected: 0,
        approvalRate: 0,
        rejectionRate: 0,
      };
      byIndustry.set(lead.industry, r);
    }
    r.reviewed += 1;
    if (hasApproval(lead)) r.approved += 1;
    if (hasRejection(lead)) r.rejected += 1;
  }
  for (const r of byIndustry.values()) {
    r.approvalRate = r.reviewed > 0 ? r.approved / r.reviewed : 0;
    r.rejectionRate = r.reviewed > 0 ? r.rejected / r.reviewed : 0;
  }
  return [...byIndustry.values()];
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

// ---------------------------------------------------------------------------
// Insight detectors — each returns 0..3 insights ranked by evidence strength.
// ---------------------------------------------------------------------------
export function detectStrongestIndustries(
  leads: ValidationLead[],
  max = 3,
): PatternInsight[] {
  const rolls = rollUpByIndustry(leads)
    .filter((r) => r.reviewed >= MIN_REVIEWS_PER_INDUSTRY)
    .filter((r) => r.approvalRate >= STRONG_APPROVAL_RATE)
    .sort((a, b) => b.approvalRate - a.approvalRate || b.reviewed - a.reviewed);
  return rolls.slice(0, max).map((r) => ({
    kind: 'strongest_industry' as const,
    text: `${capitalise(r.industry)} are converting on review — ${pct(r.approvalRate)} approval.`,
    evidenceLabel: `${r.approved} approved of ${r.reviewed} reviewed`,
    evidenceCount: r.reviewed,
  }));
}

export function detectWeakestIndustries(
  leads: ValidationLead[],
  max = 3,
): PatternInsight[] {
  const rolls = rollUpByIndustry(leads)
    .filter((r) => r.reviewed >= MIN_REVIEWS_PER_INDUSTRY)
    .filter((r) => r.rejectionRate >= STRONG_REJECTION_RATE)
    .sort((a, b) => b.rejectionRate - a.rejectionRate || b.reviewed - a.reviewed);
  return rolls.slice(0, max).map((r) => ({
    kind: 'weakest_industry' as const,
    text: `${capitalise(r.industry)} are routinely rejected — ${pct(r.rejectionRate)} of reviews.`,
    evidenceLabel: `${r.rejected} rejected of ${r.reviewed} reviewed`,
    evidenceCount: r.reviewed,
  }));
}

export function detectFalsePositivePatterns(
  leads: ValidationLead[],
  max = 3,
): PatternInsight[] {
  // False positive = high opportunity score AND operator rejected.
  const fps = leads.filter(
    (l) => l.opportunityScore >= HIGH_SCORE && hasRejection(l),
  );
  if (fps.length === 0) return [];
  // Group by industry.
  const byIndustry = new Map<string, number>();
  for (const l of fps) {
    const key = l.industry ?? '(unknown)';
    byIndustry.set(key, (byIndustry.get(key) ?? 0) + 1);
  }
  const ranked = [...byIndustry.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max);
  return ranked.map(([industry, count]) => ({
    kind: 'false_positive' as const,
    text: `${capitalise(industry)} repeatedly rank high but operators reject them.`,
    evidenceLabel: `${count} false positives`,
    evidenceCount: count,
  }));
}

export function detectFalseRejectPatterns(
  leads: ValidationLead[],
  max = 3,
): PatternInsight[] {
  // False reject = low opportunity score AND operator approved.
  const frs = leads.filter(
    (l) => l.opportunityScore < LOW_SCORE && hasApproval(l),
  );
  if (frs.length === 0) return [];
  const byIndustry = new Map<string, number>();
  for (const l of frs) {
    const key = l.industry ?? '(unknown)';
    byIndustry.set(key, (byIndustry.get(key) ?? 0) + 1);
  }
  const ranked = [...byIndustry.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max);
  return ranked.map(([industry, count]) => ({
    kind: 'false_reject' as const,
    text: `${capitalise(industry)} rank low but operators consistently want them.`,
    evidenceLabel: `${count} false rejects`,
    evidenceCount: count,
  }));
}

export function detectSignalPatterns(leads: ValidationLead[]): PatternInsight[] {
  const insights: PatternInsight[] = [];
  // Direct-DM email → review approval correlation.
  const withDm = leads.filter((l) => l.hasNamedDmEmail && isReviewed(l));
  if (withDm.length >= MIN_REVIEWS_PER_INDUSTRY) {
    const approved = withDm.filter(hasApproval).length;
    const rate = approved / withDm.length;
    if (rate >= 0.6) {
      insights.push({
        kind: 'signal_pattern',
        text: 'Leads with a direct decision-maker email are approved more often than the corpus average.',
        evidenceLabel: `${approved} approved of ${withDm.length} reviewed`,
        evidenceCount: withDm.length,
      });
    }
  }
  // Generic-only email penalty.
  const genericOnly = leads.filter(
    (l) => l.hasGuessedOnlyEmail && !l.hasNamedDmEmail && isReviewed(l),
  );
  if (genericOnly.length >= MIN_REVIEWS_PER_INDUSTRY) {
    const rejected = genericOnly.filter(hasRejection).length;
    const rate = rejected / genericOnly.length;
    if (rate >= 0.5) {
      insights.push({
        kind: 'signal_pattern',
        text: 'Generic-email-only leads are rejected more often than the corpus average.',
        evidenceLabel: `${rejected} rejected of ${genericOnly.length} reviewed`,
        evidenceCount: genericOnly.length,
      });
    }
  }
  // Weak onboarding flow (no form + no booking) on UK SMBs.
  const weakOnboarding = leads.filter(
    (l) => !l.hasContactForm && !l.hasBookingLink && isReviewed(l),
  );
  if (weakOnboarding.length >= MIN_REVIEWS_PER_INDUSTRY) {
    const approved = weakOnboarding.filter(hasApproval).length;
    const rate = approved / weakOnboarding.length;
    if (rate >= 0.5) {
      insights.push({
        kind: 'signal_pattern',
        text: 'Businesses with no form + no booking still convert on review — operators see latent demand.',
        evidenceLabel: `${approved} approved of ${weakOnboarding.length} reviewed`,
        evidenceCount: weakOnboarding.length,
      });
    }
  }
  return insights;
}

// ---------------------------------------------------------------------------
// Calibration recommendations — each tweak is grounded in one or more
// detected patterns above. Outputs plain-text actions an operator can
// translate into a scoring change.
// ---------------------------------------------------------------------------
export function deriveRecommendations(
  leads: ValidationLead[],
): CalibrationRecommendation[] {
  const recs: CalibrationRecommendation[] = [];

  const fps = detectFalsePositivePatterns(leads);
  for (const fp of fps) {
    const industry = extractIndustryFromInsight(fp.text);
    if (!industry) continue;
    recs.push({
      text: `Reduce ranking weight for ${industry}.`,
      rationale: `Marked as false positives ${fp.evidenceCount} times — high opportunity scores didn't survive review.`,
      evidenceCount: fp.evidenceCount,
    });
  }

  const frs = detectFalseRejectPatterns(leads);
  for (const fr of frs) {
    const industry = extractIndustryFromInsight(fr.text);
    if (!industry) continue;
    recs.push({
      text: `Increase ranking weight for ${industry}.`,
      rationale: `Operator approved them ${fr.evidenceCount} times despite a low opportunity score.`,
      evidenceCount: fr.evidenceCount,
    });
  }

  // Trust barrier — if many high-trust-barrier leads are rejected,
  // suggest tightening the penalty.
  const highTrust = leads.filter((l) => l.trustBarrier >= 50 && hasRejection(l));
  const highTrustReviewed = leads.filter((l) => l.trustBarrier >= 50 && isReviewed(l));
  if (highTrustReviewed.length >= MIN_REVIEWS_PER_INDUSTRY) {
    const rate = highTrust.length / highTrustReviewed.length;
    if (rate >= 0.6) {
      recs.push({
        text: 'Increase trust-barrier penalty across the board.',
        rationale: `High-trust-barrier leads were rejected ${pct(rate)} of the time (${highTrust.length} / ${highTrustReviewed.length}).`,
        evidenceCount: highTrustReviewed.length,
      });
    }
  }

  // DM-email signal — if leads with a named DM email are approved
  // disproportionately, recommend lifting accessibility weight.
  const withDm = leads.filter((l) => l.hasNamedDmEmail && isReviewed(l));
  if (withDm.length >= MIN_REVIEWS_PER_INDUSTRY) {
    const approved = withDm.filter(hasApproval).length;
    const rate = approved / withDm.length;
    if (rate >= 0.7) {
      recs.push({
        text: 'Boost accessibility weight for leads with a direct decision-maker email.',
        rationale: `Direct-DM-email leads were approved ${pct(rate)} of the time (${approved} / ${withDm.length}).`,
        evidenceCount: withDm.length,
      });
    }
  }

  // Sort by evidence count desc so the most-grounded recommendations
  // appear first.
  recs.sort((a, b) => b.evidenceCount - a.evidenceCount);
  return recs;
}

// ---------------------------------------------------------------------------
// Composite — used by the page to populate every section in one call.
// ---------------------------------------------------------------------------
export interface ValidationInsights {
  strongest: PatternInsight[];
  weakest: PatternInsight[];
  falsePositives: PatternInsight[];
  falseRejects: PatternInsight[];
  signals: PatternInsight[];
  recommendations: CalibrationRecommendation[];
}

export function deriveValidationInsights(leads: ValidationLead[]): ValidationInsights {
  return {
    strongest: detectStrongestIndustries(leads),
    weakest: detectWeakestIndustries(leads),
    falsePositives: detectFalsePositivePatterns(leads),
    falseRejects: detectFalseRejectPatterns(leads),
    signals: detectSignalPatterns(leads),
    recommendations: deriveRecommendations(leads),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function capitalise(s: string): string {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}

function extractIndustryFromInsight(text: string): string | null {
  // Insight strings start with `${capitalise(industry)} …` — we pull
  // up to the first verb-shaped word. Conservative parse — null if
  // anything looks off.
  const m = text.match(/^([A-Za-z][\w &/-]+?)\s+(?:repeatedly|rank|are|consistently)\b/);
  if (!m) return null;
  return m[1].toLowerCase();
}
