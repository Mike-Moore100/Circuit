// Run the AI analysis engine over today's top-priority leads. Respects the
// daily cost cap, the per-run lead cap, and the priority allow-list from env.
//
//   npm run analyze:top-leads
//   npm run analyze:top-leads -- --force      # bypass cache
//   npm run analyze:top-leads -- --limit 3
//
import { config } from '../src/config/index';
import { closeDb, getDb } from '../src/db/client';
import { getAllCompanies, getInspectionByCompany, getLatestScore } from '../src/db/repository';
import {
  analyzeTopLeads,
  type AnalyzeTopLeadsCandidate,
} from '../src/ai/aiAnalysisEngine';
import { PROMPT_VERSION } from '../src/ai/aiTypes';

interface Args {
  force: boolean;
  limit: number | null;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let force = false;
  let limit: number | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--force' || a === '-f') force = true;
    else if (a === '--limit' || a === '-n') {
      const v = Number(args[i + 1]);
      if (Number.isFinite(v)) limit = v;
      i += 1;
    }
  }
  return { force, limit };
}

function priorityOrder(p: string): number {
  return p === 'A' ? 0 : p === 'B' ? 1 : p === 'C' ? 2 : 3;
}

async function main() {
  const { force, limit } = parseArgs();
  const db = getDb();

  const allowed = new Set(config.aiAnalysis.allowedPriorities);
  console.log(
    `[ai] provider=${config.aiAnalysis.provider} model=${config.aiAnalysis.model} allowed=[${[...allowed].join(',')}] cap=${config.aiAnalysis.maxLeadsPerRun} daily-limit=$${config.aiAnalysis.dailyCostLimitUsd}`,
  );

  // Build candidate list from companies that have a score row.
  const companies = getAllCompanies(db);
  const candidates: AnalyzeTopLeadsCandidate[] = [];
  for (const company of companies) {
    const score = getLatestScore(company.id, db);
    if (!score) continue;
    if (!allowed.has(score.priority as 'A' | 'B' | 'C')) continue;
    let parsed: { rule: { reasons: Array<{ label: string; delta: number; code: string }>; rejectionReasons: Array<{ label: string; delta: number; code: string }> } } | null = null;
    try {
      parsed = JSON.parse(score.reasons_json);
    } catch {
      parsed = null;
    }
    const reasons = parsed?.rule?.reasons ?? [];
    const rejections = parsed?.rule?.rejectionReasons ?? [];
    const inspection = getInspectionByCompany(company.id, db);
    const verifiedSignals = reasons
      .filter((r) => r.code.startsWith('verified_'))
      .map((r) => ({
        type: `verified.${r.code.replace(/^verified_/, '')}`,
        value: r.label,
        confidence: 80,
      }));
    candidates.push({
      companyId: company.id,
      priority: score.priority as 'A' | 'B' | 'C',
      input: {
        promptVersion: PROMPT_VERSION,
        company: {
          companyName: company.name,
          industry: company.industry,
          location: company.location,
          websiteUrl: company.website_url,
          source: company.source,
          sizeEstimate: company.size_estimate,
        },
        scoring: {
          finalScore: score.final_score,
          ruleScore: score.rule_score,
          intentScore: score.intent_score,
          priority: score.priority as 'A' | 'B' | 'C' | 'Reject',
          reasons,
          rejectionReasons: rejections,
        },
        verifiedSignals,
        homepageSnippet: inspection?.meta_description
          ? `${inspection.title ?? ''}\n${inspection.meta_description ?? ''}`
          : null,
        contact: null,
      },
    });
  }

  candidates.sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority));
  const sliced = limit ? candidates.slice(0, limit) : candidates;

  console.log(`[ai] ${sliced.length} eligible leads (force=${force}).`);

  const summary = await analyzeTopLeads(sliced, { force, db });

  console.log('');
  console.log('AI analysis complete');
  console.log('────────────────────');
  console.log(`Attempted    : ${summary.attempted}`);
  console.log(`OK (live)    : ${summary.ok}`);
  console.log(`Cache hits   : ${summary.cacheHits}`);
  console.log(`Failed       : ${summary.failed}`);
  console.log(`Skipped      : ${summary.skipped}`);
  console.log(`Cost (run)   : $${summary.totalCostUsd.toFixed(4)}`);

  // Per-lead one-liners for the operator.
  if (summary.outcomes.length > 0) {
    console.log('');
    console.log('Per-lead outcomes:');
    for (const o of summary.outcomes) {
      const company = companies.find((c) => c.id === o.companyId);
      const name = company?.name ?? o.companyId;
      const cost = o.estimatedCostUsd ? `$${o.estimatedCostUsd.toFixed(5)}` : '—';
      const tokens = o.usage
        ? `${o.usage.inputTokens}+${o.usage.cachedInputTokens ?? 0}c/${o.usage.outputTokens}`
        : '—';
      const confidence = o.result?.confidence ?? '—';
      const tag = o.status.padEnd(13);
      console.log(`  [${tag}] ${name.padEnd(34).slice(0, 34)}  tok=${tokens}  cost=${cost}  conf=${confidence}`);
      if (o.errorMessage) console.log(`      ${o.errorMessage}`);
    }
  }

  closeDb();
}

main().catch((err) => {
  console.error('[ai] failed:', err);
  process.exit(1);
});
