import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { config } from '../config/index';
import { getDb } from '../db/client';
import { persistAiAnalysis } from '../db/repository';
import { PROMPT_VERSION, type AiProvider, type EngineAnalysisOutcome, type PromptInput } from './aiTypes';
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
} from './buildAnalysisPrompt';
import { parseAnalysisResponse } from './parseAnalysisResponse';
import { findCachedAnalysis, hashPromptInput, rowToAnalysis } from './aiCache';
import { checkBudgetForCost } from './aiBudget';
import { createAnthropicProvider } from './providers/anthropicProvider';
import { createMockAiProvider } from './providers/mockAiProvider';
import { estimateCostUsd } from './providers/types';

// --------------------------------------------------------------------------
// Provider selection. Mirrors the Google Maps pattern: explicit override
// wins, then forceMock, then no-API-key fallback, then real Anthropic.
// --------------------------------------------------------------------------
function defaultProvider(): { provider: AiProvider; warning?: string } {
  const { apiKey, forceMock, model, provider, maxOutputTokens, requestTimeoutMs } =
    config.aiAnalysis;

  if (forceMock) {
    return {
      provider: createMockAiProvider(model),
      warning: 'AI_ANALYSIS_FORCE_MOCK=1 — using mock AI provider (no live calls).',
    };
  }
  if (!apiKey) {
    return {
      provider: createMockAiProvider(model),
      warning:
        'No ANTHROPIC_API_KEY / AI_PROVIDER_API_KEY set — using mock AI provider (no live calls).',
    };
  }
  if (provider !== 'anthropic') {
    return {
      provider: createMockAiProvider(model),
      warning: `AI_ANALYSIS_PROVIDER=${provider} is not implemented yet — using mock provider.`,
    };
  }
  return {
    provider: createAnthropicProvider({
      apiKey,
      model,
      maxOutputTokens,
      requestTimeoutMs,
    }),
  };
}

export interface AnalyzeOptions {
  provider?: AiProvider;
  force?: boolean; // bypass cache lookup
  db?: Database;
}

