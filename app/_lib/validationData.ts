// Data loader for the /validation page. Pulls everything the dashboard
// needs in one bundle so the page itself can stay declarative.

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
  HIGH_SCORE_THRESHOLD,
  type CalibrationLeadInput,
  type OperatorAgreementMetrics,
} from '../../src/validation/operatorAgreement';
import type { OpportunityIntelligence } from '../../src/intelligence/intelligenceTypes';
import { visibleOrigins } from '../../src/db/dataMode';
import {
  computeCommercialWeaknesses,
  type CommercialWeakness,
} from '../../src/intelligence/commercialWeakness';

export interface ValidationLeadView {
  companyId: string;
  company: string;
  industry: string | null;
  location: string | null;
  opportunityScore: number;
  trustBarrier: number;
  operationalPain: number;
  attentionPriority: string;
  projectType: string;
  reviewTags: string[];
  latestOutcome: string | null;
  approved: boolean;
  rejected: boolean;
}

export interface ValidationPageData {
  // Top N highest-ranked real opportunities.
  topRanked: ValidationLeadView[];
  // Highest operator-approved leads — those with the most approval tags.
  highestApproved: ValidationLeadView[];
  // Commercial pain pattern counts across the corpus.
  commercialPainPatterns: Array<{ kind: string; label: string; count: number }>;
  // Strongest conversion opportunities — high opp score + weak onboarding
  // commercial weakness signal.
  conversionOpportunities: ValidationLeadView[];
  // Trust barrier patterns — top-N companies sorted by trust_barrier_score
  // and the count of "high_trust_barrier" operator tags.
  highestTrustBarrier: ValidationLeadView[];
  // Calibration metrics (agreement rate, false positives, etc.)
  metrics: OperatorAgreementMetrics;
  // Outcome distribution — how the operator's recorded outcomes break down.
  outcomeDistribution: Record<string, number>;
  // Companies reviewed with the strongest agreement / disagreement.
  scoreVsAgreement: {
    highScoreApproved: ValidationLeadView[];
    highScoreRejected: ValidationLeadView[];
    lowScoreApproved: ValidationLeadView[];
  };
}

function setIntersects(a: Set<string>, b: Set<string>): boolean {
  for (const v of a) if (b.has(v)) return true;
  return false;
}

