'use client';

import { useMemo } from 'react';
import { ExportLeadsBar } from './ExportLeadsBar';
import { InsufficientCallDataBanner } from './InsufficientCallDataBanner';
import { LeadsTable } from './LeadsTable';
import { MetricCards } from './MetricCards';
import { buildLeadRows, filterSnapshotClient } from './selectors';
import { useCrmStore } from './useCrmStore';

export function AllLeadsView() {
  const snapshot = useCrmStore((s) => s.snapshot);
  const filters = useCrmStore((s) => s.filters);

  const { rows, insufficient } = useMemo(() => {
    if (!snapshot) return { rows: [], insufficient: 0 };
    const filtered = filterSnapshotClient(snapshot, filters);
    const leadRows = buildLeadRows(filtered);
    return {
      rows: leadRows,
      insufficient: leadRows.filter((r) => r.callDataStatus === 'INSUFFICIENT_CALL_DATA')
        .length,
    };
  }, [snapshot, filters]);

  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <h1>All Leads</h1>
          <p>Full process list with primary intelligence category and recommended action.</p>
        </div>
        <ExportLeadsBar rows={rows} label="All Leads" compact />
      </header>
      <MetricCards
        items={[
          { label: 'Processes', value: rows.length },
          {
            label: 'Insufficient call data',
            value: insufficient,
            tone: insufficient ? 'warning' : 'neutral',
          },
        ]}
      />
      <InsufficientCallDataBanner
        count={insufficient}
        callTotal={
          snapshot?.callTotal ??
          snapshot?.syncMeta.callCount ??
          snapshot?.calls.length
        }
      />
      <section className="dash-card">
        <LeadsTable rows={rows} />
      </section>
    </div>
  );
}
