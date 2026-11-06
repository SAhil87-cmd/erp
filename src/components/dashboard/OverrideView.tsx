'use client';

import { useMemo } from 'react';
import { CATEGORY_LABELS, formatDate } from './labels';
import { buildLeadRows, filterSnapshotClient } from './selectors';
import { LeadsTable } from './LeadsTable';
import { useCrmStore } from './useCrmStore';

export function OverrideView() {
  const snapshot = useCrmStore((s) => s.snapshot);
  const filters = useCrmStore((s) => s.filters);
  const setSelectedLead = useCrmStore((s) => s.setSelectedLead);

  const { overrides, recovered } = useMemo(() => {
    if (!snapshot) return { overrides: [], recovered: [] };

    const filtered = filterSnapshotClient(snapshot, filters);
    const sortedOverrides = [...snapshot.overrides].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );

    const recoveredProcessIds = new Set<string>();
    for (const cls of filtered.classifications) {
      const original = cls.evidence?._originalCategory as unknown;
      if (original === 'GONE_DARK' && cls.primaryCategory !== 'GONE_DARK') {
        recoveredProcessIds.add(cls.salesProcessId);
      }
    }
    for (const o of snapshot.overrides) {
      if (o.originalCategory === 'GONE_DARK' && o.overrideCategory !== 'GONE_DARK') {
        if (o.salesProcessId) recoveredProcessIds.add(o.salesProcessId);
        else {
          for (const p of filtered.processes) {
            if (p.customerId === o.customerId) recoveredProcessIds.add(p.salesProcessId);
          }
        }
      }
    }

    return {
      overrides: sortedOverrides,
      recovered: buildLeadRows(filtered).filter((r) =>
        recoveredProcessIds.has(r.salesProcessId),
      ),
    };
  }, [snapshot, filters]);

  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <h1>Not Gone Dark / Override</h1>
          <p>
            Manual overrides and leads recovered from Gone Dark. Engine results stay intact.
          </p>
        </div>
      </header>
      <section className="dash-card">
        <h2 className="section-title">Override log</h2>
        {overrides.length === 0 ? (
          <div className="empty-state">No overrides yet.</div>
        ) : (
          <div className="table-scroll">
            <table className="leads-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Original</th>
                  <th>Override</th>
                  <th>Reason</th>
                  <th>By</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {overrides.map((o) => (
                  <tr
                    key={o.overrideId}
                    onClick={() =>
                      setSelectedLead({
                        customerId: o.customerId,
                        salesProcessId:
                          o.salesProcessId ||
                          snapshot?.processes.find((p) => p.customerId === o.customerId)
                            ?.salesProcessId ||
                          '',
                      })
                    }
                  >
                    <td>{o.customerId}</td>
                    <td>
                      {o.originalCategory ? CATEGORY_LABELS[o.originalCategory] : '—'}
                    </td>
                    <td>{CATEGORY_LABELS[o.overrideCategory]}</td>
                    <td className="cell-clamp">{o.reason}</td>
                    <td>{o.createdBy}</td>
                    <td>{formatDate(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="dash-card">
        <h2 className="section-title">Recovered from Gone Dark</h2>
        <LeadsTable
          rows={recovered}
          emptyMessage="No overridden Gone Dark recoveries yet."
        />
      </section>
    </div>
  );
}
