// Phase 1 Live Validation — operator agreement metrics. Pure-function
// tests, no DB. We cover every category boundary so the dashboard
// numbers don't drift quietly.

import { describe, it, expect } from 'vitest';
import {
  APPROVAL_TAGS,
  HIGH_SCORE_THRESHOLD,
  LOW_SCORE_THRESHOLD,
  REJECTION_TAGS,
  computeOperatorAgreement,
  type CalibrationLeadInput,
} from '../src/validation/operatorAgreement';

function lead(
  score: number,
  tags: string[] = [],
): CalibrationLeadInput {
  return {
    companyId: `c-${score}-${tags.join('-')}`,
    opportunityScore: score,
    reviewTags: new Set(tags),
  };
}

describe('APPROVAL_TAGS / REJECTION_TAGS', () => {
  it('covers every commercial validation tag from the brief', () => {
    for (const t of [
      'would_contact',
      'high_commercial_potential',
      'strong_pain',
      'likely_high_value',
      'strong_opportunity',
    ]) {
      expect(APPROVAL_TAGS.has(t)).toBe(true);
    }
    for (const t of [
      'would_not_contact',
      'low_commercial_potential',
      'weak_pain',
      'ignore',
      'false_positive',
    ]) {
      expect(REJECTION_TAGS.has(t)).toBe(true);
    }
  });
});

describe('computeOperatorAgreement', () => {
  it('returns zeros when no leads are reviewed', () => {
    const m = computeOperatorAgreement([]);
    expect(m.totalReviewed).toBe(0);
    expect(m.operatorAgreementRate).toBeNull();
    expect(m.falsePositiveRate).toBeNull();
    expect(m.rankingConfidence).toBeNull();
  });

  it('ignores leads with no review tags', () => {
    const m = computeOperatorAgreement([lead(80), lead(20)]);
    expect(m.totalReviewed).toBe(0);
  });

  it('classifies a high-score approval as a correct positive', () => {
    const m = computeOperatorAgreement([
      lead(HIGH_SCORE_THRESHOLD, ['would_contact']),
    ]);
    expect(m.totalReviewed).toBe(1);
    expect(m.totalHighScore).toBe(1);
    expect(m.highScoreApproved).toBe(1);
    expect(m.highScoreRejected).toBe(0);
    expect(m.operatorAgreementRate).toBe(1);
  });

  it('classifies a high-score rejection as a false positive', () => {
    const m = computeOperatorAgreement([
      lead(80, ['would_not_contact']),
    ]);
    expect(m.highScoreRejected).toBe(1);
    expect(m.falsePositiveRate).toBe(1);
  });

  it('classifies a low-score approval as a false negative', () => {
    const m = computeOperatorAgreement([
      lead(LOW_SCORE_THRESHOLD - 1, ['would_contact']),
    ]);
    expect(m.lowScoreApproved).toBe(1);
    expect(m.falseNegativeRate).toBe(1);
  });

  it('classifies a low-score rejection as a correct negative', () => {
    const m = computeOperatorAgreement([
      lead(10, ['ignore']),
    ]);
    expect(m.lowScoreRejected).toBe(1);
    expect(m.falseNegativeRate).toBe(0);
  });

  it('returns null for ranking confidence below the minimum review count', () => {
    // 4 reviews — below the 5-review minimum.
    const m = computeOperatorAgreement([
      lead(80, ['would_contact']),
      lead(80, ['would_contact']),
      lead(70, ['would_contact']),
      lead(20, ['ignore']),
    ]);
    expect(m.rankingConfidence).toBeNull();
  });

  it('returns 100 ranking confidence when every signal aligns', () => {
    const m = computeOperatorAgreement([
      lead(80, ['would_contact']),
      lead(75, ['would_contact']),
      lead(70, ['strong_opportunity']),
      lead(15, ['ignore']),
      lead(10, ['weak_pain']),
    ]);
    expect(m.rankingConfidence).toBe(100);
  });

  it('returns 0 ranking confidence when every signal is inverted', () => {
    const m = computeOperatorAgreement([
      lead(80, ['would_not_contact']),
      lead(75, ['ignore']),
      lead(70, ['weak_pain']),
      lead(15, ['would_contact']),
      lead(10, ['high_commercial_potential']),
    ]);
    expect(m.rankingConfidence).toBe(0);
  });

  it('rates approval + rejection on the same lead as one of each', () => {
    // Edge case: the operator flipped their mind. We still want to record
    // they reviewed it, so totalReviewed=1 with both signals counted.
    const m = computeOperatorAgreement([
      lead(80, ['would_contact', 'would_not_contact']),
    ]);
    expect(m.totalReviewed).toBe(1);
    expect(m.highScoreApproved).toBe(1);
    expect(m.highScoreRejected).toBe(1);
  });

  it('weights high-score quality more heavily than low-score quality', () => {
    // Perfect high-side, perfect low-side ⇒ 100. Swap them so high-side
    // wrong, low-side right ⇒ should be < 50 because high-side dominates.
    const m = computeOperatorAgreement([
      // 3 high-score rejected (false positives)
      lead(80, ['would_not_contact']),
      lead(75, ['would_not_contact']),
      lead(70, ['would_not_contact']),
      // 3 low-score rejected (correct negatives)
      lead(15, ['ignore']),
      lead(20, ['ignore']),
      lead(10, ['ignore']),
    ]);
    expect(m.rankingConfidence).not.toBeNull();
    expect(m.rankingConfidence!).toBeLessThan(50);
  });
});
