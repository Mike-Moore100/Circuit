import { describe, it, expect } from 'vitest';
import {
  computeWhyNow,
  topWhyNow,
  type WhyNowInputs,
} from '../src/intelligence/whyNowReasoning';
import type {
  OpportunityIntelligence,
  SubScore,
} from '../src/intelligence/intelligenceTypes';

function sub(score: number, signals: string[] = []): SubScore {
  return { score, reasons: [], signals };
}

function makeIntelligence(
  overrides: Partial<OpportunityIntelligence> = {},
): OpportunityIntelligence {
  return {
    companyId: 'c1',
    computedAt: '2026-01-01T00:00:00.000Z',
    opportunityScore: 55,
    humanAttentionPriority: 'MEDIUM',
    operationalPain: sub(40),
    buyingReadiness: sub(40),
    accessibility: sub(40),
    implementationFit: sub(40),
    trustBarrier: sub(20),
    evidenceConfidence: sub(40),
    opportunityReasons: [],
    riskFactors: [],
    strongestSignals: [],
    weakestSignals: [],
    likelyProjectType: 'UNCLEAR',
    estimatedProjectComplexity: 'MEDIUM',
    estimatedCommercialPotential: 'MEDIUM',
    ...overrides,
  };
}

function makeInputs(overrides: Partial<WhyNowInputs> = {}): WhyNowInputs {
  return {
    intelligence: makeIntelligence(),
    verifiedSignals: [],
    hasContactForm: false,
    hasBookingLink: false,
    hasWorkingWebsite: true,
    ...overrides,
  };
}

describe('computeWhyNow', () => {
  it('returns an empty list when nothing applies', () => {
    const out = computeWhyNow(
      makeInputs({
        hasContactForm: true,
        hasBookingLink: true,
        intelligence: makeIntelligence({
          operationalPain: sub(20),
          trustBarrier: sub(10),
        }),
      }),
    );
    expect(out).toEqual([]);
  });

  it('flags hiring when a careers page is detected', () => {
    const out = computeWhyNow(
      makeInputs({
        verifiedSignals: [{ type: 'verified.has_careers_page', value: '/jobs' }],
        // Don't trip weak_conversion in the same case.
        hasContactForm: true,
      }),
    );
    expect(out.some((s) => s.kind === 'hiring')).toBe(true);
  });

  it('flags weak conversion only when website works and no form / booking', () => {
    const out = computeWhyNow(
      makeInputs({
        hasWorkingWebsite: true,
        hasContactForm: false,
        hasBookingLink: false,
      }),
    );
    expect(out.some((s) => s.kind === 'weak_conversion')).toBe(true);

    const withForm = computeWhyNow(
      makeInputs({ hasContactForm: true }),
    );
    expect(withForm.some((s) => s.kind === 'weak_conversion')).toBe(false);
  });

  it('uses high weight when there is no contact path at all, low when only the form is missing', () => {
    const noPath = computeWhyNow(
      makeInputs({
        verifiedSignals: [],
        hasContactForm: false,
        hasBookingLink: false,
      }),
    );
    const onlyContactPage = computeWhyNow(
      makeInputs({
        verifiedSignals: [{ type: 'verified.has_contact_page', value: '/contact' }],
        hasContactForm: false,
        hasBookingLink: false,
      }),
    );
    const noPathSig = noPath.find((s) => s.kind === 'weak_conversion');
    const onlyContactSig = onlyContactPage.find(
      (s) => s.kind === 'weak_conversion',
    );
    expect(noPathSig!.weight).toBeGreaterThan(onlyContactSig!.weight);
  });

  it('flags ops complexity when operational pain is at or above 60', () => {
    const out = computeWhyNow(
      makeInputs({
        hasContactForm: true,
        intelligence: makeIntelligence({ operationalPain: sub(70) }),
      }),
    );
    expect(out.some((s) => s.kind === 'ops_complexity')).toBe(true);
  });

  it('flags low_digital_maturity with higher weight when the website failed', () => {
    const failed = computeWhyNow(
      makeInputs({
        verifiedSignals: [{ type: 'verified.website_failed', value: 'true' }],
        hasContactForm: true,
        hasWorkingWebsite: false,
      }),
    );
    const lowMaturity = computeWhyNow(
      makeInputs({
        verifiedSignals: [{ type: 'verified.low_digital_maturity', value: '1' }],
        hasContactForm: true,
      }),
    );
    const failedSig = failed.find((s) => s.kind === 'low_digital_maturity');
    const lowSig = lowMaturity.find((s) => s.kind === 'low_digital_maturity');
    expect(failedSig!.weight).toBeGreaterThan(lowSig!.weight);
  });

  it('flags weak_automation only for likely service businesses without AI language', () => {
    const flagged = computeWhyNow(
      makeInputs({
        verifiedSignals: [
          { type: 'verified.likely_service_business', value: '1' },
        ],
        hasContactForm: true,
      }),
    );
    expect(flagged.some((s) => s.kind === 'weak_automation')).toBe(true);

    const notFlagged = computeWhyNow(
      makeInputs({
        verifiedSignals: [
          { type: 'verified.likely_service_business', value: '1' },
          { type: 'verified.has_ai_automation_language', value: 'true' },
        ],
        hasContactForm: true,
      }),
    );
    expect(notFlagged.some((s) => s.kind === 'weak_automation')).toBe(false);
  });

  it('sorts results deterministically by weight then kind', () => {
    const out = computeWhyNow(
      makeInputs({
        verifiedSignals: [
          { type: 'verified.has_careers_page', value: '/jobs' },
          { type: 'verified.has_manual_workflow_language', value: '1' },
          { type: 'verified.likely_service_business', value: '1' },
        ],
        hasContactForm: false,
        hasBookingLink: false,
        intelligence: makeIntelligence({ trustBarrier: sub(80) }),
      }),
    );
    // No equal weights should ever swap order across runs.
    const weights = out.map((s) => s.weight);
    expect(weights).toEqual([...weights].sort((a, b) => b - a));
  });
});

describe('topWhyNow', () => {
  it('returns at most the requested number of signals', () => {
    const out = topWhyNow(
      makeInputs({
        verifiedSignals: [
          { type: 'verified.has_careers_page', value: '/' },
          { type: 'verified.has_manual_workflow_language', value: '1' },
          { type: 'verified.likely_service_business', value: '1' },
          { type: 'verified.low_digital_maturity', value: '1' },
        ],
        hasContactForm: false,
        hasBookingLink: false,
        intelligence: makeIntelligence({
          operationalPain: sub(70),
          trustBarrier: sub(80),
        }),
      }),
      3,
    );
    expect(out.length).toBeLessThanOrEqual(3);
    // The strongest signals (weight 5) come first.
    expect(out[0].weight).toBeGreaterThanOrEqual(out[out.length - 1].weight);
  });
});
