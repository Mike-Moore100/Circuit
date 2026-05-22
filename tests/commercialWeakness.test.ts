// Phase 1 Live Validation — commercial weakness detection.

import { describe, it, expect } from 'vitest';
import {
  computeCommercialWeaknesses,
  topCommercialWeaknesses,
  type CommercialWeaknessInputs,
} from '../src/intelligence/commercialWeakness';
import type {
  IntelligenceVerifiedSignal,
  OpportunityIntelligence,
  SubScore,
} from '../src/intelligence/intelligenceTypes';

function sub(score: number, signals: string[] = []): SubScore {
  return { score, reasons: [], signals };
}

function intel(
  overrides: Partial<OpportunityIntelligence> = {},
): OpportunityIntelligence {
  return {
    companyId: 'c1',
    computedAt: '2026-01-01T00:00:00.000Z',
    opportunityScore: 50,
    humanAttentionPriority: 'MEDIUM',
    operationalPain: sub(40),
    buyingReadiness: sub(40),
    accessibility: sub(40),
    implementationFit: sub(40),
    trustBarrier: sub(30),
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

function inputs(
  overrides: Partial<CommercialWeaknessInputs> = {},
): CommercialWeaknessInputs {
  return {
    verifiedSignals: [] as IntelligenceVerifiedSignal[],
    intelligence: intel(),
    hasContactForm: true,
    hasBookingLink: false,
    hasWorkingWebsite: true,
    companyName: 'Lumen & Co',
    industry: 'marketing agency',
    ...overrides,
  };
}

describe('computeCommercialWeaknesses', () => {
  it('flags unclear service structure when working site has no services page', () => {
    const out = computeCommercialWeaknesses(inputs());
    expect(out.some((w) => w.kind === 'unclear_service_structure')).toBe(true);
  });

  it('does NOT flag unclear services if the website failed to load', () => {
    const out = computeCommercialWeaknesses(
      inputs({ hasWorkingWebsite: false }),
    );
    expect(out.some((w) => w.kind === 'unclear_service_structure')).toBe(false);
  });

  it('clears unclear services when a services page is detected', () => {
    const out = computeCommercialWeaknesses(
      inputs({
        verifiedSignals: [{ type: 'verified.has_services_page', value: '/services' }],
      }),
    );
    expect(out.some((w) => w.kind === 'unclear_service_structure')).toBe(false);
  });

  it('flags weak onboarding when there is no form and no booking', () => {
    const out = computeCommercialWeaknesses(
      inputs({ hasContactForm: false, hasBookingLink: false }),
    );
    const weak = out.find((w) => w.kind === 'weak_onboarding_flow');
    expect(weak).toBeTruthy();
    expect(weak!.severity).toBe(5);
  });

  it('flags generic positioning when the name contains the industry as a phrase', () => {
    const out = computeCommercialWeaknesses(
      inputs({
        companyName: 'Digital Marketing Agency London',
        industry: 'marketing agency',
      }),
    );
    expect(out.some((w) => w.kind === 'generic_positioning')).toBe(true);
  });

  it('does NOT flag generic positioning for a branded name', () => {
    const out = computeCommercialWeaknesses(
      inputs({ companyName: 'Lumen & Co', industry: 'marketing agency' }),
    );
    expect(out.some((w) => w.kind === 'generic_positioning')).toBe(false);
  });

  it('flags operational immaturity with higher severity when site failed AND low maturity', () => {
    const out = computeCommercialWeaknesses(
      inputs({
        verifiedSignals: [
          { type: 'verified.website_failed', value: 'true' },
          { type: 'verified.low_digital_maturity', value: '1' },
        ],
        hasWorkingWebsite: false,
      }),
    );
    const om = out.find((w) => w.kind === 'operational_immaturity');
    expect(om!.severity).toBe(5);
  });

  it('flags weak trust signals when the trust barrier is high', () => {
    const out = computeCommercialWeaknesses(
      inputs({ intelligence: intel({ trustBarrier: sub(80) }) }),
    );
    const w = out.find((x) => x.kind === 'weak_trust_signals');
    expect(w).toBeTruthy();
    expect(w!.severity).toBe(4);
  });

  it('returns results sorted by severity desc, then kind for stability', () => {
    const out = computeCommercialWeaknesses(
      inputs({
        verifiedSignals: [
          { type: 'verified.website_failed', value: '1' },
          { type: 'verified.low_digital_maturity', value: '1' },
          { type: 'verified.likely_service_business', value: '1' },
        ],
        hasContactForm: false,
        hasBookingLink: false,
        hasWorkingWebsite: false,
        companyName: 'Digital Marketing Agency London',
        intelligence: intel({ trustBarrier: sub(80) }),
      }),
    );
    const severities = out.map((w) => w.severity);
    expect(severities).toEqual([...severities].sort((a, b) => b - a));
  });
});

describe('topCommercialWeaknesses', () => {
  it('clamps the result count', () => {
    const out = topCommercialWeaknesses(
      inputs({
        hasContactForm: false,
        hasBookingLink: false,
        verifiedSignals: [
          { type: 'verified.website_failed', value: '1' },
          { type: 'verified.likely_service_business', value: '1' },
        ],
        companyName: 'Digital Marketing Agency London',
        intelligence: intel({ trustBarrier: sub(80) }),
      }),
      2,
    );
    expect(out.length).toBeLessThanOrEqual(2);
  });
});
