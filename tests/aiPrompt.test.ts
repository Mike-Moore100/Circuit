import { describe, it, expect } from 'vitest';
import {
  SYSTEM_PROMPT,
  buildHashableInput,
  buildUserPrompt,
} from '../src/ai/buildAnalysisPrompt';
import {
  parseAnalysisResponse,
} from '../src/ai/parseAnalysisResponse';
import { PROMPT_VERSION, type PromptInput } from '../src/ai/aiTypes';

const baseInput: PromptInput = {
  promptVersion: PROMPT_VERSION,
  company: {
    companyName: 'Acme Bookkeeping',
    industry: 'accounting',
    location: 'London, UK',
    websiteUrl: 'https://acme.example',
    source: 'google_maps',
    sizeEstimate: 10,
  },
  scoring: {
    finalScore: 88,
    ruleScore: 92,
    intentScore: 82,
    priority: 'A',
    reasons: [
      { label: 'Target industry match: accounting', delta: 14 },
      { label: 'Ideal headcount (10)', delta: 18 },
    ],
    rejectionReasons: [],
  },
  verifiedSignals: [
    { type: 'verified.has_contact_form', value: '/contact', confidence: 90 },
    { type: 'verified.has_services_page', value: '/services', confidence: 85 },
  ],
  homepageSnippet: 'We handle bookkeeping and admin for small businesses.',
  contact: { name: 'Sam Owner', role: 'Owner', email: 'sam@acme.example' },
};

describe('buildUserPrompt', () => {
  it('produces a compact structured prompt under the char cap', () => {
    const prompt = buildUserPrompt(baseInput, 12000);
    expect(prompt.length).toBeLessThanOrEqual(12000);
    expect(prompt).toContain('COMPANY: Acme Bookkeeping');
    expect(prompt).toContain('INDUSTRY: accounting');
    expect(prompt).toContain('priority    : A');
    expect(prompt).toContain('verified.has_contact_form');
    expect(prompt).toContain('Sam Owner');
    expect(prompt).toContain('STRICT JSON');
  });

  it('honors the maxChars cap', () => {
    const cap = 200;
    const prompt = buildUserPrompt(baseInput, cap);
    expect(prompt.length).toBeLessThanOrEqual(cap);
  });

  it('redacts an undefined homepage snippet without crashing', () => {
    const prompt = buildUserPrompt(
      { ...baseInput, homepageSnippet: null, contact: null },
      12000,
    );
    expect(prompt).not.toContain('HOMEPAGE SNIPPET');
    expect(prompt).not.toContain('CONTACT');
  });
});

describe('buildHashableInput', () => {
  it('is stable across identical inputs', () => {
    const a = buildHashableInput(baseInput);
    const b = buildHashableInput({ ...baseInput });
    expect(a).toBe(b);
  });

  it('changes when prompt version bumps', () => {
    const a = buildHashableInput(baseInput);
    const b = buildHashableInput({ ...baseInput, promptVersion: 'v9.9.9' });
    expect(a).not.toBe(b);
  });

  it('sorts reason labels so order does not matter', () => {
    const reordered: PromptInput = {
      ...baseInput,
      scoring: {
        ...baseInput.scoring,
        reasons: [
          { label: 'Ideal headcount (10)', delta: 18 },
          { label: 'Target industry match: accounting', delta: 14 },
        ],
      },
    };
    expect(buildHashableInput(baseInput)).toBe(buildHashableInput(reordered));
  });
});

describe('SYSTEM_PROMPT', () => {
  it('contains the anti-hype rules and JSON schema instructions', () => {
    expect(SYSTEM_PROMPT).toContain('Circuit');
    expect(SYSTEM_PROMPT).toContain('STRICT JSON');
    expect(SYSTEM_PROMPT).toContain('AI transformation');
    expect(SYSTEM_PROMPT).toContain('operationalPainPoints');
    expect(SYSTEM_PROMPT).toContain('automationOpportunities');
    expect(SYSTEM_PROMPT).toContain('likelyBuyer');
  });
});

describe('parseAnalysisResponse', () => {
  const VALID = JSON.stringify({
    summary: 'A plausible automation fit.',
    confidence: 65,
    operationalPainPoints: [
      {
        title: 'Manual intake',
        description: 'Likely manual coordination of inbound enquiries.',
        confidence: 70,
        evidence: ['verified.has_contact_form'],
      },
    ],
    automationOpportunities: [
      {
        title: 'Intake automation',
        description: 'Classify + draft first response.',
        businessImpact: 'Frees admin time.',
        implementationComplexity: 'low',
        confidence: 65,
      },
    ],
    likelyBuyer: {
      role: 'Owner',
      reasoning: 'Sub-50 person SMB.',
      confidence: 70,
    },
    urgencyAssessment: { level: 'medium', reasoning: 'Some manual signals.' },
    proofAngles: [{ title: 'Audit', description: 'Walk one inbound end-to-end.' }],
    risksOrObjections: ['No track record yet.'],
  });

  it('parses a clean JSON string', () => {
    const out = parseAnalysisResponse(VALID);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.summary).toContain('plausible');
      expect(out.result.operationalPainPoints).toHaveLength(1);
    }
  });

  it('extracts JSON wrapped in a markdown code fence', () => {
    const fenced = '```json\n' + VALID + '\n```';
    const out = parseAnalysisResponse(fenced);
    expect(out.ok).toBe(true);
  });

  it('extracts JSON wrapped in prose', () => {
    const wrapped = `Here you go:\n${VALID}\n\nLet me know if you need anything else.`;
    const out = parseAnalysisResponse(wrapped);
    expect(out.ok).toBe(true);
  });

  it('rejects responses with no JSON', () => {
    const out = parseAnalysisResponse("Sorry, I can't help with that.");
    expect(out.ok).toBe(false);
  });

  it('rejects JSON that fails schema validation', () => {
    const bad = JSON.stringify({
      summary: 'oops',
      // missing required fields
    });
    const out = parseAnalysisResponse(bad);
    expect(out.ok).toBe(false);
  });

  it('rejects confidence values outside 0–100', () => {
    const bad = JSON.parse(VALID);
    bad.confidence = 150;
    const out = parseAnalysisResponse(JSON.stringify(bad));
    expect(out.ok).toBe(false);
  });

  it('rejects invalid complexity values', () => {
    const bad = JSON.parse(VALID);
    bad.automationOpportunities[0].implementationComplexity = 'extreme';
    const out = parseAnalysisResponse(JSON.stringify(bad));
    expect(out.ok).toBe(false);
  });
});
