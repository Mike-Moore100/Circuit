// Pure-function tests for the Layer 1 decision summary derivation —
// the heart of the new 3-layer information hierarchy. Each helper is
// tested against real-world fixture shapes so the card / drawer
// rendering can't drift away from the spec.

import { describe, it, expect } from 'vitest';
import {
  pickBestContact,
  pickStrongestEvidence,
  pickStrongestReason,
  pickTopRisk,
  recommendNextAction,
} from '../app/_components/decisionSummaryLogic';
import type {
  IntelligenceRowSummary,
  LeadContactBundle,
  LeadEvidenceSummary,
  RegistryEnrichmentPanel,
} from '../app/_lib/dashboardData';
import type { ReviewQueueRow } from '../src/types';

function lead(overrides: Partial<ReviewQueueRow> = {}): ReviewQueueRow {
  return {
    companyId: 'cid',
    company: 'Acme Ltd',
    website: 'https://acme.test',
    industry: 'accountants',
    location: 'London',
    sizeEstimate: 12,
    source: 'serp.duckduckgo',
    ruleScore: 70,
    intentScore: 60,
    finalScore: 65,
    priority: 'A',
    status: 'queued',
    reasons: [],
    rejectionReasons: [],
    likelyPainPoints: [],
    suggestedNextStep: '',
    updatedAt: '2026-01-01T00:00:00.000Z',
    primaryCampaign: 'AI_AUTOMATION',
    campaignScores: {
      AI_AUTOMATION: 70,
      WEB_REBUILD: 0,
      FUNNEL_OPTIMIZATION: 0,
      LOCAL_DIGITAL_UPGRADE: 0,
      LOW_PRIORITY_NURTURE: 0,
      REJECT: 0,
    },
    primaryReason: 'fits',
    discoveryQuery: 'accountants London',
    discoveryLocation: 'London',
    industrySource: 'query',
    industryConfidence: 95,
    ...overrides,
  };
}

function intel(overrides: Partial<IntelligenceRowSummary> = {}): IntelligenceRowSummary {
  return {
    opportunityScore: 72,
    humanAttentionPriority: 'HIGH',
    likelyProjectType: 'AI_AUTOMATION',
    estimatedCommercialPotential: 'MEDIUM',
    whyNow: [],
    operationalPain: 60,
    trustBarrier: 30,
    buyingReadiness: 65,
    accessibility: 55,
    topOpportunityReason: 'Manual workflow language detected',
    topRiskFactor: 'Trust friction visible',
    strongestEvidence: 'Multiple service pages + contact form',
    strongestPainSignal: 'Manual onboarding',
    likelyBuyer: 'Founder · Jane Smith',
    commercialWeaknesses: [],
    registry: null,
    ...overrides,
  };
}

function emptyContacts(): LeadContactBundle {
  return { contacts: [], routes: [] };
}

// ---------------------------------------------------------------------------
// pickBestContact
// ---------------------------------------------------------------------------
describe('pickBestContact', () => {
  it('prefers a named decision-maker with an extracted personal email', () => {
    const out = pickBestContact(
      {
        contacts: [
          {
            name: 'Jane Smith',
            role: 'Founder',
            email: 'jane@acme.test',
            emailType: null,
            emailStatus: 'extracted',
            linkedinUrl: null,
            sourceUrl: null,
            source: 'static',
            overallConfidence: 80,
            isPrimary: true,
            id: 'cid-1',
            emailVerificationStatus: null,
            emailConfidenceScore: null,
            emailRiskReasons: null,
            emailCheckedAt: null,
            isDisposable: false,
            isRoleBased: false,
            isCatchAllRisk: false,
            verificationMethod: null,
          },
        ],
        routes: [],
      },
      null,
      false,
    );
    expect(out.tone).toBe('ok');
    expect(out.line).toContain('Jane Smith');
    expect(out.line).toContain('jane@acme.test');
  });

  it('downgrades to warn for a generic info@ email', () => {
    const out = pickBestContact(
      {
        contacts: [
          {
            name: null,
            role: null,
            email: 'info@acme.test',
            emailType: 'generic',
            emailStatus: 'extracted',
            linkedinUrl: null,
            sourceUrl: null,
            source: 'static',
            overallConfidence: 50,
            isPrimary: true,
            id: 'cid-2',
            emailVerificationStatus: null,
            emailConfidenceScore: null,
            emailRiskReasons: null,
            emailCheckedAt: null,
            isDisposable: false,
            isRoleBased: false,
            isCatchAllRisk: false,
            verificationMethod: null,
          },
        ],
        routes: [],
      },
      'Founder · Jane Smith',
      true,
    );
    expect(out.tone).toBe('warn');
    expect(out.line).toContain('info@acme.test');
    expect(out.line).toContain('+ phone');
  });

  it('falls back to phone-only when no email exists', () => {
    expect(pickBestContact(emptyContacts(), null, true).tone).toBe('warn');
    expect(pickBestContact(emptyContacts(), null, true).line).toMatch(/Phone only/);
  });

  it('returns muted "no path" when nothing is reachable', () => {
    expect(pickBestContact(emptyContacts(), null, false).tone).toBe('muted');
  });

  it('rejects guessed emails for the named-DM path (downgrades to ok-named-only)', () => {
    const out = pickBestContact(
      {
        contacts: [
          {
            name: 'Jane Smith',
            role: 'Founder',
            email: 'jane@acme.test',
            emailType: null,
            emailStatus: 'guessed',
            linkedinUrl: null,
            sourceUrl: null,
            source: 'guessed',
            overallConfidence: 30,
            isPrimary: true,
            id: 'cid-3',
            emailVerificationStatus: null,
            emailConfidenceScore: null,
            emailRiskReasons: null,
            emailCheckedAt: null,
            isDisposable: false,
            isRoleBased: false,
            isCatchAllRisk: false,
            verificationMethod: null,
          },
        ],
        routes: [],
      },
      null,
      false,
    );
    // Still 'ok' because the name + email pair is present, just not the
    // top-tier extracted-DM path.
    expect(out.tone).toBe('ok');
    expect(out.line).toContain('Jane Smith');
  });
});

