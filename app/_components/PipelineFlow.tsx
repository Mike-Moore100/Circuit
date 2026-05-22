// Visual representation of the pipeline as flowing stages. Used on the
// Overview page so the operator sees Circuit as a continuously running
// system, not a stack of stats.

import Link from 'next/link';

export interface PipelineStage {
  href: string;
  label: string;
  // Primary value shown in the stage (e.g. queue depth, throughput).
  value: string | number;
  // Optional sub-line.
  sub?: string;
  // Optional alert state — render the stage in warning tone.
  alert?: boolean;
}

export function PipelineFlow({ stages }: { stages: PipelineStage[] }) {
  return (
    <div className="pipeline-flow" role="list">
      {stages.map((stage, i) => (
        <div key={stage.href} className="pipeline-stage-row" role="listitem">
          <Link
            href={stage.href}
            className={`pipeline-stage${stage.alert ? ' pipeline-stage-alert' : ''}`}
          >
            <span className="pipeline-stage-label">{stage.label}</span>
            <span className="pipeline-stage-value">{stage.value}</span>
            {stage.sub && <span className="pipeline-stage-sub">{stage.sub}</span>}
          </Link>
          {i < stages.length - 1 && (
            <span className="pipeline-arrow" aria-hidden>
              →
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
