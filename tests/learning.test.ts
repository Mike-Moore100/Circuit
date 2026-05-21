import { describe, it, expect } from 'vitest';
import { suggestCalibrations } from '../src/learning/scoringCalibration';
import { deriveInsights } from '../src/learning/operatorFeedbackInsights';
import type { ReviewPattern } from '../src/learning/learningTypes';

function pat(overrides: Partial<ReviewPattern>): ReviewPattern {
  return {
    reviewType: 'false_positive',
    previousCampaign: 'WEB_REBUILD',
    count: 3,
    sampleCompanies: ['Acme', 'Beta', 'Gamma'],
    avgOpportunityScore: 45,
    avgFinalScore: 50,
    ...overrides,
  };
}

describe('suggestCalibrations', () => {
  it('returns no suggestions below the evidence threshold', () => {
    const out = suggestCalibrations([pat({ count: 1 })]);
    expect(out).toEqual([]);
  });

  it('suggests raising a campaign threshold after repeated false positives', () => {
    const out = suggestCalibrations([
      pat({ reviewType: 'false_positive', previousCampaign: 'WEB_REBUILD', count: 4 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].target).toBe('campaign_weight');
    expect(out[0].direction).toBe('increase');
    expect(out[0].knob).toContain('WEB_REBUILD');
  });

  it('suggests softening the reject path after repeated false rejects', () => {
    const out = suggestCalibrations([
      pat({ reviewType: 'false_reject', previousCampaign: 'AI_AUTOMATION', count: 5 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].direction).toBe('decrease');
  });

  it('suggests boosting positives when strong opportunities have low intelligence scores', () => {
    const out = suggestCalibrations([
      pat({
        reviewType: 'strong_opportunity',
        previousCampaign: 'AI_AUTOMATION',
        count: 3,
        avgOpportunityScore: 40,
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].direction).toBe('increase');
  });

  it('sorts suggestions so the highest-confidence + evidence comes first', () => {
    const out = suggestCalibrations([
      pat({ count: 3 }),
      pat({ previousCampaign: 'AI_AUTOMATION', count: 7 }),
    ]);
    expect(out[0].evidenceCount).toBe(7);
  });
});

describe('deriveInsights', () => {
  it('flags a campaign that is over-routing', () => {
    const out = deriveInsights([
      pat({ reviewType: 'false_positive', previousCampaign: 'WEB_REBUILD', count: 4 }),
    ]);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].tone).toBe('warning');
    expect(out[0].headline).toContain('WEB_REBUILD');
  });

  it('flags a campaign that is producing strong opportunities', () => {
    const out = deriveInsights([
      pat({
        reviewType: 'strong_opportunity',
        previousCampaign: 'AI_AUTOMATION',
        count: 3,
      }),
    ]);
    expect(out.some((i) => i.tone === 'opportunity')).toBe(true);
  });

  it('flags persistent false rejects as a system-wide warning', () => {
    const out = deriveInsights([
      pat({ reviewType: 'false_reject', previousCampaign: 'AI_AUTOMATION', count: 4 }),
    ]);
    expect(out.some((i) => i.headline.includes('wrongly rejected'))).toBe(true);
  });
});
