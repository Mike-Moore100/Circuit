// debug:opportunities — the operator's view of the Command Center from
// the terminal. Surfaces six interesting cuts of the data so you can
// answer "what should I be working on right now?" without opening the UI.
//
//   1. highest-ranked opportunities (top opportunity score)
//   2. fastest-close candidates (low complexity × high accessibility)
//   3. strongest pain signals (operational pain leaders)
//   4. highest trust barriers (where proof-heavy approach matters)
//   5. most-reviewed opportunities (where the operator has the most context)
//   6. lowest-confidence opportunities (where we need more signal)
//
//   npm run debug:opportunities
//   npm run debug:opportunities -- --limit 5

import { closeDb, getDb } from '../src/db/client';
import {
  getAllCompanies,
  listOpportunityIntelligence,
} from '../src/db/repository';
import type { OpportunityIntelligence } from '../src/intelligence/intelligenceTypes';

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

function rpad(n: number | string, w = 3): string {
  return String(n).padStart(w);
}

interface OppRow {
  companyId: string;
  company: string;
  opportunityScore: number;
  attention: string;
  projectType: string;
  pain: number;
  readiness: number;
  accessibility: number;
  fit: number;
  trust: number;
  confidence: number;
  reviewCount: number;
}

function loadOpportunities(db: ReturnType<typeof getDb>, limit: number): OppRow[] {
  const rows = listOpportunityIntelligence(db, { limit: Math.max(limit * 4, 50) });
  const companies = getAllCompanies(db);
  const nameById = new Map(companies.map((c) => [c.id, c.name]));
  const reviewCounts = db
    .prepare(
      'SELECT company_id, COUNT(*) AS n FROM lead_reviews GROUP BY company_id',
    )
    .all() as Array<{ company_id: string; n: number }>;
  const reviewById = new Map(reviewCounts.map((r) => [r.company_id, r.n]));

  return rows.flatMap((r) => {
    let oi: OpportunityIntelligence | null = null;
    try {
      oi = JSON.parse(r.payload_json) as OpportunityIntelligence;
    } catch {
      return [];
    }
    return [{
      companyId: r.company_id,
      company: nameById.get(r.company_id) ?? r.company_id,
      opportunityScore: r.opportunity_score,
      attention: r.human_attention_priority,
      projectType: r.likely_project_type,
      pain: oi.operationalPain.score,
      readiness: oi.buyingReadiness.score,
      accessibility: oi.accessibility.score,
      fit: oi.implementationFit.score,
      trust: oi.trustBarrier.score,
      confidence: oi.evidenceConfidence.score,
      reviewCount: reviewById.get(r.company_id) ?? 0,
    }];
  });
}

function header(title: string) {
  console.log('');
  console.log(title);
  console.log('-'.repeat(title.length));
}

function table(rows: OppRow[], scoreLabel: string, picker: (r: OppRow) => number) {
  if (rows.length === 0) {
    console.log('  (no opportunities)');
    return;
  }
  console.log(
    `  ${pad('company', 36)}  ${pad('proj', 16)}  ${pad('att', 9)}  ${scoreLabel.padStart(6)}  opp`,
  );
  for (const r of rows) {
    const projLabel = r.projectType.toLowerCase().replace(/_/g, ' ');
    console.log(
      `  ${pad(r.company, 36)}  ${pad(projLabel, 16)}  ${pad(r.attention, 9)}  ${rpad(picker(r), 6)}  ${rpad(r.opportunityScore, 3)}`,
    );
  }
}

function main() {
  const args = process.argv.slice(2);
  let limit = 10;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      const v = Number(args[i + 1]);
      if (Number.isFinite(v)) limit = v;
      i++;
    }
  }
  const db = getDb();
  const all = loadOpportunities(db, limit);

  console.log('Circuit — debug:opportunities');
  console.log('=============================');
  console.log(`mode loaded ${all.length} opportunities · showing top ${limit} per cut`);

  // 1) Highest-ranked
  header('1. Highest-ranked opportunities');
  table(
    [...all].sort((a, b) => b.opportunityScore - a.opportunityScore).slice(0, limit),
    'score',
    (r) => r.opportunityScore,
  );

  // 2) Fastest-close — accessibility × fit × low trust barrier.
  //    Deterministic single composite, conservative weighting so trust
  //    can't dominate (it's bounded at -50).
  header('2. Fastest-close candidates (access × fit, low trust)');
  const fastClose = [...all]
    .map((r) => ({
      r,
      fc: r.accessibility * 0.45 + r.fit * 0.45 - r.trust * 0.5,
    }))
    .sort((a, b) => b.fc - a.fc)
    .slice(0, limit);
  table(fastClose.map((x) => x.r), 'fc', (_) => Math.round(fastClose.find((x) => x.r.companyId === _.companyId)!.fc));

  // 3) Strongest pain
  header('3. Strongest operational pain');
  table([...all].sort((a, b) => b.pain - a.pain).slice(0, limit), 'pain', (r) => r.pain);

  // 4) Highest trust barriers
  header('4. Highest trust barriers');
  table([...all].sort((a, b) => b.trust - a.trust).slice(0, limit), 'trust', (r) => r.trust);

  // 5) Most-reviewed — where the operator has invested the most attention
  header('5. Most-reviewed opportunities');
  const reviewed = [...all].filter((r) => r.reviewCount > 0);
  table(
    reviewed.sort((a, b) => b.reviewCount - a.reviewCount).slice(0, limit),
    'rvw',
    (r) => r.reviewCount,
  );

  // 6) Lowest evidence confidence — we need more signal before we can act
  header('6. Lowest evidence confidence (need more signal)');
  table(
    [...all].sort((a, b) => a.confidence - b.confidence).slice(0, limit),
    'conf',
    (r) => r.confidence,
  );

  console.log('');
  closeDb();
}

main();
