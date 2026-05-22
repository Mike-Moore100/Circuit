import { config } from '../../src/config/index';
import { getDb } from '../../src/db/client';
import {
  getAiAnalysisStats,
  getContactRoutesForCompany,
  getContactsForCompany,
  getDiscoveryStats,
  getEvidenceForCompany,
  getInspectionStats,
  getLatestReviewByCompany,
  getOpportunityIntelligence,
  getReviewTagsByCompany,
  getQualificationQueueStats,
  getRecentSourceRuns,
  listDiscoveryRuns,
  listOpportunityIntelligence,
  listQualificationQueue,
} from '../../src/db/repository';
import type { OpportunityIntelligence } from '../../src/intelligence/intelligenceTypes';
import { topWhyNow, type WhyNowSignal } from '../../src/intelligence/whyNowReasoning';
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

export interface LeadContact {
  name: string | null;
  role: string | null;
  email: string | null;
  emailType: string | null;
  emailStatus: string | null;
  linkedinUrl: string | null;
  sourceUrl: string | null;
  // 'static' | 'playwright' | 'guessed' | 'inferred'
  source: string;
  overallConfidence: number;
  isPrimary: boolean;
}

export interface LeadRoute {
  type: string;
  value: string;
  sourceUrl: string | null;
  confidence: number;
}

export interface LeadContactBundle {
  contacts: LeadContact[];
  routes: LeadRoute[];
}

export interface LeadEvidenceSummary {
  capturedAt: string | null;
  evidenceConfidence: number;
  desktopScreenshotPath: string | null;
  mobileScreenshotPath: string | null;
  visualIssues: Array<{
    code: string;
    label: string;
    confidence: number;
    campaign: string;
    detail: string | null;
  }>;
  operationalClues: Array<{
    code: string;
    label: string;
    confidence: number;
    evidence: string[];
  }>;
}

// Phase 10 — opportunity intelligence per lead (drawer)
export function getIntelligenceForLead(companyId: string): OpportunityIntelligence | null {
  const row = getOpportunityIntelligence(companyId, getDb());
  if (!row) return null;
  try {
    return JSON.parse(row.payload_json) as OpportunityIntelligence;
  } catch {
    return null;
  }
}

// Lightweight summary indexed by companyId for the queue rows. Only the
// fields the queue actually surfaces — keeps the response small.
export interface IntelligenceRowSummary {
  opportunityScore: number;
  humanAttentionPriority: string;
  likelyProjectType: string;
  estimatedCommercialPotential: string;
  // Operator-scannable urgency reasons surfaced on the card. Computed
  // deterministically from the full intelligence row + verified signals.
  whyNow: WhyNowSignal[];
  // Sub-scores the card needs as small pills. Keep numerics only so the
  // server payload stays compact; the card formats them.
  operationalPain: number;
  trustBarrier: number;
  buyingReadiness: number;
  accessibility: number;
  topOpportunityReason: string | null;
  topRiskFactor: string | null;
  // The strongest evidence-confidence signal — what we believe most about
  // this lead. Populated from the intelligence orchestrator's already-
  // computed `strongestSignals` list so this stays deterministic.
  strongestEvidence: string | null;
  // The strongest operational pain signal as text (not just a score) —
  // taken from operationalPain.signals[0]. Lets the card name the
  // specific pain rather than just show a number.
  strongestPainSignal: string | null;
  // Likely buyer. Deterministic-first: derived from the primary contact's
  // detected role + name. If AI analysis exists for the company it can
  // override this in the card layer; the summary stays AI-free.
  likelyBuyer: string | null;
}

// Rollup of "is there a usable contact path per company". Cheap aggregate
// query so the cards can show "email / phone / no direct path" without
// fetching the full contact list for every row.
export interface ContactRollupRow {
  hasContact: boolean;
  hasPhone: boolean;
}