export function getValidationData(): ValidationPageData {
  const db = getDb();

  // Real-mode only: visibleOrigins() drives the row scope across the
  // dashboard. We piggyback on the same helper here.
  const origins = visibleOrigins();
  const placeholders = origins.map(() => '?').join(',');

  // ---- 1. Lead-level rows ----------------------------------------------
  const intelligenceRows = listOpportunityIntelligence(db, { limit: 500 });
  const companies = db
    .prepare(
      `SELECT id, name, industry, location FROM companies
        WHERE data_origin IN (${placeholders})`,
    )
    .all(...origins) as Array<{
    id: string;
    name: string;
    industry: string | null;
    location: string | null;
  }>;
  const companyById = new Map(companies.map((c) => [c.id, c]));

  const reviewTags = getReviewTagsByCompany(db);

  // Verified signals per company (for commercial weakness detection).
  const signalRows = db
    .prepare(
      `SELECT company_id, type, value FROM signals
        WHERE source = 'website_inspection'`,
    )
    .all() as Array<{ company_id: string; type: string; value: string }>;
  const signalsByCompany = new Map<
    string,
    Array<{ type: string; value: string }>
  >();
  for (const s of signalRows) {
    let arr = signalsByCompany.get(s.company_id);
    if (!arr) {
      arr = [];
      signalsByCompany.set(s.company_id, arr);
    }
    arr.push({ type: s.type, value: s.value });
  }

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

  // Latest outcome per company (status indicator on the rows).
  const outcomeRows = db
    .prepare(
      `SELECT lo.company_id, lo.outcome_type FROM lead_outcomes lo
         JOIN (
           SELECT company_id, MAX(created_at) AS created_at
             FROM lead_outcomes GROUP BY company_id
         ) latest
           ON latest.company_id = lo.company_id
          AND latest.created_at = lo.created_at`,
    )
    .all() as Array<{ company_id: string; outcome_type: string }>;
  const latestOutcomeByCompany = new Map(
    outcomeRows.map((r) => [r.company_id, r.outcome_type]),
  );

  // Per-lead aggregated commercial weakness (top one across the corpus).
  const weaknessCountsByKind = new Map<
    string,
    { kind: string; label: string; count: number }
  >();

  const views: ValidationLeadView[] = [];

  for (const r of intelligenceRows) {
    const company = companyById.get(r.company_id);
    if (!company) continue;
    let intelligence: OpportunityIntelligence | null = null;
    try {
      intelligence = JSON.parse(r.payload_json) as OpportunityIntelligence;
    } catch {
      continue;
    }
    const tags = reviewTags.get(r.company_id) ?? new Set<string>();
    const approved = setIntersects(tags, APPROVAL_TAGS);
    const rejected = setIntersects(tags, REJECTION_TAGS);

    const verified = signalsByCompany.get(r.company_id) ?? [];
    const hasWorkingWebsite = verified.some(
      (s) =>
        s.type === 'verified.website_loads' ||
        s.type === 'verified.has_working_website',
    );
    const weaknesses = computeCommercialWeaknesses({
      verifiedSignals: verified,
      intelligence,
      hasContactForm: formIds.has(r.company_id),
      hasBookingLink: bookingIds.has(r.company_id),
      hasWorkingWebsite,
      companyName: company.name,
      industry: company.industry,
    });
    for (const w of weaknesses) {
      const existing = weaknessCountsByKind.get(w.kind);
      if (existing) {
        existing.count += 1;
      } else {
        weaknessCountsByKind.set(w.kind, { kind: w.kind, label: w.label, count: 1 });
      }
    }

    views.push({
      companyId: r.company_id,
      company: company.name,
      industry: company.industry,
      location: company.location,
      opportunityScore: r.opportunity_score,
      trustBarrier: r.trust_barrier_score ?? 0,
      operationalPain: intelligence.operationalPain.score,
      attentionPriority: r.human_attention_priority,
      projectType: r.likely_project_type,
      reviewTags: [...tags],
      latestOutcome: latestOutcomeByCompany.get(r.company_id) ?? null,
      approved,
      rejected,
    });
  }

  // ---- 2. Top-ranked / approved / conversion / trust slices -----------
  const topRanked = [...views]
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, 25);

  // "Highest approved" — most approval tags per lead, tiebreak on opp score.
  const highestApproved = views
    .map((v) => ({
      v,
      approvedCount: v.reviewTags.filter((t) => APPROVAL_TAGS.has(t)).length,
    }))
    .filter((x) => x.approvedCount > 0)
    .sort((a, b) => {
      if (b.approvedCount !== a.approvedCount) return b.approvedCount - a.approvedCount;
      return b.v.opportunityScore - a.v.opportunityScore;
    })
    .slice(0, 25)
    .map((x) => x.v);

  // Conversion opportunities — leads with the weak_onboarding_flow
  // commercial weakness (deterministic signal) AND a high opp score.
  // Recompute per-lead since we don't keep the per-lead weakness array
  // around. Cheap because the per-lead step is just a string check.
  const conversionOpportunities = views
    .filter((v) => v.opportunityScore >= 40)
    .filter((v) => {
      const verified = signalsByCompany.get(v.companyId) ?? [];
      const hasWorkingWebsite = verified.some(
        (s) =>
          s.type === 'verified.website_loads' ||
          s.type === 'verified.has_working_website',
      );
      if (!hasWorkingWebsite) return false;
      return !formIds.has(v.companyId) && !bookingIds.has(v.companyId);
    })
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, 25);

  const highestTrustBarrier = [...views]
    .sort((a, b) => b.trustBarrier - a.trustBarrier)
    .slice(0, 25);

  // ---- 3. Calibration metrics ------------------------------------------
  const calibrationLeads: CalibrationLeadInput[] = views.map((v) => ({
    companyId: v.companyId,
    opportunityScore: v.opportunityScore,
    reviewTags: new Set(v.reviewTags),
  }));
  const metrics = computeOperatorAgreement(calibrationLeads);

  // ---- 4. Score-vs-agreement breakouts --------------------------------
  const highScoreApproved = views.filter(
    (v) => v.opportunityScore >= HIGH_SCORE_THRESHOLD && v.approved,
  );
  const highScoreRejected = views.filter(
    (v) => v.opportunityScore >= HIGH_SCORE_THRESHOLD && v.rejected,
  );
  const lowScoreApproved = views.filter(
    (v) => v.opportunityScore < HIGH_SCORE_THRESHOLD && v.approved,
  );

  return {
    topRanked,
    highestApproved,
    commercialPainPatterns: [...weaknessCountsByKind.values()].sort(
      (a, b) => b.count - a.count,
    ),
    conversionOpportunities,
    highestTrustBarrier,
    metrics,
    outcomeDistribution: getOutcomeDistribution(db),
    scoreVsAgreement: {
      highScoreApproved: highScoreApproved
        .sort((a, b) => b.opportunityScore - a.opportunityScore)
        .slice(0, 15),
      highScoreRejected: highScoreRejected
        .sort((a, b) => b.opportunityScore - a.opportunityScore)
        .slice(0, 15),
      lowScoreApproved: lowScoreApproved
        .sort((a, b) => b.opportunityScore - a.opportunityScore)
        .slice(0, 15),
    },
  };
}