// --------------------------------------------------------------------------
// Analyse one lead. Selective: caller already filtered by priority + caps.
// --------------------------------------------------------------------------
export async function analyzeOneLead(
  companyId: string,
  input: PromptInput,
  options: AnalyzeOptions = {},
): Promise<EngineAnalysisOutcome> {
  const db = options.db ?? getDb();

  if (!config.aiAnalysis.enabled) {
    return { companyId, status: 'skipped_disabled' };
  }

  const inputHash = hashPromptInput(input);

  // ---- Cache lookup ----------------------------------------------------
  if (!options.force) {
    const cached = findCachedAnalysis(companyId, inputHash, db);
    if (cached) {
      const result = rowToAnalysis(cached);
      return {
        companyId,
        status: 'cache_hit',
        analysisId: cached.id,
        result: result ?? undefined,
        fromCache: true,
        provider: cached.ai_provider,
        model: cached.model,
        inputHash,
        usage: {
          inputTokens: cached.tokens_input,
          outputTokens: cached.tokens_output,
          cachedInputTokens: cached.tokens_cached,
        },
        estimatedCostUsd: cached.estimated_cost,
      };
    }
  }

  // ---- Budget guard ----------------------------------------------------
  // Use a conservative pre-call estimate (one full-priced input + output)
  // so we never start a call we can't afford.
  const conservativeEstimate = estimateCostUsd(config.aiAnalysis.model, {
    inputTokens: 3500,
    outputTokens: config.aiAnalysis.maxOutputTokens,
  });
  const budget = checkBudgetForCost(conservativeEstimate, db);
  if (!budget.allowed) {
    return {
      companyId,
      status: 'skipped_budget',
      errorMessage: budget.reason,
      inputHash,
    };
  }

  // ---- Provider call ---------------------------------------------------
  const { provider, warning } = options.provider
    ? { provider: options.provider, warning: undefined as string | undefined }
    : defaultProvider();
  const userPrompt = buildUserPrompt(input, config.aiAnalysis.maxInputChars);

  try {
    const providerResult = await provider.generate(SYSTEM_PROMPT, userPrompt);
    const parsed = parseAnalysisResponse(providerResult.rawJson);

    if (!parsed.ok) {
      const id = randomUUID();
      persistAiAnalysis(
        {
          id,
          companyId,
          promptVersion: PROMPT_VERSION,
          inputHash,
          provider: provider.name,
          model: provider.model,
          summary: null,
          confidence: null,
          operationalPainPointsJson: null,
          automationOpportunitiesJson: null,
          estimatedBusinessImpactJson: null,
          likelyBuyerJson: null,
          urgencyJson: null,
          proofAnglesJson: null,
          risksJson: null,
          rawResponseJson: providerResult.rawJson,
          tokensInput: providerResult.usage.inputTokens,
          tokensCached: providerResult.usage.cachedInputTokens ?? 0,
          tokensOutput: providerResult.usage.outputTokens,
          estimatedCost: providerResult.estimatedCostUsd,
          status: 'failed',
          errorMessage: parsed.error,
        },
        db,
      );
      return {
        companyId,
        status: 'failed',
        analysisId: id,
        errorMessage: warning ? `${warning} | ${parsed.error}` : parsed.error,
        provider: provider.name,
        model: provider.model,
        usage: providerResult.usage,
        estimatedCostUsd: providerResult.estimatedCostUsd,
        inputHash,
      };
    }

    const result = parsed.result;
    const id = randomUUID();
    const impactSummary = result.automationOpportunities.map((o) => ({
      title: o.title,
      businessImpact: o.businessImpact,
      complexity: o.implementationComplexity,
    }));

    persistAiAnalysis(
      {
        id,
        companyId,
        promptVersion: PROMPT_VERSION,
        inputHash,
        provider: provider.name,
        model: provider.model,
        summary: result.summary,
        confidence: result.confidence,
        operationalPainPointsJson: JSON.stringify(result.operationalPainPoints),
        automationOpportunitiesJson: JSON.stringify(result.automationOpportunities),
        estimatedBusinessImpactJson: JSON.stringify(impactSummary),
        likelyBuyerJson: JSON.stringify(result.likelyBuyer),
        urgencyJson: JSON.stringify(result.urgencyAssessment),
        proofAnglesJson: JSON.stringify(result.proofAngles),
        risksJson: JSON.stringify(result.risksOrObjections),
        rawResponseJson: providerResult.rawJson,
        tokensInput: providerResult.usage.inputTokens,
        tokensCached: providerResult.usage.cachedInputTokens ?? 0,
        tokensOutput: providerResult.usage.outputTokens,
        estimatedCost: providerResult.estimatedCostUsd,
        status: 'ok',
        errorMessage: warning ?? null,
      },
      db,
    );

    return {
      companyId,
      status: 'ok',
      analysisId: id,
      result,
      provider: provider.name,
      model: provider.model,
      usage: providerResult.usage,
      estimatedCostUsd: providerResult.estimatedCostUsd,
      inputHash,
      errorMessage: warning,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err ?? 'unknown error');
    return {
      companyId,
      status: 'failed',
      errorMessage: warning ? `${warning} | ${message}` : message,
      provider: provider.name,
      model: provider.model,
      inputHash,
    };
  }
}

// --------------------------------------------------------------------------
// Pipeline entry point: pick top-priority leads, analyse with caps + cache.
// --------------------------------------------------------------------------
export interface AnalyzeTopLeadsCandidate {
  companyId: string;
  priority: 'A' | 'B' | 'C';
  input: PromptInput;
}

export interface AnalyzeTopLeadsSummary {
  attempted: number;
  ok: number;
  cacheHits: number;
  failed: number;
  skipped: number;
  totalCostUsd: number;
  outcomes: EngineAnalysisOutcome[];
}

export async function analyzeTopLeads(
  candidates: AnalyzeTopLeadsCandidate[],
  options: { provider?: AiProvider; force?: boolean; db?: Database } = {},
): Promise<AnalyzeTopLeadsSummary> {
  const allowed = new Set(config.aiAnalysis.allowedPriorities);
  const cap = config.aiAnalysis.maxLeadsPerRun;

  const eligible = candidates.filter((c) =>
    allowed.has(c.priority as 'A' | 'B' | 'C'),
  );
  const slice = eligible.slice(0, cap);

  const summary: AnalyzeTopLeadsSummary = {
    attempted: 0,
    ok: 0,
    cacheHits: 0,
    failed: 0,
    skipped: 0,
    totalCostUsd: 0,
    outcomes: [],
  };

  for (const c of slice) {
    summary.attempted += 1;
    const outcome = await analyzeOneLead(c.companyId, c.input, options);
    summary.outcomes.push(outcome);
    if (outcome.status === 'ok') {
      summary.ok += 1;
      summary.totalCostUsd += outcome.estimatedCostUsd ?? 0;
    } else if (outcome.status === 'cache_hit') {
      summary.cacheHits += 1;
    } else if (outcome.status === 'failed') {
      summary.failed += 1;
    } else {
      summary.skipped += 1;
    }

    // Stop early if a skipped_budget was returned — every subsequent lead
    // will fail the same check.
    if (outcome.status === 'skipped_budget') break;
  }

  return summary;
}
