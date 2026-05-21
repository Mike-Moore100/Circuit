import type { Database } from 'better-sqlite3';
import { getDb } from '../db/client';
import { config } from '../config/index';

// Daily spend = sum(estimated_cost) over rows whose created_at falls on
// today's UTC date. SQLite handles this without TZ libraries by comparing
// the YYYY-MM-DD prefix on the ISO timestamp.
export function getTodaySpendUsd(db: Database = getDb()): number {
  const todayPrefix = new Date().toISOString().slice(0, 10);
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(estimated_cost), 0) AS total
         FROM ai_analyses
        WHERE substr(created_at, 1, 10) = ?`,
    )
    .get(todayPrefix) as { total: number };
  return row.total;
}

export interface BudgetCheck {
  allowed: boolean;
  remainingUsd: number;
  spentTodayUsd: number;
  limitUsd: number;
  reason?: string;
}

export function checkBudgetForCost(
  estimatedCostUsd: number,
  db: Database = getDb(),
): BudgetCheck {
  const limit = config.aiAnalysis.dailyCostLimitUsd;
  const spent = getTodaySpendUsd(db);
  const remaining = limit - spent;
  if (spent >= limit) {
    return {
      allowed: false,
      remainingUsd: 0,
      spentTodayUsd: spent,
      limitUsd: limit,
      reason: `Daily AI cost ceiling reached (spent $${spent.toFixed(4)} of $${limit}).`,
    };
  }
  // We don't know the exact cost until after the call, but we can refuse
  // calls when the headroom is below a conservative estimate of one call.
  if (estimatedCostUsd > 0 && remaining < estimatedCostUsd) {
    return {
      allowed: false,
      remainingUsd: remaining,
      spentTodayUsd: spent,
      limitUsd: limit,
      reason: `Estimated call cost $${estimatedCostUsd.toFixed(4)} exceeds remaining daily budget $${remaining.toFixed(4)}.`,
    };
  }
  return {
    allowed: true,
    remainingUsd: remaining,
    spentTodayUsd: spent,
    limitUsd: limit,
  };
}
