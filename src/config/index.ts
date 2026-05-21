import path from 'node:path';

const projectRoot = process.cwd();

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envPath(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw && raw.length > 0 ? path.resolve(projectRoot, raw) : path.resolve(projectRoot, fallback);
}

export const config = {
  dbPath: envPath('CIRCUIT_DB_PATH', 'data/circuit.db'),
  outputDir: envPath('CIRCUIT_OUTPUT_DIR', 'data/outputs'),
  minReviewScore: envInt('CIRCUIT_MIN_REVIEW_SCORE', 60),

  googleMaps: {
    apiKey: process.env.GOOGLE_PLACES_API_KEY ?? '',
    maxSearchesPerRun: envInt('GOOGLE_MAPS_MAX_SEARCHES_PER_RUN', 20),
    maxResultsPerSearch: envInt('GOOGLE_MAPS_MAX_RESULTS_PER_SEARCH', 20),
    maxLeadsPerRun: envInt('GOOGLE_MAPS_MAX_LEADS_PER_RUN', 200),
    requestTimeoutMs: envInt('GOOGLE_MAPS_REQUEST_TIMEOUT_MS', 15000),
    // Set to "1" to force the mock provider even with an API key present.
    forceMock: process.env.GOOGLE_MAPS_FORCE_MOCK === '1',
  },
} as const;

export type CircuitConfig = typeof config;
