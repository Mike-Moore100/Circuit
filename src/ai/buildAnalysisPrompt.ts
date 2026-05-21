import type { PromptInput } from './aiTypes';

// The system prompt is the EXPENSIVE part — long, stable, marked as cacheable
// by the Anthropic provider so we pay ~0.1× input on cache hits.
//
// Tone rules embedded here are deliberate: Circuit is not a marketing
// engine — every line of output should sound like an experienced operator
// drafting a private internal note.
export const SYSTEM_PROMPT = `You are Circuit's operational intelligence analyst.

You produce realistic, grounded analyses of small / mid-sized businesses for an
AI development and automation agency. Your audience is one operator deciding
whether to invest time pitching this lead — so your output is read once, used
once, and must hold up under scrutiny.

YOU MUST:
- Ground every insight in the structured evidence provided (verified website
  signals, scoring reasons, homepage snippet, contact info).
- State confidence honestly. If evidence is thin, lower confidence. Say so.
- Use plain operational language ("likely spending time coordinating inbound
  enquiries"), not marketing language.
- Suggest realistic automation opportunities tied to the business's actual
  workflows. Tie each opportunity to concrete evidence.

YOU MUST NOT:
- Invent specifics, numbers, revenue figures, headcount, or claims the
  evidence does not support.
- Use buzzwords or hype ("AI transformation", "massive opportunity",
  "revolutionize", "10x", "next-gen").
- Generate outreach copy, email drafts, or marketing language.
- Speculate beyond what the evidence supports — if you do not know, say so
  and lower confidence.

CONFIDENCE CALIBRATION:
- 80–100: strong, directly-evidenced.
- 50–79: plausible, partially evidenced.
- 20–49: weak, mostly industry baseline.
- 0–19: do not bother — return "Insufficient evidence to analyze."

OUTPUT FORMAT — STRICT JSON ONLY. No prose before or after, no markdown
fences. Match this schema exactly:

{
  "summary": "2–3 sentence neutral summary of the lead and its plausible operational profile.",
  "confidence": 0-100,
  "operationalPainPoints": [
    {
      "title": "<short title>",
      "description": "<1–2 sentences, plain operational language>",
      "confidence": 0-100,
      "evidence": ["<short reference to a signal or input you used>"]
    }
  ],
  "automationOpportunities": [
    {
      "title": "<short>",
      "description": "<concrete automation idea grounded in evidence>",
      "businessImpact": "<directional impact — time saved, error reduction, etc. — no fake numbers>",
      "implementationComplexity": "low" | "medium" | "high",
      "confidence": 0-100
    }
  ],
  "likelyBuyer": {
    "role": "<expected decision maker>",
    "reasoning": "<short>",
    "confidence": 0-100
  },
  "urgencyAssessment": {
    "level": "low" | "medium" | "high",
    "reasoning": "<short>"
  },
  "proofAngles": [
    {
      "title": "<short>",
      "description": "<a concrete audit / observation we could surface before any outreach>"
    }
  ],
  "risksOrObjections": [
    "<short — concrete reasons this lead may not convert>"
  ]
}

If the evidence is too thin to analyze at all, return the schema with
"summary": "Insufficient evidence to analyze.", a confidence under 25, and
empty arrays for the list fields (still include likelyBuyer and
urgencyAssessment with low confidence and a "no evidence" reasoning).`;

function fmtReason(r: { label: string; delta: number }): string {
  const sign = r.delta >= 0 ? '+' : '';
  return `  ${sign}${r.delta}  ${r.label}`;
}

// Compact, structured input. We deliberately do NOT include the homepage
// raw HTML — only its title, meta description, and a length-capped excerpt.
export function buildUserPrompt(input: PromptInput, maxChars: number): string {
  const c = input.company;
  const s = input.scoring;
  const lines: string[] = [];

  lines.push(`PROMPT_VERSION: ${input.promptVersion}`);
  lines.push(`COMPANY: ${c.companyName}`);
  if (c.industry) lines.push(`INDUSTRY: ${c.industry}`);
  if (c.location) lines.push(`LOCATION: ${c.location}`);
  if (c.websiteUrl) lines.push(`WEBSITE: ${c.websiteUrl}`);
  if (c.sizeEstimate !== null) lines.push(`SIZE_ESTIMATE: ~${c.sizeEstimate}`);
  lines.push(`SOURCE: ${c.source}`);
  lines.push('');

  lines.push('SCORING');
  lines.push(`  priority    : ${s.priority}`);
  lines.push(`  final_score : ${s.finalScore}`);
  lines.push(`  rule_score  : ${s.ruleScore}`);
  lines.push(`  intent_score: ${s.intentScore}`);
  if (s.reasons.length > 0) {
    lines.push('  reasons:');
    for (const r of s.reasons.slice(0, 20)) lines.push(fmtReason(r));
  }
  if (s.rejectionReasons.length > 0) {
    lines.push('  rejection_reasons:');
    for (const r of s.rejectionReasons.slice(0, 10)) lines.push(fmtReason(r));
  }
  lines.push('');

  if (input.verifiedSignals.length > 0) {
    lines.push('VERIFIED WEBSITE SIGNALS');
    for (const sig of input.verifiedSignals.slice(0, 25)) {
      lines.push(`  ${sig.type}  [conf ${sig.confidence}]  ${sig.value}`);
    }
    lines.push('');
  }

  if (input.contact && (input.contact.name || input.contact.role || input.contact.email)) {
    lines.push('CONTACT');
    if (input.contact.name) lines.push(`  name : ${input.contact.name}`);
    if (input.contact.role) lines.push(`  role : ${input.contact.role}`);
    if (input.contact.email) lines.push(`  email: ${input.contact.email}`);
    lines.push('');
  }

  if (input.homepageSnippet) {
    lines.push('HOMEPAGE SNIPPET');
    lines.push(input.homepageSnippet.slice(0, 2000));
    lines.push('');
  }

  lines.push('Return STRICT JSON matching the schema in the system prompt.');

  let prompt = lines.join('\n');
  if (prompt.length > maxChars) prompt = prompt.slice(0, maxChars);
  return prompt;
}

// Stable cache hash input — covers the prompt version + everything that
// affects the model's input. Changing prompt version invalidates all cache.
export function buildHashableInput(input: PromptInput): string {
  return JSON.stringify({
    v: input.promptVersion,
    company: input.company,
    scoring: {
      priority: input.scoring.priority,
      final: input.scoring.finalScore,
      rule: input.scoring.ruleScore,
      intent: input.scoring.intentScore,
      reasons: input.scoring.reasons.map((r) => r.label).sort(),
      rejections: input.scoring.rejectionReasons.map((r) => r.label).sort(),
    },
    signals: input.verifiedSignals
      .map((s) => `${s.type}:${s.value}`)
      .sort(),
    snippet: input.homepageSnippet?.slice(0, 1500) ?? null,
    contact: input.contact ?? null,
  });
}
