// Print everything we know about the AI analysis for one company.
//
//   npm run debug:ai -- "Lumen & Co Marketing"
//   npm run debug:ai -- lumenand.co
//
import { closeDb, getDb } from '../src/db/client';
import { getAllAnalysesForCompany, getAllCompanies, getLatestScore } from '../src/db/repository';
import { getLatestAnalysisForCompany, rowToAnalysis } from '../src/ai/aiCache';
import { config } from '../src/config/index';
import { getTodaySpendUsd } from '../src/ai/aiBudget';

function findCompany(query: string) {
  const db = getDb();
  const companies = getAllCompanies(db);
  const q = query.toLowerCase();
  return (
    companies.find((c) => c.name.toLowerCase() === q) ??
    companies.find((c) => c.domain && c.domain.toLowerCase() === q) ??
    companies.find((c) => c.name.toLowerCase().includes(q)) ??
    companies.find((c) => (c.domain ?? '').toLowerCase().includes(q))
  );
}

async function main() {
  const query = process.argv.slice(2).join(' ').trim();
  if (!query) {
    console.error('Usage: npm run debug:ai -- "<company name or domain>"');
    process.exit(2);
  }
  const company = findCompany(query);
  if (!company) {
    console.error(`No company matching "${query}".`);
    process.exit(1);
  }
  const db = getDb();
  const score = getLatestScore(company.id, db);
  const latest = getLatestAnalysisForCompany(company.id, db);
  const history = getAllAnalysesForCompany(company.id, db);
  const todaySpend = getTodaySpendUsd(db);

  console.log('─────────────────────────────────────────────────────────────');
  console.log(`Company   : ${company.name}`);
  console.log(`Website   : ${company.website_url ?? '—'}`);
  console.log(`Industry  : ${company.industry ?? '—'}`);
  console.log(`Status    : ${company.status}`);
  if (score) {
    const inAllowList = config.aiAnalysis.allowedPriorities.includes(score.priority as 'A' | 'B' | 'C');
    console.log(`Score     : ${score.final_score}  (priority ${score.priority})  rule=${score.rule_score} intent=${score.intent_score}`);
    console.log(`Eligible  : ${inAllowList ? 'YES — priority is in allow list' : 'NO — priority not in allow list ' + config.aiAnalysis.allowedPriorities.join(',')}`);
  } else {
    console.log('Score     : (no score row — pipeline has not run on this lead)');
  }
  console.log('');
  console.log('Budget');
  console.log(`  Daily limit  : $${config.aiAnalysis.dailyCostLimitUsd.toFixed(2)}`);
  console.log(`  Spent today  : $${todaySpend.toFixed(4)}`);
  console.log(`  Remaining    : $${(config.aiAnalysis.dailyCostLimitUsd - todaySpend).toFixed(4)}`);
  console.log('');

  if (!latest) {
    console.log('No AI analysis has been run on this company yet.');
    closeDb();
    return;
  }

  console.log(`Latest analysis: ${latest.id}`);
  console.log(`  status         : ${latest.status}`);
  console.log(`  feedback       : ${latest.feedback_status}${latest.feedback_notes ? ` — ${latest.feedback_notes}` : ''}`);
  console.log(`  provider/model : ${latest.ai_provider} / ${latest.model}`);
  console.log(`  prompt_version : ${latest.prompt_version}`);
  console.log(`  input_hash     : ${latest.input_hash.slice(0, 16)}…`);
  console.log(`  tokens         : input=${latest.tokens_input}  cached=${latest.tokens_cached}  output=${latest.tokens_output}`);
  console.log(`  estimated cost : $${latest.estimated_cost.toFixed(5)}`);
  console.log(`  created_at     : ${latest.created_at}`);
  if (latest.error_message) console.log(`  note           : ${latest.error_message}`);

  const analysis = rowToAnalysis(latest);
  if (analysis) {
    console.log('');
    console.log('Summary');
    console.log(`  ${analysis.summary}`);
    console.log(`  confidence: ${analysis.confidence}`);
    console.log('');
    console.log('Operational pain points');
    for (const p of analysis.operationalPainPoints) {
      console.log(`  - ${p.title}  [conf ${p.confidence}]`);
      console.log(`      ${p.description}`);
      if (p.evidence.length > 0) console.log(`      evidence: ${p.evidence.join(' · ')}`);
    }
    console.log('');
    console.log('Automation opportunities');
    for (const o of analysis.automationOpportunities) {
      console.log(`  - ${o.title}  [conf ${o.confidence}, ${o.implementationComplexity}]`);
      console.log(`      ${o.description}`);
      console.log(`      impact: ${o.businessImpact}`);
    }
    console.log('');
    console.log(`Likely buyer  : ${analysis.likelyBuyer.role}  [conf ${analysis.likelyBuyer.confidence}]`);
    console.log(`  reasoning   : ${analysis.likelyBuyer.reasoning}`);
    console.log('');
    console.log(`Urgency       : ${analysis.urgencyAssessment.level}`);
    console.log(`  reasoning   : ${analysis.urgencyAssessment.reasoning}`);
    if (analysis.proofAngles.length > 0) {
      console.log('');
      console.log('Proof angles');
      for (const p of analysis.proofAngles) {
        console.log(`  - ${p.title}: ${p.description}`);
      }
    }
    if (analysis.risksOrObjections.length > 0) {
      console.log('');
      console.log('Risks / objections');
      for (const r of analysis.risksOrObjections) console.log(`  - ${r}`);
    }
  }

  if (history.length > 1) {
    console.log('');
    console.log(`History (${history.length} total)`);
    for (const h of history.slice(0, 5)) {
      console.log(`  ${h.created_at}  ${h.status.padEnd(7)}  conf=${h.confidence ?? '—'}  cost=$${h.estimated_cost.toFixed(5)}  feedback=${h.feedback_status}`);
    }
  }

  closeDb();
}

main().catch((err) => {
  console.error('[debug:ai] failed:', err);
  process.exit(1);
});
