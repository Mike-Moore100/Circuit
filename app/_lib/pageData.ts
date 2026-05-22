// Per-page data fetchers. Each one returns the minimal slice its page
// needs, so a single page never pays for the full dashboard payload.
// The full getDashboardData() helper in dashboardData.ts is still used
// by Overview + Opportunities; everything else uses the focused helpers
// here.

import { config } from '../../src/config/index';
import { getDb } from '../../src/db/client';
import {
  getAiAnalysisStats,
  getDiscoveryStats,
  getInspectionStats,
  getQualificationQueueStats,
  listDiscoveryRuns,
  listOpportunityIntelligence,
  listQualificationQueue,
} from '../../src/db/repository';
import { buildLearningReport } from '../../src/learning/buildReport';
import type { Campaign } from '../../src/scoring/campaignTypes';

// ---------------------------------------------------------------------------
// Overview — compact pipeline summary
// ---------------------------------------------------------------------------
export function getOverviewData() {
  const db = getDb();
  const discovery = getDiscoveryStats(db);
  const qual = getQualificationQueueStats(db);
  const inspection = getInspectionStats(db);
  const aiRaw = getAiAnalysisStats(db);
  const ai = {
    ...aiRaw,
    dailyLimitUsd: config.aiAnalysis.dailyCostLimitUsd,
  };
  const reviewQueue = (db
    .prepare(
      `SELECT COUNT(*) AS n FROM review_queue WHERE status NOT IN ('rejected','archived')`,
    )
    .get() as { n: number }).n;
  const totalCompanies = (db
    .prepare(`SELECT COUNT(*) AS n FROM companies`)
    .get() as { n: number }).n;
  const topOpps = listOpportunityIntelligence(db, { limit: 5 });
  return {
    discovery,
    qualification: qual,
    inspection,
    ai,
    reviewQueue,
    totalCompanies,
    topOpps,
  };
}

// ---------------------------------------------------------------------------
// Discovery page
// ---------------------------------------------------------------------------
export function getDiscoveryPageData() {
  const db = getDb();
  return {
    stats: getDiscoveryStats(db),
    recentRuns: listDiscoveryRuns(db, 10),
  };
}

