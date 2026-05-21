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
import { inspectAndCache, mapWithConcurrency } from '../inspection/inspect';
import {
  analyzeTopLeads,
  type AnalyzeTopLeadsCandidate,
  type AnalyzeTopLeadsSummary,
} from '../ai/aiAnalysisEngine';
import { PROMPT_VERSION } from '../ai/aiTypes';

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
  inspection: {
    attempted: number;
    fromCache: number;
    failed: number;
    skipped: number;
  };
  ai: AnalyzeTopLeadsSummary | null;
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
    inspection: { attempted: 0, fromCache: 0, failed: 0, skipped: 0 },
    ai: null,
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

      // ---- 4. Persist companies + contacts + raw source signals first ---
      const persistedLeads: Array<{
        company: ReturnType<typeof upsertCompanyFromLead>['company'];
        lead: RawLead;
      }> = [];
      for (const lead of unique) {
        const { company } = upsertCompanyFromLead(lead, db);
        upsertContactFromLead(company.id, lead, db);
        persistSignals(company.id, lead, db);
        persistedLeads.push({ company, lead });
      }

      // ---- 4b. Parallel website inspection (between dedupe and scoring) -
      if (config.websiteInspection.enabled && persistedLeads.length > 0) {
        const inspectionResults = await mapWithConcurrency(
          persistedLeads,
          config.websiteInspection.concurrency,
          async ({ company, lead }) => {
            summary.inspection.attempted += 1;
            try {
              const outcome = await inspectAndCache(
                lead.websiteUrl,
                { companyId: company.id },
                db,
              );
              if (!outcome) {
                summary.inspection.skipped += 1;
                return null;
              }
              if (outcome.result.fromCache) summary.inspection.fromCache += 1;
              if (
                outcome.result.status === 'failed' ||
                outcome.result.status === 'timeout'
              ) {
                summary.inspection.failed += 1;
              }
              return outcome;
            } catch (err) {
              summary.inspection.failed += 1;
              errors.push(
                `inspection failed for ${lead.websiteUrl}: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
              return null;
            }
          },
        );

        // Fold verified signals into each lead AND persist them so the
        // signals table reflects everything used for scoring.
        for (let i = 0; i < persistedLeads.length; i++) {
          const outcome = inspectionResults[i];
          if (!outcome || outcome.result.signals.length === 0) continue;
          const verifiedOnly = outcome.result.signals;
          persistedLeads[i].lead = {
            ...persistedLeads[i].lead,
            signals: [...persistedLeads[i].lead.signals, ...verifiedOnly],
          };
          persistSignals(
            persistedLeads[i].company.id,
            {
              ...persistedLeads[i].lead,
              signals: verifiedOnly,
              source: 'website_inspection',
            },
            db,
          );
        }
      }

      // ---- 4c. Score + enqueue using the now-enriched leads --------------
      for (const { company, lead } of persistedLeads) {
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

  // ---- 5. Selective AI analysis on top-priority leads only -----------
  if (config.aiAnalysis.enabled && summary.rows.length > 0) {
    const candidates: AnalyzeTopLeadsCandidate[] = summary.rows
      .filter((row) => row.priority === 'A' || row.priority === 'B' || row.priority === 'C')
      .map((row) => {
        // Pull the persisted lead's signals back out of the row's reasons +
        // any inspection signals already attached to this row in summary.
        // The PromptInput is built from the data we already have at hand;
        // verified signals come from row.reasons that have code prefix
        // verified_ AND from the actual signals captured during inspection.
        const verifiedFromReasons = row.reasons
          .filter((r) => r.code.startsWith('verified_'))
          .map((r) => ({
            type: `verified.${r.code.replace(/^verified_/, '')}`,
            value: r.label,
            confidence: 80,
          }));
        return {
          companyId: row.companyId,
          priority: row.priority as 'A' | 'B' | 'C',
          input: {
            promptVersion: PROMPT_VERSION,
            company: {
              companyName: row.company,
              industry: row.industry,
              location: row.location,
              websiteUrl: row.website,
              source: row.source,
              sizeEstimate: null,
            },
            scoring: {
              finalScore: row.finalScore,
              ruleScore: row.ruleScore,
              intentScore: row.intentScore,
              priority: row.priority,
              reasons: row.reasons.map((r) => ({ label: r.label, delta: r.delta })),
              rejectionReasons: row.rejectionReasons.map((r) => ({
                label: r.label,
                delta: r.delta,
              })),
            },
            verifiedSignals: verifiedFromReasons,
            homepageSnippet: null, // engine doesn't strictly need it
            contact: null,
          },
        };
      });

    summary.ai = await analyzeTopLeads(candidates, { db });
  }

  return summary;
}
