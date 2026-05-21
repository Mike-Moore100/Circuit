// Summary view of evidence captured across the database, or a single-
// company deep dive.
//
//   npm run debug:evidence
//   npm run debug:evidence -- "Lumen & Co Marketing"
import { closeDb, getDb } from '../src/db/client';
import {
  getAllCompanies,
  getEvidenceForCompany,
  getEvidenceStats,
  getLatestScore,
} from '../src/db/repository';

function main() {
  const query = process.argv.slice(2).join(' ').trim();
  const db = getDb();

  if (query) {
    const companies = getAllCompanies(db);
    const q = query.toLowerCase();
    const co =
      companies.find((c) => c.name.toLowerCase() === q) ??
      companies.find((c) => c.name.toLowerCase().includes(q));
    if (!co) {
      console.error(`No company matching "${query}".`);
      process.exit(1);
    }
    const evidence = getEvidenceForCompany(co.id, db);
    const score = getLatestScore(co.id, db);
    console.log('─────────────────────────────────────────────────────────────');
    console.log(`Company  : ${co.name}`);
    console.log(`Website  : ${co.website_url ?? '—'}`);
    console.log(`Campaign : ${score?.primary_campaign ?? '—'}`);
    console.log('');
    if (evidence.length === 0) {
      console.log('No evidence captured yet. Run `npm run extract:evidence`.');
    } else {
      console.log(`Evidence rows (${evidence.length}):`);
      for (const e of evidence) {
        const screenshot = e.screenshot_path ? ' [desktop]' : '';
        const mobile = e.mobile_screenshot_path ? ' [mobile]' : '';
        console.log(
          `  ${e.evidence_type.padEnd(36).slice(0, 36)}  conf=${e.confidence.toString().padStart(3)}  ${e.evidence_summary ?? ''}${screenshot}${mobile}`,
        );
      }
    }
    closeDb();
    return;
  }

  const stats = getEvidenceStats(db);
  console.log('Circuit — evidence summary');
  console.log('==========================');
  console.log('');
  console.log(`Companies with evidence  : ${stats.companiesWithEvidence}`);
  console.log(`Total evidence rows      : ${stats.totalEvidenceRows}`);
  console.log(`Desktop screenshots      : ${stats.withDesktopScreenshot}`);
  console.log(`Mobile screenshots       : ${stats.withMobileScreenshot}`);
  console.log('');
  console.log('By evidence type');
  const sorted = Object.entries(stats.byType).sort((a, b) => b[1] - a[1]);
  for (const [type, n] of sorted) {
    console.log(`  ${type.padEnd(36)}  ${n}`);
  }
  if (sorted.length === 0) {
    console.log('  (no evidence captured yet — run `npm run extract:evidence`)');
  }

  closeDb();
}

try {
  main();
} catch (err) {
  console.error('[debug:evidence] failed:', err);
  process.exit(1);
}
