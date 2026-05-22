// debug:corpus — terminal view of the corpus health surface. Same data
// the /discovery page renders, plus a sample diversified query plan so
// the operator can see what the planner *would* run next given the
// current corpus state.
//
//   npm run debug:corpus
//   npm run debug:corpus -- --budget 30

import { closeDb } from '../src/db/client';
import { getCorpusHealthReport } from '../app/_lib/corpusHealthData';
import { planDiversifiedDiscovery } from '../src/discovery/discoveryDiversity';

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}
function rpad(n: number | string, w = 3): string {
  return String(n).padStart(w);
}
function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
function bar(share: number, width = 20): string {
  const filled = Math.max(0, Math.min(width, Math.round(share * width)));
  return '█'.repeat(filled) + '·'.repeat(width - filled);
}
function header(title: string) {
  console.log('');
  console.log(title);
  console.log('-'.repeat(title.length));
}

function main() {
  const args = process.argv.slice(2);
  let budget = 20;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--budget' && args[i + 1]) {
      const v = Number(args[i + 1]);
      if (Number.isFinite(v)) budget = v;
      i++;
    }
  }

  const report = getCorpusHealthReport();

  console.log('Circuit — debug:corpus');
  console.log('======================');
  console.log(`corpus size            : ${report.total}`);
  console.log(`overall diversity      : ${report.overallDiversityScore}/100`);
  console.log(`industry diversity     : ${pct(report.diversityScores.industry)}`);
  console.log(`source diversity       : ${pct(report.diversityScores.source)}`);
  console.log(`campaign diversity     : ${pct(report.diversityScores.campaign)}`);
  console.log(`opportunity diversity  : ${pct(report.diversityScores.opportunity)}`);

  // Warnings first — they're what an operator looks at first.
  header('Warnings');
  if (report.warnings.length === 0) {
    console.log('  (none — corpus distribution within limits)');
  } else {
    for (const w of report.warnings) {
      const tag = pad(`[${w.level}]`, 11);
      console.log(`  ${tag}  ${w.message}`);
    }
  }

  // Industries
  header('Industry distribution');
  if (report.industryDistribution.length === 0) {
    console.log('  (no industry data — most companies have null industry)');
  } else {
    for (const b of report.industryDistribution.slice(0, 12)) {
      console.log(
        `  ${pad(b.bucket, 30)}  ${bar(b.share)}  ${rpad(b.count, 4)}  ${pct(b.share)}`,
      );
    }
  }

  header('Industries — overrepresented');
  const over = report.industryBalance.classifications.filter(
    (c) => c.status === 'overrepresented',
  );
  if (over.length === 0) console.log('  (none)');
  else for (const c of over) {
    console.log(`  ${pad(c.industry, 30)}  ${pct(c.share)} (target ${pct(c.targetShare)})`);
  }

  header('Industries — missing / underrepresented');
  const under = report.industryBalance.classifications.filter(
    (c) => c.status === 'missing' || c.status === 'underrepresented',
  );
  if (under.length === 0) console.log('  (none)');
  else for (const c of under) {
    console.log(
      `  ${pad(c.industry, 30)}  ${c.count === 0 ? 'missing' : pct(c.share)} (target ${pct(c.targetShare)})`,
    );
  }

  // Sources
  header('Source concentration');
  if (report.sourceDistribution.length === 0) {
    console.log('  (no sources yet)');
  } else {
    for (const b of report.sourceDistribution) {
      const dom = report.sourceConcentration.dominantSource === b.bucket ? ' ⚠ dominant' : '';
      console.log(`  ${pad(b.bucket, 30)}  ${bar(b.share)}  ${rpad(b.count, 4)}  ${pct(b.share)}${dom}`);
    }
    console.log(
      `  limit                          ${pct(report.sourceConcentration.concentrationLimit)}`,
    );
  }

  // Campaigns
  header('Campaign distribution');
  if (report.campaignDistribution.length === 0) {
    console.log('  (no campaigns assigned)');
  } else {
    for (const b of report.campaignDistribution) {
      console.log(`  ${pad(b.bucket, 30)}  ${bar(b.share)}  ${rpad(b.count, 4)}  ${pct(b.share)}`);
    }
  }

  // Opportunity bands
  header('Opportunity distribution');
  for (const b of report.opportunityDistribution) {
    console.log(`  ${pad(b.bucket, 30)}  ${bar(b.share)}  ${rpad(b.count, 4)}  ${pct(b.share)}`);
  }

  // Planner sample
  header(`Sample diversified plan — budget ${budget}`);
  const industryCounts: Record<string, number> = {};
  for (const b of report.industryDistribution) {
    industryCounts[b.bucket] = b.count;
  }
  const plan = planDiversifiedDiscovery({
    queryBudget: budget,
    industryCounts,
  });
  if (plan.queries.length === 0) {
    console.log('  (planner produced no queries — every target industry was overrepresented)');
  } else {
    console.log('  per-industry quota:');
    for (const [ind, n] of Object.entries(plan.quotaPerIndustry).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )) {
      console.log(`    ${pad(ind, 30)}  ${rpad(n, 3)}`);
    }
    console.log('  queries:');
    for (const q of plan.queries.slice(0, 25)) {
      console.log(`    ${q.queryString}`);
    }
    if (plan.queries.length > 25) {
      console.log(`    ... +${plan.queries.length - 25} more`);
    }
  }

  console.log('');
  closeDb();
}

main();
