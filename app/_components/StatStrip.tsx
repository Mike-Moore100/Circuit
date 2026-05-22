// Reusable stat strip — a row of compact metric cards. Replaces the
// hand-rolled .discovery-strip markup that's been duplicated on every
// operational page.

export interface StatItem {
  label: string;
  value: string | number;
  foot?: string;
  // Optional tone for the value: success / warning / danger / accent.
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'accent';
}

export function StatStrip({ items }: { items: StatItem[] }) {
  return (
    <div className="discovery-strip">
      {items.map((s, i) => (
        <div key={`${s.label}-${i}`} className="discovery-stat">
          <span className="discovery-stat-label">{s.label}</span>
          <span
            className="discovery-stat-value"
            data-tone={s.tone ?? 'default'}
          >
            {s.value}
          </span>
          {s.foot && <span className="discovery-stat-foot">{s.foot}</span>}
        </div>
      ))}
    </div>
  );
}
