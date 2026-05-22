// Phase 1 Discovery Diversity — query generation tests.

import { describe, it, expect } from 'vitest';
import {
  distributeQuota,
  generateDiversifiedQueries,
} from '../src/discovery/queryGeneration';

describe('generateDiversifiedQueries', () => {
  it('returns no queries when industries or cities are empty', () => {
    expect(generateDiversifiedQueries({ industries: [], cities: ['London'] })).toEqual([]);
    expect(generateDiversifiedQueries({ industries: ['accountants'], cities: [] })).toEqual([]);
  });

  it('produces deterministic output for the same config', () => {
    const cfg = {
      industries: ['accountants', 'recruitment agency', 'legal firm'],
      cities: ['London', 'Manchester', 'Leeds'],
      defaultPerIndustry: 2,
    };
    const a = generateDiversifiedQueries(cfg);
    const b = generateDiversifiedQueries(cfg);
    expect(a.map((q) => q.queryString)).toEqual(b.map((q) => q.queryString));
  });

  it('respects per-industry quotas', () => {
    const out = generateDiversifiedQueries({
      industries: ['accountants', 'legal firm'],
      cities: ['London', 'Manchester'],
      quotas: { accountants: 1, 'legal firm': 2 },
      defaultPerIndustry: 99,
    });
    const counts = out.reduce<Record<string, number>>((acc, q) => {
      acc[q.industry] = (acc[q.industry] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts.accountants).toBe(1);
    expect(counts['legal firm']).toBe(2);
  });

  it('never repeats the same (industry, city) pair when perCityCap = 1', () => {
    const out = generateDiversifiedQueries({
      industries: ['accountants'],
      cities: ['London', 'Manchester'],
      defaultPerIndustry: 5, // more than cities allow with cap=1
      perCityCap: 1,
    });
    const seen = new Set<string>();
    for (const q of out) {
      const key = `${q.industry}|${q.location}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(out.length).toBeLessThanOrEqual(2);
  });

  it('staggers city cursors so two industries do not both start at the same city', () => {
    const out = generateDiversifiedQueries({
      industries: ['accountants', 'legal firm'],
      cities: ['London', 'Manchester', 'Leeds'],
      defaultPerIndustry: 1,
    });
    const firstAcc = out.find((q) => q.industry === 'accountants');
    const firstLegal = out.find((q) => q.industry === 'legal firm');
    expect(firstAcc?.location).not.toBe(firstLegal?.location);
  });

  it('applies templates with the %CITY% placeholder', () => {
    const out = generateDiversifiedQueries({
      industries: ['accountants'],
      cities: ['Leeds'],
      defaultPerIndustry: 1,
      templates: { accountants: 'chartered accountants near %CITY%' },
    });
    expect(out[0].queryString).toBe('chartered accountants near Leeds');
  });

  it('falls back to the industry-specific default template when none supplied', () => {
    const out = generateDiversifiedQueries({
      industries: ['accountants'],
      cities: ['Leeds'],
      defaultPerIndustry: 1,
    });
    // Phase 1 rebalance — the default accountants template biases SERP
    // toward independent practices rather than aggregator pages.
    expect(out[0].queryString).toBe('chartered accountants Leeds');
  });

  it('falls back to bare "industry city" for industries with no preset template', () => {
    const out = generateDiversifiedQueries({
      industries: ['knitting circles'],
      cities: ['Leeds'],
      defaultPerIndustry: 1,
    });
    expect(out[0].queryString).toBe('knitting circles Leeds');
  });

  it('caps total queries at totalCap', () => {
    const out = generateDiversifiedQueries({
      industries: ['accountants', 'legal firm', 'estate agents'],
      cities: ['London', 'Manchester', 'Leeds'],
      defaultPerIndustry: 3,
      totalCap: 5,
    });
    expect(out.length).toBe(5);
  });
});

describe('distributeQuota', () => {
  it('returns zero for every key when total = 0', () => {
    expect(distributeQuota(0, { a: 1, b: 1 })).toEqual({ a: 0, b: 0 });
  });

  it('returns zero for every key when weights sum to 0', () => {
    expect(distributeQuota(10, { a: 0, b: 0 })).toEqual({ a: 0, b: 0 });
  });

  it('preserves the total when weights are equal', () => {
    const out = distributeQuota(10, { a: 1, b: 1, c: 1 });
    expect(Object.values(out).reduce((s, n) => s + n, 0)).toBe(10);
    // The remainder distribution must hit each key roughly evenly.
    expect(Math.max(...Object.values(out)) - Math.min(...Object.values(out))).toBeLessThanOrEqual(1);
  });

  it('weights proportionally', () => {
    const out = distributeQuota(20, { a: 3, b: 1 });
    expect(out.a).toBe(15);
    expect(out.b).toBe(5);
  });

  it('is deterministic — same input, same output', () => {
    const cfg = { a: 1, b: 2, c: 3, d: 4 };
    const a = distributeQuota(13, cfg);
    const b = distributeQuota(13, cfg);
    expect(a).toEqual(b);
  });
});
