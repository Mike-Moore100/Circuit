// Inspect the Opportunity Intelligence layer. Surfaces top leads by
// composite score + each sub-score so the operator can see why the
// ranking ordered things the way it did.
//
//   npm run debug:intelligence
//   npm run debug:intelligence -- "Lumen & Co Marketing"
import { closeDb, getDb } from '../src/db/client';
import {
  getAllCompanies,
  getOpportunityIntelligence,
  listOpportunityIntelligence,
} from '../src/db/repository';
import type { OpportunityIntelligence } from '../src/intelligence/intelligenceTypes';

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

function ipad(n: number, w = 3): string {
  return String(n).padStart(w);
}

function name(id: string, byId: Map<string, string>): string {
  return byId.get(id) ?? id;
}

function main() {
  const query = process.argv.slice(2).join(' ').trim();
  const db = getDb();
  const companies = getAllCompanies(db);
  const byId = new Map(companies.map((c) => [c.id, c.name]));

  // Per-company deep dive --------------------------------------------------
  if (query) {
    const q = query.toLowerCase();
    const co =
      companies.find((c) => c.name.toLowerCase() === q) ??
      companies.find((c) => c.name.toLowerCase().includes(q));
    if (!co) {
      console.error(`No company matching "${query}".`);
      process.exit(1);
    }
    const row = getOpportunityIntelligence(co.id, db);
    if (!row) {
      console.error(`No intelligence row for "${co.name}". Run npm run seed first.`);
      process.exit(1);
    }
    const intel = JSON.parse(row.payload_json) as OpportunityIntelligence;
    console.log('─────────────────────────────────────────────────────────────');
    console.log(`Company  : ${co.name}`);
    console.log(`Website  : ${co.website_url ?? '—'}`);
    console.log(`Priority : ${row.human_attention_priority}`);
    console.log(`Score    : ${row.opportunity_score}  ·  ${row.likely_project_type}  ·  complexity=${row.estimated_project_complexity}  ·  potential=${row.estimated_commercial_potential}`);
    console.log('');
    console.log('Sub-scores');
    console.log(`  operational pain      : ${ipad(intel.operationalPain.score)}`);
    console.log(`  buying readiness      : ${ipad(intel.buyingReadiness.score)}`);
    console.log(`  accessibility         : ${ipad(intel.accessibility.score)}`);
    console.log(`  implementation fit    : ${ipad(intel.implementationFit.score)}`);
    console.log(`  trust barrier (-)     : ${ipad(intel.trustBarrier.score)}`);
    console.log(`  evidence confidence   : ${ipad(intel.evidenceConfidence.score)}`);
    console.log('');
    console.log('Why it ranked highly');
    for (const r of intel.opportunityReasons) console.log(`  + ${r}`);
    if (intel.opportunityReasons.length === 0) console.log('  (no positive reasons)');
    console.log('');
    console.log('Risk factors');
    for (const r of intel.riskFactors) console.log(`  - ${r}`);
    if (intel.riskFactors.length === 0) console.log('  (no risk factors)');
    console.log('');
    console.log('Strongest signals');
    for (const r of intel.strongestSignals) console.log(`  · ${r}`);
    closeDb();
    return;
  }

  // Roll-up view -----------------------------------------------------------
  const rows = listOpportunityIntelligence(db, { limit: 50 });
  if (rows.length === 0) {
    console.log('No intelligence rows yet. Run `npm run seed` first.');
    closeDb();
    return;
  }
  console.log('Circuit — Opportunity Intelligence');
  console.log('==================================');
  console.log('');
  console.log(
    `Rank  Score  Priority   Pain Read  Acc Fit Trust  Conf  Project              Lead`,
  );
  console.log(
    `----  -----  ---------- ---- ---- ---- ---- ---- ----  -------------------- ----------------`,
  );
  rows.forEach((r, i) => {
    console.log(
      `${ipad(i + 1, 4)}  ${ipad(r.opportunity_score, 5)}  ${pad(r.human_attention_priority, 10)} ${ipad(r.operational_pain_score, 4)} ${ipad(r.buying_readiness_score, 4)} ${ipad(r.accessibility_score, 4)} ${ipad(r.implementation_fit_score, 4)} ${ipad(r.trust_barrier_score, 4)} ${ipad(r.evidence_confidence_score, 4)}  ${pad(r.likely_project_type, 20)} ${name(r.company_id, byId).slice(0, 36)}`,
    );
  });

  console.log('');
  console.log('By priority bucket');
  const byPrio = new Map<string, number>();
  for (const r of rows) byPrio.set(r.human_attention_priority, (byPrio.get(r.human_attention_priority) ?? 0) + 1);
  for (const [p, n] of byPrio) console.log(`  ${pad(p, 10)} ${n}`);

  console.log('');
  console.log('Top by operational pain');
  rows
    .slice()
    .sort((a, b) => b.operational_pain_score - a.operational_pain_score)
    .slice(0, 5)
    .forEach((r) =>
      console.log(`  pain=${ipad(r.operational_pain_score, 3)}  ${name(r.company_id, byId)}`),
    );

  console.log('');
  console.log('Best contactability');
  rows
    .slice()
    .sort((a, b) => b.accessibility_score - a.accessibility_score)
    .slice(0, 5)
    .forEach((r) =>
      console.log(`  acc=${ipad(r.accessibility_score, 3)}   ${name(r.company_id, byId)}`),
    );

  console.log('');
  console.log('Lowest trust barrier (fast close)');
  rows
    .slice()
    .filter((r) => r.opportunity_score >= 50)
    .sort((a, b) => a.trust_barrier_score - b.trust_barrier_score)
    .slice(0, 5)
    .forEach((r) =>
      console.log(`  trust=${ipad(r.trust_barrier_score, 3)} opp=${ipad(r.opportunity_score, 3)}  ${name(r.company_id, byId)}`),
    );

  console.log('');
  console.log('Highest evidence confidence');
  rows
    .slice()
    .sort((a, b) => b.evidence_confidence_score - a.evidence_confidence_score)
    .slice(0, 5)
    .forEach((r) =>
      console.log(`  conf=${ipad(r.evidence_confidence_score, 3)}  ${name(r.company_id, byId)}`),
    );

  console.log('');
  console.log('Weakest evidence confidence');
  rows
    .slice()
    .sort((a, b) => a.evidence_confidence_score - b.evidence_confidence_score)
    .slice(0, 5)
    .forEach((r) =>
      console.log(`  conf=${ipad(r.evidence_confidence_score, 3)}  ${name(r.company_id, byId)}`),
    );

  closeDb();
}

try {
  main();
} catch (err) {
  console.error('[debug:intelligence] failed:', err);
  process.exit(1);
}
