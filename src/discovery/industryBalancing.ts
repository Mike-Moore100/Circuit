// Phase 1 Discovery Diversity — industry balancing.
//
// Given the current industry distribution of a corpus and a target
// distribution, classify each industry as overrepresented, balanced, or
// underrepresented. Returns deprioritise / prioritise actions the
// discovery planner can apply to the next query batch.
//
// Pure function — no DB, no I/O. Caller fetches the counts.

import { TARGET_INDUSTRIES } from './queryGeneration';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------
export type IndustryStatus =
  | 'overrepresented'
  | 'balanced'
  | 'underrepresented'
  | 'missing'; // target industry with zero corpus presence

export interface IndustryClassification {
  industry: string;
  count: number;
  share: number; // 0–1 fraction of the corpus
  targetShare: number; // 0–1 desired fraction
  status: IndustryStatus;
}

export interface BalancingResult {
  classifications: IndustryClassification[];
  // Industries the planner should send fewer queries to (overrepresented).
  deprioritize: string[];
  // Industries the planner should send more queries to (under / missing).
  prioritize: string[];
  // Industries not in the target list but present in the corpus — kept
  // for visibility on the dashboard.
  untargeted: Array<{ industry: string; count: number; share: number }>;
}

export interface BalancingConfig {
  // Industries we want represented. Defaults to TARGET_INDUSTRIES.
  targets?: readonly string[];
  // Equal share if undefined; otherwise the planner uses these weights
  // normalised to sum 1.0.
  targetShares?: Partial<Record<string, number>>;
  // An industry crossing this share threshold is overrepresented even
  // if it sits within its targetShare. Defaults to 0.20 (the Phase 1
  // rebalance cap — no single industry above 20%).
  maxConcentration?: number;
  // Per-industry hard caps that *override* maxConcentration when set.
  // Use for peer industries we want to allow but never let dominate.
  // Example: { 'marketing agency': 0.10 } keeps marketing agencies
  // below 10% of the corpus even when the general cap is 20%.
  perIndustryCap?: Partial<Record<string, number>>;
  // An industry below targetShare * underrepresentedRatio is flagged
  // underrepresented. Defaults to 0.5.
  underrepresentedRatio?: number;
  // Optional minimum corpus size — below this, every industry stays
  // classified as 'underrepresented' so the planner aggressively builds
  // up volume before declaring anything overrepresented.
  minCorpusSize?: number;
}

// Default per-industry caps applied across the system unless a
// caller overrides them. Marketing/web/design agencies are eligible
// for discovery but must never represent more than 10% of the corpus.
export const DEFAULT_PER_INDUSTRY_CAPS: Record<string, number> = {
  'marketing agency': 0.10,
  'web agency': 0.10,
  'design studio': 0.10,
};

