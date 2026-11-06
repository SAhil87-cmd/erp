'use client';

import { useMemo } from 'react';
import { computeProjectIntelligence } from '@/lib/crm/analytics';
import { ChartCard } from './charts/ChartCard';
import { SimpleBarChart } from './charts/SimpleBarChart';
import { formatPct } from './labels';
import { filterSnapshotClient } from './selectors';
import { useCrmStore } from './useCrmStore';

export function ProjectIntelligenceView() {
  const snapshot = useCrmStore((s) => s.snapshot);
  const filters = useCrmStore((s) => s.filters);

  const rows = useMemo(() => {
    if (!snapshot) return [];
    return computeProjectIntelligence(filterSnapshotClient(snapshot, filters)).sort(
      (a, b) => b.processCount - a.processCount,
    );
  }, [snapshot, filters]);

  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <h1>Project Intelligence</h1>
          <p>Pipeline volume, intent, and recovery risk by project.</p>
        </div>
      </header>
      <ChartCard title="Process volume by project">
        <SimpleBarChart
          data={rows.slice(0, 10).map((r) => ({ name: r.projectName, value: r.processCount }))}
          color="#2563eb"
        />
      </ChartCard>
      <section className="dash-card">
        <div className="table-scroll">
          <table className="leads-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Processes</th>
                <th>Customers</th>
                <th>Closed</th>
                <th>Conversion</th>
                <th>High Intent</th>
                <th>V. High Intent</th>
                <th>Gone Dark</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.projectName}>
                  <td>{r.projectName}</td>
                  <td>{r.processCount}</td>
                  <td>{r.customerCount}</td>
                  <td>{r.closedCount}</td>
                  <td>{formatPct(r.conversionRate)}</td>
                  <td>{r.highIntentCount}</td>
                  <td>{r.veryHighIntentCount}</td>
                  <td>{r.goneDarkCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
