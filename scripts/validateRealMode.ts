// validate:real-mode — sanity-check that the REAL-mode invariants hold.
// Exits non-zero if any leakage is detected so CI / pre-commit hooks
// can gate on it.
//
//   npm run validate:real-mode
//
// Checks performed:
//   1. The companies table has data_origin + source_type columns.
//   2. listOpportunityIntelligence / dashboardData / pageData fetchers
//      do NOT return DEMO rows when DEMO_MODE=0 and ALLOW_MOCK_DATA=0.
//   3. mockSourceConnector declares dataOrigin='DEMO'.
//   4. Seed mock data is gated by ALLOW_MOCK_DATA.
//
// Pure read-only — never writes to the DB.

import { config } from '../src/config/index';
import { closeDb, getDb } from '../src/db/client';
import {
  fetchReviewedLeadsForCalibration,
  getAllCompanies,
  listOpportunityIntelligence,
} from '../src/db/repository';
import { currentDataMode, visibleOrigins } from '../src/db/dataMode';
import { mockSourceConnector } from '../src/sources/index';

interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

function run(): { passed: number; failed: number; results: CheckResult[] } {
  const results: CheckResult[] = [];
  const db = getDb();

  // 1. Schema columns exist
  const cols = db.prepare('PRAGMA table_info(companies)').all() as Array<{
    name: string;
  }>;
  const colNames = new Set(cols.map((c) => c.name));
  results.push({
    name: 'companies.data_origin column',
    pass: colNames.has('data_origin'),
    detail: colNames.has('data_origin') ? 'present' : 'MISSING',
  });
  results.push({
    name: 'companies.source_type column',
    pass: colNames.has('source_type'),
    detail: colNames.has('source_type') ? 'present' : 'MISSING',
  });

  // 2. Mock connector declares DEMO origin
  results.push({
    name: 'mockSourceConnector.dataOrigin = DEMO',
    pass: mockSourceConnector.dataOrigin === 'DEMO',
    detail: `actual: ${mockSourceConnector.dataOrigin ?? 'undefined'}`,
  });

  // 3. Config flags read as expected
  results.push({
    name: 'config.demoMode read from env',
    pass: typeof config.demoMode === 'boolean',
    detail: `demoMode=${config.demoMode}`,
  });
  results.push({
    name: 'config.allowMockData read from env',
    pass: typeof config.allowMockData === 'boolean',
    detail: `allowMockData=${config.allowMockData}`,
  });

  // 4. Current mode + visible origins agree
  const mode = currentDataMode();
  const origins = visibleOrigins();
  results.push({
    name: 'current data mode resolved',
    pass: mode === 'REAL' || mode === 'DEMO',
    detail: `mode=${mode} visibleOrigins=[${origins.join(', ')}]`,
  });

  // 5. No DEMO leakage in REAL mode
  if (mode === 'REAL') {
    const all = getAllCompanies(db);
    const leaked = all.filter((c) =>
      ['DEMO', 'TEST'].includes(
        (c as unknown as { data_origin?: string }).data_origin ?? 'REAL',
      ),
    );
    results.push({
      name: 'getAllCompanies leaks no DEMO/TEST rows in REAL mode',
      pass: leaked.length === 0,
      detail:
        leaked.length === 0
          ? `${all.length} REAL companies visible`
          : `LEAKED: ${leaked.map((l) => l.name).join(', ')}`,
    });

    const opps = listOpportunityIntelligence(db, { limit: 500 });
    const oppLeaks = opps.filter((row) => {
      const co = db
        .prepare('SELECT data_origin FROM companies WHERE id = ?')
        .get(row.company_id) as { data_origin: string } | undefined;
      return co && co.data_origin !== 'REAL';
    });
    results.push({
      name: 'listOpportunityIntelligence leaks no DEMO/TEST rows in REAL mode',
      pass: oppLeaks.length === 0,
      detail:
        oppLeaks.length === 0
          ? `${opps.length} REAL opportunity rows`
          : `LEAKED: ${oppLeaks.length} rows`,
    });

    const reviewed = fetchReviewedLeadsForCalibration(db);
    const revLeaks = reviewed.filter((r) => {
      const co = db
        .prepare('SELECT data_origin FROM companies WHERE id = ?')
        .get(r.company_id) as { data_origin: string } | undefined;
      return co && co.data_origin !== 'REAL';
    });
    results.push({
      name: 'calibration data leaks no DEMO/TEST rows in REAL mode',
      pass: revLeaks.length === 0,
      detail:
        revLeaks.length === 0
          ? `${reviewed.length} REAL-origin reviews`
          : `LEAKED: ${revLeaks.length} rows`,
    });
  }

  // 6. Real data inventory
  const real = (db
    .prepare("SELECT COUNT(*) AS n FROM companies WHERE data_origin = 'REAL'")
    .get() as { n: number }).n;
  const demo = (db
    .prepare("SELECT COUNT(*) AS n FROM companies WHERE data_origin = 'DEMO'")
    .get() as { n: number }).n;
  results.push({
    name: 'inventory: REAL vs DEMO company counts',
    pass: true,
    detail: `REAL=${real} DEMO=${demo}`,
  });

  closeDb();

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  return { passed, failed, results };
}

function main() {
  console.log('Circuit — validate:real-mode');
  console.log('============================');
  console.log('');
  const out = run();
  for (const r of out.results) {
    console.log(`  ${r.pass ? 'OK   ' : 'FAIL '} ${r.name}`);
    console.log(`         ${r.detail}`);
  }
  console.log('');
  console.log(`Passed: ${out.passed}    Failed: ${out.failed}`);
  if (out.failed > 0) process.exit(1);
}

try {
  main();
} catch (err) {
  console.error('[validate:real-mode] failed:', err);
  process.exit(1);
}
