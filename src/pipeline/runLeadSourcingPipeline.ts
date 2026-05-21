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
  createSourceRun,
  finishSourceRun,
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

export interface PipelineSourceRunSummary {
  source: string;
  runId: string;
  leadsFound: number;
  leadsAccepted: number;
  leadsRejected: number;
  apiCalls: number;
  errors: string[];
}

export interface PipelineRunSummary {
  totalFetched: number;
  duplicatesDropped: number;
  ruleFiltered: number;
  accepted: number;
  rejected: number;
  byPriority: { A: number; B: number; C: number; Reject: number };
  rows: ReviewQueueRow[];
  sourceRuns: PipelineSourceRunSummary[];
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
    sourceRuns: [],
  };
}

export async function runLeadSourcingPipeline(
  options: PipelineRunOptions = {},
): Promise<PipelineRunSummary> {
  const db = options.db ?? getDb();
  const sources = options.sources ?? activeSources;
  const summary = emptySummary();

  for (const source of sources) {
    // ---- 1. Start a source_runs row -------------------------------------
    const run = createSourceRun({ source: source.name }, db);

    let leadsFound = 0;
    let leadsAccepted = 0;
    let leadsRejected = 0;
    let apiCalls = 0;
    const errors: string[] = [];

    try {
      // ---- 2. Fetch ------------------------------------------------------
      const result = await source.fetchLeads(options.fetchOptions);
      apiCalls = result.apiCalls;
      errors.push(...result.errors);

      const validLeads: RawLead[] = [];
      for (const raw of result.leads) {
        const parsed = RawLeadSchema.safeParse(raw);
        if (!parsed.success) {
          errors.push(`invalid lead: ${parsed.error.message}`);
          continue;
        }
        validLeads.push(parsed.data);
      }

      // ---- 3. Dedupe within this source's batch -------------------------
      const { unique, dropped } = dedupeLeads(validLeads);
      summary.duplicatesDropped += dropped;
      summary.totalFetched += unique.length + dropped;
      leadsFound = unique.length;

      // Persist run params + provider info early so they survive failures.
      if (result.params) {
        db.prepare('UPDATE source_runs SET params_json = ? WHERE id = ?').run(
          JSON.stringify(result.params),
          run.id,
        );
      }

      // ---- 4. Persist, score, enqueue ------------------------------------
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
          leadsAccepted += 1;
        } else {
          setCompanyStatus(company.id, 'rejected', db);
          summary.rejected += 1;
          leadsRejected += 1;
        }
        if (!rule.pass) summary.ruleFiltered += 1;

        summary.byPriority[combined.priority] += 1;
        summary.rows.push(buildReviewRow(company, lead, combined));
      }

      finishSourceRun(
        {
          id: run.id,
          status: errors.length > 0 ? 'completed' : 'completed',
          leadsFound,
          leadsAccepted,
          leadsRejected,
          apiCalls,
          errors,
        },
        db,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? 'unknown error');
      errors.push(`fatal: ${message}`);
      finishSourceRun(
        {
          id: run.id,
          status: 'failed',
          leadsFound,
          leadsAccepted,
          leadsRejected,
          apiCalls,
          errors,
        },
        db,
      );
    }

    summary.sourceRuns.push({
      source: source.name,
      runId: run.id,
      leadsFound,
      leadsAccepted,
      leadsRejected,
      apiCalls,
      errors,
    });
  }

  summary.rows.sort((a, b) => b.finalScore - a.finalScore);
  return summary;
}
