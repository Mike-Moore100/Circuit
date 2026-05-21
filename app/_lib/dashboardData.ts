import { config } from '../../src/config/index';
import { getDb } from '../../src/db/client';
import {
  getAiAnalysisStats,
  getInspectionStats,
  getLatestReviewByCompany,
  getRecentSourceRuns,
} from '../../src/db/repository';
import { CAMPAIGN_VALUES, CAMPAIGN_LABEL } from '../../src/scoring/campaignTypes';
import type { Campaign } from '../../src/scoring/campaignTypes';
import {
  computeCampaignMetrics,
  computeReviewTotals,
  computeSourceQuality,
  computeTopReasons,
} from '../../src/validation/metrics';
import { detectCandidateFalseRejects } from '../../src/validation/falseRejectDetector';
import type {
  CampaignMetric,
  FalseRejectCandidate,
  ReviewType,
  SourceQuality,
  TopReason,
} from '../../src/validation/types';
import type {
  Company,
  Priority,
  ReviewQueueRow,
  ScoreReason,
  Signal,
  SourceRun,
} from '../../src/types';

interface RawJoinedRow extends Company {
  rule_score: number | null;
  intent_score: number | null;
  final_score: number | null;
  priority: Priority | null;
  reasons_json: string | null;
  primary_campaign: Campaign | null;
  campaign_scores_json: string | null;
  campaign_reasons_json: string | null;
  primary_reason: string | null;
  suggested_investigation: string | null;
  review_status: string | null;
}

export interface InspectionCounts {
  inspected: number;
  failed: number;
  highAutomationFit: number;
  withContactForm: number;
  withBookingLink: number;
  aiProvider: number;
}

export interface LeadVerifiedSignal {
  type: string;
  value: string;
  confidence: number;
}

interface PersistedReasons {
  rule: {
    ruleScore: number;
    pass: boolean;
    reasons: ScoreReason[];
    rejectionReasons: ScoreReason[];
  };
  intent: {
    intentScore: number;
    reasons: ScoreReason[];
    components: Record<string, number>;
  };
}

export interface SourceRunSummary {
  id: string;
  source: string;
  status: SourceRun['status'];
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  leadsFound: number;
  leadsAccepted: number;
  leadsRejected: number;
  apiCalls: number;
  errors: string[];
}

export interface AiAnalysisPanel {
  id: string;
  summary: string;
  confidence: number;
  operationalPainPoints: Array<{
    title: string;
    description: string;
    confidence: number;
    evidence: string[];
  }>;
  automationOpportunities: Array<{
    title: string;
    description: string;
    businessImpact: string;
    implementationComplexity: 'low' | 'medium' | 'high';
    confidence: number;
  }>;
  likelyBuyer: { role: string; reasoning: string; confidence: number };
  urgency: { level: 'low' | 'medium' | 'high'; reasoning: string };
  proofAngles: Array<{ title: string; description: string }>;
  risks: string[];
  provider: string;
  model: string;
  tokensInput: number;
  tokensCached: number;
  tokensOutput: number;
  estimatedCost: number;
  feedbackStatus: string;
  createdAt: string;
}

export interface AiOverview {
  total: number;
  ok: number;
  failed: number;
  todayCostUsd: number;
  totalCostUsd: number;
  dailyLimitUsd: number;
  feedback: Record<string, number>;
}

export interface ValidationOverview {
  campaignMetrics: CampaignMetric[];
  sourceQuality: SourceQuality[];
  topReasons: Record<Campaign, TopReason[]>;
  topRejectionReasons: TopReason[];
  falseRejectCandidates: FalseRejectCandidate[];
  reviewTotals: Record<ReviewType, number>;
  reviewByCompany: Record<string, string>;
}

export interface DashboardData {
  totals: { processed: number; accepted: number; rejected: number };
  priorityCounts: Record<Priority, number>;
  campaignCounts: Record<Campaign, number>;
  // Leads grouped by their primary campaign. REJECT bucket is kept separate
  // because it's the only segment we don't actively pursue.
  byCampaign: Record<Campaign, ReviewQueueRow[]>;
  reviewQueue: ReviewQueueRow[];
  rejected: ReviewQueueRow[];
  sourceRuns: SourceRunSummary[];
  inspection: InspectionCounts;
  // companyId → array of verified signals for that company.
  verifiedSignalsByCompany: Record<string, LeadVerifiedSignal[]>;
  // companyId → latest AI analysis (if any)
  aiByCompany: Record<string, AiAnalysisPanel>;
  ai: AiOverview;
  validation: ValidationOverview;
}

