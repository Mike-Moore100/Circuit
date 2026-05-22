// Data loader for the /validation page.
//
// Phase 1 Validation refactor — the page is now a *review workflow*,
// not an analytics dashboard. The payload is structured around the
// four sections the operator interacts with:
//
//   summary           — compact rates + best/worst industries
//   queue             — prioritised reviewable leads
//   patterns          — text insights (strongest / weakest / FP / FR / signals)
//   recommendations   — one-line calibration tweaks with evidence
//
// Every datapoint the old shape exposed still lives here, just
// re-organised so the page can render decision-first instead of
// metrics-first.

import { getDb } from '../../src/db/client';
import {
  getOutcomeDistribution,
  getReviewTagsByCompany,
  listOpportunityIntelligence,
} from '../../src/db/repository';
import {
  computeOperatorAgreement,
  APPROVAL_TAGS,
  REJECTION_TAGS,
  type OperatorAgreementMetrics,
} from '../../src/validation/operatorAgreement';
import {
  deriveValidationInsights,
  type CalibrationRecommendation,
  type PatternInsight,
  type ValidationLead,
} from '../../src/validation/patternInsights';
import type { OpportunityIntelligence } from '../../src/intelligence/intelligenceTypes';
import { visibleOrigins } from '../../src/db/dataMode';

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------
export interface ValidationQueueItem {
  companyId: string;
  company: string;
  industry: string | null;
  campaign: string | null;
  opportunityScore: number;
  // The four Layer-1 strings the queue card surfaces — derived from
  // intelligence + verified signals, fall back to null when not
  // available rather than inventing.
  strongestReason: string | null;
  strongestRisk: string | null;
  whyNow: string | null;
  bestEvidence: string | null;
  contactability: string;
  appliedTags: string[];
  // Why this lead is in the queue — drives the tone on the card.
  // 'unreviewed_high' is the most common in a healthy corpus.
  queueReason:
    | 'unreviewed_high'
    | 'false_positive_candidate'
    | 'false_reject_candidate'
    | 'conflicting_tags';
}

export interface ValidationSummary {
  metrics: OperatorAgreementMetrics;
  strongestIndustry: string | null;
  weakestIndustry: string | null;
  scoringDriftWarning: string | null;
  outcomeDistribution: Record<string, number>;
}

