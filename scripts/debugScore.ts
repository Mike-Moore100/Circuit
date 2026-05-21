// Prints an explainable score breakdown for every test fixture, or for a
// single company name passed as argv. Useful while tuning scoring weights.
//
//   npm run debug:score
//   npm run debug:score -- "Lumen & Co Marketing"
import { TEST_LEAD_FIXTURES, fixtureByCompanyName } from '../src/debug/testLeadFixtures';
import { explainScoreFor } from '../src/debug/explainScore';

const filter = process.argv.slice(2).join(' ').trim();

const leads = filter
  ? [fixtureByCompanyName(filter)].filter((l): l is NonNullable<typeof l> => !!l)
  : TEST_LEAD_FIXTURES;

if (leads.length === 0) {
  console.error(`No fixture matches "${filter}". Available companies:`);
  for (const l of TEST_LEAD_FIXTURES) console.error(`  - ${l.companyName}`);
  process.exit(1);
}

const ranked = leads
  .map((lead) => ({ lead, result: explainScoreFor(lead) }))
  .sort((a, b) => b.result.combined.finalScore - a.result.combined.finalScore);

for (const { result } of ranked) {
  console.log(result.text);
}

console.log('─────────────────────────────────────────────────────────────');
console.log('Summary (ranked):');
for (const { lead, result } of ranked) {
  console.log(
    `  ${result.combined.priority}  ${result.combined.finalScore
      .toString()
      .padStart(3)}  ${lead.companyName}`,
  );
}