function parseReasons(raw: string | null): PersistedReasons | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedReasons;
  } catch {
    return null;
  }
}

function inferPainPoints(reasons: ScoreReason[]): string[] {
  const codes = new Set(reasons.map((r) => r.code));
  const out: string[] = [];
  if (codes.has('automatable_workload') || codes.has('manual_workload')) {
    out.push('Repetitive manual workflows likely eating operator time');
  }
  if (codes.has('ops_complexity')) {
    out.push('Multi-step operational workflows that could be glued together');
  }
  if (codes.has('urgency_workload')) {
    out.push('Team is visibly under workload pressure right now');
  }
  if (codes.has('fit_workflows')) {
    out.push('Workflow profile matches the agency’s automation playbook');
  }
  if (codes.has('budget_size')) {
    out.push('Size band suggests a real (but lean) budget');
  }
  return out;
}

function nextStep(priority: Priority, websiteUrl: string | null): string {
  if (priority === 'Reject') return 'Skip — fails rule filter or intent threshold.';
  if (!websiteUrl) return 'Find a website / digital footprint before contacting.';
  if (priority === 'A') return 'Manually inspect website + LinkedIn, draft tailored outreach for founder.';
  if (priority === 'B') return 'Spot-check operational workflow signals, then queue for outreach in next batch.';
  return 'Park in nurture list; revisit if stronger signals appear.';
}

function parseCampaignScores(raw: string | null): Record<Campaign, number> {
  const zero: Record<Campaign, number> = {
    AI_AUTOMATION: 0,
    WEB_REBUILD: 0,
    FUNNEL_OPTIMIZATION: 0,
    LOCAL_DIGITAL_UPGRADE: 0,
    LOW_PRIORITY_NURTURE: 0,
    REJECT: 0,
  };
  if (!raw) return zero;
  try {
    const parsed = JSON.parse(raw) as Record<string, number>;
    return { ...zero, ...parsed };
  } catch {
    return zero;
  }
}

function parseTrueRejectionReasons(raw: string | null): ScoreReason[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as {
      trueRejectionReasons?: ScoreReason[];
    };
    return parsed.trueRejectionReasons ?? [];
  } catch {
    return [];
  }
}

function toRow(raw: RawJoinedRow): ReviewQueueRow {
  const parsed = parseReasons(raw.reasons_json);
  const reasons = parsed
    ? [...parsed.rule.reasons, ...parsed.intent.reasons]
    : ([] as ScoreReason[]);
  const primaryCampaign: Campaign = raw.primary_campaign ?? 'LOW_PRIORITY_NURTURE';
  const trueRejectionReasons = parseTrueRejectionReasons(raw.campaign_reasons_json);
  const isReject = primaryCampaign === 'REJECT';
  return {
    companyId: raw.id,
    company: raw.name,
    website: raw.website_url ?? null,
    industry: raw.industry ?? null,
    location: raw.location ?? null,
    source: raw.source,
    ruleScore: raw.rule_score ?? 0,
    intentScore: raw.intent_score ?? 0,
    finalScore: raw.final_score ?? 0,
    priority: raw.priority ?? 'Reject',
    status: (raw.review_status as ReviewQueueRow['status']) ?? (isReject ? 'rejected' : 'queued'),
    reasons,
    // Only true rejection reasons are surfaced — the legacy
    // rule.rejectionReasons list is no longer treated as final.
    rejectionReasons: isReject ? trueRejectionReasons : [],
    likelyPainPoints: inferPainPoints(reasons),
    suggestedNextStep:
      raw.suggested_investigation ?? nextStep(raw.priority ?? 'Reject', raw.website_url ?? null),
    updatedAt: raw.updated_at,
    primaryCampaign,
    campaignScores: parseCampaignScores(raw.campaign_scores_json),
    primaryReason: raw.primary_reason ?? '',
  };
}

