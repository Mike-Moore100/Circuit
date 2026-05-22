// Phase 1 Discovery Diversity — corpus health.
//
// Aggregates the distribution shape of the corpus across multiple axes
// (industry, source, campaign, size band, opportunity band) and produces
// a structured health report. Pure function — caller fetches the rows.
//
// Diversity is reported as a normalised Shannon entropy in [0, 1] so we
// can compare distributions of different cardinality on the same scale.
// 1.0 = perfectly uniform across the categories present; 0.0 = a single
// category absorbs everything.

import {
  classifyIndustryBalance,
  type BalancingResult,
  type BalancingConfig,
} from './industryBalancing';
import {
  computeSourceDistribution,
  type SourceDistributionResult,
  type SourceDistributionConfig,
} from './sourceDistribution';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------
export interface CorpusCompany {
  industry: string | null;
  source: string;
  primaryCampaign: string | null;
  sizeEstimate: number | null;
  opportunityScore: number | null;
}

export type WarningLevel = 'info' | 'warning' | 'critical';

export interface CorpusWarning {
  level: WarningLevel;
  message: string;
  code: string;
}

export interface CorpusBucket {
  bucket: string;
  count: number;
  share: number;
}

export interface CorpusHealthReport {
  total: number;
  industryDistribution: CorpusBucket[];
  sourceDistribution: CorpusBucket[];
  campaignDistribution: CorpusBucket[];
  sizeDistribution: CorpusBucket[];
  opportunityDistribution: CorpusBucket[];
  // Pre-computed planner outputs (re-uses industryBalancing + sourceDistribution
  // so the dashboard and the CLI never disagree).
  industryBalance: BalancingResult;
  sourceConcentration: SourceDistributionResult;
  // Normalised Shannon entropy per axis, 0–1.
  diversityScores: {
    industry: number;
    source: number;
    campaign: number;
    opportunity: number;
  };
  // Overall corpus diversity score 0–100 — a single number for the
  // dashboard tile. Composite of the four per-axis scores weighted
  // toward industry diversity (the brief's primary concern).
  overallDiversityScore: number;
  warnings: CorpusWarning[];
}

