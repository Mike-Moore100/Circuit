import type { CombinedScore, RawLead, ScoreReason } from '../types/index';
import { combineScores, evaluateIntent } from '../scoring/intentScoring';
import { evaluateRules } from '../filters/ruleBasedFilter';

function fmtReason(r: ScoreReason): string {
  const sign = r.delta >= 0 ? '+' : '';
  return `    ${sign}${r.delta}  ${r.label}`;
}

export function explainScoreFor(lead: RawLead): { combined: CombinedScore; text: string } {
  const rule = evaluateRules(lead);
  const intent = evaluateIntent(lead);
  const combined = combineScores(rule, intent, lead);

  const lines: string[] = [];
  lines.push('─────────────────────────────────────────────────────────────');
  lines.push(`Company:        ${lead.companyName}`);
  lines.push(`Industry:       ${lead.industry ?? '—'}`);
  lines.push(`Website:        ${lead.websiteUrl ?? '—'}`);
  lines.push(`Size estimate:  ${lead.sizeEstimate ?? '—'}`);
  lines.push(`Contact:        ${lead.contactName ?? '—'} (${lead.contactRole ?? '—'})`);
  lines.push('');
  lines.push(`Rule score:     ${rule.ruleScore.toString().padStart(3)} / 100   pass=${rule.pass}`);
  lines.push(`Intent score:   ${intent.intentScore.toString().padStart(3)} / 100`);
  lines.push(`Final score:    ${combined.finalScore.toString().padStart(3)} / 100`);
  lines.push(`Priority:       ${combined.priority}`);
  lines.push(`Campaign:       ${combined.campaign.primary}  — ${combined.campaign.primaryReason}`);
  lines.push('');
  lines.push('Rule reasons:');
  if (rule.reasons.length === 0) lines.push('    (none)');
  for (const r of rule.reasons) lines.push(fmtReason(r));
  lines.push('Rejection reasons:');
  if (rule.rejectionReasons.length === 0) lines.push('    (none)');
  for (const r of rule.rejectionReasons) lines.push(fmtReason(r));
  lines.push('Intent reasons:');
  if (intent.reasons.length === 0) lines.push('    (none)');
  for (const r of intent.reasons) lines.push(fmtReason(r));
  lines.push('Intent components:');
  for (const [k, v] of Object.entries(intent.components)) {
    lines.push(`    ${k.padEnd(26)} ${v}`);
  }

  return { combined, text: lines.join('\n') };
}
