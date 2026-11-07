'use client';

import { useMemo } from 'react';
import { computeFollowUpBuckets } from '@/lib/crm/analytics';
import { MetricCards } from './MetricCards';
import { filterSnapshotClient } from './selectors';
import { useCrmStore } from './useCrmStore';
import { formatDate } from './labels';

export function FollowUpCentre() {
  const snapshot = useCrmStore((s) => s.snapshot);
  const filters = useCrmStore((s) => s.filters);
  const setSelectedLead = useCrmStore((s) => s.setSelectedLead);

  const buckets = useMemo(() => {
    if (!snapshot) return [];
    const filtered = filterSnapshotClient(snapshot, filters);
    return computeFollowUpBuckets(
      filtered.followUps,
      undefined,
      filtered.processes,
    );
  }, [snapshot, filters]);

  const customers = useMemo(() => {
    const map = new Map(snapshot?.customers.map((c) => [c.customerId, c]) ?? []);
    return map;
  }, [snapshot]);

  const focus = buckets.filter((b) =>
    ['today', 'overdue', 'upcoming'].includes(b.bucket),
  );

  return (
    <section className="dash-card">
      <header className="view-header compact">
        <div>
          <h2>Follow-up centre</h2>
          <p>Today, overdue, and upcoming (7-day) follow-ups from CRM dates.</p>
        </div>
      </header>
      <MetricCards
        items={focus.map((b) => ({
          label: b.bucket,
          value: b.count,
          tone: b.bucket === 'overdue' ? 'urgent' : b.bucket === 'today' ? 'warning' : 'default',
        }))}
      />
      <div className="followup-columns">
        {focus.map((bucket) => (
          <div key={bucket.bucket} className="followup-col">
            <h3>
              {bucket.bucket} <em>{bucket.count}</em>
            </h3>
            <ul>
              {bucket.items.slice(0, 12).map((item) => {
                const customer = customers.get(item.customerId);
                return (
                  <li key={`${item.customerId}-${item.salesProcessId}`}>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedLead({
                          customerId: item.customerId,
                          salesProcessId: item.salesProcessId,
                        })
                      }
                    >
                      <strong>{customer?.name || item.customerId}</strong>
                      <span>
                        {item.assignedTo || item.followupOwner || 'Unassigned'} ·{' '}
                        {item.currentStage}
                      </span>
                      <em>Next: {formatDate(item.nextFollowUpDate)}</em>
                    </button>
                  </li>
                );
              })}
              {bucket.items.length === 0 ? (
                <li className="cell-muted">No items</li>
              ) : null}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