// ---------------------------------------------------------------------------
// recommendNextAction
// ---------------------------------------------------------------------------
describe('recommendNextAction', () => {
  it('returns Skip when primary campaign is REJECT', () => {
    const out = recommendNextAction(
      lead({ primaryCampaign: 'REJECT', primaryReason: 'fails filter' }),
      intel(),
      { line: '', tone: 'ok' },
      null,
    );
    expect(out.tone).toBe('skip');
    expect(out.label).toBe('Skip');
    expect(out.reasoning).toContain('fails filter');
  });

  it('returns "Skip — not trading" for dissolved companies', () => {
    const registry: RegistryEnrichmentPanel = {
      outcome: 'enriched',
      reason: '',
      fetchedAt: '',
      registry: 'companies_house',
      record: {
        registryId: '00000001',
        registry: 'companies_house',
        companyName: 'Acme',
        status: 'dissolved',
        incorporationDate: null,
        sicCodes: [],
        registeredOfficeLocality: null,
        registeredOfficeCountry: null,
        officers: [],
        filingsCurrent: null,
      },
      signals: null,
    };
    const out = recommendNextAction(lead(), intel(), { line: '', tone: 'ok' }, registry);
    expect(out.tone).toBe('skip');
    expect(out.label).toMatch(/not trading/);
  });

  it('returns "Contact today" for IMMEDIATE attention with a good contact route', () => {
    const out = recommendNextAction(
      lead(),
      intel({ humanAttentionPriority: 'IMMEDIATE' }),
      { line: 'Jane Smith · …', tone: 'ok' },
      null,
    );
    expect(out.label).toBe('Contact today');
    expect(out.tone).toBe('pursue');
  });

  it('returns "Contact this week" for HIGH attention with a good contact route', () => {
    const out = recommendNextAction(
      lead(),
      intel({ humanAttentionPriority: 'HIGH' }),
      { line: 'Jane Smith · …', tone: 'ok' },
      null,
    );
    expect(out.label).toBe('Contact this week');
  });

  it('returns "Investigate further" for MEDIUM attention', () => {
    const out = recommendNextAction(
      lead(),
      intel({ humanAttentionPriority: 'MEDIUM' }),
      { line: '', tone: 'warn' },
      null,
    );
    expect(out.tone).toBe('investigate');
  });

  it('returns "Park as nurture" for IGNORE attention', () => {
    const out = recommendNextAction(
      lead(),
      intel({ humanAttentionPriority: 'IGNORE', opportunityScore: 5 }),
      { line: '', tone: 'muted' },
      null,
    );
    expect(out.tone).toBe('skip');
    expect(out.label).toMatch(/nurture/);
    expect(out.reasoning).toContain('5/100');
  });
});

// ---------------------------------------------------------------------------
// pickTopRisk, pickStrongestReason, pickStrongestEvidence
// ---------------------------------------------------------------------------
describe('pickTopRisk', () => {
  it('uses topRiskFactor when present', () => {
    expect(pickTopRisk(intel({ topRiskFactor: 'r' }))).toBe('r');
  });
  it('falls back to first commercial weakness', () => {
    expect(
      pickTopRisk(
        intel({
          topRiskFactor: null,
          commercialWeaknesses: [
            {
              kind: 'weak_onboarding_flow',
              label: 'Weak onboarding',
              detail: 'no form',
              severity: 5,
            },
          ],
        }),
      ),
    ).toBe('no form');
  });
  it('falls back to high trust barrier when nothing else is set', () => {
    expect(
      pickTopRisk(intel({ topRiskFactor: null, commercialWeaknesses: [], trustBarrier: 80 })),
    ).toBe('High trust barrier visible');
  });
  it('returns null when no risks at all', () => {
    expect(
      pickTopRisk(intel({ topRiskFactor: null, commercialWeaknesses: [], trustBarrier: 0 })),
    ).toBeNull();
  });
});

describe('pickStrongestReason', () => {
  it('prefers topOpportunityReason', () => {
    expect(pickStrongestReason(intel({ topOpportunityReason: 'r' }))).toBe('r');
  });
  it('falls back to the first why-now signal', () => {
    expect(
      pickStrongestReason(
        intel({
          topOpportunityReason: null,
          whyNow: [
            { kind: 'hiring', label: 'Hiring', detail: 'detail-line', weight: 4 },
          ],
        }),
      ),
    ).toBe('detail-line');
  });
});

describe('pickStrongestEvidence', () => {
  it('prefers intelligence.strongestEvidence', () => {
    expect(pickStrongestEvidence(intel({ strongestEvidence: 'phone listed' }), null)).toBe(
      'phone listed',
    );
  });
  it('falls back to the first operational clue', () => {
    const ev: LeadEvidenceSummary = {
      capturedAt: null,
      evidenceConfidence: 50,
      desktopScreenshotPath: null,
      mobileScreenshotPath: null,
      visualIssues: [],
      operationalClues: [
        { code: 'manual_workflow', label: 'Manual workflow', confidence: 80, evidence: [] },
      ],
    };
    expect(
      pickStrongestEvidence(intel({ strongestEvidence: null }), ev),
    ).toBe('Manual workflow');
  });
});