export async function getDashboardData(): Promise<DashboardData> {
  const db = getDb();

  // Latest score per company.
  const rows = db
    .prepare(
      `WITH latest AS (
         SELECT company_id, MAX(created_at) AS created_at
           FROM lead_scores
          GROUP BY company_id
       )
       SELECT c.*,
              s.rule_score              AS rule_score,
              s.intent_score            AS intent_score,
              s.final_score             AS final_score,
              s.priority                AS priority,
              s.reasons_json            AS reasons_json,
              s.primary_campaign        AS primary_campaign,
              s.campaign_scores_json    AS campaign_scores_json,
              s.campaign_reasons_json   AS campaign_reasons_json,
              s.primary_reason          AS primary_reason,
              s.suggested_investigation AS suggested_investigation,
              r.status                  AS review_status
         FROM companies c
         LEFT JOIN latest l        ON l.company_id = c.id
         LEFT JOIN lead_scores s   ON s.company_id = c.id AND s.created_at = l.created_at
         LEFT JOIN review_queue r  ON r.company_id = c.id
        ORDER BY COALESCE(s.final_score, 0) DESC`,
    )
    .all() as RawJoinedRow[];

  const all = rows.map(toRow);
  // Admission is now driven by campaign, not priority.
  const reviewQueue = all.filter((r) => r.primaryCampaign !== 'REJECT');
  const rejected = all.filter((r) => r.primaryCampaign === 'REJECT');

  const priorityCounts: Record<Priority, number> = { A: 0, B: 0, C: 0, Reject: 0 };
  for (const r of all) priorityCounts[r.priority] += 1;

  const campaignCounts: Record<Campaign, number> = {
    AI_AUTOMATION: 0,
    WEB_REBUILD: 0,
    FUNNEL_OPTIMIZATION: 0,
    LOCAL_DIGITAL_UPGRADE: 0,
    LOW_PRIORITY_NURTURE: 0,
    REJECT: 0,
  };
  const byCampaign: Record<Campaign, ReviewQueueRow[]> = {
    AI_AUTOMATION: [],
    WEB_REBUILD: [],
    FUNNEL_OPTIMIZATION: [],
    LOCAL_DIGITAL_UPGRADE: [],
    LOW_PRIORITY_NURTURE: [],
    REJECT: [],
  };
  for (const r of all) {
    campaignCounts[r.primaryCampaign] += 1;
    byCampaign[r.primaryCampaign].push(r);
  }

  const sourceRuns: SourceRunSummary[] = getRecentSourceRuns(20, db).map((r) => {
    let errors: string[] = [];
    if (r.errors_json) {
      try {
        const parsed = JSON.parse(r.errors_json);
        if (Array.isArray(parsed)) errors = parsed.map(String);
      } catch {
        errors = [r.errors_json];
      }
    }
    const startedMs = new Date(r.started_at).getTime();
    const completedMs = r.completed_at ? new Date(r.completed_at).getTime() : null;
    return {
      id: r.id,
      source: r.source,
      status: r.status,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      durationMs: completedMs ? completedMs - startedMs : null,
      leadsFound: r.leads_found,
      leadsAccepted: r.leads_accepted,
      leadsRejected: r.leads_rejected,
      apiCalls: r.api_calls,
      errors,
    };
  });

  // Verified signals per company (only those that came from inspection).
  const verifiedRows = db
    .prepare(
      `SELECT company_id, type, value, confidence
         FROM signals
        WHERE source = 'website_inspection'
        ORDER BY created_at DESC`,
    )
    .all() as Array<{
    company_id: string;
    type: string;
    value: string;
    confidence: number;
  }>;

  const verifiedSignalsByCompany: Record<string, LeadVerifiedSignal[]> = {};
  for (const r of verifiedRows) {
    (verifiedSignalsByCompany[r.company_id] ??= []).push({
      type: r.type,
      value: r.value,
      confidence: r.confidence,
    });
  }

  const inspectionStats = getInspectionStats(db);
  const distinctCompanyTypes = (predicate: (t: string) => boolean) =>
    new Set(
      verifiedRows
        .filter((r) => predicate(r.type))
        .map((r) => r.company_id),
    ).size;

  const inspection: InspectionCounts = {
    inspected: inspectionStats.inspected,
    failed: inspectionStats.failed,
    highAutomationFit: distinctCompanyTypes(
      (t) => t === 'verified.high_automation_fit',
    ),
    withContactForm: distinctCompanyTypes(
      (t) => t === 'verified.has_contact_form',
    ),
    withBookingLink: distinctCompanyTypes(
      (t) => t === 'verified.has_booking_link',
    ),
    aiProvider: distinctCompanyTypes(
      (t) => t === 'verified.has_ai_automation_language',
    ),
  };

  // ---- AI analyses: latest row per company --------------------------------
  const aiRows = db
    .prepare(
      `SELECT a.*
         FROM ai_analyses a
        WHERE a.id IN (
          SELECT id FROM ai_analyses a2
           WHERE a2.company_id = a.company_id
           ORDER BY a2.created_at DESC LIMIT 1
        )
        ORDER BY a.created_at DESC`,
    )
    .all() as Array<{
    id: string;
    company_id: string;
    summary: string | null;
    confidence: number | null;
    operational_pain_points_json: string | null;
    automation_opportunities_json: string | null;
    likely_buyer_json: string | null;
    urgency_json: string | null;
    proof_angles_json: string | null;
    risks_json: string | null;
    ai_provider: string;
    model: string;
    tokens_input: number;
    tokens_cached: number;
    tokens_output: number;
    estimated_cost: number;
    feedback_status: string;
    status: string;
    created_at: string;
  }>;

  const aiByCompany: Record<string, AiAnalysisPanel> = {};
  for (const r of aiRows) {
    if (r.status !== 'ok' || !r.summary) continue;
    try {
      aiByCompany[r.company_id] = {
        id: r.id,
        summary: r.summary,
        confidence: r.confidence ?? 0,
        operationalPainPoints: r.operational_pain_points_json
          ? JSON.parse(r.operational_pain_points_json)
          : [],
        automationOpportunities: r.automation_opportunities_json
          ? JSON.parse(r.automation_opportunities_json)
          : [],
        likelyBuyer: r.likely_buyer_json
          ? JSON.parse(r.likely_buyer_json)
          : { role: '', reasoning: '', confidence: 0 },
        urgency: r.urgency_json
          ? JSON.parse(r.urgency_json)
          : { level: 'low', reasoning: '' },
        proofAngles: r.proof_angles_json ? JSON.parse(r.proof_angles_json) : [],
        risks: r.risks_json ? JSON.parse(r.risks_json) : [],
        provider: r.ai_provider,
        model: r.model,
        tokensInput: r.tokens_input,
        tokensCached: r.tokens_cached,
        tokensOutput: r.tokens_output,
        estimatedCost: r.estimated_cost,
        feedbackStatus: r.feedback_status,
        createdAt: r.created_at,
      };
    } catch {
      // skip malformed rows
    }
  }

  const aiStats = getAiAnalysisStats(db);
  const aiOverview: AiOverview = {
    total: aiStats.total,
    ok: aiStats.ok,
    failed: aiStats.failed,
    todayCostUsd: aiStats.todayCostUsd,
    totalCostUsd: aiStats.totalCostUsd,
    dailyLimitUsd: config.aiAnalysis.dailyCostLimitUsd,
    feedback: aiStats.feedback,
  };

  // ---- Validation overview ------------------------------------------------
  const campaignMetrics = computeCampaignMetrics(db);
  const sourceQuality = computeSourceQuality(db);
  const topReasons = computeTopReasons(db);
  const reviewTotals = computeReviewTotals(db);
  const falseRejectCandidates = detectCandidateFalseRejects([...reviewQueue, ...rejected]);
  const latestReviews = getLatestReviewByCompany(db);
  const reviewByCompany: Record<string, string> = {};
  for (const [companyId, review] of latestReviews) {
    reviewByCompany[companyId] = review.review_type;
  }

  return {
    totals: {
      processed: all.length,
      accepted: reviewQueue.length,
      rejected: rejected.length,
    },
    priorityCounts,
    campaignCounts,
    byCampaign,
    reviewQueue,
    rejected,
    sourceRuns,
    inspection,
    verifiedSignalsByCompany,
    aiByCompany,
    ai: aiOverview,
    validation: {
      campaignMetrics,
      sourceQuality,
      topReasons: topReasons.byCampaign,
      topRejectionReasons: topReasons.trueRejections,
      falseRejectCandidates,
      reviewTotals,
      reviewByCompany,
    },
  };
}
