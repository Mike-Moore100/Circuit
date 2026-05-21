// Print all signals — raw source + verified — for a given company.
//
//   npm run debug:signals -- "Lumen & Co Marketing"
//   npm run debug:signals -- lumenand.co
import { closeDb, getDb } from '../src/db/client';
import {
  extractDomain,
  getAllCompanies,
  getContactsForCompany,
  getInspectionByCompany,
  getSignalsForCompany,
} from '../src/db/repository';

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
    console.error('Usage: npm run debug:signals -- "<company name or domain>"');
    process.exit(2);
  }
  const company = findCompany(query);
  if (!company) {
    console.error(`No company matching "${query}".`);
    process.exit(1);
  }
  const db = getDb();
  const signals = getSignalsForCompany(company.id, db);
  const contacts = getContactsForCompany(company.id, db);
  const inspection = getInspectionByCompany(company.id, db);

  console.log('─────────────────────────────────────────────────────────────');
  console.log(`Company:   ${company.name}`);
  console.log(`Domain:    ${extractDomain(company.website_url) ?? '—'}`);
  console.log(`Website:   ${company.website_url ?? '—'}`);
  console.log(`Industry:  ${company.industry ?? '—'}`);
  console.log(`Source:    ${company.source}`);
  console.log(`Status:    ${company.status}`);

  console.log('');
  console.log(`Contacts (${contacts.length})`);
  for (const c of contacts) {
    console.log(`  ${c.name ?? '—'} (${c.role ?? '—'})  ${c.email ?? ''} ${c.linkedin_url ?? ''}`);
  }

  if (inspection) {
    console.log('');
    console.log('Last inspection:');
    console.log(`  status        : ${inspection.status}`);
    console.log(`  fetched_at    : ${inspection.fetched_at}`);
    console.log(`  status_code   : ${inspection.status_code ?? '—'}`);
    console.log(`  title         : ${inspection.title ?? '—'}`);
    if (inspection.error_message) {
      console.log(`  error         : ${inspection.error_message}`);
    }
  } else {
    console.log('');
    console.log('No website inspection recorded yet.');
  }

  console.log('');
  console.log(`Signals (${signals.length})`);
  const grouped: Record<string, typeof signals> = {};
  for (const s of signals) {
    (grouped[s.source] ??= []).push(s);
  }
  for (const [source, list] of Object.entries(grouped)) {
    console.log(`  source: ${source}`);
    for (const s of list) {
      console.log(`    [${s.confidence.toString().padStart(3)}]  ${s.type.padEnd(40)}  ${s.value}`);
    }
  }
  closeDb();
}

main().catch((err) => {
  console.error('[debug:signals] failed:', err);
  process.exit(1);
});
