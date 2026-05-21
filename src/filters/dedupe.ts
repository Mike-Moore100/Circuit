import type { RawLead } from '../types/index';
import { extractDomain } from '../db/repository';

function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(inc|llc|ltd|limited|co|corp|company|group|gmbh|plc)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// In-memory dedupe across a batch of leads from one pipeline run. We dedupe
// on domain when present, falling back to a normalised company name.
export function dedupeLeads(leads: RawLead[]): { unique: RawLead[]; dropped: number } {
  const seen = new Map<string, RawLead>();
  let dropped = 0;
  for (const lead of leads) {
    const domain = extractDomain(lead.websiteUrl);
    const key = domain ?? `name:${normaliseName(lead.companyName)}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, lead);
      continue;
    }
    // Merge: keep the richer record (more non-null fields wins).
    const merged = mergeLead(existing, lead);
    seen.set(key, merged);
    dropped += 1;
  }
  return { unique: Array.from(seen.values()), dropped };
}

function richness(lead: RawLead): number {
  return [
    lead.websiteUrl,
    lead.industry,
    lead.location,
    lead.sizeEstimate,
    lead.contactName,
    lead.contactRole,
    lead.contactEmail,
    lead.linkedinUrl,
    lead.notes,
  ].filter((v) => v !== null && v !== undefined && v !== '').length;
}

function mergeLead(a: RawLead, b: RawLead): RawLead {
  const primary = richness(a) >= richness(b) ? a : b;
  const secondary = primary === a ? b : a;
  const pick = <K extends keyof RawLead>(k: K): RawLead[K] =>
    (primary[k] ?? secondary[k]) as RawLead[K];
  return {
    companyName: pick('companyName'),
    websiteUrl: pick('websiteUrl'),
    industry: pick('industry'),
    location: pick('location'),
    sizeEstimate: pick('sizeEstimate'),
    source: primary.source,
    sourceUrl: pick('sourceUrl'),
    contactName: pick('contactName'),
    contactRole: pick('contactRole'),
    contactEmail: pick('contactEmail'),
    linkedinUrl: pick('linkedinUrl'),
    notes: pick('notes'),
    signals: [...a.signals, ...b.signals],
  };
}
