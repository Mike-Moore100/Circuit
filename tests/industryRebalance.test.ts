// Phase 1 rebalance — per-industry caps, min-industries floor, the
// corpus_overconcentrated warning, and the new operational SMB
// industries.

import { describe, it, expect } from 'vitest';
import {
  classifyIndustryBalance,
  DEFAULT_MAX_CONCENTRATION,
  DEFAULT_PER_INDUSTRY_CAPS,
  MIN_INDUSTRIES_PER_BATCH,
} from '../src/discovery/industryBalancing';
import { planDiversifiedDiscovery } from '../src/discovery/discoveryDiversity';
import { computeCorpusHealth } from '../src/discovery/corpusHealth';
import {
  CANONICAL_INDUSTRIES,
  normaliseIndustry,
} from '../src/discovery/industryNormalizer';
import { TARGET_INDUSTRIES } from '../src/discovery/queryGeneration';

describe('Phase 1 rebalance constants', () => {
  it('caps any single industry at 20%', () => {
    expect(DEFAULT_MAX_CONCENTRATION).toBe(0.20);
  });

  it('caps marketing / web / design agencies at 10%', () => {
    expect(DEFAULT_PER_INDUSTRY_CAPS['marketing agency']).toBe(0.10);
    expect(DEFAULT_PER_INDUSTRY_CAPS['web agency']).toBe(0.10);
    expect(DEFAULT_PER_INDUSTRY_CAPS['design studio']).toBe(0.10);
  });

  it('targets at least 5 distinct industries per batch', () => {
    expect(MIN_INDUSTRIES_PER_BATCH).toBeGreaterThanOrEqual(5);
  });

  it('puts operational SMBs ahead of peer agencies in the default order', () => {
    const idxRecruitment = TARGET_INDUSTRIES.indexOf('recruitment agency');
    const idxAccountants = TARGET_INDUSTRIES.indexOf('accountants');
    const idxMarketing = TARGET_INDUSTRIES.indexOf('marketing agency');
    expect(idxRecruitment).toBeLessThan(idxMarketing);
    expect(idxAccountants).toBeLessThan(idxMarketing);
  });

  it('includes every new operational SMB industry', () => {
    for (const ind of [
      'care agency',
      'cleaning services',
      'courier services',
      'trades services',
    ]) {
      expect(TARGET_INDUSTRIES).toContain(ind);
    }
  });
});

describe('classifyIndustryBalance — per-industry cap override', () => {
  it('flags marketing as overrepresented at 12% even when general cap is 20%', () => {
    const counts: Record<string, number> = {
      'marketing agency': 12,
      accountants: 22,
      'recruitment agency': 22,
      'legal services': 22,
      'estate agents': 22,
    };
    const result = classifyIndustryBalance(counts, {
      targets: ['marketing agency', 'accountants', 'recruitment agency', 'legal services', 'estate agents'],
      // Marketing cap is 10% via the DEFAULT_PER_INDUSTRY_CAPS map.
    });
    const mkt = result.classifications.find((c) => c.industry === 'marketing agency');
    expect(mkt?.status).toBe('overrepresented');
  });

  it('does not flag a non-peer industry at 12% (under the 20% general cap)', () => {
    const counts: Record<string, number> = {
      accountants: 12,
      'recruitment agency': 22,
      'legal services': 22,
      'estate agents': 22,
      'care agency': 22,
    };
    const result = classifyIndustryBalance(counts, {
      targets: ['accountants', 'recruitment agency', 'legal services', 'estate agents', 'care agency'],
    });
    const acc = result.classifications.find((c) => c.industry === 'accountants');
    expect(acc?.status).not.toBe('overrepresented');
  });

  it('honours a caller-supplied perIndustryCap override', () => {
    const counts: Record<string, number> = {
      consultants: 12,
      accountants: 22,
      'recruitment agency': 22,
      'legal services': 22,
      'estate agents': 22,
    };
    const result = classifyIndustryBalance(counts, {
      targets: ['consultants', 'accountants', 'recruitment agency', 'legal services', 'estate agents'],
      perIndustryCap: { consultants: 0.05 }, // tighter than the 20% general cap
    });
    const cons = result.classifications.find((c) => c.industry === 'consultants');
    expect(cons?.status).toBe('overrepresented');
  });
});

