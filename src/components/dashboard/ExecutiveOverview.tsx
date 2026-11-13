'use client';

import { useMemo } from 'react';
import {
  compareExecutiveRanking,
  computeBookingForecast,
  computeExecutivePerformance,
  computeOverviewMetrics,
  computeRecoveryMetrics,
  executiveRankingScore,
} from '@/lib/crm/analytics';
import { calendarDateKey, isCalendarKeyInRange } from '@/lib/crm/dates';
import {
  sumCallsInDateRange,
  sumInteractionsInDateRange,
} from '@/lib/crm/dateIndex';
import { ChartCard } from './charts/ChartCard';
import { SimpleBarChart } from './charts/SimpleBarChart';
import { SimplePieChart } from './charts/SimplePieChart';
import { BookingForecastPanel } from './BookingForecastPanel';
import { InsufficientCallDataBanner } from './InsufficientCallDataBanner';
import { MetricCards } from './MetricCards';
import { CATEGORY_LABELS, formatPct } from './labels';
import { filterSnapshotClient } from './selectors';
import { useCrmStore } from './useCrmStore';

export function ExecutiveOverview() {
  const snapshot = useCrmStore((s) => s.snapshot);
  const filters = useCrmStore((s) => s.filters);

  const derived = useMemo(() => {
    if (!snapshot) return null;
    const filtered = filterSnapshotClient(snapshot, filters);
    const hasDateFilter = Boolean(filters.dateFrom || filters.dateTo);
    const hasNarrowingFilter =
      hasDateFilter ||
      Boolean(filters.executives?.length) ||
      Boolean(filters.projects?.length) ||
      Boolean(filters.stages?.length) ||
      Boolean(filters.categories?.length) ||
      Boolean(filters.processNames?.length) ||
      Boolean(filters.search?.trim());
    // Precomputed KPIs only when the overview pack has no lead rows and no filters.
    const usePrecomputed =
      snapshot.pack === 'overview' &&
      filtered.processes.length === 0 &&
      Boolean(snapshot.overviewMetrics) &&
      !hasNarrowingFilter;

    const metrics = usePrecomputed
      ? { ...snapshot.overviewMetrics! }
      : computeOverviewMetrics(filtered);
    const recovery = usePrecomputed
      ? snapshot.recoveryMetrics ?? computeRecoveryMetrics(filtered.classifications)
      : computeRecoveryMetrics(filtered.classifications);
    const todayCalls = new Map(
      (snapshot.todayCallsByExecutive ?? []).map((r) => [
        r.executiveName.toLowerCase(),
        r.callCount,
      ]),
    );
    const totalCalls = new Map(
      (snapshot.callsByExecutive ?? []).map((r) => [
        r.executiveName.toLowerCase(),
        r.callCount,
      ]),
    );
    const execs = (
      usePrecomputed && snapshot.executivePerformance
        ? snapshot.executivePerformance
        : computeExecutivePerformance(filtered)
    )
      .map((r) => {
        const intentCount =
          r.intentCount ??
          (r.highIntentCount ?? 0) + (r.veryHighIntentCount ?? 0);
        const mismarkedNiCount = r.mismarkedNiCount ?? 0;
        const goneDarkCount = r.goneDarkCount ?? 0;
        const key = r.executiveName.toLowerCase();
        const callsToday = todayCalls.get(key) ?? 0;
        const callsTotal = totalCalls.get(key) ?? 0;
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
      .sort(compareExecutiveRanking)
      .slice(0, 8);
    const insufficient = usePrecomputed
      ? 0
      : filtered.classifications.filter(
          (c) => c.callDataStatus === 'INSUFFICIENT_CALL_DATA',
        ).length;

    if (hasDateFilter) {
      const callSum = sumCallsInDateRange(
        snapshot.callsByDayByExecutive,
        filters,
      );
      if (callSum != null) metrics.totalCalls = callSum;
      const ixSum = sumInteractionsInDateRange(
        snapshot.interactionSeries?.daily,
        filters,
        filters.dateFrom ?? filters.dateTo ?? undefined,
      );
      if (ixSum != null) metrics.totalInteractions = ixSum;
    }

    const series = snapshot.interactionSeries;
    let daily = series?.daily ?? [];
    let monthly = series?.monthly ?? [];
    if (!series) {
      const dailyMap = new Map<string, number>();
      for (const ix of filtered.interactions) {
        const key = calendarDateKey(ix.interactionDate);
        if (!key) continue;
        dailyMap.set(key, (dailyMap.get(key) ?? 0) + 1);
      }
      daily = [...dailyMap.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-30)
        .map(([name, value]) => ({ name: name.slice(5), value }));

      const monthlyMap = new Map<string, number>();
      for (const key of dailyMap.keys()) {
        const month = key.slice(0, 7);
        monthlyMap.set(month, (monthlyMap.get(month) ?? 0) + (dailyMap.get(key) ?? 0));
      }
      monthly = [...monthlyMap.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, value]) => ({ name, value }));
    } else if (hasDateFilter) {
      const year = (filters.dateFrom ?? filters.dateTo ?? '').slice(0, 4);
      daily = daily.filter((d) =>
        isCalendarKeyInRange(
          d.name.length === 5 ? `${year}-${d.name}` : d.name,
          filters.dateFrom,
          filters.dateTo,
        ),
      );
      monthly = monthly.filter((m) => {
        const monthStart = `${m.name}-01`;
        const monthEnd = `${m.name}-31`;
        const fromOk = !filters.dateFrom || monthEnd >= filters.dateFrom;
        const toOk = !filters.dateTo || monthStart <= filters.dateTo;
        return fromOk && toOk;
      });
    }

    const stageData = Object.entries(metrics.byStage).map(([name, value]) => ({
      name,
      value,
    }));
    const categoryData = Object.entries(metrics.byCategory)
      .filter(([k]) => k !== 'NONE')
      .map(([name, value]) => ({
        name: CATEGORY_LABELS[name as keyof typeof CATEGORY_LABELS] || name,
        value,
      }));

    const sourceMap = new Map<string, number>();
    for (const p of filtered.processes) {
      const src = p.source?.trim() || 'Unknown';
      sourceMap.set(src, (sourceMap.get(src) ?? 0) + 1);
    }
    const sourceData = [...sourceMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, value]) => ({ name, value }));

    const projectMap = new Map<string, number>();
    for (const p of filtered.processes) {
      const name = p.projectName?.trim() || 'Unassigned';
      projectMap.set(name, (projectMap.get(name) ?? 0) + 1);
    }
    const projectData = [...projectMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, value]) => ({ name, value }));

    const priorityMap = new Map<string, number>();
    for (const ix of filtered.interactions) {
      const pr = ix.priority?.trim() || 'Unspecified';
      priorityMap.set(pr, (priorityMap.get(pr) ?? 0) + 1);
    }
    const priorityData = [...priorityMap.entries()].map(([name, value]) => ({
      name,
      value,
    }));

    const funnelOrder = [
      'Interested',
      'Followup',
      'Cold Followup',
      'Site Visit Scheduled',
      'Site Visit Done',
      'Revisit Done',
      'Sales Closed',
    ];
    const funnelData = funnelOrder.map((name) => ({
      name,
      value: metrics.byStage[name] ?? 0,
    }));

    const forecast = computeBookingForecast(filtered);
    const hot = forecast.filter((f) => f.tier === 'HOT' || f.tier === 'WARM').length;

    return {
      metrics,
      recovery,
      execs,
      insufficient,
      daily,
      monthly,
      stageData,
      categoryData,
      sourceData,
      projectData,
      priorityData,
      funnelData,
      hot,
    };
  }, [snapshot, filters]);

  if (!derived) {
    return <div className="empty-state">Loading overview…</div>;
  }

  const { metrics, recovery } = derived;

  const isDemoSeed =
    snapshot?.syncMeta.source === 'csv' &&
    (snapshot.syncMeta.message || '').toLowerCase().includes('synthetic');

  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <h1>Executive Overview</h1>
          <p>
            Pipeline health, recovery alerts, and booking opportunity tiers from live
            classifications.
          </p>
        </div>
      </header>

      {isDemoSeed ? (
        <div className="insufficient-banner" role="status">
          <strong>DEMO DATA</strong>
          <span>
            Showing the synthetic sample seed ({snapshot?.customers.length ?? 0} customers /{' '}
            {snapshot?.syncMeta.callCount ?? snapshot?.calls.length ?? 0} calls), not the live
            Google Sheet. Open <em>Data Health & Settings</em> and click{' '}
            <strong>Sync published Google Sheet</strong> — first sync can take 1–2 minutes.
          </span>
        </div>
      ) : null}

      <MetricCards
        items={[
          { label: 'Customers', value: metrics.totalCustomers },
          { label: 'Active processes', value: metrics.totalProcesses },
          { label: 'Sales closed', value: metrics.salesClosed, tone: 'opportunity' },
          {
            label: 'Conversion',
            value: formatPct(metrics.conversionRate),
            hint: metrics.conversionDenominatorDescription,
          },
          { label: 'Gone Dark', value: recovery.goneDark, tone: 'urgent' },
          { label: 'Not Picking Up', value: recovery.notPickingUp, tone: 'warning' },
          { label: 'Mismarked NI', value: recovery.mismarkedNi, tone: 'warning' },
          { label: 'Stuck', value: recovery.stuck, tone: 'warning' },
          {
            label: 'Hot / Warm booking',
            value: derived.hot,
            tone: 'opportunity',
          },
          {
            label: 'Calls linked',
            value: metrics.totalCalls,
            hint:
              filters.dateFrom || filters.dateTo
                ? `Calls in selected date range (${metrics.totalCalls.toLocaleString()})`
                : snapshot?.callsTruncated
                  ? `Full sheet total (${metrics.totalCalls.toLocaleString()}); list preview capped for speed`
                  : undefined,
          },
        ]}
      />

      <InsufficientCallDataBanner
        count={derived.insufficient}
        callTotal={snapshot?.callTotal ?? metrics.totalCalls}
      />

      <div className="chart-grid">
        <ChartCard title="Daily interactions" subtitle="Last 30 calendar days with activity">
          <SimpleBarChart data={derived.daily} color="#2563eb" />
        </ChartCard>
        <ChartCard title="Monthly interactions">
          <SimpleBarChart data={derived.monthly} color="#0d9488" />
        </ChartCard>
        <ChartCard title="Stage distribution">
          <SimplePieChart data={derived.stageData} />
        </ChartCard>
        <ChartCard title="Intelligence categories">
          <SimpleBarChart data={derived.categoryData} color="#dc2626" />
        </ChartCard>
        <ChartCard
          title="Executive ranking (top)"
          subtitle="Conversion + closed; GD / Mismarked NI by rate"
        >
          <SimpleBarChart
            data={derived.execs.map((e) => ({
              name: e.executiveName.split(' ')[0],
              value: Math.round(e.rankingScore),
            }))}
            color="#0d9488"
          />
        </ChartCard>
        <ChartCard title="Project mix">
          <SimpleBarChart data={derived.projectData} color="#0d9488" />
        </ChartCard>
        <ChartCard title="Lead source">
          <SimplePieChart data={derived.sourceData} />
        </ChartCard>
        <ChartCard title="Priority (interactions)">
          <SimpleBarChart data={derived.priorityData} color="#f59e0b" />
        </ChartCard>
        <ChartCard title="Funnel stages" subtitle="Selected progression stages">
          <SimpleBarChart data={derived.funnelData} color="#2563eb" height={260} />
        </ChartCard>
      </div>

      <BookingForecastPanel />
    </div>
  );
}
