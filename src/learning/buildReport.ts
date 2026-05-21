// Orchestrator for the learning layer — single call returns the full
// LearningReport so dashboards / CLIs / API surfaces have one entry point.

import type { Database } from 'better-sqlite3';
import { getDb } from '../db/client';
import { REVIEW_TYPES, type ReviewType } from '../validation/types';
import { deriveInsights } from './operatorFeedbackInsights';
import { analyzeReviewPatterns } from './reviewPatternAnalysis';
import { suggestCalibrations } from './scoringCalibration';
import type { LearningReport } from './learningTypes';

export function buildLearningReport(db: Database = getDb()): LearningReport {
  const patterns = analyzeReviewPatterns(db);
  const suggestions = suggestCalibrations(patterns);
  const insights = deriveInsights(patterns);
  const counts = db
    .prepare(
      `SELECT review_type AS t, COUNT(*) AS n FROM lead_reviews GROUP BY review_type`,
    )
    .all() as Array<{ t: ReviewType; n: number }>;
  const reviewCounts = Object.fromEntries(
    REVIEW_TYPES.map((rt) => [rt, 0]),
  ) as Record<ReviewType, number>;
  for (const c of counts) reviewCounts[c.t] = c.n;
  const totalReviews = counts.reduce((a, b) => a + b.n, 0);
  return {
    generatedAt: new Date().toISOString(),
    totalReviews,
    reviewCounts,
    patterns,
    suggestions,
    insights,
  };
}