// ---------------------------------------------------------------------------
// Qualification page — covers inspection + contact discovery + evidence
// ---------------------------------------------------------------------------
export function getQualificationPageData() {
  const db = getDb();
  const inspectionBase = getInspectionStats(db);
  // Extra inspection signals — count distinct companies that have each
  // verified.* signal type in the signals table.
  const sigCount = (type: string): number => {
    const row = db
      .prepare(
        `SELECT COUNT(DISTINCT company_id) AS n FROM signals WHERE type = ?`,
      )
      .get(type) as { n: number };
    return row.n;
  };
  const inspection = {
    ...inspectionBase,
    working: sigCount('verified.has_working_website'),
    withContactForm: sigCount('verified.has_contact_form'),
    withBookingLink: sigCount('verified.has_booking_link'),
    aiProvider: sigCount('verified.has_ai_automation_language'),
  };
  const contacts = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN email IS NOT NULL THEN 1 ELSE 0 END) AS withEmail,
      SUM(CASE WHEN email_status = 'extracted' THEN 1 ELSE 0 END) AS extractedEmail,
      SUM(CASE WHEN email_status = 'guessed' THEN 1 ELSE 0 END) AS guessedEmail,
      SUM(CASE WHEN source = 'playwright' THEN 1 ELSE 0 END) AS playwrightContacts
    FROM contacts
  `).get() as {
    total: number;
    withEmail: number;
    extractedEmail: number;
    guessedEmail: number;
    playwrightContacts: number;
  };
  const evidence = db.prepare(`
    SELECT
      COUNT(DISTINCT company_id) AS companies,
      SUM(CASE WHEN evidence_type = 'summary' AND screenshot_path IS NOT NULL THEN 1 ELSE 0 END) AS desktopShots,
      SUM(CASE WHEN evidence_type = 'summary' AND mobile_screenshot_path IS NOT NULL THEN 1 ELSE 0 END) AS mobileShots,
      SUM(CASE WHEN evidence_type LIKE 'visual.%' THEN 1 ELSE 0 END) AS visualIssues,
      SUM(CASE WHEN evidence_type LIKE 'operational.%' THEN 1 ELSE 0 END) AS operationalClues
    FROM lead_evidence
  `).get() as {
    companies: number;
    desktopShots: number;
    mobileShots: number;
    visualIssues: number;
    operationalClues: number;
  };
  const qualification = getQualificationQueueStats(db);
  return { inspection, contacts, evidence, qualification };
}

// ---------------------------------------------------------------------------
// Campaigns page — per-campaign breakdown
// ---------------------------------------------------------------------------
export function getCampaignsPageData() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      ls.primary_campaign AS campaign,
      COUNT(*) AS total,
      AVG(ls.final_score) AS avg_score,
      AVG(oi.opportunity_score) AS avg_opp,
      SUM(CASE WHEN oi.human_attention_priority = 'IMMEDIATE' THEN 1 ELSE 0 END) AS immediate,
      SUM(CASE WHEN oi.human_attention_priority = 'HIGH' THEN 1 ELSE 0 END) AS high,
      SUM(CASE WHEN oi.human_attention_priority = 'MEDIUM' THEN 1 ELSE 0 END) AS medium
    FROM lead_scores ls
    JOIN companies c ON c.id = ls.company_id
    LEFT JOIN opportunity_intelligence oi ON oi.company_id = c.id
    WHERE c.status NOT IN ('rejected','archived')
    GROUP BY ls.primary_campaign
  `).all() as Array<{
    campaign: Campaign | null;
    total: number;
    avg_score: number | null;
    avg_opp: number | null;
    immediate: number;
    high: number;
    medium: number;
  }>;
  return { campaigns: rows };
}

// ---------------------------------------------------------------------------
// Review page
// ---------------------------------------------------------------------------
export function getReviewPageData() {
  const db = getDb();
  const learning = buildLearningReport(db);
  const rejected = db.prepare(`
    SELECT c.name, c.industry, c.location, ls.final_score, ls.primary_campaign
    FROM lead_scores ls
    JOIN companies c ON c.id = ls.company_id
    WHERE ls.primary_campaign = 'REJECT'
       OR ls.priority = 'Reject'
    ORDER BY ls.created_at DESC
    LIMIT 25
  `).all() as Array<{
    name: string;
    industry: string | null;
    location: string | null;
    final_score: number;
    primary_campaign: string | null;
  }>;
  return { learning, rejected };
}

// ---------------------------------------------------------------------------
// Intelligence page
// ---------------------------------------------------------------------------
export function getIntelligencePageData() {
  const db = getDb();
  const rows = listOpportunityIntelligence(db, { limit: 100 });
  return { intelligence: rows };
}

// ---------------------------------------------------------------------------
// Sources page
// ---------------------------------------------------------------------------
export function getSourcesPageData() {
  const db = getDb();
  const recent = db
    .prepare(
      `SELECT * FROM source_runs ORDER BY started_at DESC LIMIT 20`,
    )
    .all() as Array<{
    id: string;
    source: string;
    status: string;
    started_at: string;
    completed_at: string | null;
    leads_found: number;
    leads_accepted: number;
    leads_rejected: number;
    api_calls: number;
  }>;
  const discoveryStats = getDiscoveryStats(db);
  return { recent, discoveryStats };
}

// ---------------------------------------------------------------------------
// Queue Monitor page
// ---------------------------------------------------------------------------
export function getQueuePageData() {
  const db = getDb();
  const stats = getQualificationQueueStats(db);
  const pending = listQualificationQueue({ status: 'PENDING', limit: 30 }, db);
  const processing = listQualificationQueue({ status: 'PROCESSING', limit: 30 }, db);
  const failed = listQualificationQueue({ status: 'FAILED', limit: 20 }, db);
  return { stats, pending, processing, failed };
}