// The Phase 1 rebalance baseline — surfaced as a constant so other
// modules (planner, corpus health, CLI) can reference the same number.
export const DEFAULT_MAX_CONCENTRATION = 0.20;
// Minimum distinct target industries we want to see in a healthy
// validation batch / corpus.
export const MIN_INDUSTRIES_PER_BATCH = 5;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function classifyIndustryBalance(
  counts: Record<string, number>,
  config: BalancingConfig = {},
): BalancingResult {
  const targets = [...(config.targets ?? TARGET_INDUSTRIES)].sort();
  const maxConcentration = config.maxConcentration ?? DEFAULT_MAX_CONCENTRATION;
  const perIndustryCap = { ...DEFAULT_PER_INDUSTRY_CAPS, ...(config.perIndustryCap ?? {}) };
  const underrepresentedRatio = config.underrepresentedRatio ?? 0.5;
  const minCorpusSize = config.minCorpusSize ?? 20;

  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  const targetShares = normalisedTargetShares(targets, config.targetShares);

  const classifications: IndustryClassification[] = [];
  for (const industry of targets) {
    const count = counts[industry] ?? 0;
    const share = total > 0 ? count / total : 0;
    const targetShare = targetShares[industry] ?? 0;
    // Tightest cap wins — if the operator set marketing-agency to 10%
    // but general maxConcentration is 20%, marketing must obey 10%.
    const effectiveCap = Math.min(
      maxConcentration,
      perIndustryCap[industry] ?? maxConcentration,
    );
    classifications.push({
      industry,
      count,
      share,
      targetShare,
      status: classifyOne(
        share,
        targetShare,
        count,
        total,
        effectiveCap,
        underrepresentedRatio,
        minCorpusSize,
      ),
    });
  }

  // Stable order — overrepresented first, then missing, then under, then balanced.
  // Tiebreak on industry name so the dashboard never flickers.
  const order: Record<IndustryStatus, number> = {
    overrepresented: 0,
    missing: 1,
    underrepresented: 2,
    balanced: 3,
  };
  classifications.sort((a, b) => {
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return a.industry.localeCompare(b.industry);
  });

  // Untargeted industries in the corpus — surfaced for visibility only.
  const targetSet = new Set(targets);
  const untargeted: BalancingResult['untargeted'] = [];
  for (const [industry, count] of Object.entries(counts)) {
    if (targetSet.has(industry)) continue;
    untargeted.push({
      industry,
      count,
      share: total > 0 ? count / total : 0,
    });
  }
  untargeted.sort((a, b) => b.count - a.count || a.industry.localeCompare(b.industry));

  return {
    classifications,
    deprioritize: classifications
      .filter((c) => c.status === 'overrepresented')
      .map((c) => c.industry),
    prioritize: classifications
      .filter((c) => c.status === 'missing' || c.status === 'underrepresented')
      .map((c) => c.industry),
    untargeted,
  };
}

function classifyOne(
  share: number,
  targetShare: number,
  count: number,
  total: number,
  maxConcentration: number,
  underrepresentedRatio: number,
  minCorpusSize: number,
): IndustryStatus {
  // Phase 1 rebalance — hard caps are hard. An industry above its cap
  // is overrepresented even in a tiny corpus, otherwise a 100% one-
  // industry corpus would keep getting MORE of that industry queried.
  // (The planner uses this to zero out further queries; corpus health
  // surfaces the warning.)
  if (share > maxConcentration) return 'overrepresented';
  // Below minCorpusSize we don't have enough total signal to declare
  // anything outside the cap. Treat zero counts as missing, everything
  // else as underrepresented so the planner aggressively builds volume.
  if (total < minCorpusSize) {
    if (count === 0) return 'missing';
    return 'underrepresented';
  }
  if (count === 0) return 'missing';
  if (targetShare > 0 && share < targetShare * underrepresentedRatio) {
    return 'underrepresented';
  }
  if (targetShare === 0 && share === 0) return 'missing';
  return 'balanced';
}

function normalisedTargetShares(
  targets: readonly string[],
  custom: BalancingConfig['targetShares'],
): Record<string, number> {
  // Use the operator-supplied weights when present, else split evenly.
  const raw: Record<string, number> = {};
  let supplied = 0;
  for (const t of targets) {
    if (custom && t in custom && typeof custom[t] === 'number') {
      raw[t] = Math.max(0, custom[t] as number);
      supplied += 1;
    }
  }
  if (supplied === 0) {
    const even = 1 / targets.length;
    const out: Record<string, number> = {};
    for (const t of targets) out[t] = even;
    return out;
  }
  // Mixed mode: targets without a custom weight inherit the average of
  // the supplied ones so they aren't silently zeroed out.
  const avg =
    Object.values(raw).reduce((s, n) => s + n, 0) / Math.max(1, Object.keys(raw).length);
  for (const t of targets) {
    if (!(t in raw)) raw[t] = avg;
  }
  // Normalise to sum 1.0.
  const total = Object.values(raw).reduce((s, n) => s + n, 0);
  if (total <= 0) return Object.fromEntries(targets.map((t) => [t, 0]));
  const out: Record<string, number> = {};
  for (const [t, w] of Object.entries(raw)) out[t] = w / total;
  return out;
}
