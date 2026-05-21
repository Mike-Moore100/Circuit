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
    console.log('─────────────────────────────────────────────────────────────');
    console.log(`Company  : ${co.name}`);
    console.log(`Website  : ${co.website_url ?? '—'}`);
    console.log(`Industry : ${co.industry ?? '—'}`);
    console.log('');
    console.log(`Contacts (${contacts.length})`);
    for (const c of contacts) {
      const primary = c.is_primary ? '★' : ' ';
      console.log(
        `  ${primary} ${(c.name ?? '—').padEnd(28).slice(0, 28)}  ${(c.role ?? '—').padEnd(24).slice(0, 24)}  ${(c.email ?? '—').padEnd(38).slice(0, 38)}  ${c.email_status ?? '—'}  conf=${c.overall_confidence ?? 0}`,
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
