// Reset and seed the local SQLite database with the mock connector's leads.
// Also runs evidence extraction (screenshots + visual issues) so the
// dashboard is complete after one command. Safe to re-run; the file is
// wiped at the start.
//
//   npm run seed
//   npm run seed -- --skip-evidence    (faster, no Playwright)
import { config } from '../src/config/index';
import { resetDb, closeDb, getDb } from '../src/db/client';
import { runLeadSourcingPipeline } from '../src/pipeline/runLeadSourcingPipeline';
import { mockSourceConnector } from '../src/sources/index';
import { extractEvidenceForCompany } from '../src/evidence/evidenceScoring';
import { getAllCompanies, getLatestScore } from '../src/db/repository';
import type { Campaign } from '../src/scoring/campaignTypes';

const skipEvidence = process.argv.includes('--skip-evidence');

async function main() {
  console.log('[seed] resetting database…');
  resetDb();

  console.log('[seed] running pipeline against mock connector…');
  const summary = await runLeadSourcingPipeline({ sources: [mockSourceConnector] });

  console.log('[seed] pipeline done.');
  console.log(`        fetched: ${summary.totalFetched}`);
  console.log(`        accepted into review queue: ${summary.accepted}`);
  console.log(`        rejected: ${summary.rejected}`);
  console.log(`        priorities: A=${summary.byPriority.A} B=${summary.byPriority.B} C=${summary.byPriority.C} Reject=${summary.byPriority.Reject}`);

  if (skipEvidence) {
    console.log('[seed] skipping evidence extraction (--skip-evidence). Run `npm run extract:evidence` later.');
    closeDb();
    return;
  }

  if (!config.evidence.enabled) {
    console.log('[seed] evidence extraction disabled via EVIDENCE_ENABLED=0; skipping.');
    closeDb();
    return;
  }

  // Pick eligible leads by the same rules the extract:evidence CLI uses.
  const db = getDb();
  const allowedCampaigns = new Set<string>(config.evidence.allowedCampaigns);
  const allowedPriorities = new Set(config.evidence.allowedPriorities);
  const eligible: Array<{ id: string; name: string; url: string; campaign: Campaign }> = [];
  for (const co of getAllCompanies(db)) {
    if (!co.website_url) continue;
    const score = getLatestScore(co.id, db);
    if (!score) continue;
    const campaign = (score.primary_campaign ?? 'LOW_PRIORITY_NURTURE') as Campaign;
    if (!allowedCampaigns.has(campaign)) continue;
    if (!allowedPriorities.has(score.priority as 'A' | 'B' | 'C')) continue;
    eligible.push({ id: co.id, name: co.name, url: co.website_url, campaign });
  }

  const cap = config.evidence.maxLeadsPerRun;
  const target = eligible.slice(0, cap);

  console.log(`[seed] extracting evidence on ${target.length} top leads…`);
  const startedAt = Date.now();
  let ok = 0;
  let partial = 0;
  for (const co of target) {
    try {
      const result = await extractEvidenceForCompany({
        companyId: co.id,
        websiteUrl: co.url,
        campaign: co.campaign,
        db,
      });
      const tag = result.errorMessage ? 'partial' : 'ok     ';
      if (result.errorMessage) partial += 1;
      else ok += 1;
      console.log(
        `        [${tag}] ${co.name.padEnd(34).slice(0, 34)}  ${co.campaign.padEnd(20)}  conf=${result.evidenceConfidence}`,
      );
    } catch (err) {
      partial += 1;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`        [failed ] ${co.name}: ${msg}`);
    }
  }
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[seed] evidence done in ${elapsed}s — ok=${ok} partial=${partial}`);

  closeDb();
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
