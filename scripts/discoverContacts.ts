// Run contact discovery against every eligible company (priority A/B,
// non-REJECT campaign, has a website URL). Cache-first: skips companies
// inspected within the last 14 days unless --force.
//
//   npm run discover:contacts
//   npm run discover:contacts -- --force
//   npm run discover:contacts -- --limit 25
import { config } from '../src/config/index';
import { closeDb, getDb } from '../src/db/client';
import {
  getAllCompanies,
  getLatestScore,
} from '../src/db/repository';
import { discoverContactsForCompany } from '../src/contacts/contactDiscovery';
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
  const allowedCampaigns = new Set<string>(config.contactDiscovery.allowedCampaigns);
  const allowedPriorities = new Set(config.contactDiscovery.allowedPriorities);

  const all = getAllCompanies(db).filter((c) => !!c.website_url);
  const candidates: typeof all = [];
  for (const c of all) {
    const score = getLatestScore(c.id, db);
    if (!score) continue;
    const campaign = (score.primary_campaign ?? 'LOW_PRIORITY_NURTURE') as Campaign;
    if (!allowedCampaigns.has(campaign)) continue;
    if (!allowedPriorities.has(score.priority as 'A' | 'B' | 'C')) continue;
    candidates.push(c);
  }
  const target = limit ? candidates.slice(0, limit) : candidates;
  console.log(
    `[contacts] ${target.length} eligible companies (force=${force}, concurrency=${config.contactDiscovery.concurrency})`,
  );

  let ok = 0;
  let cached = 0;
  let failed = 0;
  let contactsTotal = 0;
  let withDirect = 0;
  const startedAt = Date.now();
  const concurrency = Math.max(1, Math.min(config.contactDiscovery.concurrency, target.length || 1));
  let cursor = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= target.length) return;
        const company = target[i];
        try {
          const result = await discoverContactsForCompany({
            companyId: company.id,
            websiteUrl: company.website_url,
            force,
            db,
          });
          if (result.fromCache) cached += 1;
          else ok += 1;
          contactsTotal += result.contacts.length;
          withDirect += result.contacts.filter(
            (c) => c.email && c.emailStatus === 'extracted',
          ).length;
          const tag = result.fromCache ? 'cached' : 'crawled';
          console.log(
            `  [${tag.padEnd(7)}]  ${company.name.padEnd(36).slice(0, 36)}  contacts=${result.contacts.length}  routes=${result.routes.length}  contactability=${result.contactabilityScore}`,
          );
        } catch (err) {
          failed += 1;
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`  [failed ]  ${company.name}: ${msg}`);
        }
      }
    }),
  );
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('');
  console.log(`[contacts] done in ${elapsed}s — crawled=${ok} cached=${cached} failed=${failed}`);
  console.log(`[contacts] contacts persisted=${contactsTotal} (direct emails=${withDirect})`);

  closeDb();
}

main().catch((err) => {
  console.error('[contacts] failed:', err);
  process.exit(1);
});
