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
} as const;

export type CircuitConfig = typeof config;
