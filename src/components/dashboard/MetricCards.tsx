'use client';

export interface MetricCardItem {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'default' | 'urgent' | 'warning' | 'opportunity' | 'neutral';
}

export function MetricCards({ items }: { items: MetricCardItem[] }) {
  return (
    <div className="metric-grid">
      {items.map((item) => (
        <article key={item.label} className={`metric-card tone-${item.tone ?? 'default'}`}>
          <p className="metric-label">{item.label}</p>
          <p className="metric-value">{item.value}</p>
          {item.hint ? <p className="metric-hint">{item.hint}</p> : null}
        </article>
      ))}
    </div>
  );
}