// Every operator tag ever applied to each company. Used by the cards to
// show currently-applied tags AND to render the active state on the
// quick-action buttons. We return arrays rather than Sets so the value
// crosses the server → client boundary cleanly.
export function getOperatorTagsByCompany(): Record<string, string[]> {
  const map = getReviewTagsByCompany(getDb());
  const out: Record<string, string[]> = {};
  for (const [companyId, tags] of map) {
    out[companyId] = [...tags];
  }
  return out;
}

// Per-company "likely buyer" label, derived from the primary contact when
// available. Deterministic — no AI required. Format: "Role · Name" or
// "Role" when the name is missing. Returns null when we have nothing
// useful (the card then falls back to AI analysis if any, else "—").
export function getLikelyBuyerByCompany(): Record<string, string> {
  const db = getDb();
  // Prefer is_primary contacts; within that, the highest overall_confidence
  // (so a guessed primary doesn't beat an extracted non-primary). Older
  // contact rows may carry `confidence` but no `overall_confidence`.
  const rows = db
    .prepare(
      `SELECT company_id, name, role,
              COALESCE(overall_confidence, confidence, 0) AS conf,
              is_primary
         FROM contacts
        WHERE role IS NOT NULL OR name IS NOT NULL
        ORDER BY is_primary DESC, conf DESC`,
    )
    .all() as Array<{
    company_id: string;
    name: string | null;
    role: string | null;
    conf: number;
    is_primary: number;
  }>;
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (out[r.company_id]) continue; // first one per company wins
    const parts: string[] = [];
    if (r.role) parts.push(r.role);
    if (r.name) parts.push(r.name);
    if (parts.length === 0) continue;
    out[r.company_id] = parts.join(' · ');
  }
  return out;
}

export function getContactRollupsByCompany(): Record<string, ContactRollupRow> {
  const db = getDb();
  // Has any non-null email — counts emails the operator could actually use.
  const emailRows = db
    .prepare(
      "SELECT DISTINCT company_id FROM contacts WHERE email IS NOT NULL AND email <> ''",
    )
    .all() as Array<{ company_id: string }>;
  const phoneRows = db
    .prepare(
      "SELECT DISTINCT company_id FROM contact_routes WHERE route_type = 'PHONE'",
    )
    .all() as Array<{ company_id: string }>;
  const out: Record<string, ContactRollupRow> = {};
  for (const r of emailRows) {
    out[r.company_id] = { hasContact: true, hasPhone: false };
  }
  for (const r of phoneRows) {
    const existing = out[r.company_id] ?? { hasContact: false, hasPhone: false };
    out[r.company_id] = { hasContact: existing.hasContact, hasPhone: true };
  }
  return out;
}

