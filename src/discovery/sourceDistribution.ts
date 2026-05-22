// Phase 1 Discovery Diversity — source distribution analysis.
//
// Tracks how much of the corpus came from each discovery source
// (serp.duckduckgo, directory.yell, etc.). Concentrated single-source
// corpora are a calibration risk — one bot-block can wipe out the
// stream and one source's bias can dominate the scoring layer.
//
// Pure function. Caller fetches the counts.

export interface SourceShare {
  source: string;
  count: number;
  share: number; // 0–1 fraction of the corpus
  status: 'dominant' | 'balanced' | 'minor';
}

export interface SourceDistributionResult {
  total: number;
  shares: SourceShare[];
  // Single source label that holds the largest share. Null when total = 0.
  dominantSource: string | null;
  // True iff a single source exceeds the concentration ceiling.
  isOverconcentrated: boolean;
  // Concentration ceiling that was applied — surfaced so the dashboard
  // can show "max 70%" alongside the warning.
  concentrationLimit: number;
}

export interface SourceDistributionConfig {
  // A single source crossing this share is flagged as dominant.
  // Defaults to 0.7 — high enough that two-source corpora are fine
  // but a 90%-from-one-source corpus raises the flag.
  concentrationLimit?: number;
  // Below this absolute count, no source is flagged as dominant — we
  // don't have enough data to declare a concentration problem yet.
  minTotal?: number;
}

export function computeSourceDistribution(
  counts: Record<string, number>,
  config: SourceDistributionConfig = {},
): SourceDistributionResult {
  const concentrationLimit = config.concentrationLimit ?? 0.7;
  const minTotal = config.minTotal ?? 10;
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  const entries = Object.entries(counts).filter(([_, n]) => n > 0);

  const shares: SourceShare[] = entries.map(([source, count]) => {
    const share = total > 0 ? count / total : 0;
    return {
      source,
      count,
      share,
      status:
        total < minTotal
          ? 'minor'
          : share > concentrationLimit
          ? 'dominant'
          : share >= 0.15
          ? 'balanced'
          : 'minor',
    };
  });
  shares.sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));

  const dominantSource =
    total >= minTotal && shares.length > 0 && shares[0].share > concentrationLimit
      ? shares[0].source
      : null;

  return {
    total,
    shares,
    dominantSource,
    isOverconcentrated: dominantSource !== null,
    concentrationLimit,
  };
}
