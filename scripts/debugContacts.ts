// Print contact-discovery summary across the database.
//
//   npm run debug:contacts
//   npm run debug:contacts -- "Lumen & Co Marketing"  # one company deep dive
import { closeDb, getDb } from '../src/db/client';
import {
  getAllCompanies,
  getContactRoutesForCompany,
  getContactsForCompany,
  getContactStats,
} from '../src/db/repository';

function main() {
  const query = process.argv.slice(2).join(' ').trim();
  const db = getDb();

  if (query) {
    const companies = getAllCompanies(db);
    const q = query.toLowerCase();
    const co =
      companies.find((c) => c.name.toLowerCase() === q) ??
      companies.find((c) => c.name.toLowerCase().includes(q)) ??
      companies.find((c) => (c.domain ?? '').toLowerCase().includes(q));
    if (!co) {
      console.error(`No company matching "${query}".`);
      process.exit(1);
    }
    const contacts = getContactsForCompany(co.id, db);
    const routes = getContactRoutesForCompany(co.id, db);
    const sourceBreakdown: Record<string, number> = {};
    for (const c of contacts) {
      const key = c.source ?? 'unknown';
      sourceBreakdown[key] = (sourceBreakdown[key] ?? 0) + 1;
    }
    console.log('─────────────────────────────────────────────────────────────');
    console.log(`Company  : ${co.name}`);
    console.log(`Website  : ${co.website_url ?? '—'}`);
    console.log(`Industry : ${co.industry ?? '—'}`);
    if (Object.keys(sourceBreakdown).length > 0) {
      const parts = Object.entries(sourceBreakdown)
        .sort((a, b) => b[1] - a[1])
        .map(([s, n]) => `${s}=${n}`)
        .join(' · ');
      console.log(`Discovery: ${parts}`);
    }
    console.log('');
    console.log(`Contacts (${contacts.length})`);
    for (const c of contacts) {
      const primary = c.is_primary ? '★' : ' ';
      const source = (c.source ?? 'static').padEnd(12).slice(0, 12);
      // Legacy Phase-1 contacts populated only `confidence`; surface that
      // when the Phase-8 overall_confidence is null.
      const conf = c.overall_confidence ?? c.confidence ?? 0;
      console.log(
        `  ${primary} ${(c.name ?? '—').padEnd(28).slice(0, 28)}  ${(c.role ?? '—').padEnd(24).slice(0, 24)}  ${(c.email ?? '—').padEnd(38).slice(0, 38)}  ${c.email_status ?? '—'}  src=${source}  conf=${conf}`,
      );
      if (c.source_url) console.log(`    source: ${c.source_url}`);
    }
    console.log('');
    console.log(`Routes (${routes.length})`);
    for (const r of routes) {
      console.log(`  ${r.route_type.padEnd(22)}  conf=${r.confidence}  ${r.value}`);
    }
    closeDb();
    return;
  }

  const stats = getContactStats(db);
  console.log('Circuit — contact discovery');
  console.log('===========================');
  console.log('');
  console.log(`Active companies         : ${stats.total}`);
  console.log(`  with direct email      : ${stats.withDirectEmail}`);
  console.log(`  with guessed email     : ${stats.withGuessedEmail}`);
  console.log(`  with named DM          : ${stats.withNamedDm}`);
  console.log(`  with contact form      : ${stats.withForm}`);
  console.log(`  with phone             : ${stats.withPhone}`);
  console.log(`  with booking link      : ${stats.withBooking}`);
  console.log(`  no contact route       : ${stats.noContact}`);
  console.log('');
  console.log('Contact rows by discovery source');
  const sources = Object.entries(stats.bySource).sort((a, b) => b[1] - a[1]);
  if (sources.length === 0) {
    console.log('  (no contacts yet — run `npm run discover:contacts`)');
  } else {
    for (const [src, n] of sources) {
      console.log(`  ${src.padEnd(22)}  ${n}`);
    }
  }
  console.log('');
  if (stats.total > 0) {
    const pct = (n: number) => `${Math.round((n / stats.total) * 100)}%`;
    console.log('Coverage');
    console.log(`  direct email coverage  : ${pct(stats.withDirectEmail)}`);
    console.log(`  any-email coverage     : ${pct(stats.withDirectEmail + stats.withGuessedEmail)}`);
    console.log(`  reachable in any way   : ${pct(stats.total - stats.noContact)}`);
  }

  closeDb();
}

try {
  main();
} catch (err) {
  console.error('[debug:contacts] failed:', err);
  process.exit(1);
}
