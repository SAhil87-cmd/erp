'use client';

import { useMemo } from 'react';
import { calendarDateKey, todayCalendarKey } from '@/lib/crm/dates';
import { FollowUpCentre } from './FollowUpCentre';
import { MetricCards } from './MetricCards';
import { filterSnapshotClient } from './selectors';
import { useCrmStore } from './useCrmStore';
import { formatDate } from './labels';

export function TodaysActivityView() {
  const snapshot = useCrmStore((s) => s.snapshot);
  const filters = useCrmStore((s) => s.filters);
  const setSelectedLead = useCrmStore((s) => s.setSelectedLead);

  const activity = useMemo(() => {
    const today = snapshot?.activityDate || todayCalendarKey();
    if (!snapshot) {
      return {
        interactions: [],
        calls: [],
        today,
        callCount: 0,
        interactionCount: 0,
        byExecutive: [] as Array<{ executiveName: string; callCount: number }>,
      };
    }
    const filtered = filterSnapshotClient(snapshot, filters);
    const interactions = filtered.interactions.filter(
      (ix) => calendarDateKey(ix.interactionDate) === today,
    );
    const calls = filtered.calls.filter(
      (c) => calendarDateKey(c.callAt || c.callDate || null) === today,
    );
    // Prefer server full-count (from unslimmed store); fall back to filtered preview.
    const callCount =
      !filters.executives?.length &&
      !filters.projects?.length &&
      !filters.stages?.length &&
      !filters.search
        ? (snapshot.todayCallCount ?? calls.length)
        : calls.length;
    const interactionCount =
      !filters.executives?.length &&
      !filters.projects?.length &&
      !filters.stages?.length &&
      !filters.search
        ? (snapshot.todayInteractionCount ?? interactions.length)
        : interactions.length;

    let byExecutive = snapshot.todayCallsByExecutive ?? [];
    if (filters.executives?.length) {
      const want = new Set(filters.executives.map((e) => e.toLowerCase()));
      byExecutive = byExecutive.filter((r) =>
        want.has(r.executiveName.toLowerCase()),
      );
    }

    return {
      interactions,
      calls,
      today,
      callCount,
      interactionCount,
      byExecutive,
    };
  }, [snapshot, filters]);

  const customers = useMemo(
    () => new Map(snapshot?.customers.map((c) => [c.customerId, c]) ?? []),
    [snapshot],
  );

  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <h1>Today&apos;s Activity</h1>
          <p>
            Follow-ups, interactions, and calls for {activity.today} (Asia/Kolkata)
            {snapshot?.activityDateIsFallback
              ? ' — latest day with published sheet activity (calendar today has none yet).'
              : '.'}
          </p>
        </div>
      </header>
      {snapshot?.activityDateIsFallback ? (
        <div className="insufficient-banner" role="status">
          <strong>Showing {activity.today}</strong>
          <span>
            The published Google Sheet has no calls for calendar today yet, so executive
            call counts use the latest day with data.
          </span>
        </div>
      ) : null}
      <MetricCards
        items={[
          { label: `Interactions (${activity.today})`, value: activity.interactionCount },
          {
            label: `Calls (${activity.today})`,
            value: activity.callCount,
            hint:
              snapshot?.callsTruncated && activity.callCount > activity.calls.length
                ? `Full day total ${activity.callCount.toLocaleString()} (list preview ${activity.calls.length})`
                : undefined,
          },
        ]}
      />

      {activity.byExecutive.length > 0 ? (
        <section className="dash-card">
          <h2 className="section-title">Calls by executive — {activity.today}</h2>
          <div className="table-scroll">
            <table className="leads-table">
              <thead>
                <tr>
                  <th>Executive / caller</th>
                  <th>Calls today</th>
                </tr>
              </thead>
              <tbody>
                {activity.byExecutive.map((row) => (
                  <tr key={row.executiveName}>
                    <td>{row.executiveName}</td>
                    <td>{row.callCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <FollowUpCentre />
      <div className="split-grid">
        <section className="dash-card">
          <h2 className="section-title">Interactions today</h2>
          {activity.interactions.length === 0 ? (
            <div className="empty-state">No interactions dated today.</div>
          ) : (
            <ul className="timeline">
              {activity.interactions.slice(0, 30).map((ix) => (
                <li key={ix.interactionId}>
                  <button
                    type="button"
                    className="linkish"
                    onClick={() =>
                      setSelectedLead({
                        customerId: ix.customerId,
                        salesProcessId: ix.salesProcessId,
                      })
                    }
                  >
                    <strong>
                      {customers.get(ix.customerId)?.name || ix.customerId}
                    </strong>
                    <span>
                      {ix.status} · {ix.assignedTo || 'Unassigned'}
                    </span>
                    <em>{formatDate(ix.interactionDate)}</em>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="dash-card">
          <h2 className="section-title">Calls today</h2>
          {activity.calls.length === 0 ? (
            <div className="empty-state">No calls dated today in the preview list.</div>
          ) : (
            <ul className="timeline">
              {activity.calls.slice(0, 50).map((call) => (
                <li key={call.callRecordId}>
                  <strong>
                    {customers.get(call.customerId)?.name || call.customerId}
                  </strong>
                  <span>
                    {call.callExecutive || 'Unassigned'} · {call.callOutcome} ·{' '}
                    {call.durationSeconds}s
                  </span>
                  <em>{formatDate(call.callAt)}</em>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
