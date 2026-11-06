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
    if (!snapshot) {
      return { interactions: [], calls: [], today: todayCalendarKey() };
    }
    const filtered = filterSnapshotClient(snapshot, filters);
    const today = todayCalendarKey();
    const interactions = filtered.interactions.filter(
      (ix) => calendarDateKey(ix.interactionDate) === today,
    );
    const calls = filtered.calls.filter(
      (c) => calendarDateKey(c.callAt || c.callDate || null) === today,
    );
    return { interactions, calls, today };
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
          <p>Follow-ups, interactions, and calls for {activity.today} (Asia/Kolkata).</p>
        </div>
      </header>
      <MetricCards
        items={[
          { label: "Today's interactions", value: activity.interactions.length },
          { label: "Today's calls", value: activity.calls.length },
        ]}
      />
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
            <div className="empty-state">No calls dated today.</div>
          ) : (
            <ul className="timeline">
              {activity.calls.slice(0, 30).map((call) => (
                <li key={call.callRecordId}>
                  <strong>
                    {customers.get(call.customerId)?.name || call.customerId}
                  </strong>
                  <span>
                    {call.callOutcome} · {call.durationSeconds}s
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