export interface CorpusHealthConfig {
  balancing?: BalancingConfig;
  source?: SourceDistributionConfig;
  // Industries that should always appear on the warning list when at
  // zero — even with a small corpus, we want operators to know they're
  // missing entirely.
  alwaysFlagMissing?: readonly string[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function computeCorpusHealth(
  companies: CorpusCompany[],
  config: CorpusHealthConfig = {},
): CorpusHealthReport {
  const industries = countBy(companies, (c) => normaliseLabel(c.industry));
  const sources = countBy(companies, (c) => c.source);
  const campaigns = countBy(companies, (c) => normaliseLabel(c.primaryCampaign));
  const sizes = countBy(companies, (c) => sizeBand(c.sizeEstimate));
  const opportunities = countBy(companies, (c) =>
    opportunityBand(c.opportunityScore),
  );

  const industryBalance = classifyIndustryBalance(
    pruneUnknown(industries),
    config.balancing,
  );
  const sourceConcentration = computeSourceDistribution(sources, config.source);

  const diversityScores = {
    industry: normalisedEntropy(industries),
    source: normalisedEntropy(sources),
    campaign: normalisedEntropy(campaigns),
    opportunity: normalisedEntropy(opportunities),
  };
  const overallDiversityScore = Math.round(
    100 *
      (diversityScores.industry * 0.45 +
        diversityScores.source * 0.2 +
        diversityScores.campaign * 0.15 +
        diversityScores.opportunity * 0.2),
  );

  const warnings = buildWarnings(
    companies.length,
    industryBalance,
    sourceConcentration,
    config.alwaysFlagMissing ?? [],
  );

  return {
    total: companies.length,
    industryDistribution: toBuckets(industries),
    sourceDistribution: toBuckets(sources),
    campaignDistribution: toBuckets(campaigns),
    sizeDistribution: toBuckets(sizes),
    opportunityDistribution: toBuckets(opportunities),
    industryBalance,
    sourceConcentration,
    diversityScores,
    overallDiversityScore,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function countBy<T>(rows: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = key(r);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function normaliseLabel(s: string | null): string {
  if (!s) return '(unknown)';
  return s.trim().toLowerCase();
}

// Industry balancing should not treat "(unknown)" as a target industry —
// strip it before handing the map across.
function pruneUnknown(counts: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) {
    if (k === '(unknown)') continue;
    out[k] = v;
  }
  return out;
}

function sizeBand(size: number | null): string {
  if (size === null || Number.isNaN(size)) return 'unknown';
  if (size < 5) return '1-4';
  if (size < 20) return '5-19';
  if (size < 50) return '20-49';
  if (size < 200) return '50-199';
  return '200+';
}

function opportunityBand(score: number | null): string {
  if (score === null) return 'no_score';
  if (score >= 70) return '70-100';
  if (score >= 50) return '50-69';
  if (score >= 30) return '30-49';
  if (score >= 10) return '10-29';
  return '0-9';
}

function toBuckets(counts: Record<string, number>): CorpusBucket[] {
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  const buckets: CorpusBucket[] = Object.entries(counts).map(([bucket, count]) => ({
    bucket,
    count,
    share: total > 0 ? count / total : 0,
  }));
  buckets.sort((a, b) => b.count - a.count || a.bucket.localeCompare(b.bucket));
  return buckets;
}

// Shannon entropy normalised to [0, 1] using log base = number of
// non-empty categories. We use natural log internally — the
// normalisation cancels the base.
function normalisedEntropy(counts: Record<string, number>): number {
  const values = Object.values(counts).filter((n) => n > 0);
  if (values.length <= 1) return 0;
  const total = values.reduce((s, n) => s + n, 0);
  if (total === 0) return 0;
  let h = 0;
  for (const n of values) {
    const p = n / total;
    h -= p * Math.log(p);
  }
  return h / Math.log(values.length);
}

function buildWarnings(
  total: number,
  balance: BalancingResult,
  source: SourceDistributionResult,
  alwaysFlagMissing: readonly string[],
): CorpusWarning[] {
  const warnings: CorpusWarning[] = [];

  if (total === 0) {
    warnings.push({
      level: 'info',
      code: 'corpus_empty',
      message: 'No companies in corpus — run discovery to seed.',
    });
    return warnings;
  }

  for (const c of balance.classifications) {
    if (c.status === 'overrepresented') {
      warnings.push({
        level: 'warning',
        code: `over_${c.industry.replace(/\s+/g, '_')}`,
        message: `${capitalise(c.industry)} exceeds target corpus share (${pct(c.share)} of ${total}).`,
      });
    }
  }

  for (const ind of alwaysFlagMissing) {
    if ((balance.classifications.find((c) => c.industry === ind)?.count ?? 0) === 0) {
      warnings.push({
        level: 'warning',
        code: `missing_${ind.replace(/\s+/g, '_')}`,
        message: `${capitalise(ind)} missing from corpus.`,
      });
    }
  }

  // Surface up to three of the strongest underrepresented industries
  // — more than that and the dashboard becomes noise.
  const under = balance.classifications.filter(
    (c) => c.status === 'underrepresented' || c.status === 'missing',
  );
  for (const c of under.slice(0, 3)) {
    if (alwaysFlagMissing.includes(c.industry)) continue; // already flagged
    warnings.push({
      level: 'info',
      code: `under_${c.industry.replace(/\s+/g, '_')}`,
      message: `${capitalise(c.industry)} underrepresented (${pct(c.share)}).`,
    });
  }

  if (source.isOverconcentrated && source.dominantSource) {
    const dom = source.shares.find((s) => s.source === source.dominantSource);
    warnings.push({
      level: 'critical',
      code: 'source_overconcentrated',
      message: `Source ${source.dominantSource} is ${pct(dom?.share ?? 0)} of corpus — diversify discovery sources.`,
    });
  }

  return warnings;
}

function capitalise(s: string): string {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
