import type { Database } from 'better-sqlite3';
import type {
  CombinedScore,
  RawLead,
  ReviewQueueRow,
  SourceConnector,
  SourceFetchOptions,
} from '../types/index';
import { RawLeadSchema } from '../types/index';
import { config } from '../config/index';
import { getDb } from '../db/client';
import {
  persistScore,
  persistSignals,
  setCompanyStatus,
  upsertCompanyFromLead,
  upsertContactFromLead,
  upsertReviewItem,
} from '../db/repository';
import { dedupeLeads } from '../filters/dedupe';
import { evaluateRules } from '../filters/ruleBasedFilter';
import { combineScores, evaluateIntent } from '../scoring/intentScoring';
import { activeSources } from '../sources/index';
import { buildReviewRow } from '../review/reviewQueue';

export interface PipelineRunOptions {
  sources?: SourceConnector[];
  fetchOptions?: SourceFetchOptions;
  db?: Database;
}

export interface PipelineRunSummary {
  totalFetched: number;
  duplicatesDropped: number;
  ruleFiltered: number;
  accepted: number;
  rejected: number;
  byPriority: { A: number; B: number; C: number; Reject: number };
  rows: ReviewQueueRow[];
}

function emptySummary(): PipelineRunSummary {
  return {
    totalFetched: 0,
    duplicatesDropped: 0,
    ruleFiltered: 0,
    accepted: 0,
    rejected: 0,
    byPriority: { A: 0, B: 0, C: 0, Reject: 0 },
    rows: [],
  };
}

export async function runLeadSourcingPipeline(
  options: PipelineRunOptions = {},
): Promise<PipelineRunSummary> {
  const db = options.db ?? getDb();
  const sources = options.sources ?? activeSources;
  const summary = emptySummary();

  // 1. Fetch from every active source.
  const fetched: RawLead[] = [];
  for (const source of sources) {
    const leads = await source.fetchLeads(options.fetchOptions);
    for (const raw of leads) {
      const parsed = RawLeadSchema.safeParse(raw);
      if (!parsed.success) {
        console.warn(
          `[pipeline] dropping invalid lead from ${source.name}: ${parsed.error.message}`,
        );
        continue;
      }
      fetched.push(parsed.data);
    }
  }
  summary.totalFetched = fetched.length;

  // 2. Dedupe within the batch.
  const { unique, dropped } = dedupeLeads(fetched);
  summary.duplicatesDropped = dropped;

  // 3. Persist + score each lead.
  for (const lead of unique) {
    const { company } = upsertCompanyFromLead(lead, db);
    upsertContactFromLead(company.id, lead, db);
    persistSignals(company.id, lead, db);

    const rule = evaluateRules(lead);
    const intent = evaluateIntent(lead);
    const combined: CombinedScore = combineScores(rule, intent);

    persistScore(company.id, combined, db);

    if (combined.finalScore >= config.minReviewScore) {
      upsertReviewItem(company.id, combined.priority, db);
      setCompanyStatus(company.id, 'review', db);
      summary.accepted += 1;
    } else {
      setCompanyStatus(company.id, 'rejected', db);
      summary.rejected += 1;
    }
    if (!rule.pass) summary.ruleFiltered += 1;

    summary.byPriority[combined.priority] += 1;

    summary.rows.push(buildReviewRow(company, lead, combined));
  }

  summary.rows.sort((a, b) => b.finalScore - a.finalScore);
  return summary;
}