export interface ValidationPageData {
  summary: ValidationSummary;
  queue: ValidationQueueItem[];
  patterns: {
    strongest: PatternInsight[];
    weakest: PatternInsight[];
    falsePositives: PatternInsight[];
    falseRejects: PatternInsight[];
    signals: PatternInsight[];
  };
  recommendations: CalibrationRecommendation[];
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------
export function getValidationData(): ValidationPageData {
  const db = getDb();
  const origins = visibleOrigins();
  const placeholders = origins.map(() => '?').join(',');

  // ---- Companies + their latest score + intelligence -------------------
  const intelligenceRows = listOpportunityIntelligence(db, { limit: 500 });
  const companyRows = db
    .prepare(
      `SELECT id, name, industry FROM companies
        WHERE data_origin IN (${placeholders})`,
    )
    .all(...origins) as Array<{
    id: string;
    name: string;
    industry: string | null;
  }>;
  const companyById = new Map(companyRows.map((c) => [c.id, c]));

  // Latest primary_campaign per company.
  const latestCampaignByCompany = new Map<string, string | null>(
    (db
      .prepare(
        `SELECT company_id, primary_campaign FROM lead_scores ls
          WHERE ls.created_at = (
            SELECT MAX(created_at) FROM lead_scores
             WHERE company_id = ls.company_id
          )`,
      )
      .all() as Array<{ company_id: string; primary_campaign: string | null }>)
      .map((r) => [r.company_id, r.primary_campaign]),
  );

  // Reviews + outcomes.
  const reviewTagsByCompany = getReviewTagsByCompany(db);

  // Has-named-DM-email rollup. SQLite's default build doesn't ship
  // REGEXP, so we pull candidate contacts (rows that already meet
  // the easy-to-SQL filters: have a name + non-guessed email) and
  // run the role regex in JS. The candidate set is small.
  const namedDmCompanyIds = new Set<string>(
    (db
      .prepare(
        `SELECT company_id, role FROM contacts
          WHERE name IS NOT NULL
            AND email IS NOT NULL
            AND email <> ''
            AND COALESCE(email_status, 'extracted') <> 'guessed'`,
      )
      .all() as Array<{ company_id: string; role: string | null }>)
      .filter(
        (r) =>
          r.role && /founder|director|partner|owner|managing|head/i.test(r.role),
      )
      .map((r) => r.company_id),
  );

  const guessedOnlyIds = new Set(
    (db
      .prepare(
        `SELECT DISTINCT company_id FROM contacts
          WHERE email IS NOT NULL AND email <> ''
            AND COALESCE(email_status, 'extracted') = 'guessed'`,
      )
      .all() as Array<{ company_id: string }>)
      .map((r) => r.company_id),
  );

  const formIds = new Set(
    (db
      .prepare(
        "SELECT DISTINCT company_id FROM signals WHERE type = 'verified.has_contact_form'",
      )
      .all() as Array<{ company_id: string }>).map((r) => r.company_id),
  );
  const bookingIds = new Set(
    (db
      .prepare(
        "SELECT DISTINCT company_id FROM signals WHERE type = 'verified.has_booking_link'",
      )
      .all() as Array<{ company_id: string }>).map((r) => r.company_id),
  );

  // Latest outcome per company.
  const latestOutcomeByCompany = new Map<string, string>(
    (db
      .prepare(
        `SELECT lo.company_id, lo.outcome_type FROM lead_outcomes lo
           JOIN (
             SELECT company_id, MAX(created_at) AS created_at
               FROM lead_outcomes GROUP BY company_id
           ) latest
             ON latest.company_id = lo.company_id
            AND latest.created_at = lo.created_at`,
      )
      .all() as Array<{ company_id: string; outcome_type: string }>)
      .map((r) => [r.company_id, r.outcome_type]),
  );

  // ---- Flat view of every scored lead (drives every section) ----------
  interface FlatLead {
    companyId: string;
    company: string;
    industry: string | null;
    campaign: string | null;
    opportunityScore: number;
    trustBarrier: number;
    operationalPain: number;
    intelligence: OpportunityIntelligence | null;
    reviewTags: Set<string>;
    outcomeTags: Set<string>;
    hasNamedDmEmail: boolean;
    hasGuessedOnlyEmail: boolean;
    hasContactForm: boolean;
    hasBookingLink: boolean;
    approved: boolean;
    rejected: boolean;
  }

  const flat: FlatLead[] = [];
  for (const r of intelligenceRows) {
    const company = companyById.get(r.company_id);
    if (!company) continue;
    let intelligence: OpportunityIntelligence | null = null;
    try {
      intelligence = JSON.parse(r.payload_json) as OpportunityIntelligence;
    } catch {
      continue;
    }
    const tags = reviewTagsByCompany.get(r.company_id) ?? new Set<string>();
    const approved = setHasAny(tags, APPROVAL_TAGS);
    const rejected = setHasAny(tags, REJECTION_TAGS);
    const outcome = latestOutcomeByCompany.get(r.company_id);
    flat.push({
      companyId: r.company_id,
      company: company.name,
      industry: company.industry,
      campaign: latestCampaignByCompany.get(r.company_id) ?? null,
      opportunityScore: r.opportunity_score,
      trustBarrier: r.trust_barrier_score ?? 0,
      operationalPain: intelligence.operationalPain.score,
      intelligence,
      reviewTags: tags,
      outcomeTags: outcome ? new Set([outcome]) : new Set(),
      hasNamedDmEmail: namedDmCompanyIds.has(r.company_id),
      hasGuessedOnlyEmail: guessedOnlyIds.has(r.company_id),
      hasContactForm: formIds.has(r.company_id),
      hasBookingLink: bookingIds.has(r.company_id),
      approved,
      rejected,
    });
  }

  // ---- 1. Summary -----------------------------------------------------
  const metrics = computeOperatorAgreement(
    flat.map((l) => ({
      companyId: l.companyId,
      opportunityScore: l.opportunityScore,
      reviewTags: l.reviewTags,
    })),
  );

  // Strongest / weakest industries — single string each, picked from
  // approval/rejection rates. Conservative: only set when there's
  // enough evidence.
  const industryStats = new Map<string, { reviewed: number; approved: number; rejected: number }>();
  for (const l of flat) {
    if (!l.industry) continue;
    const reviewed = l.reviewTags.size > 0 ? 1 : 0;
    if (!reviewed) continue;
    const cur = industryStats.get(l.industry) ?? { reviewed: 0, approved: 0, rejected: 0 };
    cur.reviewed += 1;
    if (l.approved) cur.approved += 1;
    if (l.rejected) cur.rejected += 1;
    industryStats.set(l.industry, cur);
  }
  const industryRolls = [...industryStats.entries()]
    .map(([industry, s]) => ({
      industry,
      reviewed: s.reviewed,
      approvalRate: s.reviewed > 0 ? s.approved / s.reviewed : 0,
      rejectionRate: s.reviewed > 0 ? s.rejected / s.reviewed : 0,
    }))
    .filter((r) => r.reviewed >= 3);
  const strongestIndustry = industryRolls
    .slice()
    .sort((a, b) => b.approvalRate - a.approvalRate)[0]?.industry ?? null;
  const weakestIndustry = industryRolls
    .slice()
    .sort((a, b) => b.rejectionRate - a.rejectionRate)[0]?.industry ?? null;

  // Scoring drift — single sentence flag. We surface this only when
  // the false-positive rate crosses 30% on a corpus with at least 10
  // reviews, since smaller corpora aren't statistically meaningful.
  let scoringDriftWarning: string | null = null;
  if (
    metrics.totalReviewed >= 10 &&
    metrics.falsePositiveRate !== null &&
    metrics.falsePositiveRate > 0.3
  ) {
    scoringDriftWarning = `Scoring drift: ${Math.round(
      metrics.falsePositiveRate * 100,
    )}% of high-score leads were rejected on review.`;
  }

  // ---- 2. Queue -------------------------------------------------------
  // Priority order:
  //   1. high-score unreviewed leads (the operator's primary workload)
  //   2. false-positive candidates (high score, recently rejected)
  //   3. false-reject candidates (low score, recently approved)
  //   4. conflicting-tag leads (approved AND rejected)
  // We keep the queue small (top 25) — the rest live on /opportunities
  // and via filters.

  const queue: ValidationQueueItem[] = [];
  const seen = new Set<string>();

  // Helper: turn a FlatLead into a queue item.
  const toQueueItem = (l: FlatLead, reason: ValidationQueueItem['queueReason']) => {
    if (seen.has(l.companyId)) return null;
    seen.add(l.companyId);
    return {
      companyId: l.companyId,
      company: l.company,
      industry: l.industry,
      campaign: l.campaign,
      opportunityScore: l.opportunityScore,
      strongestReason: l.intelligence?.opportunityReasons[0] ?? null,
      strongestRisk: l.intelligence?.riskFactors[0] ?? null,
      whyNow: null, // populated below
      bestEvidence: l.intelligence?.strongestSignals[0] ?? null,
      contactability: contactabilityLabel(l),
      appliedTags: [...l.reviewTags],
      queueReason: reason,
    };
  };

  // 4. Conflicting tags (rare but loud — surface first if present)
  for (const l of flat) {
    if (l.approved && l.rejected) {
      const item = toQueueItem(l, 'conflicting_tags');
      if (item) queue.push(item);
    }
  }
  // 1. Unreviewed high-score
  const unreviewedHigh = flat
    .filter((l) => l.reviewTags.size === 0 && l.opportunityScore >= 40)
    .sort((a, b) => b.opportunityScore - a.opportunityScore);
  for (const l of unreviewedHigh) {
    const item = toQueueItem(l, 'unreviewed_high');
    if (item) queue.push(item);
    if (queue.length >= 25) break;
  }
  // 2. False-positive candidates
  if (queue.length < 25) {
    const fps = flat
      .filter((l) => l.opportunityScore >= 60 && l.rejected)
      .sort((a, b) => b.opportunityScore - a.opportunityScore);
    for (const l of fps) {
      const item = toQueueItem(l, 'false_positive_candidate');
      if (item) queue.push(item);
      if (queue.length >= 25) break;
    }
  }
  // 3. False-reject candidates
  if (queue.length < 25) {
    const frs = flat
      .filter((l) => l.opportunityScore < 30 && l.approved)
      .sort((a, b) => b.opportunityScore - a.opportunityScore);
    for (const l of frs) {
      const item = toQueueItem(l, 'false_reject_candidate');
      if (item) queue.push(item);
      if (queue.length >= 25) break;
    }
  }

  // ---- 3. Patterns + 4. Recommendations -------------------------------
  const insightLeads: ValidationLead[] = flat.map((l) => ({
    companyId: l.companyId,
    industry: l.industry,
    opportunityScore: l.opportunityScore,
    primaryCampaign: l.campaign,
    hasNamedDmEmail: l.hasNamedDmEmail,
    hasGuessedOnlyEmail: l.hasGuessedOnlyEmail,
    hasContactForm: l.hasContactForm,
    hasBookingLink: l.hasBookingLink,
    trustBarrier: l.trustBarrier,
    reviewTags: l.reviewTags,
    outcomeTags: l.outcomeTags,
  }));
  const insights = deriveValidationInsights(insightLeads);

  return {
    summary: {
      metrics,
      strongestIndustry,
      weakestIndustry,
      scoringDriftWarning,
      outcomeDistribution: getOutcomeDistribution(db),
    },
    queue,
    patterns: {
      strongest: insights.strongest,
      weakest: insights.weakest,
      falsePositives: insights.falsePositives,
      falseRejects: insights.falseRejects,
      signals: insights.signals,
    },
    recommendations: insights.recommendations,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function setHasAny(a: Set<string>, b: Set<string>): boolean {
  for (const v of a) if (b.has(v)) return true;
  return false;
}

function contactabilityLabel(l: {
  hasNamedDmEmail: boolean;
  hasGuessedOnlyEmail: boolean;
  hasContactForm: boolean;
  hasBookingLink: boolean;
}): string {
  if (l.hasNamedDmEmail) return 'Direct DM email';
  if (l.hasContactForm && l.hasBookingLink) return 'Form + booking';
  if (l.hasContactForm) return 'Contact form';
  if (l.hasBookingLink) return 'Booking link';
  if (l.hasGuessedOnlyEmail) return 'Guessed email only';
  return 'No clear path';
}
