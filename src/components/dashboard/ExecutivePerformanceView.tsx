'use client';

import { useMemo } from 'react';
import { computeExecutivePerformance } from '@/lib/crm/analytics';
import { ChartCard } from './charts/ChartCard';
import { SimpleBarChart } from './charts/SimpleBarChart';
import { formatPct } from './labels';
import { filterSnapshotClient } from './selectors';
import { useCrmStore } from './useCrmStore';

export function ExecutivePerformanceView() {
  const snapshot = useCrmStore((s) => s.snapshot);
  const filters = useCrmStore((s) => s.filters);

  const rows = useMemo(() => {
    if (!snapshot) return [];
    return computeExecutivePerformance(filterSnapshotClient(snapshot, filters)).sort(
      (a, b) => b.closedCount - a.closedCount || b.processCount - a.processCount,
    );
  }, [snapshot, filters]);

  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <h1>Executive Performance</h1>
          <p>Workload, conversion, and intelligence flags by assigned executive.</p>
        </div>
      </header>
      <ChartCard title="Closed deals by executive">
        <SimpleBarChart
          data={rows.slice(0, 12).map((r) => ({
            name: r.executiveName,
            value: r.closedCount,
          }))}
          color="#0d9488"
        />
      </ChartCard>
      <section className="dash-card">
        <div className="table-scroll">
          <table className="leads-table">
            <thead>
              <tr>
                <th>Executive</th>
                <th>Processes</th>
                <th>Customers</th>
                <th>Closed</th>
                <th>Conversion</th>
                <th>Gone Dark</th>
                <th>Not Picking</th>
                <th>Stuck</th>
                <th>High Intent</th>
                <th>V. High Intent</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.executiveName}>
                  <td>{r.executiveName}</td>
                  <td>{r.processCount}</td>
                  <td>{r.customerCount}</td>
                  <td>{r.closedCount}</td>
                  <td>{formatPct(r.conversionRate)}</td>
                  <td>{r.goneDarkCount}</td>
                  <td>{r.notPickingUpCount}</td>
                  <td>{r.stuckCount}</td>
                  <td>{r.highIntentCount}</td>
                  <td>{r.veryHighIntentCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
