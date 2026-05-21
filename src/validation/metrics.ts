import type { Database } from 'better-sqlite3';
import { getDb } from '../db/client';
import { countReviewsByType, getLatestReviewByCompany } from '../db/repository';
import {
  CAMPAIGN_VALUES,
  type Campaign,
} from '../scoring/campaignTypes';
import { REVIEW_TYPES, type CampaignMetric, type ReviewType, type SourceQuality, type TopReason } from './types';

interface LatestScoreRow {
  company_id: string;
  final_score: number;
  primary_campaign: Campaign | null;
  campaign_reasons_json: string | null;
}

function fetchLatestScores(db: Database): LatestScoreRow[] {
  return db
    .prepare(
      `WITH latest AS (
         SELECT company_id, MAX(created_at) AS created_at
           FROM lead_scores
          GROUP BY company_id
       )
       SELECT s.company_id, s.final_score, s.primary_campaign,
              s.campaign_reasons_json
         FROM lead_scores s
         JOIN latest l ON l.company_id = s.company_id
                      AND l.created_at = s.created_at`,
    )
    .all() as LatestScoreRow[];
}

interface CompanyMeta {
  id: string;
  source: string;
}

function fetchCompanyMeta(db: Database): Map<string, CompanyMeta> {
  const rows = db
    .prepare('SELECT id, source FROM companies').all() as CompanyMeta[];
  const map = new Map<string, CompanyMeta>();
  for (const r of rows) map.set(r.id, r);
  return map;
}

function emptyReviewCounts(): Record<ReviewType, number> {
  const out: Record<string, number> = {};
  for (const t of REVIEW_TYPES) out[t] = 0;
  return out as Record<ReviewType, number>;
}

function emptyCampaignCounts(): Record<Campaign, number> {
  const out: Record<string, number> = {};
  for (const c of CAMPAIGN_VALUES) out[c] = 0;
  return out as Record<Campaign, number>;
}

function rate(numer: number, denom: number): number | null {
  if (denom === 0) return null;
  return numer / denom;
}

