// Phase 1 Discovery Diversity — corpus-aware planner tests.

import { describe, it, expect } from 'vitest';
import { planDiversifiedDiscovery } from '../src/discovery/discoveryDiversity';

describe('planDiversifiedDiscovery', () => {
  it('skips overrepresented industries entirely', () => {
    const plan = planDiversifiedDiscovery({
      queryBudget: 30,
      industryCounts: {
        'marketing agency': 80,
        accountants: 5,
        'legal firm': 5,
      },
      industries: ['marketing agency', 'accountants', 'legal firm'],
      balancing: { maxConcentration: 0.5 },
    });
    expect(plan.quotaPerIndustry['marketing agency']).toBeFalsy();
    expect(plan.queries.every((q) => q.industry !== 'marketing agency')).toBe(true);
  });

  it('prioritises missing industries over underrepresented ones', () => {
    const plan = planDiversifiedDiscovery({
      queryBudget: 20,
      industryCounts: {
        accountants: 5,
        // legal firm missing entirely
      },
      industries: ['accountants', 'legal firm'],
      missingShare: 0.8,
      underrepresentedShare: 0.2,
    });
    expect(plan.quotaPerIndustry['legal firm']).toBeGreaterThan(plan.quotaPerIndustry.accountants ?? 0);
  });

  it('reallocates a tier budget to the next tier when the tier has no industries', () => {
    // 5 industries at 20% share each — each at the cap, none over.
    // No "missing" industries; everything is "underrepresented" under
    // the small-corpus gate. The planner should still produce queries
    // by reallocating the missing-tier budget down.
    const plan = planDiversifiedDiscovery({
      queryBudget: 10,
      industryCounts: {
        accountants: 2,
        'recruitment agency': 2,
        'legal services': 2,
        'estate agents': 2,
        'care agency': 2,
      },
      industries: [
        'accountants',
        'recruitment agency',
        'legal services',
        'estate agents',
        'care agency',
      ],
      missingShare: 0.6,
      underrepresentedShare: 0.3,
    });
    expect(plan.queries.length).toBeGreaterThan(0);
    const industries = new Set(plan.queries.map((q) => q.industry));
    expect(industries.size).toBe(5);
  });

  it('respects the query budget', () => {
    const plan = planDiversifiedDiscovery({
      queryBudget: 5,
      industryCounts: {},
      industries: ['accountants', 'legal firm', 'estate agents'],
    });
    expect(plan.queries.length).toBeLessThanOrEqual(5);
  });

  it('produces an empty plan when every target industry is overrepresented', () => {
    const plan = planDiversifiedDiscovery({
      queryBudget: 10,
      industryCounts: { accountants: 100 },
      industries: ['accountants'],
      balancing: { maxConcentration: 0.5 },
    });
    expect(plan.queries.length).toBe(0);
  });

  it('is deterministic — same input always produces the same plan', () => {
    const cfg = {
      queryBudget: 12,
      industryCounts: { accountants: 5, 'legal firm': 2 },
      industries: ['accountants', 'legal firm', 'estate agents'],
    };
    const a = planDiversifiedDiscovery(cfg);
    const b = planDiversifiedDiscovery(cfg);
    expect(a.queries.map((q) => q.queryString)).toEqual(b.queries.map((q) => q.queryString));
  });
});
