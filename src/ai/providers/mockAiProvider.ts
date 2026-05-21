import type { AiProvider, AiAnalysisResult, ProviderResult } from '../aiTypes';
import { estimateCostUsd } from './types';

// Deterministic, grounded-looking analysis built from the structured input.
// Used when no API key is available or when GOOGLE_/AI_-style FORCE_MOCK is set.
function buildMockAnalysis(userPrompt: string): AiAnalysisResult {
  // Light input fingerprinting so the mock looks like it actually read the
  // structured context (rather than emitting identical output for every lead).
  const companyMatch = userPrompt.match(/COMPANY:\s*([^\n]+)/);
  const industryMatch = userPrompt.match(/INDUSTRY:\s*([^\n]+)/);
  const company = companyMatch?.[1]?.trim() ?? 'this business';
  const industry = industryMatch?.[1]?.trim() ?? 'their industry';
  const hasContactForm = /verified\.has_contact_form/.test(userPrompt);
  const hasBooking = /verified\.has_booking_link/.test(userPrompt);
  const hasManualLanguage = /verified\.has_manual_workflow_language/.test(userPrompt);

  const painPoints = [
    {
      title: 'Inbound enquiry coordination',
      description: `Likely spending meaningful operator time on inbound enquiry triage and follow-ups, given the surfaced contact / intake pattern on ${company}'s site.`,
      confidence: hasContactForm ? 65 : 45,
      evidence: hasContactForm
        ? ['verified.has_contact_form on homepage', 'industry baseline for ' + industry]
        : ['industry baseline for ' + industry],
    },
  ];
  if (hasManualLanguage) {
    painPoints.push({
      title: 'Manual repetitive workflows',
      description: 'Homepage copy explicitly describes handling, coordinating or scheduling on behalf of clients — those are typical automation targets.',
      confidence: 70,
      evidence: ['verified.has_manual_workflow_language phrasing on site'],
    });
  }

  const opportunities = [
    {
      title: 'Intake → first-response automation',
      description: 'A lightweight pipeline that triages inbound submissions, classifies intent, and drafts a templated first response for the owner to review.',
      businessImpact: 'Reduces first-response latency; frees ~20–40% of admin time depending on volume (rough industry estimate, not measured for this lead).',
      implementationComplexity: 'low' as const,
      confidence: hasContactForm ? 65 : 45,
    },
  ];
  if (hasBooking) {
    opportunities.push({
      title: 'Booking-to-CRM hand-off',
      description: 'Connect the existing booking link to a structured client record + reminders flow so nothing is re-keyed manually.',
      businessImpact: 'Removes manual re-entry; reduces no-shows.',
      implementationComplexity: 'low' as const,
      confidence: 65,
    });
  }

  return {
    summary: `Plausible automation fit for ${company} based on the verified surface; specific scope would need an owner conversation to confirm. (mock provider — not a live AI call.)`,
    confidence: hasContactForm ? 55 : 40,
    operationalPainPoints: painPoints,
    automationOpportunities: opportunities,
    likelyBuyer: {
      role: 'Owner / managing director',
      reasoning: 'Sub-50 person businesses with visible founder contact tend to make automation purchases at the owner level.',
      confidence: 60,
    },
    urgencyAssessment: {
      level: hasManualLanguage ? 'medium' : 'low',
      reasoning: hasManualLanguage
        ? 'Manual-workflow language on the homepage suggests the operator is already aware of the cost.'
        : 'No strong urgency signal from the evidence provided.',
    },
    proofAngles: [
      {
        title: 'Show, don\'t tell',
        description: 'Audit one real inbound submission end-to-end and demonstrate where the manual steps live.',
      },
    ],
    risksOrObjections: [
      'Insufficient evidence to estimate hard numbers — this analysis is directional, not quantified.',
    ],
  };
}

export function createMockAiProvider(model = 'mock'): AiProvider {
  return {
    name: 'mock',
    model,
    async generate(_systemPrompt: string, userPrompt: string): Promise<ProviderResult> {
      const analysis = buildMockAnalysis(userPrompt);
      const rawJson = JSON.stringify(analysis);
      const usage = {
        inputTokens: Math.min(2000, userPrompt.length / 4),
        outputTokens: Math.min(800, rawJson.length / 4),
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
      };
      return {
        rawJson,
        usage,
        // Treat mock as effectively zero-cost for budget arithmetic.
        estimatedCostUsd: estimateCostUsd('claude-haiku-4-5', usage) * 0, // explicit zero
        provider: 'mock',
        model,
      };
    },
  };
}
