// Phase 1 Discovery Diversity — industry balancing tests.

import { describe, it, expect } from 'vitest';
import { classifyIndustryBalance } from '../src/discovery/industryBalancing';

describe('classifyIndustryBalance', () => {
  it('treats an empty corpus as everything missing', () => {
    const out = classifyIndustryBalance(
      {},
      { targets: ['accountants', 'legal firm'] },
    );
    expect(out.classifications.map((c) => c.status)).toEqual(['missing', 'missing']);
  });

  it('marks a target with zero count as missing when corpus has data', () => {
    const out = classifyIndustryBalance(
      // 30 marketing agencies, no accountants. minCorpusSize default = 20.
      { 'marketing agency': 30 },
      { targets: ['accountants', 'marketing agency'] },
    );
    const acc = out.classifications.find((c) => c.industry === 'accountants');
    expect(acc?.status).toBe('missing');
  });

  it('flags overrepresentation past the concentration ceiling', () => {
    const out = classifyIndustryBalance(
      { 'marketing agency': 80, accountants: 20 },
      {
        targets: ['accountants', 'marketing agency'],
        maxConcentration: 0.7,
      },
    );
    const mkt = out.classifications.find((c) => c.industry === 'marketing agency');
    expect(mkt?.status).toBe('overrepresented');
    expect(out.deprioritize).toContain('marketing agency');
  });

  it('forces every industry under minCorpusSize into missing / underrepresented', () => {
    const out = classifyIndustryBalance(
      // 5 marketing agencies — below minCorpusSize default = 20.
      { 'marketing agency': 5 },
      { targets: ['accountants', 'marketing agency'] },
    );
    const mkt = out.classifications.find((c) => c.industry === 'marketing agency');
    const acc = out.classifications.find((c) => c.industry === 'accountants');
    expect(mkt?.status).toBe('underrepresented');
    expect(acc?.status).toBe('missing');
  });

  it('treats balanced industries as balanced once corpus passes minCorpusSize', () => {
    const out = classifyIndustryBalance(
      // 10 each — 33% share apiece, below the default 35% concentration ceiling.
      { accountants: 10, 'marketing agency': 10, 'legal firm': 10 },
      {
        targets: ['accountants', 'marketing agency', 'legal firm'],
        underrepresentedRatio: 0.5,
      },
    );
    expect(out.classifications.every((c) => c.status === 'balanced')).toBe(true);
  });

  it('keeps the priority lists ordered: overrepresented, missing, underrepresented, balanced', () => {
    const out = classifyIndustryBalance(
      // marketing: 60% over; accountants: 5% under; legal: missing; estate: balanced
      {
        'marketing agency': 60,
        accountants: 5,
        'estate agents': 35,
      },
      {
        targets: ['accountants', 'estate agents', 'legal firm', 'marketing agency'],
        maxConcentration: 0.5,
        underrepresentedRatio: 0.5,
      },
    );
    const statusOrder = out.classifications.map((c) => c.status);
    // Overrepresented appears before missing appears before underrepresented appears before balanced.
    const expectedOrder = ['overrepresented', 'missing', 'underrepresented', 'balanced'];
    const seen: string[] = [];
    for (const s of statusOrder) if (!seen.includes(s)) seen.push(s);
    for (const s of seen) {
      expect(expectedOrder).toContain(s);
    }
    // Order check: each transition must respect expectedOrder.
    for (let i = 1; i < statusOrder.length; i++) {
      const prev = expectedOrder.indexOf(statusOrder[i - 1]);
      const curr = expectedOrder.indexOf(statusOrder[i]);
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });

  it('surfaces untargeted industries separately', () => {
    const out = classifyIndustryBalance(
      { accountants: 10, 'florist shop': 4 },
      { targets: ['accountants'] },
    );
    expect(out.untargeted.map((u) => u.industry)).toEqual(['florist shop']);
    expect(out.classifications.find((c) => c.industry === 'florist shop')).toBeUndefined();
  });
});