export function getIntelligenceSummariesByCompany(): Record<string, IntelligenceRowSummary> {
  const db = getDb();
  const rows = listOpportunityIntelligence(db, { limit: 500 });
  const out: Record<string, IntelligenceRowSummary> = {};
  const buyerByCompany = getLikelyBuyerByCompany();

  // We need verified signals + contactability for the why-now computation.
  // Single-query approach keeps this O(1) DB calls instead of O(N).
  const signalRows = db
    .prepare(
      `SELECT company_id, type, value
         FROM signals
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

  // Contactability rolled up cheaply via aggregate queries.
  const formCompanyIds = new Set(
    (db
      .prepare(
        "SELECT DISTINCT company_id FROM signals WHERE type = 'verified.has_contact_form'",
      )
      .all() as Array<{ company_id: string }>).map((r) => r.company_id),
  );
  const bookingCompanyIds = new Set(
    (db
      .prepare(
        "SELECT DISTINCT company_id FROM signals WHERE type = 'verified.has_booking_link'",
      )
      .all() as Array<{ company_id: string }>).map((r) => r.company_id),
  );

  for (const r of rows) {
    let intelligence: OpportunityIntelligence | null = null;
    try {
      intelligence = JSON.parse(r.payload_json) as OpportunityIntelligence;
    } catch {
      // Bad row — surface the basics but skip the derived bits.
    }
    const verified = signalsByCompany.get(r.company_id) ?? [];
    const hasWorkingWebsite = verified.some(
      (s) =>
        s.type === 'verified.website_loads' ||
        s.type === 'verified.has_working_website',
    );
    const whyNow = intelligence
      ? topWhyNow({
          intelligence,
          verifiedSignals: verified,
          hasContactForm: formCompanyIds.has(r.company_id),
          hasBookingLink: bookingCompanyIds.has(r.company_id),
          hasWorkingWebsite,
        })
      : [];
    out[r.company_id] = {
      opportunityScore: r.opportunity_score,
      humanAttentionPriority: r.human_attention_priority,
      likelyProjectType: r.likely_project_type,
      estimatedCommercialPotential: r.estimated_commercial_potential,
      whyNow,
      operationalPain: intelligence?.operationalPain.score ?? 0,
      trustBarrier: intelligence?.trustBarrier.score ?? 0,
      buyingReadiness: intelligence?.buyingReadiness.score ?? 0,
      accessibility: intelligence?.accessibility.score ?? 0,
      topOpportunityReason: intelligence?.opportunityReasons[0] ?? null,
      topRiskFactor: intelligence?.riskFactors[0] ?? null,
      strongestEvidence: intelligence?.strongestSignals[0] ?? null,
      strongestPainSignal: intelligence?.operationalPain.signals[0] ?? null,
      likelyBuyer: buyerByCompany[r.company_id] ?? null,
    };
  }
  return out;
}

export function getEvidenceForLead(companyId: string): LeadEvidenceSummary | null {
  const rows = getEvidenceForCompany(companyId, getDb());
  if (rows.length === 0) return null;
  const summary = rows.find((r) => r.evidence_type === 'summary');
  const visualIssues: LeadEvidenceSummary['visualIssues'] = [];
  const operationalClues: LeadEvidenceSummary['operationalClues'] = [];
  for (const r of rows) {
    if (r.evidence_type.startsWith('visual.')) {
      let meta: { campaign?: string; detail?: string | null } = {};
      try {
        meta = r.metadata_json ? JSON.parse(r.metadata_json) : {};
      } catch { /* ignore */ }
      visualIssues.push({
        code: r.evidence_type.slice('visual.'.length),
        label: r.evidence_summary ?? r.evidence_type,
        confidence: r.confidence,
        campaign: meta.campaign ?? 'ANY',
        detail: meta.detail ?? null,
      });
    } else if (r.evidence_type.startsWith('operational.')) {
      let meta: { evidence?: string[] } = {};
      try {
        meta = r.metadata_json ? JSON.parse(r.metadata_json) : {};
      } catch { /* ignore */ }
      operationalClues.push({
        code: r.evidence_type.slice('operational.'.length),
        label: r.evidence_summary ?? r.evidence_type,
        confidence: r.confidence,
        evidence: meta.evidence ?? [],
      });
    }
  }
  return {
    capturedAt: summary?.created_at ?? null,
    evidenceConfidence: summary?.confidence ?? 0,
    desktopScreenshotPath: summary?.screenshot_path ?? null,
    mobileScreenshotPath: summary?.mobile_screenshot_path ?? null,
    visualIssues,
    operationalClues,
  };
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
  // Phase 11 — top-of-funnel discovery throughput
  discovery: DiscoveryOverview;
  // Phase 12 — Discovery → Qualification queue
  promotion: PromotionOverview;
}

export interface PromotionOverview {
  total: number;
  byStatus: Record<string, number>;
  topPromotionReasons: Array<{ reason: string; count: number }>;
  recent24hPromoted: number;
  recent24hSkipped: number;
  recent24hFailed: number;
  recent: Array<{
    id: string;
    domain: string;
    status: string;
    priority: number;
    promotionReason: string;
    createdAt: string;
  }>;
}

export interface DiscoveryOverview {
  totalRuns: number;
  totalRawFound: number;
  totalValid: number;
  totalDeduped: number;
  totalRejected: number;
  domainsToday: number;
  validToday: number;
  validationPassRateToday: number | null;
  bySource: Record<string, { runs: number; valid: number; rejected: number; deduped: number }>;
  topFailures: Array<{ reason: string; count: number }>;
  recentRuns: Array<{
    id: string;
    source: string;
    startedAt: string;
    completedAt: string | null;
    rawFound: number;
    validDomains: number;
    deduped: number;
    rejected: number;
  }>;
}

// Loaded per-lead (only for the selected drawer lead) to avoid bloating the
// main dashboardData response.
export function getContactsForLead(companyId: string): LeadContactBundle {
  const db = getDb();
  const contacts: LeadContact[] = getContactsForCompany(companyId, db).map((c) => ({
    name: c.name,
    role: c.role,
    email: c.email,
    emailType: c.email_type,
    emailStatus: c.email_status,
    linkedinUrl: c.linkedin_url,
    sourceUrl: c.source_url,
    // 'static' | 'playwright' | 'guessed' | 'inferred' | 'source-feed'.
    // Older rows may carry 'website' (pre-Phase-8.1) — surface as 'static'.
    source: c.source === 'website' ? 'static' : c.source ?? 'static',
    // Legacy Phase-1 contacts only populated `confidence`; fall back so the
    // dashboard doesn't show 0 for a real Founder + email pair.
    overallConfidence: c.overall_confidence ?? c.confidence ?? 0,
    isPrimary: Boolean(c.is_primary),
  }));
  const routes: LeadRoute[] = getContactRoutesForCompany(companyId, db).map(
    (r) => ({
      type: r.route_type,
      value: r.value,
      sourceUrl: r.source_url,
      confidence: r.confidence,
    }),
  );
  return { contacts, routes };
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
    sizeEstimate: raw.size_estimate ?? null,
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

  // Phase 14.1 — restrict to mode-visible companies so the Opportunities
  // view (and everything downstream of getDashboardData) never silently
  // mixes mock/demo data into real-mode operations.
  const { visibleOrigins } = await import('../../src/db/dataMode');
  const origins = visibleOrigins();
  const placeholders = origins.map(() => '?').join(',');
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
        WHERE c.data_origin IN (${placeholders})
        ORDER BY COALESCE(s.final_score, 0) DESC`,
    )
    .all(...origins) as RawJoinedRow[];

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
    discovery: buildDiscoveryOverview(db),
    promotion: buildPromotionOverview(db),
  };
}

