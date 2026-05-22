// PatternInsightCard — one concise insight + evidence count. Used in
// the Pattern Insights section. Stays one line of insight text, one
// short evidence chip — no charts.

import type { PatternInsight } from '../../src/validation/patternInsights';

const KIND_LABEL: Record<PatternInsight['kind'], string> = {
  strongest_industry: 'Strongest',
  weakest_industry: 'Weakest',
  false_positive: 'False positives',
  false_reject: 'False rejects',
  signal_pattern: 'Signal',
};

const KIND_TONE: Record<PatternInsight['kind'], 'ok' | 'warn' | 'err' | 'info'> = {
  strongest_industry: 'ok',
  weakest_industry: 'warn',
  false_positive: 'err',
  false_reject: 'warn',
  signal_pattern: 'info',
};

interface Props {
  insight: PatternInsight;
}

export function PatternInsightCard({ insight }: Props) {
  return (
    <article className={`pattern-card pattern-card-${KIND_TONE[insight.kind]}`}>
      <header className="pattern-card-head">
        <span className={`pattern-card-kind pattern-card-kind-${KIND_TONE[insight.kind]}`}>
          {KIND_LABEL[insight.kind]}
        </span>
        <span className="pattern-card-evidence">{insight.evidenceLabel}</span>
      </header>
      <p className="pattern-card-text">{insight.text}</p>
    </article>
  );
}
