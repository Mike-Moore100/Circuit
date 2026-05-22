// Phase 1 — industry normaliser tests.

import { describe, it, expect } from 'vitest';
import {
  CANONICAL_INDUSTRIES,
  isCanonicalIndustry,
  normaliseFromCandidates,
  normaliseIndustry,
} from '../src/discovery/industryNormalizer';

describe('normaliseIndustry — canonical mapping', () => {
  it.each<[string, string]>([
    // recruitment cluster
    ['recruitment agency', 'recruitment agency'],
    ['Recruiters Manchester', 'recruitment agency'],
    ['Staffing Agency London', 'recruitment agency'],
    ['talent agency leeds', 'recruitment agency'],
    // accounting cluster
    ['accountants', 'accountants'],
    ['Chartered Accountants Leeds', 'accountants'],
    ['accountancy services bristol', 'accountants'],
    ['Bookkeeping Services Birmingham', 'bookkeeping services'],
    ['Book-keeping Manchester', 'bookkeeping services'],
    // property cluster
    ['estate agents london', 'estate agents'],
    ['Lettings Agent Cardiff', 'estate agents'],
    ['property management glasgow', 'property management'],
    ['Block Managers Newcastle', 'property management'],
    // legal cluster
    ['Solicitors Birmingham', 'legal services'],
    ['Law Firm London', 'legal services'],
    ['legal services edinburgh', 'legal services'],
    ['conveyancing solicitors leeds', 'conveyancing solicitors'],
    // marketing / web cluster
    ['marketing agency london', 'marketing agency'],
    ['Digital Marketing Liverpool', 'marketing agency'],
    ['web design agency leeds', 'web agency'],
    ['Design Studio Glasgow', 'design studio'],
    // healthcare cluster
    ['healthcare staffing agency Cardiff', 'healthcare staffing agency'],
    ['healthcare admin company', 'healthcare admin'],
    // others
    ['payroll services bristol', 'payroll services'],
    ['logistics company manchester', 'logistics company'],
    ['Consultants London', 'consultants'],
  ])('normalises "%s" → "%s"', (input, expected) => {
    expect(normaliseIndustry(input).industry).toBe(expected);
  });

  it('returns null for inputs that do not match any rule', () => {
    expect(normaliseIndustry('Tea shop').industry).toBeNull();
    expect(normaliseIndustry('Florist').industry).toBeNull();
  });

  it('returns null safely for null/undefined/empty input', () => {
    expect(normaliseIndustry(null).industry).toBeNull();
    expect(normaliseIndustry(undefined).industry).toBeNull();
    expect(normaliseIndustry('').industry).toBeNull();
    expect(normaliseIndustry('   ').industry).toBeNull();
  });

  it('prefers more specific rules over generic ones', () => {
    // "conveyancing solicitors" must NOT fall through to "legal services".
    const r = normaliseIndustry('conveyancing solicitors birmingham');
    expect(r.industry).toBe('conveyancing solicitors');
    // "healthcare staffing" must NOT fall through to "recruitment agency".
    const h = normaliseIndustry('healthcare staffing agency cardiff');
    expect(h.industry).toBe('healthcare staffing agency');
  });

  it('every canonical industry is a value the matcher itself can return', () => {
    // Calling normaliseIndustry on each canonical label must produce
    // either that label or null — never some other canonical label.
    for (const canonical of CANONICAL_INDUSTRIES) {
      const r = normaliseIndustry(canonical);
      if (r.industry) expect(r.industry).toBe(canonical);
    }
  });

  it('weights confidence by source — query > website', () => {
    const fromQuery = normaliseIndustry('accountants leeds', 'query');
    const fromWebsite = normaliseIndustry('accountants leeds', 'website');
    expect(fromQuery.confidence).toBeGreaterThan(fromWebsite.confidence);
  });
});

describe('normaliseFromCandidates', () => {
  it('returns the first non-null match in priority order', () => {
    const r = normaliseFromCandidates([
      { text: 'random business name', source: 'name' },
      { text: 'accountants leeds', source: 'query' },
      { text: 'web agency london', source: 'title' },
    ]);
    expect(r.industry).toBe('accountants');
    expect(r.source).toBe('query');
  });

  it('returns null when no candidate matches', () => {
    const r = normaliseFromCandidates([
      { text: 'florist', source: 'name' },
      { text: null, source: 'query' },
    ]);
    expect(r.industry).toBeNull();
  });
});

describe('isCanonicalIndustry', () => {
  it.each(CANONICAL_INDUSTRIES)('accepts canonical label "%s"', (s) => {
    expect(isCanonicalIndustry(s)).toBe(true);
  });

  it('rejects free-form text', () => {
    expect(isCanonicalIndustry('Accountants')).toBe(false); // case-sensitive
    expect(isCanonicalIndustry('marketing')).toBe(false);
    expect(isCanonicalIndustry(null)).toBe(false);
    expect(isCanonicalIndustry('')).toBe(false);
  });
});
