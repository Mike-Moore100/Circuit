// Calibration service — builds the snapshot, persists insights +
// per-signal performance, returns the full report. Same ServiceResult /
// ProgressCallback shape every other Circuit service uses.

import type { Database } from 'better-sqlite3';
import { getDb } from '../db/client';
import {
  clearCalibrationInsights,
  fetchReviewedLeadsForCalibration,
  insertCalibrationInsight,
  listCalibrationInsights,
  listSignalPerformance,
  upsertSignalPerformance,
} from '../db/repository';
import { detectAllPatterns } from '../calibration/patternDetection';
import { deriveInsights } from '../calibration/scoringInsights';
import { suggestCalibrations } from '../calibration/calibrationSuggestions';
import { computeScoringDrift } from '../calibration/scoringDrift';
import type {
  CalibrationSnapshot,
} from '../calibration/calibrationTypes';
import { REVIEW_TYPES, type ReviewType } from '../validation/types';
import {
  makeResult,
  NOOP_PROGRESS,
  type ProgressCallback,
  type ServiceResult,
} from './types';

export interface CalibrationServiceOptions {
  onProgress?: ProgressCallback;
  db?: Database;
}

export async function runCalibrationAnalysis(
  options: CalibrationServiceOptions = {},
): Promise<ServiceResult<never, { insights: number; signals: number; reviews: number }>> {
  const startedAt = new Date();
  const db = options.db ?? getDb();
  const onProgress = options.onProgress ?? NOOP_PROGRESS;

  onProgress({
    level: 'info',
    code: 'calibration.start',
    message: 'fetching reviewed leads',
  });

  const rows = fetchReviewedLeadsForCalibration(db);
  const detection = detectAllPatterns(rows);
  const insights = deriveInsights(detection);
  const suggestions = suggestCalibrations(detection);
  const drift = computeScoringDrift(rows);

  onProgress({
    level: 'info',
    code: 'calibration.detected',
    message: `${detection.signals.length} signals · ${detection.opportunityPatterns.length} patterns · ${detection.trustBarrierPatterns.length} trust patterns`,
  });

  // Persist insights — wipe and replace, no history yet (snapshots can
  // come later if the operator asks for time-series).
  clearCalibrationInsights(db);
  for (const i of insights) {
    insertCalibrationInsight(
      {
        type: i.type,
        title: i.title,
        description: i.description,
        confidence: i.confidence,
        evidence: i.evidence,
      },
      db,
    );
  }

  // Per-signal performance — upsert all rows that had any review activity.
  for (const s of detection.signals) {
    upsertSignalPerformance(
      {
        signalName: s.signalName,
        reviewedCount: s.reviewedCount,
        positiveOutcomes: s.positiveOutcomes,
        negativeOutcomes: s.negativeOutcomes,
        falsePositiveCount: s.falsePositiveCount,
        falseRejectCount: s.falseRejectCount,
        precision: s.precision,
        confidence: s.confidence,
      },
      db,
    );
  }

  onProgress({
    level: 'success',
    code: 'calibration.done',
    message: `persisted ${insights.length} insights, ${detection.signals.length} signal-perf rows, ${suggestions.length} suggestions`,
  });

  // Build the in-memory snapshot the caller actually wants.
  const reviewCounts = Object.fromEntries(
    REVIEW_TYPES.map((t) => [t, 0]),
  ) as Record<ReviewType, number>;
  for (const r of rows) {
    reviewCounts[r.review_type as ReviewType] =
      (reviewCounts[r.review_type as ReviewType] ?? 0) + 1;
  }

  // (Snapshot returned in items for completeness; CLI / page can read
  // it via getCalibrationOverview below.)
  const snapshot: CalibrationSnapshot = {
    generatedAt: startedAt.toISOString(),
    totalReviews: rows.length,
    reviewCounts,
    signalPerformance: detection.signals,
    opportunityPatterns: detection.opportunityPatterns,
    trustBarrierPatterns: detection.trustBarrierPatterns,
    insights,
    suggestions,
    drift,
  };
  (snapshot as CalibrationSnapshot & { ok?: boolean }).ok = true;

  return makeResult({
    ok: true,
    startedAt,
    stats: {
      insights: insights.length,
      signals: detection.signals.length,
      reviews: rows.length,
    },
    errors: [],
  });
}

// Read-only — used by the dashboard + CLI.
export function getCalibrationOverview(
  db: Database = getDb(),
): CalibrationSnapshot {
  const rows = fetchReviewedLeadsForCalibration(db);
  const detection = detectAllPatterns(rows);
  const insights = deriveInsights(detection);
  const suggestions = suggestCalibrations(detection);
  const drift = computeScoringDrift(rows);
  const reviewCounts = Object.fromEntries(
    REVIEW_TYPES.map((t) => [t, 0]),
  ) as Record<ReviewType, number>;
  for (const r of rows) {
    reviewCounts[r.review_type as ReviewType] =
      (reviewCounts[r.review_type as ReviewType] ?? 0) + 1;
  }
  return {
    generatedAt: new Date().toISOString(),
    totalReviews: rows.length,
    reviewCounts,
    signalPerformance: detection.signals,
    opportunityPatterns: detection.opportunityPatterns,
    trustBarrierPatterns: detection.trustBarrierPatterns,
    insights,
    suggestions,
    drift,
  };
}

// Read persisted rows (last run) — for an API surface that doesn't
// want to recompute every request.
export function getPersistedCalibration(db: Database = getDb()): {
  insights: ReturnType<typeof listCalibrationInsights>;
  signals: ReturnType<typeof listSignalPerformance>;
} {
  return {
    insights: listCalibrationInsights(db, 50),
    signals: listSignalPerformance(db, 80),
  };
}
