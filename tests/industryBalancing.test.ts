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

  it('flags an industry over its cap as overrepresented even below minCorpusSize', () => {
    // Phase 1 rebalance — hard caps are hard. A 100%-of-corpus
    // industry is overrepresented regardless of how small the corpus
    // is, otherwise discovery keeps adding more of it.
    const out = classifyIndustryBalance(
      { 'marketing agency': 5 },
      { targets: ['accountants', 'marketing agency'] },
    );
    const mkt = out.classifications.find((c) => c.industry === 'marketing agency');
    const acc = out.classifications.find((c) => c.industry === 'accountants');
    expect(mkt?.status).toBe('overrepresented');
    // Accountants still classified as 'missing' (count=0) — that part
    // of the small-corpus logic still applies to within-cap industries.
    expect(acc?.status).toBe('missing');
  });

  it('treats a within-cap industry as underrepresented when corpus is small', () => {
    // 5 accountants total — under minCorpusSize, but accountants share
    // (100%) exceeds the 20% general cap. So this should be overrepresented.
    // To exercise the "small corpus, under cap" path, use a small balanced
    // distribution.
    const out = classifyIndustryBalance(
      { accountants: 2, 'recruitment agency': 2, 'legal services': 2, 'estate agents': 2, 'care agency': 2 },
      {
        targets: [
          'accountants',
          'recruitment agency',
          'legal services',
          'estate agents',
          'care agency',
        ],
      },
    );
    // Each industry sits at 20% — exactly at the cap, so not overrepresented.
    // Corpus total = 10 < minCorpusSize 20, so the small-corpus gate
    // kicks in and marks them underrepresented to keep building.
    for (const c of out.classifications) {
      expect(c.status).toBe('underrepresented');
    }
  });

  it('treats balanced industries as balanced once corpus passes minCorpusSize', () => {
    // Six industries at ~16% each — under the Phase 1 rebalance cap
    // (20%) and also under the marketing-specific 10% cap, so no
    // industry is overrepresented.
    const out = classifyIndustryBalance(
      {
        accountants: 4,
        'recruitment agency': 4,
        'legal services': 4,
        'estate agents': 4,
        'care agency': 4,
        'cleaning services': 4,
      },
      {
        targets: [
          'accountants',
          'recruitment agency',
          'legal services',
          'estate agents',
          'care agency',
          'cleaning services',
        ],
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
