// Capture desktop + mobile screenshots, detect visual issues, and extract
// operational-clue language for eligible leads. Slow (Playwright) — kept
// out of the main pipeline by default; run this when you want fresh proof.
//
//   npm run extract:evidence
//   npm run extract:evidence -- --force
//   npm run extract:evidence -- --limit 10
import { config } from '../src/config/index';
import { closeDb, getDb } from '../src/db/client';
import { getAllCompanies, getLatestScore } from '../src/db/repository';
import { extractEvidenceForCompany } from '../src/evidence/evidenceScoring';
import type { Campaign } from '../src/scoring/campaignTypes';

interface Args {
  force: boolean;
  limit: number | null;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let force = false;
  let limit: number | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--force' || a === '-f') force = true;
    else if (a === '--limit' || a === '-n') {
      const v = Number(args[i + 1]);
      if (Number.isFinite(v)) limit = v;
      i += 1;
    }
  }
  return { force, limit };
}

async function main() {
  const { force, limit } = parseArgs();
  const db = getDb();
  const allowedCampaigns = new Set<string>(config.evidence.allowedCampaigns);
  const allowedPriorities = new Set(config.evidence.allowedPriorities);

  const all = getAllCompanies(db).filter((c) => !!c.website_url);
  const candidates: Array<{ id: string; name: string; website_url: string; campaign: Campaign }> = [];
  for (const c of all) {
    const score = getLatestScore(c.id, db);
    if (!score) continue;
    const campaign = (score.primary_campaign ?? 'LOW_PRIORITY_NURTURE') as Campaign;
    if (!allowedCampaigns.has(campaign)) continue;
    if (!allowedPriorities.has(score.priority as 'A' | 'B' | 'C')) continue;
    candidates.push({
      id: c.id,
      name: c.name,
      website_url: c.website_url!,
      campaign,
    });
  }

  const cap = config.evidence.maxLeadsPerRun;
  const target = candidates.slice(0, limit ?? cap);
  console.log(
    `[evidence] ${target.length} eligible leads (force=${force}, cap=${cap})`,
  );

  const startedAt = Date.now();
  let okCount = 0;
  let cached = 0;
  let failed = 0;
  for (const co of target) {
    try {
      const result = await extractEvidenceForCompany({
        companyId: co.id,
        websiteUrl: co.website_url,
        campaign: co.campaign,
        force,
        db,
      });
      const tag = result.fromCache ? 'cached  ' : result.errorMessage ? 'partial' : 'ok      ';
      if (result.fromCache) cached += 1;
      else if (!result.errorMessage) okCount += 1;
      else failed += 1;
      console.log(
        `  [${tag}] ${co.name.padEnd(36).slice(0, 36)}  ${co.campaign.padEnd(22)}  issues=${result.visualIssues.length}  clues=${result.operationalClues.length}  conf=${result.evidenceConfidence}`,
      );
      if (result.errorMessage) console.log(`      note: ${result.errorMessage}`);
    } catch (err) {
      failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  [failed ] ${co.name}: ${msg}`);
    }
  }
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('');
  console.log(`[evidence] done in ${elapsed}s — ok=${okCount} cached=${cached} failed=${failed}`);

  closeDb();
}

main().catch((err) => {
  console.error('[evidence] failed:', err);
  process.exit(1);
});
