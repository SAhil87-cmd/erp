'use client';

import { useMemo } from 'react';
import { computeBookingForecast } from '@/lib/crm/analytics';
import { MetricCards } from './MetricCards';
import { filterSnapshotClient } from './selectors';
import { useCrmStore } from './useCrmStore';

const TIER_ORDER = ['HOT', 'WARM', 'COOL', 'COLD', 'EXCLUDED'] as const;

export function BookingForecastPanel() {
  const snapshot = useCrmStore((s) => s.snapshot);
  const filters = useCrmStore((s) => s.filters);
  const setSelectedLead = useCrmStore((s) => s.setSelectedLead);

  const { items, counts } = useMemo(() => {
    if (!snapshot) {
      return {
        items: [] as ReturnType<typeof computeBookingForecast>,
        counts: {} as Record<string, number>,
      };
    }
    const filtered = filterSnapshotClient(snapshot, filters);
    const forecast = computeBookingForecast(filtered).filter((f) => f.tier !== 'EXCLUDED');
    const c: Record<string, number> = {};
    for (const f of forecast) {
      c[f.tier] = (c[f.tier] ?? 0) + 1;
    }
    return { items: forecast, counts: c };
  }, [snapshot, filters]);

  return (
    <section className="dash-card">
      <header className="view-header compact">
        <div>
          <h2>Booking opportunity tiers</h2>
          <p>
            Transparent rule-based tiers from classifications — not AI probability scores.
          </p>
        </div>
      </header>
      <MetricCards
        items={TIER_ORDER.filter((t) => t !== 'EXCLUDED').map((tier) => ({
          label: tier,
          value: counts[tier] ?? 0,
          tone:
            tier === 'HOT'
              ? 'opportunity'
              : tier === 'WARM'
                ? 'opportunity'
                : tier === 'COOL'
                  ? 'warning'
                  : 'neutral',
        }))}
      />
      <div className="table-scroll">
        <table className="leads-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Project</th>
              <th>Executive</th>
              <th>Tier</th>
              <th>Reasons</th>
            </tr>
          </thead>
          <tbody>
            {items.slice(0, 40).map((item) => (
              <tr
                key={`${item.customerId}-${item.salesProcessId}`}
                onClick={() =>
                  setSelectedLead({
                    customerId: item.customerId,
                    salesProcessId: item.salesProcessId,
                  })
                }
              >
                <td>{item.customerId}</td>
                <td>{item.projectName || '—'}</td>
                <td>{item.assignedTo || 'Unassigned'}</td>
                <td>
                  <span className={`tier-pill tier-${item.tier.toLowerCase()}`}>
                    {item.tier}
                  </span>
                </td>
                <td className="cell-clamp">{item.reasons.join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
