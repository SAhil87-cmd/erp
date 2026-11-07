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
    const filtered = filterSnapshotClient(snapshot, filters);
    const perf =
      snapshot.pack === 'overview' &&
      filtered.processes.length === 0 &&
      snapshot.executivePerformance?.length
        ? snapshot.executivePerformance
        : computeExecutivePerformance(filtered);
    const todayMap = new Map(
      (snapshot.todayCallsByExecutive ?? []).map((r) => [
        r.executiveName.toLowerCase(),
        r.callCount,
      ]),
    );
    const allMap = new Map(
      (snapshot.callsByExecutive ?? []).map((r) => [
        r.executiveName.toLowerCase(),
        r.callCount,
      ]),
    );

    return perf
      .map((r) => ({
        ...r,
        callsToday: todayMap.get(r.executiveName.toLowerCase()) ?? 0,
        callsTotal: allMap.get(r.executiveName.toLowerCase()) ?? 0,
      }))
      .sort(
        (a, b) =>
          b.callsToday - a.callsToday ||
          b.closedCount - a.closedCount ||
          b.processCount - a.processCount,
      );
  }, [snapshot, filters]);

  const callerOnlyRows = useMemo(() => {
    if (!snapshot?.todayCallsByExecutive?.length) return [];
    const assigned = new Set(
      rows.map((r) => r.executiveName.toLowerCase()),
    );
    return snapshot.todayCallsByExecutive.filter(
      (r) => !assigned.has(r.executiveName.toLowerCase()),
    );
  }, [snapshot, rows]);

  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <h1>Executive Performance</h1>
          <p>
            Workload, conversion, and call volume by executive. Call totals come from the
            full sheet (not the truncated preview)
            {snapshot?.activityDate
              ? `. Activity day: ${snapshot.activityDate}${
                  snapshot.activityDateIsFallback
                    ? ' (latest published day — calendar today has no calls yet)'
                    : ''
                }`
              : '.'}
          </p>
        </div>
      </header>
      <ChartCard
        title={`Calls by executive — ${snapshot?.activityDate ?? 'activity day'}`}
      >
        <SimpleBarChart
          data={(snapshot?.todayCallsByExecutive ?? [])
            .slice(0, 12)
            .map((r) => ({
              name: r.executiveName.split(' ')[0],
              value: r.callCount,
            }))}
          color="#2563eb"
        />
      </ChartCard>
      {(snapshot?.callsByDayByExecutive?.length ?? 0) > 0 ? (
        <ChartCard title="Daily call volume (last 14 days with activity)">
          <SimpleBarChart
            data={(snapshot?.callsByDayByExecutive ?? []).map((d) => ({
              name: d.date.slice(5),
              value: d.total,
            }))}
            color="#0f766e"
          />
        </ChartCard>
      ) : null}
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
                <th>Calls ({snapshot?.activityDate?.slice(5) ?? 'day'})</th>
                <th>Calls total</th>
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
                  <td>{r.callsToday}</td>
                  <td>{r.callsTotal}</td>
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
              {callerOnlyRows.map((r) => (
                <tr key={`caller-${r.executiveName}`}>
                  <td>{r.executiveName}</td>
                  <td>{r.callCount}</td>
                  <td>
                    {snapshot?.callsByExecutive?.find(
                      (x) =>
                        x.executiveName.toLowerCase() ===
                        r.executiveName.toLowerCase(),
                    )?.callCount ?? r.callCount}
                  </td>
                  <td colSpan={9} className="cell-muted">
                    Caller present in call history (no assigned CRM processes)
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
