// Phase 14.1 — Data Mode helper. Single source of truth for whether a
// query should include DEMO/TEST rows. The dashboard, services, and
// CLIs all read from here so no surface accidentally leaks mock data.
//
// Modes:
//   REAL  → only real-discovered + real-promoted companies render
//   DEMO  → REAL + DEMO. The badge in the UI says "DEMO MODE" so the
//           operator can never confuse it with real intelligence.
//   TEST  → reserved for unit tests; never shown in any dashboard

import { config } from '../config/index';

export type DataOrigin = 'REAL' | 'DEMO' | 'TEST';
export type SourceType = 'REAL_SOURCE' | 'MOCK_SOURCE' | 'MANUAL_TEST';
export type DataMode = 'REAL' | 'DEMO';

// Resolves the current dashboard mode from config. DEMO_MODE=1 or
// ALLOW_MOCK_DATA=1 flips this to DEMO. Anything else is REAL.
export function currentDataMode(): DataMode {
  if (config.demoMode || config.allowMockData) return 'DEMO';
  return 'REAL';
}

// Returns the set of data_origin values visible in the current mode.
export function visibleOrigins(): DataOrigin[] {
  return currentDataMode() === 'DEMO' ? ['REAL', 'DEMO'] : ['REAL'];
}

// SQL helper — returns "AND data_origin IN ('REAL'[, 'DEMO'])" — drops
// straight into any WHERE clause. The alias parameter lets callers
// qualify the column (e.g. 'c' for companies).
export function dataModeAnd(alias = 'c'): string {
  const origins = visibleOrigins();
  return `AND ${alias}.data_origin IN (${origins.map((o) => `'${o}'`).join(',')})`;
}

// Standalone WHERE clause (no leading AND). Useful when a query starts
// fresh from the companies table.
export function dataModeWhere(alias = 'c'): string {
  const origins = visibleOrigins();
  return `${alias}.data_origin IN (${origins.map((o) => `'${o}'`).join(',')})`;
}
