'use client';

import { useMemo } from 'react';
import { formatDate } from './labels';
import { filterSnapshotClient, buildLeadRows } from './selectors';
import { LeadsTable } from './LeadsTable';
import { useCrmStore } from './useCrmStore';

export function ReviewedLeadsView() {
  const snapshot = useCrmStore((s) => s.snapshot);
  const filters = useCrmStore((s) => s.filters);
  const setSelectedLead = useCrmStore((s) => s.setSelectedLead);

  const { reviews, rows } = useMemo(() => {
    if (!snapshot) return { reviews: [], rows: [] };
    const filtered = filterSnapshotClient(snapshot, filters);
    const reviewedIds = new Set(snapshot.reviews.map((r) => r.customerId));
    const leadRows = buildLeadRows(filtered).filter((r) => reviewedIds.has(r.customerId));
    return {
      reviews: [...snapshot.reviews].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      rows: leadRows,
    };
  }, [snapshot, filters]);

  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <h1>Reviewed Leads</h1>
          <p>Manual reviews appended without mutating engine classifications.</p>
        </div>
      </header>
      <section className="dash-card">
        <h2 className="section-title">Review log</h2>
        {reviews.length === 0 ? (
          <div className="empty-state">No reviews yet. Open a lead drawer to add one.</div>
        ) : (
          <div className="table-scroll">
            <table className="leads-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Reviewer</th>
                  <th>Disposition</th>
                  <th>Note</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {reviews.map((r) => (
                  <tr
                    key={r.reviewId}
                    onClick={() =>
                      setSelectedLead({
                        customerId: r.customerId,
                        salesProcessId:
                          r.salesProcessId ||
                          snapshot?.processes.find((p) => p.customerId === r.customerId)
                            ?.salesProcessId ||
                          '',
                      })
                    }
                  >
                    <td>{r.customerId}</td>
                    <td>{r.reviewer}</td>
                    <td>{r.disposition || '—'}</td>
                    <td className="cell-clamp">{r.note}</td>
                    <td>{formatDate(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="dash-card">
        <h2 className="section-title">Reviewed processes</h2>
        <LeadsTable rows={rows} emptyMessage="No reviewed processes in filter set." />
      </section>
    </div>
  );
}
