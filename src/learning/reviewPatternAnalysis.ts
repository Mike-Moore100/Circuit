// Pure analysis over the lead_reviews + opportunity_intelligence + lead_scores
// tables. Surfaces patterns the operator has implicitly taught the system.
// No auto-adjustment — surfaces only.

import type { Database } from 'better-sqlite3';
import { getDb } from '../db/client';
import type { Campaign } from '../scoring/campaignTypes';
import type { ReviewType } from '../validation/types';
import type { ReviewPattern } from './learningTypes';

interface ReviewWithContext {
  review_type: ReviewType;
  previous_campaign: Campaign;
  company_id: string;
  company_name: string;
  opportunity_score: number | null;
  final_score: number | null;
}

function fetchReviewsWithContext(db: Database): ReviewWithContext[] {
  return db
    .prepare(
      `SELECT
         lr.review_type        AS review_type,
         lr.previous_campaign  AS previous_campaign,
         c.id                  AS company_id,
         c.name                AS company_name,
         oi.opportunity_score  AS opportunity_score,
         ls.final_score        AS final_score
       FROM lead_reviews lr
       JOIN companies c ON c.id = lr.company_id
       LEFT JOIN opportunity_intelligence oi ON oi.company_id = c.id
       LEFT JOIN (
         SELECT company_id, final_score, ROW_NUMBER() OVER
           (PARTITION BY company_id ORDER BY created_at DESC) AS rn
         FROM lead_scores
       ) ls ON ls.company_id = c.id AND ls.rn = 1
       ORDER BY lr.created_at DESC`,
    )
    .all() as ReviewWithContext[];
}

export function analyzeReviewPatterns(db: Database = getDb()): ReviewPattern[] {
  const rows = fetchReviewsWithContext(db);
  const buckets = new Map<string, ReviewWithContext[]>();
  for (const r of rows) {
    // Skip rows where the operator didn't actually disagree with the system
    // (those still contribute to counts but the "pattern" is "system was right",
    // which doesn't need re-tuning).
    const key = `${r.review_type}::${r.previous_campaign}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(r);
  }

  const patterns: ReviewPattern[] = [];
  for (const [key, items] of buckets) {
    const [reviewType, previousCampaign] = key.split('::') as [
      ReviewType,
      Campaign,
    ];
    if (items.length === 0) continue;
    const oppScores = items
      .map((i) => i.opportunity_score)
      .filter((x): x is number => typeof x === 'number');
    const finalScores = items
      .map((i) => i.final_score)
      .filter((x): x is number => typeof x === 'number');
    patterns.push({
      reviewType,
      previousCampaign,
      count: items.length,
      sampleCompanies: items.slice(0, 5).map((i) => i.company_name),
      avgOpportunityScore: oppScores.length
        ? Math.round(oppScores.reduce((a, b) => a + b, 0) / oppScores.length)
        : 0,
      avgFinalScore: finalScores.length
        ? Math.round(finalScores.reduce((a, b) => a + b, 0) / finalScores.length)
        : 0,
    });
  }

  // Most-frequent patterns first
  patterns.sort((a, b) => b.count - a.count);
  return patterns;
}
