import { getDb } from '../../src/db/client';
import type {
  Company,
  Priority,
  ReviewQueueRow,
  ScoreReason,
} from '../../src/types';

interface RawJoinedRow extends Company {
  rule_score: number | null;
  intent_score: number | null;
  final_score: number | null;
  priority: Priority | null;
  reasons_json: string | null;
  review_status: string | null;
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

export interface DashboardData {
  totals: { processed: number; accepted: number; rejected: number };
  priorityCounts: Record<Priority, number>;
  reviewQueue: ReviewQueueRow[];
  rejected: ReviewQueueRow[];
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

function toRow(raw: RawJoinedRow): ReviewQueueRow {
  const parsed = parseReasons(raw.reasons_json);
  const reasons = parsed
    ? [...parsed.rule.reasons, ...parsed.intent.reasons]
    : ([] as ScoreReason[]);
  const rejectionReasons = parsed?.rule.rejectionReasons ?? [];
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
    status: (raw.review_status as ReviewQueueRow['status']) ?? 'rejected',
    reasons,
    rejectionReasons,
    likelyPainPoints: inferPainPoints(reasons),
    suggestedNextStep: nextStep(raw.priority ?? 'Reject', raw.website_url ?? null),
    updatedAt: raw.updated_at,
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
              s.rule_score    AS rule_score,
              s.intent_score  AS intent_score,
              s.final_score   AS final_score,
              s.priority      AS priority,
              s.reasons_json  AS reasons_json,
              r.status        AS review_status
         FROM companies c
         LEFT JOIN latest l        ON l.company_id = c.id
         LEFT JOIN lead_scores s   ON s.company_id = c.id AND s.created_at = l.created_at
         LEFT JOIN review_queue r  ON r.company_id = c.id
        ORDER BY COALESCE(s.final_score, 0) DESC`,
    )
    .all() as RawJoinedRow[];

  const all = rows.map(toRow);
  const reviewQueue = all.filter((r) => r.priority !== 'Reject');
  const rejected = all.filter((r) => r.priority === 'Reject');

  const priorityCounts: Record<Priority, number> = { A: 0, B: 0, C: 0, Reject: 0 };
  for (const r of all) priorityCounts[r.priority] += 1;

  return {
    totals: {
      processed: all.length,
      accepted: reviewQueue.length,
      rejected: rejected.length,
    },
    priorityCounts,
    reviewQueue,
    rejected,
  };
}
