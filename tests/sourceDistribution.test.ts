// Phase 1 Discovery Diversity — source distribution tests.

import { describe, it, expect } from 'vitest';
import { computeSourceDistribution } from '../src/discovery/sourceDistribution';

describe('computeSourceDistribution', () => {
  it('returns an empty result for an empty corpus', () => {
    const out = computeSourceDistribution({});
    expect(out.total).toBe(0);
    expect(out.shares).toEqual([]);
    expect(out.dominantSource).toBeNull();
    expect(out.isOverconcentrated).toBe(false);
  });

  it('does not flag overconcentration below minTotal', () => {
    const out = computeSourceDistribution(
      { 'serp.duckduckgo': 5 },
      { minTotal: 10 },
    );
    expect(out.isOverconcentrated).toBe(false);
  });

  it('flags a single dominant source past the concentration limit', () => {
    const out = computeSourceDistribution(
      { 'serp.duckduckgo': 95, 'directory.yell': 5 },
      { concentrationLimit: 0.7, minTotal: 10 },
    );
    expect(out.dominantSource).toBe('serp.duckduckgo');
    expect(out.isOverconcentrated).toBe(true);
  });

  it('classifies shares: dominant > limit, balanced ≥ 0.15, minor below that', () => {
    const out = computeSourceDistribution(
      { a: 80, b: 17, c: 3 },
      { concentrationLimit: 0.7, minTotal: 10 },
    );
    const by = Object.fromEntries(out.shares.map((s) => [s.source, s.status]));
    expect(by.a).toBe('dominant');
    expect(by.b).toBe('balanced');
    expect(by.c).toBe('minor');
  });

  it('sorts shares by count desc', () => {
    const out = computeSourceDistribution({ a: 10, b: 30, c: 20 });
    expect(out.shares.map((s) => s.source)).toEqual(['b', 'c', 'a']);
  });

  it('surfaces the configured concentration limit on the report', () => {
    const out = computeSourceDistribution(
      { a: 50 },
      { concentrationLimit: 0.5 },
    );
    expect(out.concentrationLimit).toBe(0.5);
  });
});