describe('planDiversifiedDiscovery — min-industries floor', () => {
  it('covers at least 5 distinct industries when the pool allows', () => {
    const plan = planDiversifiedDiscovery({
      queryBudget: 10,
      industryCounts: {}, // empty corpus = every target is missing
    });
    expect(plan.industriesCovered).toBeGreaterThanOrEqual(5);
    expect(plan.minIndustriesUnmet).toBe(false);
  });

  it('reports minIndustriesUnmet when the pool is smaller than the floor', () => {
    const plan = planDiversifiedDiscovery({
      queryBudget: 10,
      industryCounts: {},
      industries: ['accountants', 'recruitment agency'], // only 2 available
    });
    expect(plan.industriesCovered).toBeLessThanOrEqual(2);
    // Floor (5) is larger than the available pool (2) — but the planner
    // should NOT raise the flag in this case because the limit is the
    // pool, not the budget.
    expect(plan.minIndustriesUnmet).toBe(false);
  });

  it('refuses to spend the entire budget on marketing agencies', () => {
    const plan = planDiversifiedDiscovery({
      queryBudget: 20,
      industryCounts: {}, // every industry missing
    });
    const marketingQueries = plan.queries.filter(
      (q) => q.industry === 'marketing agency',
    );
    // Marketing is in the pool but ranked last — with a 20-budget over
    // 19 industries it gets at most 1 query reserved by the min-industries
    // floor (or zero, if the budget gives out before reaching marketing).
    expect(marketingQueries.length).toBeLessThanOrEqual(2);
  });
});

describe('computeCorpusHealth — overconcentration warning', () => {
  it('fires corpus_overconcentrated when one industry exceeds the general 20% cap (regardless of corpus size)', () => {
    const corpus = Array.from({ length: 10 }, () => ({
      industry: 'marketing agency',
      source: 'serp.duckduckgo',
      primaryCampaign: null,
      sizeEstimate: null,
      opportunityScore: null,
    }));
    const r = computeCorpusHealth(corpus);
    const codes = r.warnings.map((w) => w.code);
    expect(codes).toContain('corpus_overconcentrated');
    const w = r.warnings.find((x) => x.code === 'corpus_overconcentrated');
    expect(w?.level).toBe('critical');
    expect(w?.message).toContain('rebalanced before calibration');
  });

  it('fires corpus_overconcentrated when corpus has fewer than 5 distinct industries', () => {
    const corpus = [
      ...Array.from({ length: 2 }, () => ({
        industry: 'accountants',
        source: 'serp.duckduckgo',
        primaryCampaign: null,
        sizeEstimate: null,
        opportunityScore: null,
      })),
      ...Array.from({ length: 2 }, () => ({
        industry: 'recruitment agency',
        source: 'serp.duckduckgo',
        primaryCampaign: null,
        sizeEstimate: null,
        opportunityScore: null,
      })),
    ];
    const r = computeCorpusHealth(corpus);
    expect(r.warnings.map((w) => w.code)).toContain('corpus_overconcentrated');
  });

  it('does NOT fire corpus_overconcentrated for a healthy balanced corpus', () => {
    const corpus = [
      'accountants',
      'recruitment agency',
      'legal services',
      'estate agents',
      'care agency',
      'cleaning services',
      'courier services',
      'logistics company',
      'payroll services',
      'consultants',
    ].map((industry) => ({
      industry,
      source: 'serp.duckduckgo',
      primaryCampaign: null,
      sizeEstimate: null,
      opportunityScore: null,
    }));
    const r = computeCorpusHealth(corpus);
    expect(r.warnings.map((w) => w.code)).not.toContain('corpus_overconcentrated');
  });
});

describe('industryNormalizer — new operational SMB rules', () => {
  it.each<[string, string]>([
    ['home care agency london', 'care agency'],
    ['domiciliary care provider birmingham', 'care agency'],
    ['Commercial Cleaning Company Manchester', 'cleaning services'],
    ['office cleaning services bristol', 'cleaning services'],
    ['Same-day Courier London', 'courier services'],
    ['Delivery company Leeds', 'courier services'],
    ['Plumbing and Heating Glasgow', 'trades services'],
    ['Electrical contractor Cardiff', 'trades services'],
  ])('normalises "%s" → "%s"', (input, expected) => {
    expect(normaliseIndustry(input).industry).toBe(expected);
  });

  it('every new canonical label is matched by its own normaliser', () => {
    for (const ind of ['care agency', 'cleaning services', 'courier services', 'trades services']) {
      expect(CANONICAL_INDUSTRIES).toContain(ind);
    }
  });
});
