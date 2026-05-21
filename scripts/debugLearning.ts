// Print the learning report — review patterns + calibration suggestions
// + insights. The system never auto-tunes; this CLI is how the operator
// reviews proposed changes.
//
//   npm run debug:learning
import { closeDb, getDb } from '../src/db/client';
import { buildLearningReport } from '../src/learning/buildReport';

function main() {
  const db = getDb();
  const report = buildLearningReport(db);
  console.log('Circuit — Operator Learning Report');
  console.log('==================================');
  console.log('');
  console.log(`Total reviews recorded: ${report.totalReviews}`);
  for (const [t, n] of Object.entries(report.reviewCounts)) {
    if (n === 0) continue;
    console.log(`  ${t.padEnd(22)} ${n}`);
  }
  if (report.totalReviews === 0) {
    console.log('  (no reviews yet — use the dashboard buttons to record some)');
  }

  console.log('');
  console.log('Insights');
  if (report.insights.length === 0) {
    console.log('  (no systemic insights detected)');
  } else {
    for (const i of report.insights) {
      console.log(`  [${i.tone}] ${i.headline}`);
      console.log(`           ${i.detail}`);
    }
  }

  console.log('');
  console.log('Calibration suggestions (proposed, NOT applied)');
  if (report.suggestions.length === 0) {
    console.log('  (no calibration suggestions yet — need more reviews)');
  } else {
    for (const s of report.suggestions) {
      console.log(
        `  [${s.confidence}%] ${s.direction.toUpperCase()} ${s.knob}  (evidence: ${s.evidenceCount})`,
      );
      console.log(`           ${s.rationale}`);
    }
  }

  console.log('');
  console.log('Review patterns');
  if (report.patterns.length === 0) {
    console.log('  (no patterns detected)');
  } else {
    for (const p of report.patterns.slice(0, 10)) {
      console.log(
        `  ${p.reviewType.padEnd(22)} ← ${p.previousCampaign.padEnd(22)} count=${p.count} avg-opp=${p.avgOpportunityScore} avg-final=${p.avgFinalScore}`,
      );
      if (p.sampleCompanies.length > 0) {
        console.log(`    sample: ${p.sampleCompanies.slice(0, 4).join(', ')}`);
      }
    }
  }

  closeDb();
}

try {
  main();
} catch (err) {
  console.error('[debug:learning] failed:', err);
  process.exit(1);
}
