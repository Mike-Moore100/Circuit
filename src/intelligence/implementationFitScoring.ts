// Implementation fit — how cleanly does this business map onto something
// we can actually deliver? Reads campaign + pain shape + size + complexity.
// Pure deterministic — no AI guess at scope.

import { clamp100, type IntelligenceInputs, type SubScore } from './intelligenceTypes';

export function scoreImplementationFit(inputs: IntelligenceInputs): SubScore {
  const reasons: SubScore['reasons'] = [];
  const signals: string[] = [];
  let score = 30; // baseline — most leads have *some* fit if they got this far

  // Campaign clarity — is the pipeline confident about what we'd build?
  switch (inputs.primaryCampaign) {
    case 'AI_AUTOMATION':
      score += 25;
      reasons.push({
        code: 'campaign_clarity',
        label: 'Clean AI automation fit — operational language present',
        delta: 25,
      });
      signals.push('AI automation campaign fit');
      break;
    case 'WEB_REBUILD':
      score += 20;
      reasons.push({
        code: 'campaign_clarity',
        label: 'Clean web rebuild fit — concrete visible failure mode',
        delta: 20,
      });
      signals.push('Web rebuild campaign fit');
      break;
    case 'FUNNEL_OPTIMIZATION':
      score += 18;
      reasons.push({
        code: 'campaign_clarity',
        label: 'Funnel optimisation fit — site works, conversion is weak',
        delta: 18,
      });
      break;
    case 'LOCAL_DIGITAL_UPGRADE':
      score += 16;
      reasons.push({
        code: 'campaign_clarity',
        label: 'Local digital upgrade — well-scoped starter project',
        delta: 16,
      });
      break;
    case 'LOW_PRIORITY_NURTURE':
      score -= 6;
      reasons.push({
        code: 'unclear_scope',
        label: 'No clear primary campaign — scope is fuzzy',
        delta: -6,
      });
      break;
    case 'REJECT':
      score -= 30;
      reasons.push({
        code: 'reject_routing',
        label: 'Routed as REJECT — pipeline does not see a fit',
        delta: -30,
      });
      break;
  }

  // Size — SMB scope is what we deliver. Solo or enterprise both reduce fit.
  const size = inputs.sizeEstimate ?? 0;
  if (size >= 5 && size <= 50) {
    score += 14;
    reasons.push({
      code: 'sweet_spot_size',
      label: `Headcount ${size} — SMB scope we deliver well`,
      delta: 14,
    });
  } else if (size > 50 && size <= 150) {
    score += 6;
    reasons.push({
      code: 'larger_smb',
      label: `Headcount ${size} — larger but still in-scope`,
      delta: 6,
    });
  } else if (size > 150) {
    score -= 14;
    reasons.push({
      code: 'enterprise_scale',
      label: `Headcount ${size} — enterprise scale, mismatched delivery`,
      delta: -14,
    });
  } else if (size > 0 && size < 3) {
    score -= 10;
    reasons.push({
      code: 'too_solo',
      label: 'Solo operator — budget will be a blocker',
      delta: -10,
    });
  }

  // Concrete inefficiencies surfaced by evidence — visible workflows we
  // can credibly improve. Pain confirms there's something to fix.
  const concretePainCount =
    inputs.operationalClues.filter((c) => c.confidence >= 50).length +
    inputs.visualIssues.filter(
      (v) => v.confidence >= 70 && v.code !== 'no_visible_form',
    ).length;
  if (concretePainCount >= 3) {
    score += 12;
    reasons.push({
      code: 'concrete_pain',
      label: `${concretePainCount} concrete operational / visual issues identified`,
      delta: 12,
    });
    signals.push(`${concretePainCount} concrete issues`);
  } else if (concretePainCount === 0) {
    score -= 8;
    reasons.push({
      code: 'no_concrete_pain',
      label: 'No concrete issues surfaced yet — speculative pitch only',
      delta: -8,
    });
  }

  // The same final score that the rule pipeline already produced is a
  // useful sanity check — if rule+intent agree, fit is more believable.
  if (inputs.finalScore >= 70) {
    score += 6;
    reasons.push({
      code: 'rule_intent_agree',
      label: `Rule/intent score ${inputs.finalScore} — pipeline confident`,
      delta: 6,
    });
  } else if (inputs.finalScore < 40) {
    score -= 8;
    reasons.push({
      code: 'rule_intent_weak',
      label: `Rule/intent score ${inputs.finalScore} — pipeline isn't sure`,
      delta: -8,
    });
  }

  reasons.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return {
    score: clamp100(score),
    reasons: reasons.slice(0, 8),
    signals,
  };
}
