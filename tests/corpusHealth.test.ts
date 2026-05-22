// Phase 1 Discovery Diversity — corpus health tests.

import { describe, it, expect } from 'vitest';
import {
  computeCorpusHealth,
  type CorpusCompany,
} from '../src/discovery/corpusHealth';

function co(overrides: Partial<CorpusCompany> = {}): CorpusCompany {
  return {
    industry: 'marketing agency',
    source: 'serp.duckduckgo',
    primaryCampaign: 'LOW_PRIORITY_NURTURE',
    sizeEstimate: 12,
    opportunityScore: 30,
    ...overrides,
  };
}

describe('computeCorpusHealth', () => {
  it('returns a corpus_empty warning when there are no companies', () => {
    const r = computeCorpusHealth([]);
    expect(r.total).toBe(0);
    expect(r.warnings.map((w) => w.code)).toContain('corpus_empty');
    expect(r.overallDiversityScore).toBe(0);
  });

  it('computes a single industry as zero diversity', () => {
    const r = computeCorpusHealth(Array.from({ length: 20 }, () => co()));
    expect(r.diversityScores.industry).toBe(0);
  });

  it('computes perfect industry diversity when the split is even across two industries', () => {
    const rows = [
      ...Array.from({ length: 10 }, () => co({ industry: 'accountants' })),
      ...Array.from({ length: 10 }, () => co({ industry: 'recruitment agency' })),
    ];
    const r = computeCorpusHealth(rows);
    expect(r.diversityScores.industry).toBeCloseTo(1, 6);
  });

  it('produces source-overconcentrated warning when a single source dominates', () => {
    const rows = [
      ...Array.from({ length: 80 }, () =>
        co({ source: 'serp.duckduckgo' }),
      ),
      ...Array.from({ length: 20 }, () =>
        co({ source: 'directory.yell', industry: 'accountants' }),
      ),
    ];
    const r = computeCorpusHealth(rows);
    expect(r.warnings.some((w) => w.code === 'source_overconcentrated')).toBe(true);
  });

  it('warns about overrepresented industries past the concentration ceiling', () => {
    const rows = [
      ...Array.from({ length: 80 }, () =>
        co({ industry: 'marketing agency' }),
      ),
      ...Array.from({ length: 20 }, () =>
        co({ industry: 'accountants', source: 'directory.yell' }),
      ),
    ];
    const r = computeCorpusHealth(rows, {
      balancing: { maxConcentration: 0.6 },
    });
    const codes = r.warnings.map((w) => w.code);
    expect(codes).toContain('over_marketing_agency');
  });

  it('always flags the configured industries when missing', () => {
    const r = computeCorpusHealth(
      Array.from({ length: 25 }, () =>
        co({ industry: 'marketing agency' }),
      ),
      {
        alwaysFlagMissing: ['accountants', 'legal firm'],
      },
    );
    const codes = r.warnings.map((w) => w.code);
    expect(codes).toContain('missing_accountants');
    expect(codes).toContain('missing_legal_firm');
  });

  it('places null industries / campaigns in an "(unknown)" bucket without breaking distributions', () => {
    const r = computeCorpusHealth([
      co({ industry: null, primaryCampaign: null }),
      co({ industry: null, primaryCampaign: null }),
      co({ industry: 'accountants', primaryCampaign: 'AI_AUTOMATION' }),
    ]);
    const ind = r.industryDistribution.find((b) => b.bucket === '(unknown)');
    expect(ind?.count).toBe(2);
    // The "(unknown)" industry must NOT appear in the targeted classifications.
    expect(
      r.industryBalance.classifications.some((c) => c.industry === '(unknown)'),
    ).toBe(false);
  });

  it('buckets size_estimate into the documented bands', () => {
    const rows = [
      co({ sizeEstimate: 2 }),
      co({ sizeEstimate: 10 }),
      co({ sizeEstimate: 25 }),
      co({ sizeEstimate: 100 }),
      co({ sizeEstimate: 500 }),
      co({ sizeEstimate: null }),
    ];
    const r = computeCorpusHealth(rows);
    const by = Object.fromEntries(r.sizeDistribution.map((b) => [b.bucket, b.count]));
    expect(by['1-4']).toBe(1);
    expect(by['5-19']).toBe(1);
    expect(by['20-49']).toBe(1);
    expect(by['50-199']).toBe(1);
    expect(by['200+']).toBe(1);
    expect(by['unknown']).toBe(1);
  });

  it('overall diversity score is bounded [0, 100]', () => {
    const r = computeCorpusHealth([
      ...Array.from({ length: 10 }, () => co({ industry: 'accountants' })),
      ...Array.from({ length: 10 }, () =>
        co({ industry: 'legal firm', source: 'directory.yell' }),
      ),
    ]);
    expect(r.overallDiversityScore).toBeGreaterThanOrEqual(0);
    expect(r.overallDiversityScore).toBeLessThanOrEqual(100);
  });
});
