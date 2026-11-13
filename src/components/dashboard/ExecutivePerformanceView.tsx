'use client';

import { useMemo } from 'react';
import {
  compareExecutiveRanking,
  computeExecutivePerformance,
  executiveRankingScore,
} from '@/lib/crm/analytics';
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
      .map((r) => {
        const intentCount =
          r.intentCount ?? (r.highIntentCount ?? 0) + (r.veryHighIntentCount ?? 0);
        const mismarkedNiCount = r.mismarkedNiCount ?? 0;
        const goneDarkCount = r.goneDarkCount ?? 0;
        const callsToday = todayMap.get(r.executiveName.toLowerCase()) ?? 0;
        const callsTotal = allMap.get(r.executiveName.toLowerCase()) ?? 0;
        const callsForRank = callsToday > 0 ? callsToday : callsTotal;
        const rankingScore = executiveRankingScore({
          closedCount: r.closedCount,
          conversionRate: r.conversionRate,
          processCount: r.processCount,
          mismarkedNiCount,
          goneDarkCount,
          intentCount,
          calls: callsForRank,
        });
        return {
          ...r,
          mismarkedNiCount,
          goneDarkCount,
          intentCount,
          rankingScore,
          callsToday,
          callsTotal,
        };
      })
      .sort(compareExecutiveRanking);
  }, [snapshot, filters]);

  const callerOnlyRows = useMemo(() => {
    if (!snapshot?.todayCallsByExecutive?.length) return [];
    const assigned = new Set(rows.map((r) => r.executiveName.toLowerCase()));
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
            Top rank = strong conversion / closed deals. Gone Dark and Mismarked
            NI are judged by rate (large healthy books stay on top)
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
      <ChartCard title="Executive ranking (conversion + closed, controlled GD / Mismarked NI)">
        <SimpleBarChart
          data={rows.slice(0, 12).map((r) => ({
            name: r.executiveName.split(' ')[0],
            value: Math.round(r.rankingScore),
          }))}
          color="#0d9488"
        />
      </ChartCard>
      <div className="chart-grid">
        <ChartCard title="Gone Dark by executive">
          <SimpleBarChart
            data={rows.slice(0, 12).map((r) => ({
              name: r.executiveName.split(' ')[0],
              value: r.goneDarkCount,
            }))}
            color="#b91c1c"
          />
        </ChartCard>
        <ChartCard title="Mismarked NI by executive">
          <SimpleBarChart
            data={rows.slice(0, 12).map((r) => ({
              name: r.executiveName.split(' ')[0],
              value: r.mismarkedNiCount,
            }))}
            color="#d97706"
          />
        </ChartCard>
        <ChartCard title="Intent (HI + VHI) by executive">
          <SimpleBarChart
            data={rows.slice(0, 12).map((r) => ({
              name: r.executiveName.split(' ')[0],
              value: r.intentCount,
            }))}
            color="#0d9488"
          />
        </ChartCard>
        <ChartCard
          title={`Calls — ${snapshot?.activityDate ?? 'activity day'}`}
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
      </div>
      <section className="dash-card">
        <div className="table-scroll">
          <table className="leads-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Executive</th>
                <th>Score</th>
                <th>Gone Dark</th>
                <th>Mismarked NI</th>
                <th>High Intent</th>
                <th>V. High Intent</th>
                <th>Intent total</th>
                <th>Calls ({snapshot?.activityDate?.slice(5) ?? 'day'})</th>
                <th>Calls total</th>
                <th>Processes</th>
                <th>Closed</th>
                <th>Conversion</th>
                <th>Not Picking</th>
                <th>Stuck</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={r.executiveName}>
                  <td>{idx + 1}</td>
                  <td>{r.executiveName}</td>
                  <td>{r.rankingScore}</td>
                  <td>{r.goneDarkCount}</td>
                  <td>{r.mismarkedNiCount}</td>
                  <td>{r.highIntentCount}</td>
                  <td>{r.veryHighIntentCount}</td>
                  <td>{r.intentCount}</td>
                  <td>{r.callsToday}</td>
                  <td>{r.callsTotal}</td>
                  <td>{r.processCount}</td>
                  <td>{r.closedCount}</td>
                  <td>{formatPct(r.conversionRate)}</td>
                  <td>{r.notPickingUpCount}</td>
                  <td>{r.stuckCount}</td>
                </tr>
              ))}
              {callerOnlyRows.map((r) => (
                <tr key={`caller-${r.executiveName}`}>
                  <td>—</td>
                  <td>{r.executiveName}</td>
                  <td>—</td>
                  <td colSpan={4} className="cell-muted">
                    —
                  </td>
                  <td>{r.callCount}</td>
                  <td>
                    {snapshot?.callsByExecutive?.find(
                      (x) =>
                        x.executiveName.toLowerCase() ===
                        r.executiveName.toLowerCase(),
                    )?.callCount ?? r.callCount}
                  </td>
                  <td colSpan={5} className="cell-muted">
                    Caller in call history (no assigned CRM processes)
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