function buildPromotionOverview(db: ReturnType<typeof getDb>): PromotionOverview {
  const stats = getQualificationQueueStats(db);
  const rows = listQualificationQueue({ limit: 12 }, db);
  return {
    total: stats.total,
    byStatus: stats.byStatus,
    topPromotionReasons: stats.topPromotionReasons,
    recent24hPromoted: stats.recent24hPromoted,
    recent24hSkipped: stats.recent24hSkipped,
    recent24hFailed: stats.recent24hFailed,
    recent: rows.map((r) => ({
      id: r.id,
      domain: r.domain,
      status: r.status,
      priority: r.priority,
      promotionReason: r.promotion_reason,
      createdAt: r.created_at,
    })),
  };
}

function buildDiscoveryOverview(db: ReturnType<typeof getDb>): DiscoveryOverview {
  const stats = getDiscoveryStats(db);
  const recent = listDiscoveryRuns(db, 8);
  return {
    totalRuns: stats.totalRuns,
    totalRawFound: stats.totalRawFound,
    totalValid: stats.totalValid,
    totalDeduped: stats.totalDeduped,
    totalRejected: stats.totalRejected,
    domainsToday: stats.domainsToday,
    validToday: stats.validToday,
    validationPassRateToday:
      stats.domainsToday > 0 ? stats.validToday / stats.domainsToday : null,
    bySource: stats.bySource,
    topFailures: Object.entries(stats.validationFailures)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count })),
    recentRuns: recent.map((r) => ({
      id: r.id,
      source: r.source,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      rawFound: r.raw_found,
      validDomains: r.valid_domains,
      deduped: r.deduped,
      rejected: r.rejected,
    })),
  };
}
