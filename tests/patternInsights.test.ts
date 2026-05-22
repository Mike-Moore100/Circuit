// Phase 1 Validation refactor — pattern detection + recommendation
// derivation tests. Pure-function coverage so the /validation page's
// insights / recommendations sections can't drift away from the spec.

import { describe, it, expect } from 'vitest';
import {
  detectFalsePositivePatterns,
  detectFalseRejectPatterns,
  detectSignalPatterns,
  detectStrongestIndustries,
  detectWeakestIndustries,
  deriveRecommendations,
  type ValidationLead,
} from '../src/validation/patternInsights';

function lead(overrides: Partial<ValidationLead> = {}): ValidationLead {
  return {
    companyId: `c-${Math.random()}`,
    industry: 'accountants',
    opportunityScore: 50,
    primaryCampaign: 'AI_AUTOMATION',
    hasNamedDmEmail: false,
    hasGuessedOnlyEmail: false,
    hasContactForm: false,
    hasBookingLink: false,
    trustBarrier: 30,
    reviewTags: new Set<string>(),
    outcomeTags: new Set<string>(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Industry rollups
// ---------------------------------------------------------------------------
describe('detectStrongestIndustries', () => {
  it('returns nothing when no industry passes the review-count floor', () => {
    const leads = Array.from({ length: 2 }, () =>
      lead({ industry: 'accountants', reviewTags: new Set(['would_contact']) }),
    );
    expect(detectStrongestIndustries(leads)).toEqual([]);
  });

  it('surfaces an industry once approval rate crosses 70% with 3+ reviews', () => {
    const leads = [
      lead({ industry: 'accountants', reviewTags: new Set(['would_contact']) }),
      lead({ industry: 'accountants', reviewTags: new Set(['good_fit']) }),
      lead({ industry: 'accountants', reviewTags: new Set(['strong_opportunity']) }),
      // unreviewed shouldn't count
      lead({ industry: 'accountants' }),
    ];
    const out = detectStrongestIndustries(leads);
    expect(out).toHaveLength(1);
    expect(out[0].text).toContain('Accountants');
    expect(out[0].evidenceCount).toBe(3);
  });

  it('caps to max returned', () => {
    const buildIndustry = (name: string) =>
      Array.from({ length: 3 }, () =>
        lead({ industry: name, reviewTags: new Set(['would_contact']) }),
      );
    const leads = [
      ...buildIndustry('accountants'),
      ...buildIndustry('legal services'),
      ...buildIndustry('recruitment agency'),
      ...buildIndustry('estate agents'),
    ];
    const out = detectStrongestIndustries(leads, 2);
    expect(out).toHaveLength(2);
  });
});

describe('detectWeakestIndustries', () => {
  it('surfaces an industry once rejection rate crosses 60% with 3+ reviews', () => {
    const leads = [
      lead({ industry: 'marketing agency', reviewTags: new Set(['ignore']) }),
      lead({ industry: 'marketing agency', reviewTags: new Set(['would_not_contact']) }),
      lead({ industry: 'marketing agency', reviewTags: new Set(['weak_pain']) }),
    ];
    const out = detectWeakestIndustries(leads);
    expect(out).toHaveLength(1);
    expect(out[0].text).toContain('Marketing agency');
  });
});

// ---------------------------------------------------------------------------
// False positive / false reject patterns
// ---------------------------------------------------------------------------
describe('detectFalsePositivePatterns', () => {
  it('groups high-score rejected leads by industry', () => {
    const leads = [
      lead({ industry: 'marketing agency', opportunityScore: 75, reviewTags: new Set(['would_not_contact']) }),
      lead({ industry: 'marketing agency', opportunityScore: 80, reviewTags: new Set(['ignore']) }),
      lead({ industry: 'marketing agency', opportunityScore: 65, reviewTags: new Set(['weak_pain']) }),
      lead({ industry: 'accountants', opportunityScore: 70, reviewTags: new Set(['would_not_contact']) }),
    ];
    const out = detectFalsePositivePatterns(leads);
    expect(out).toHaveLength(1);
    expect(out[0].text).toContain('Marketing agency');
    expect(out[0].evidenceCount).toBe(3);
  });

  it('returns nothing when fewer than 2 leads per industry hit', () => {
    const leads = [
      lead({ industry: 'marketing agency', opportunityScore: 75, reviewTags: new Set(['ignore']) }),
    ];
    expect(detectFalsePositivePatterns(leads)).toEqual([]);
  });
});

describe('detectFalseRejectPatterns', () => {
  it('groups low-score approved leads by industry', () => {
    const leads = [
      lead({ industry: 'recruitment agency', opportunityScore: 15, reviewTags: new Set(['would_contact']) }),
      lead({ industry: 'recruitment agency', opportunityScore: 20, reviewTags: new Set(['strong_opportunity']) }),
    ];
    const out = detectFalseRejectPatterns(leads);
    expect(out).toHaveLength(1);
    expect(out[0].text).toContain('Recruitment agency');
    expect(out[0].evidenceCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Signal patterns
// ---------------------------------------------------------------------------
describe('detectSignalPatterns', () => {
  it('surfaces "direct DM email → approved" when correlation passes the floor', () => {
    const leads = Array.from({ length: 5 }, () =>
      lead({ hasNamedDmEmail: true, reviewTags: new Set(['would_contact']) }),
    );
    const out = detectSignalPatterns(leads);
    expect(out.some((p) => /decision-maker email/.test(p.text))).toBe(true);
  });

  it('does not surface signal patterns below the evidence floor', () => {
    const leads = [
      lead({ hasNamedDmEmail: true, reviewTags: new Set(['would_contact']) }),
    ];
    expect(detectSignalPatterns(leads)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------
describe('deriveRecommendations', () => {
  it('recommends reducing weight for industries with repeated false positives', () => {
    const leads = [
      lead({ industry: 'marketing agency', opportunityScore: 80, reviewTags: new Set(['would_not_contact']) }),
      lead({ industry: 'marketing agency', opportunityScore: 75, reviewTags: new Set(['ignore']) }),
    ];
    const recs = deriveRecommendations(leads);
    expect(recs.some((r) => /Reduce/.test(r.text) && /marketing agency/i.test(r.text))).toBe(true);
  });

  it('recommends increasing weight for industries the operator keeps rescuing', () => {
    const leads = [
      lead({ industry: 'recruitment agency', opportunityScore: 15, reviewTags: new Set(['would_contact']) }),
      lead({ industry: 'recruitment agency', opportunityScore: 10, reviewTags: new Set(['strong_opportunity']) }),
    ];
    const recs = deriveRecommendations(leads);
    expect(recs.some((r) => /Increase/.test(r.text) && /recruitment agency/i.test(r.text))).toBe(true);
  });

  it('recommends tightening trust-barrier penalty when high-trust leads are rejected', () => {
    const leads = Array.from({ length: 5 }, () =>
      lead({ trustBarrier: 75, reviewTags: new Set(['would_not_contact']) }),
    );
    const recs = deriveRecommendations(leads);
    expect(recs.some((r) => /trust-barrier/i.test(r.text))).toBe(true);
  });

  it('returns empty when there is no operator review history at all', () => {
    const leads = Array.from({ length: 5 }, () => lead({ reviewTags: new Set() }));
    expect(deriveRecommendations(leads)).toEqual([]);
  });

  it('sorts recommendations by evidence count desc', () => {
    const leads = [
      // Marketing FP — 3 events
      lead({ industry: 'marketing agency', opportunityScore: 80, reviewTags: new Set(['ignore']) }),
      lead({ industry: 'marketing agency', opportunityScore: 75, reviewTags: new Set(['ignore']) }),
      lead({ industry: 'marketing agency', opportunityScore: 70, reviewTags: new Set(['would_not_contact']) }),
      // Trust barrier — 5 events (stronger evidence)
      ...Array.from({ length: 5 }, () =>
        lead({ trustBarrier: 80, reviewTags: new Set(['ignore']) }),
      ),
    ];
    const recs = deriveRecommendations(leads);
    const evidenceCounts = recs.map((r) => r.evidenceCount);
    expect(evidenceCounts).toEqual([...evidenceCounts].sort((a, b) => b - a));
  });
});
