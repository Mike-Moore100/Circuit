// Phase 1 Discovery Diversity — corpus-aware query planner.
//
// Given the current industry distribution + a query budget, produce a
// diversified DiscoveryQuery batch that:
//
//   1. Skips overrepresented target industries entirely (quota = 0)
//   2. Prioritises missing target industries first
//   3. Then underrepresented industries
//   4. Then balanced industries with whatever budget remains
//
// Pure function — no DB, no network. The CLI / scheduler pull the
// industry counts and pass them in.

import {
  classifyIndustryBalance,
  type BalancingConfig,
  type IndustryClassification,
} from './industryBalancing';
import {
  distributeQuota,
  generateDiversifiedQueries,
  TARGET_INDUSTRIES,
  type GeneratedQuery,
  type QueryGenerationConfig,
} from './queryGeneration';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------
export interface DiversityPlannerConfig {
  // Total queries to plan for this batch.
  queryBudget: number;
  // Current industry counts pulled from the corpus.
  industryCounts: Record<string, number>;
  // Industries to draw from. Defaults to TARGET_INDUSTRIES.
  industries?: readonly string[];
  // Forwarded to queryGeneration.
  cities?: readonly string[];
  perCityCap?: number;
  templates?: Partial<Record<string, string>>;
  // Forwarded to industryBalancing.
  balancing?: BalancingConfig;
  // Fraction of the budget to spend on missing industries before any
  // other industry gets queries. Defaults to 0.6 — we strongly bias
  // toward filling gaps when they exist.
  missingShare?: number;
  // Same idea for underrepresented. Defaults to 0.3.
  underrepresentedShare?: number;
}

export interface DiversityPlan {
  queries: GeneratedQuery[];
  // The per-industry quota the planner computed before generation.
  quotaPerIndustry: Record<string, number>;
  // Diagnostic info: which industries got what status.
  classifications: IndustryClassification[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function planDiversifiedDiscovery(
  config: DiversityPlannerConfig,
): DiversityPlan {
  const industries = [...(config.industries ?? TARGET_INDUSTRIES)].sort();
  const balance = classifyIndustryBalance(config.industryCounts, {
    targets: industries,
    ...config.balancing,
  });
  const budget = Math.max(0, Math.floor(config.queryBudget));

  // Three-tier allocation. Anything overrepresented is hard-zeroed.
  const tiers: Record<'missing' | 'underrepresented' | 'balanced', string[]> = {
    missing: [],
    underrepresented: [],
    balanced: [],
  };
  for (const c of balance.classifications) {
    if (c.status === 'overrepresented') continue;
    tiers[c.status === 'missing' ? 'missing' : c.status === 'underrepresented' ? 'underrepresented' : 'balanced']
      .push(c.industry);
  }

  // If the tiers leave us with nothing to query, fall back to a small
  // round-robin across whatever non-overrepresented industries exist —
  // the operator still wants *some* queries to run.
  const missingShare = config.missingShare ?? 0.6;
  const underrepresentedShare = config.underrepresentedShare ?? 0.3;
  const balancedShare = Math.max(0, 1 - missingShare - underrepresentedShare);

  const tierBudgets: Record<string, number> = {
    missing: tiers.missing.length > 0 ? Math.round(budget * missingShare) : 0,
    underrepresented:
      tiers.underrepresented.length > 0 ? Math.round(budget * underrepresentedShare) : 0,
    balanced: tiers.balanced.length > 0 ? Math.round(budget * balancedShare) : 0,
  };
  // If a tier has no industries, reallocate its share to the next tier.
  let remainder =
    budget -
    (tierBudgets.missing + tierBudgets.underrepresented + tierBudgets.balanced);
  for (const tier of ['missing', 'underrepresented', 'balanced'] as const) {
    if (remainder <= 0) break;
    if (tiers[tier].length === 0) continue;
    tierBudgets[tier] += remainder;
    remainder = 0;
  }

  // Distribute each tier's budget across its industries evenly.
  const quotaPerIndustry: Record<string, number> = {};
  for (const tier of ['missing', 'underrepresented', 'balanced'] as const) {
    if (tiers[tier].length === 0 || tierBudgets[tier] === 0) continue;
    const mix = Object.fromEntries(tiers[tier].map((i) => [i, 1]));
    const allocated = distributeQuota(tierBudgets[tier], mix);
    for (const [industry, n] of Object.entries(allocated)) {
      quotaPerIndustry[industry] = (quotaPerIndustry[industry] ?? 0) + n;
    }
  }

  const queryConfig: QueryGenerationConfig = {
    industries: Object.keys(quotaPerIndustry).sort(),
    cities: config.cities,
    perCityCap: config.perCityCap,
    templates: config.templates,
    quotas: quotaPerIndustry,
    // Cap to budget so we don't accidentally overshoot.
    totalCap: budget,
    defaultPerIndustry: 0, // anything not in the quota map gets nothing
  };
  const queries = generateDiversifiedQueries(queryConfig);

  return {
    queries,
    quotaPerIndustry,
    classifications: balance.classifications,
  };
}
