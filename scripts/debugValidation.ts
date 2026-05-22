// debug:validation — Phase 1 Live Validation terminal view. Answers the
// only question that matters at this phase: "is the opportunity
// intelligence layer actually surfacing leads the operator wants to
// contact?"
//
// Reads the same source of truth as /validation (operatorAgreement +
// commercialWeakness + outcome distribution) so the two surfaces never
// disagree. Scoring-calibration debug lives in `npm run debug:calibration`.
//
//   npm run debug:validation
//   npm run debug:validation -- --limit 10

import { closeDb } from '../src/db/client';
import { getValidationData } from '../app/_lib/validationData';

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}
function rpad(n: number | string, w = 3): string {
  return String(n).padStart(w);
}
function pct(rate: number | null): string {
  if (rate === null) return '—';
  return `${Math.round(rate * 100)}%`;
}

function header(title: string) {
  console.log('');
  console.log(title);
  console.log('-'.repeat(title.length));
}

interface MiniLead {
  opportunityScore: number;
  company: string;
  attentionPriority: string;
  trustBarrier: number;
  operationalPain: number;
  approved: boolean;
  rejected: boolean;
  latestOutcome: string | null;
}

function leadRow(l: MiniLead): string {
  const verdict = l.approved ? '✓' : l.rejected ? '✗' : ' ';
  const outcome = l.latestOutcome ? l.latestOutcome.toLowerCase().replace(/_/g, ' ') : '';
  return `  ${rpad(l.opportunityScore, 3)}  ${pad(l.company, 38)}  ${pad(
    l.attentionPriority,
    9,
  )}  ${rpad(l.trustBarrier, 3)}  ${rpad(l.operationalPain, 3)}  ${verdict}  ${outcome}`;
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

  const data = getValidationData();
  const m = data.metrics;

  console.log('Circuit — debug:validation');
  console.log('==========================');
  console.log('');
  console.log(`reviewed leads        : ${m.totalReviewed}`);
  console.log(`high-score reviewed   : ${m.totalHighScore}`);
  console.log(`low-score reviewed    : ${m.totalLowScore}`);
  console.log(`agreement rate        : ${pct(m.operatorAgreementRate)}`);
  console.log(`disagreement rate     : ${pct(m.operatorDisagreementRate)}`);
  console.log(
    `false positive rate   : ${pct(m.falsePositiveRate)} (${m.highScoreRejected}/${m.totalHighScore})`,
  );
  console.log(
    `false negative rate   : ${pct(m.falseNegativeRate)} (${m.lowScoreApproved}/${m.totalLowScore})`,
  );
  console.log(
    `ranking confidence    : ${
      m.rankingConfidence === null ? '— (need 5+ reviews)' : `${m.rankingConfidence}/100`
    }`,
  );

  // 1) Top-ranked real leads
  header('1. Top-ranked real leads');
  console.log(`  ${pad('opp', 3)}  ${pad('company', 38)}  ${pad('att', 9)}  trust  pain  v  outcome`);
  for (const l of data.topRanked.slice(0, limit)) console.log(leadRow(l));

  // 2) Highest operator agreement
  header('2. Highest operator-approved leads');
  if (data.highestApproved.length === 0) {
    console.log('  (no approvals yet — mark a few leads "Would contact" on /opportunities)');
  } else {
    for (const l of data.highestApproved.slice(0, limit)) console.log(leadRow(l));
  }

  // 3) Strongest commercial opportunities (= top conversion opportunities)
  header('3. Strongest commercial opportunities (high opp + weak onboarding)');
  if (data.conversionOpportunities.length === 0) {
    console.log('  (no high-opp leads with weak onboarding flow detected)');
  } else {
    for (const l of data.conversionOpportunities.slice(0, limit)) console.log(leadRow(l));
  }

  // 4) Trust barrier patterns
  header('4. Highest trust barriers');
  if (data.highestTrustBarrier.every((l) => l.trustBarrier === 0)) {
    console.log('  (no trust barrier scoring yet — need inspector signals first)');
  } else {
    for (const l of data.highestTrustBarrier.slice(0, limit)) console.log(leadRow(l));
  }

  // 5) False positive patterns — high-score rejected
  header('5. False positive patterns (high score · rejected)');
  if (data.scoreVsAgreement.highScoreRejected.length === 0) {
    console.log('  (no false positives — every high-score lead the operator reviewed was approved)');
  } else {
    for (const l of data.scoreVsAgreement.highScoreRejected.slice(0, limit)) console.log(leadRow(l));
  }

  // 6) Commercial pain patterns
  header('6. Commercial pain patterns (across the corpus)');
  if (data.commercialPainPatterns.length === 0) {
    console.log('  (no patterns detected yet)');
  } else {
    for (const p of data.commercialPainPatterns) {
      console.log(`  ${pad(p.label, 32)}  ${rpad(p.count, 3)} companies`);
    }
  }

  // 7) Outcome distribution
  header('7. Outcome distribution');
  const dist = Object.entries(data.outcomeDistribution).sort((a, b) => b[1] - a[1]);
  if (dist.length === 0) {
    console.log('  (no outcomes recorded yet — record some on /opportunities → drawer)');
  } else {
    for (const [type, count] of dist) {
      console.log(`  ${pad(type, 22)}  ${rpad(count, 3)}`);
    }
  }

  console.log('');
  closeDb();
}

main();