// ---------------------------------------------------------------------------
// Per-campaign metrics: count + avg score + reviewer feedback breakdown.
// ---------------------------------------------------------------------------
export function computeCampaignMetrics(db: Database = getDb()): CampaignMetric[] {
  const scores = fetchLatestScores(db);
  const reviews = getLatestReviewByCompany(db);

  const byCampaign = new Map<Campaign, LatestScoreRow[]>();
  for (const row of scores) {
    const c: Campaign = row.primary_campaign ?? 'LOW_PRIORITY_NURTURE';
    if (!byCampaign.has(c)) byCampaign.set(c, []);
    byCampaign.get(c)!.push(row);
  }

  const result: CampaignMetric[] = [];
  for (const campaign of CAMPAIGN_VALUES) {
    const rows = byCampaign.get(campaign) ?? [];
    const total = rows.length;
    const avgFinalScore = total > 0
      ? Math.round(rows.reduce((s, r) => s + r.final_score, 0) / total)
      : 0;
    const reviewCounts = emptyReviewCounts();
    let reviewedTotal = 0;
    for (const r of rows) {
      const review = reviews.get(r.company_id);
      if (!review) continue;
      const type = review.review_type as ReviewType;
      if (!(type in reviewCounts)) continue;
      reviewCounts[type] += 1;
      reviewedTotal += 1;
    }
    result.push({
      campaign,
      total,
      avgFinalScore,
      reviewCounts,
      reviewedTotal,
      falseRejectRate: rate(reviewCounts.false_reject, reviewedTotal),
      falsePositiveRate: rate(reviewCounts.false_positive, reviewedTotal),
      correctRate: rate(reviewCounts.correct_campaign, reviewedTotal),
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Per-source quality: how often each source produces actionable leads.
// ---------------------------------------------------------------------------
export function computeSourceQuality(db: Database = getDb()): SourceQuality[] {
  const scores = fetchLatestScores(db);
  const companies = fetchCompanyMeta(db);
  const reviews = getLatestReviewByCompany(db);
  const inspectionRows = db
    .prepare(
      `SELECT company_id, status FROM website_inspections
        WHERE company_id IS NOT NULL`,
    )
    .all() as Array<{ company_id: string; status: string }>;
  const inspectionByCompany = new Map<string, string>();
  for (const r of inspectionRows) inspectionByCompany.set(r.company_id, r.status);

  const bySource = new Map<string, LatestScoreRow[]>();
  for (const s of scores) {
    const meta = companies.get(s.company_id);
    const source = meta?.source ?? 'unknown';
    if (!bySource.has(source)) bySource.set(source, []);
    bySource.get(source)!.push(s);
  }

  const result: SourceQuality[] = [];
  for (const [source, rows] of bySource) {
    const byCampaign = emptyCampaignCounts();
    let inspected = 0;
    let inspectionFailed = 0;
    let strong = 0;
    let reviewedRejects = 0;
    let sumScore = 0;
    for (const r of rows) {
      const campaign: Campaign = r.primary_campaign ?? 'LOW_PRIORITY_NURTURE';
      byCampaign[campaign] += 1;
      sumScore += r.final_score;
      const inspection = inspectionByCompany.get(r.company_id);
      if (inspection) {
        inspected += 1;
        if (inspection !== 'ok' && inspection !== 'cached') inspectionFailed += 1;
      }
      const review = reviews.get(r.company_id);
      if (review?.review_type === 'strong_opportunity') strong += 1;
      if (review?.review_type === 'false_reject') reviewedRejects += 1;
    }
    result.push({
      source,
      totalLeads: rows.length,
      byCampaign,
      avgFinalScore: rows.length > 0 ? Math.round(sumScore / rows.length) : 0,
      inspectionFailureRate:
        inspected > 0 ? inspectionFailed / inspected : null,
      strongOpportunities: strong,
      reviewedRejects,
    });
  }
  result.sort((a, b) => b.totalLeads - a.totalLeads);
  return result;
}

// ---------------------------------------------------------------------------
// Top reasons — most-frequent positive contributions across each campaign,
// and most-frequent true-rejection reasons across the whole dataset.
// ---------------------------------------------------------------------------
interface CampaignReasonsJsonShape {
  reasons?: Partial<Record<Campaign, Array<{ code: string; label: string; delta: number }>>>;
  trueRejectionReasons?: Array<{ code: string; label: string; delta: number }>;
}

function aggregateReasons(
  entries: Array<{ code: string; label: string; delta: number }>,
): TopReason[] {
  const map = new Map<string, TopReason>();
  for (const e of entries) {
    const existing = map.get(e.code);
    if (existing) {
      existing.count += 1;
      existing.totalDelta += e.delta;
    } else {
      map.set(e.code, { code: e.code, label: e.label, count: 1, totalDelta: e.delta });
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => Math.abs(b.totalDelta) - Math.abs(a.totalDelta),
  );
}

export function computeTopReasons(db: Database = getDb()): {
  byCampaign: Record<Campaign, TopReason[]>;
  trueRejections: TopReason[];
} {
  const scores = fetchLatestScores(db);
  const byCampaignReasons: Record<Campaign, Array<{ code: string; label: string; delta: number }>> = {
    AI_AUTOMATION: [],
    WEB_REBUILD: [],
    FUNNEL_OPTIMIZATION: [],
    LOCAL_DIGITAL_UPGRADE: [],
    LOW_PRIORITY_NURTURE: [],
    REJECT: [],
  };
  const trueRejections: Array<{ code: string; label: string; delta: number }> = [];

  for (const row of scores) {
    if (!row.campaign_reasons_json) continue;
    let parsed: CampaignReasonsJsonShape | null = null;
    try {
      parsed = JSON.parse(row.campaign_reasons_json) as CampaignReasonsJsonShape;
    } catch {
      continue;
    }
    if (parsed.reasons) {
      const primary: Campaign = row.primary_campaign ?? 'LOW_PRIORITY_NURTURE';
      const list = parsed.reasons[primary] ?? [];
      for (const r of list) {
        if (r.delta > 0) byCampaignReasons[primary].push(r);
      }
    }
    if (parsed.trueRejectionReasons) {
      for (const r of parsed.trueRejectionReasons) trueRejections.push(r);
    }
  }

  const byCampaign = {} as Record<Campaign, TopReason[]>;
  for (const c of CAMPAIGN_VALUES) {
    byCampaign[c] = aggregateReasons(byCampaignReasons[c]).slice(0, 5);
  }
  return {
    byCampaign,
    trueRejections: aggregateReasons(trueRejections).slice(0, 5),
  };
}

// ---------------------------------------------------------------------------
// Review totals — for dashboard headline metrics.
// ---------------------------------------------------------------------------
export function computeReviewTotals(db: Database = getDb()): Record<ReviewType, number> {
  const counts = countReviewsByType(db);
  const out = emptyReviewCounts();
  for (const t of REVIEW_TYPES) {
    out[t] = counts[t] ?? 0;
  }
  return out;
}
