// Thin wrapper around runCalibrationAnalysis — persists insights +
// signal-performance to the DB so the dashboard reads them without
// recomputing.
//
//   npm run run:calibration
import { closeDb } from '../src/db/client';
import { runCalibrationAnalysis } from '../src/services/index';

async function main() {
  const result = await runCalibrationAnalysis({
    onProgress: (e) => {
      if (e.code.startsWith('calibration.')) console.log(`[calibration] ${e.message}`);
    },
  });
  const s = result.stats!;
  console.log(
    `\n[calibration] done in ${(result.durationMs / 1000).toFixed(1)}s — reviews=${s.reviews} signals=${s.signals} insights=${s.insights}`,
  );
  closeDb();
  if (!result.ok) process.exit(1);
}

main().catch((err) => {
  console.error('[calibration] failed:', err);
  process.exit(1);
});
