import type { Priority } from '../../src/types';

interface Props {
  counts: Record<Priority, number>;
  size?: number;
  thickness?: number;
}

// Segment colour driven by the same priority palette used in pills/badges
const COLOR: Record<Priority, string> = {
  A: 'var(--success)',
  B: 'var(--info)',
  C: 'var(--warning)',
  Reject: 'var(--danger)',
};

const ORDER: Priority[] = ['A', 'B', 'C', 'Reject'];

export function PriorityDonut({ counts, size = 132, thickness = 14 }: Props) {
  const radius = (size - thickness) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const total = ORDER.reduce((sum, key) => sum + (counts[key] ?? 0), 0);
  const active = total - (counts.Reject ?? 0);

  let offset = 0;
  const arcs = ORDER.map((key) => {
    const value = counts[key] ?? 0;
    const dash = total > 0 ? (value / total) * circumference : 0;
    const gap = circumference - dash;
    const seg = {
      key,
      dash,
      gap,
      // SVG starts at 3 o'clock; rotate -90° to start at 12; then offset by
      // the cumulative arcs we've already drawn.
      rotation: -90 + (offset / circumference) * 360,
    };
    offset += dash;
    return seg;
  });

  return (
    <div className="donut-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle
          cx={center}
          cy={center}
          r={radius}
          stroke="var(--bg-muted)"
          strokeWidth={thickness}
          fill="none"
        />
        {arcs.map((arc) =>
          arc.dash > 0 ? (
            <circle
              key={arc.key}
              cx={center}
              cy={center}
              r={radius}
              stroke={COLOR[arc.key]}
              strokeWidth={thickness}
              fill="none"
              strokeDasharray={`${arc.dash} ${arc.gap}`}
              strokeLinecap="butt"
              transform={`rotate(${arc.rotation} ${center} ${center})`}
            />
          ) : null,
        )}
      </svg>
      <div className="donut-center">
        <div className="donut-value">{active}</div>
        <div className="donut-label">in queue</div>
      </div>
    </div>
  );
}
