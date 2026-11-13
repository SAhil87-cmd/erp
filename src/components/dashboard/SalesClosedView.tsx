'use client';

import { useMemo } from 'react';
import { computeOverviewMetrics } from '@/lib/crm/analytics';
import { ExportLeadsBar } from './ExportLeadsBar';
import { LeadsTable } from './LeadsTable';
import { MetricCards } from './MetricCards';
import { formatPct } from './labels';
import { buildLeadRows, filterSnapshotClient } from './selectors';
import { useCrmStore } from './useCrmStore';

export function SalesClosedView() {
  const snapshot = useCrmStore((s) => s.snapshot);
  const filters = useCrmStore((s) => s.filters);

  const { rows, metrics } = useMemo(() => {
    if (!snapshot) return { rows: [], metrics: null };
    const filtered = filterSnapshotClient(snapshot, {
      ...filters,
      stages: ['Sales Closed'],
    });
    return {
      rows: buildLeadRows(filtered),
      metrics: computeOverviewMetrics(filterSnapshotClient(snapshot, filters)),
    };
  }, [snapshot, filters]);

  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <h1>Sales Closed</h1>
          <p>Won deals in the current filter set.</p>
        </div>
        <ExportLeadsBar rows={rows} label="Sales Closed" compact />
      </header>
      <MetricCards
        items={[
          { label: 'Closed deals', value: rows.length, tone: 'opportunity' },
          {
            label: 'Conversion (pipeline)',
            value: metrics ? formatPct(metrics.conversionRate) : '—',
            hint: metrics?.conversionDenominatorDescription,
          },
        ]}
      />
      <section className="dash-card">
        <LeadsTable rows={rows} emptyMessage="No closed sales in this filter set." />
      </section>
    </div>
  );
}
