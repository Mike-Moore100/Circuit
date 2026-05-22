import type {
  CombinedScore,
  Company,
  RawLead,
  ReviewQueueRow,
  ScoreReason,
} from '../types/index';

// Map raw rule/intent reasons into human-friendly "likely pain point" phrases
// the operator can use as a starting point during outreach.
function inferPainPoints(combined: CombinedScore): string[] {
  const codes = new Set([
    ...combined.rule.reasons.map((r) => r.code),
    ...combined.intent.reasons.map((r) => r.code),
  ]);
  const points: string[] = [];

  if (codes.has('automatable_workload') || codes.has('manual_workload')) {
    points.push('Repetitive manual workflows likely eating operator time');
  }
  if (codes.has('ops_complexity')) {
    points.push('Multi-step operational workflows that could be glued together');
  }
  if (codes.has('urgency_workload')) {
    points.push('Team is visibly under workload pressure right now');
  }
  if (codes.has('urgency_hiring')) {
    points.push('Hiring to keep up — automation may delay/avoid more headcount');
  }
  if (codes.has('fit_workflows')) {
    points.push('Workflow profile matches the agency’s automation playbook');
  }
  if (codes.has('budget_size')) {
    points.push('Size band suggests a real (but lean) budget');
  }
  return points;
}

function suggestNextStep(combined: CombinedScore, lead: RawLead): string {
  if (combined.priority === 'Reject') {
    return 'Skip — fails rule filter or intent threshold.';
  }
  if (!lead.websiteUrl) {
    return 'Find a website / digital footprint before contacting.';
  }
  if (combined.priority === 'A') {
    return 'Manually inspect website + LinkedIn, draft tailored outreach for founder.';
  }
  if (combined.priority === 'B') {
    return 'Spot-check operational workflow signals, then queue for outreach in next batch.';
  }
  return 'Park in nurture list; revisit if stronger signals appear.';
}

export function buildReviewRow(
  company: Company,
  lead: RawLead,
  combined: CombinedScore,
): ReviewQueueRow {
  const isReject = combined.campaign.primary === 'REJECT';
  return {
    companyId: company.id,
    company: company.name,
    website: company.website_url ?? null,
    industry: company.industry ?? null,
    location: company.location ?? null,
    sizeEstimate: company.size_estimate ?? null,
    source: company.source,
    ruleScore: combined.rule.ruleScore,
    intentScore: combined.intent.intentScore,
    finalScore: combined.finalScore,
    priority: combined.priority,
    status: isReject ? 'rejected' : 'queued',
    reasons: [...combined.rule.reasons, ...combined.intent.reasons],
    // True rejection reasons only — empty if the lead landed in a real campaign.
    rejectionReasons: isReject ? combined.campaign.trueRejectionReasons : [],
    likelyPainPoints: inferPainPoints(combined),
    // The campaign-specific next step replaces the priority-derived one.
    suggestedNextStep: combined.campaign.suggestedInvestigation,
    updatedAt: new Date().toISOString(),
    primaryCampaign: combined.campaign.primary,
    campaignScores: combined.campaign.scores,
    primaryReason: combined.campaign.primaryReason,
    // Phase 1 industry tagging — copy through from companies if present.
    // Older callsites that don't have these fields just see null.
    discoveryQuery: (company as { discovery_query?: string | null }).discovery_query ?? null,
    discoveryLocation: (company as { discovery_location?: string | null }).discovery_location ?? null,
    industrySource: (company as { industry_source?: string | null }).industry_source ?? null,
    industryConfidence: (company as { industry_confidence?: number | null }).industry_confidence ?? null,
  };
}
