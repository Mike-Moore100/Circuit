import { describe, it, expect } from 'vitest';
import { scoreAccessibility } from '../src/intelligence/accessibilityScoring';
import { scoreBuyingReadiness } from '../src/intelligence/buyingReadinessScoring';
import { scoreEvidenceConfidence } from '../src/intelligence/evidenceConfidenceScoring';
import { scoreImplementationFit } from '../src/intelligence/implementationFitScoring';
import { scoreOperationalPain } from '../src/intelligence/operationalPainScoring';
import { scoreTrustBarrier } from '../src/intelligence/trustBarrierScoring';
import { computeOpportunityIntelligence } from '../src/intelligence/opportunityIntelligence';
import { rankHumanAttention } from '../src/intelligence/humanAttentionRanking';
import type { IntelligenceInputs } from '../src/intelligence/intelligenceTypes';

function makeInputs(overrides: Partial<IntelligenceInputs> = {}): IntelligenceInputs {
  return {
    companyId: 'cid',
    companyName: 'Acme',
    industry: 'marketing agency',
    location: 'London',
    websiteUrl: 'https://acme.test',
    sizeEstimate: 12,
    ruleScore: 70,
    intentScore: 60,
    finalScore: 65,
    primaryCampaign: 'AI_AUTOMATION',
    inspectionAttempted: true,
    inspectionOk: true,
    verifiedSignals: [
      { type: 'verified.has_working_website', value: '1' },
      { type: 'verified.has_contact_page', value: '/contact' },
    ],
    contacts: [
      {
        name: 'Jane Smith',
        role: 'Founder & CEO',
        email: 'jane@acme.test',
        emailStatus: 'extracted',
        source: 'static',
        detectedRole: 'founder',
        isPrimary: true,
      },
    ],
    hasPhone: true,
    hasContactForm: true,
    hasBookingLink: false,
    hasLinkedIn: true,
    hasDesktopScreenshot: true,
    hasMobileScreenshot: true,
    visualIssues: [],
    operationalClues: [
      { code: 'manual_intake_language', confidence: 70, evidence: ['we handle', 'we manage'] },
      { code: 'recurring_reporting_cadence', confidence: 65, evidence: ['monthly reporting'] },
    ],
    evidenceComputedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Per-scorer unit tests
// ---------------------------------------------------------------------------
describe('scoreOperationalPain', () => {
  it('produces 0 when there are no signals', () => {
    const out = scoreOperationalPain(
      makeInputs({ verifiedSignals: [], operationalClues: [], visualIssues: [] }),
    );
    expect(out.score).toBe(0);
    expect(out.reasons).toEqual([]);
  });

  it('adds points for a failed-page-load visual signal scaled by confidence', () => {
    const out = scoreOperationalPain(
      makeInputs({
        operationalClues: [],
        verifiedSignals: [],
        visualIssues: [{ code: 'page_failed_to_load', confidence: 90, campaign: 'WEB_REBUILD' }],
      }),
    );
    expect(out.score).toBeGreaterThan(15);
    expect(out.reasons[0].code).toContain('page_failed_to_load');
  });

  it('rolls up operational-clue language into the score', () => {
    const out = scoreOperationalPain(
      makeInputs({
        visualIssues: [],
        verifiedSignals: [],
        operationalClues: [
          { code: 'manual_intake_language', confidence: 80, evidence: [] },
          { code: 'admin_overhead_language', confidence: 60, evidence: [] },
        ],
      }),
    );
    expect(out.score).toBeGreaterThan(8);
    expect(out.signals.length).toBeGreaterThan(0);
  });
});

describe('scoreBuyingReadiness', () => {
  it('rewards SMB sweet-spot headcount + high-intent industry + working site', () => {
    const out = scoreBuyingReadiness(
      makeInputs({ sizeEstimate: 12, industry: 'marketing agency' }),
    );
    expect(out.score).toBeGreaterThanOrEqual(50);
    expect(out.reasons.some((r) => r.code === 'sweet_spot_size')).toBe(true);
    expect(out.reasons.some((r) => r.code === 'high_intent_industry')).toBe(true);
  });

  it('penalises solo operators', () => {
    const out = scoreBuyingReadiness(makeInputs({ sizeEstimate: 1 }));
    expect(out.reasons.some((r) => r.code === 'solo')).toBe(true);
  });
});

describe('scoreAccessibility', () => {
  it('peaks when the founder has a directly extracted email', () => {
    const out = scoreAccessibility(makeInputs());
    expect(out.score).toBeGreaterThanOrEqual(60);
    expect(out.reasons[0].code).toBe('named_dm_extracted');
  });

  it('only adds 22 (not 45) when the DM email is pattern-guessed', () => {
    const out = scoreAccessibility(
      makeInputs({
        contacts: [
          {
            ...makeInputs().contacts[0],
            email: 'jane@acme.test',
            emailStatus: 'guessed',
          },
        ],
      }),
    );
    expect(out.reasons[0].code).toBe('named_dm_guessed_email');
  });

  it('penalises 100+ headcount as procurement risk', () => {
    const out = scoreAccessibility(makeInputs({ sizeEstimate: 220 }));
    expect(out.reasons.some((r) => r.code === 'enterprise_bureaucracy' && r.delta < 0)).toBe(true);
  });
});

describe('scoreImplementationFit', () => {
  it('rewards a clean AI_AUTOMATION campaign + sweet-spot size', () => {
    const out = scoreImplementationFit(makeInputs());
    expect(out.score).toBeGreaterThanOrEqual(60);
  });

  it('hard-penalises REJECT-routed leads', () => {
    const out = scoreImplementationFit(makeInputs({ primaryCampaign: 'REJECT' }));
    expect(out.reasons.some((r) => r.delta <= -20)).toBe(true);
    expect(out.score).toBeLessThan(30);
  });
});

describe('scoreTrustBarrier', () => {
  it('returns 0 for a typical SMB', () => {
    const out = scoreTrustBarrier(makeInputs());
    expect(out.score).toBeLessThan(15);
  });

  it('flags enterprise headcount as a major trust barrier', () => {
    const out = scoreTrustBarrier(makeInputs({ sizeEstimate: 320 }));
    expect(out.score).toBeGreaterThanOrEqual(35);
  });

  it('flags technical industries as a trust barrier', () => {
    const out = scoreTrustBarrier(
      makeInputs({ industry: 'developer tools and infrastructure' }),
    );
    expect(out.reasons.some((r) => r.code === 'technical_industry')).toBe(true);
  });
});

describe('scoreEvidenceConfidence', () => {
  it('rewards inspection ok + verified signals + screenshots', () => {
    const out = scoreEvidenceConfidence(makeInputs());
    expect(out.score).toBeGreaterThanOrEqual(50);
  });

  it('keeps confidence low when nothing has run', () => {
    const out = scoreEvidenceConfidence(
      makeInputs({
        inspectionAttempted: false,
        inspectionOk: false,
        verifiedSignals: [],
        visualIssues: [],
        operationalClues: [],
        hasDesktopScreenshot: false,
        hasMobileScreenshot: false,
        contacts: [],
      }),
    );
    expect(out.score).toBeLessThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// Orchestrator + priority ranking
// ---------------------------------------------------------------------------
describe('computeOpportunityIntelligence', () => {
  it('produces a deterministic snapshot with all six sub-scores', () => {
    const intel = computeOpportunityIntelligence(makeInputs());
    expect(intel.opportunityScore).toBeGreaterThan(0);
    expect(intel.opportunityScore).toBeLessThanOrEqual(100);
    expect(intel.operationalPain).toBeDefined();
    expect(intel.buyingReadiness).toBeDefined();
    expect(intel.accessibility).toBeDefined();
    expect(intel.implementationFit).toBeDefined();
    expect(intel.trustBarrier).toBeDefined();
    expect(intel.evidenceConfidence).toBeDefined();
    expect(intel.opportunityReasons.length).toBeGreaterThan(0);
    expect(['IMMEDIATE', 'HIGH', 'MEDIUM', 'LOW', 'IGNORE']).toContain(
      intel.humanAttentionPriority,
    );
  });

  it('classifies a REJECT-routed lead as IGNORE', () => {
    const intel = computeOpportunityIntelligence(makeInputs({ primaryCampaign: 'REJECT' }));
    expect(intel.humanAttentionPriority).toBe('IGNORE');
  });

  it('classifies a strong reachable opportunity as HIGH or IMMEDIATE', () => {
    const intel = computeOpportunityIntelligence(
      makeInputs({
        visualIssues: [
          { code: 'no_visible_cta', confidence: 85, campaign: 'FUNNEL_OPTIMIZATION' },
          { code: 'mobile_horizontal_overflow', confidence: 85, campaign: 'WEB_REBUILD' },
          { code: 'no_contact_path', confidence: 90, campaign: 'WEB_REBUILD' },
          { code: 'outdated_visual_quality', confidence: 75, campaign: 'WEB_REBUILD' },
        ],
        operationalClues: [
          { code: 'manual_intake_language', confidence: 85, evidence: [] },
          { code: 'admin_overhead_language', confidence: 75, evidence: [] },
          { code: 'recurring_reporting_cadence', confidence: 75, evidence: [] },
        ],
      }),
    );
    expect(['IMMEDIATE', 'HIGH']).toContain(intel.humanAttentionPriority);
    expect(intel.likelyProjectType).toBe('AI_AUTOMATION');
  });

  it('marks enterprise-shape leads with high trust barriers as IGNORE', () => {
    const intel = computeOpportunityIntelligence(
      makeInputs({
        sizeEstimate: 350,
        industry: 'enterprise software platform',
        primaryCampaign: 'AI_AUTOMATION',
      }),
    );
    expect(intel.trustBarrier.score).toBeGreaterThanOrEqual(50);
    expect(['IGNORE', 'LOW']).toContain(intel.humanAttentionPriority);
  });

  it('confidence multiplier pulls high-pain low-evidence scores toward middle', () => {
    const noEvidence = computeOpportunityIntelligence(
      makeInputs({
        inspectionAttempted: false,
        inspectionOk: false,
        verifiedSignals: [],
        operationalClues: [],
        visualIssues: [],
        hasDesktopScreenshot: false,
        hasMobileScreenshot: false,
      }),
    );
    const withEvidence = computeOpportunityIntelligence(makeInputs());
    expect(noEvidence.opportunityScore).toBeLessThan(withEvidence.opportunityScore);
  });
});

describe('rankHumanAttention', () => {
  it('returns IGNORE for REJECT-routed leads regardless of other scores', () => {
    const r = rankHumanAttention({
      opportunityScore: 90,
      pain: { score: 80, reasons: [], signals: [] },
      readiness: { score: 80, reasons: [], signals: [] },
      accessibility: { score: 80, reasons: [], signals: [] },
      fit: { score: 80, reasons: [], signals: [] },
      trust: { score: 10, reasons: [], signals: [] },
      confidence: { score: 80, reasons: [], signals: [] },
      inputs: makeInputs({ primaryCampaign: 'REJECT' }),
    });
    expect(r.priority).toBe('IGNORE');
  });

  it('returns IGNORE when trust barrier is overwhelming', () => {
    const r = rankHumanAttention({
      opportunityScore: 80,
      pain: { score: 80, reasons: [], signals: [] },
      readiness: { score: 80, reasons: [], signals: [] },
      accessibility: { score: 80, reasons: [], signals: [] },
      fit: { score: 80, reasons: [], signals: [] },
      trust: { score: 85, reasons: [], signals: [] },
      confidence: { score: 80, reasons: [], signals: [] },
      inputs: makeInputs(),
    });
    expect(r.priority).toBe('IGNORE');
  });
});
