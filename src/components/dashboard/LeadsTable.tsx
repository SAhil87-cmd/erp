'use client';

import { useMemo, useState } from 'react';
import type { LeadRow } from './selectors';
import { CATEGORY_LABELS, formatDate } from './labels';
import { useCrmStore } from './useCrmStore';

type SortKey =
  | 'name'
  | 'projectName'
  | 'stage'
  | 'assignedTo'
  | 'category'
  | 'stageEnteredAt';

export function LeadsTable({
  rows,
  emptyMessage = 'No leads match the current filters.',
}: {
  rows: LeadRow[];
  emptyMessage?: string;
}) {
  const setSelectedLead = useCrmStore((s) => s.setSelectedLead);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rows;
    if (q) {
      list = list.filter((r) =>
        [
          r.name,
          r.mobile,
          r.customerId,
          r.projectName,
          r.assignedTo,
          r.stage,
          r.category,
          r.remark,
        ]
          .join(' ')
          .toLowerCase()
          .includes(q),
      );
    }
    list = [...list].sort((a, b) => {
      const av = String(a[sortKey] ?? '');
      const bv = String(b[sortKey] ?? '');
      const cmp = av.localeCompare(bv, undefined, { sensitivity: 'base' });
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [rows, search, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice(page * pageSize, page * pageSize + pageSize);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  return (
    <div className="leads-table-wrap">
      <div className="leads-table-toolbar">
        <input
          className="dash-input"
          placeholder="Search name, phone, project, executive…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
        <span className="table-count">
          {filtered.length} lead{filtered.length === 1 ? '' : 's'}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">{emptyMessage}</div>
      ) : (
        <>
          <div className="table-scroll">
            <table className="leads-table">
              <thead>
                <tr>
                  <th>
                    <button type="button" onClick={() => toggleSort('name')}>
                      Customer
                    </button>
                  </th>
                  <th>
                    <button type="button" onClick={() => toggleSort('projectName')}>
                      Project
                    </button>
                  </th>
                  <th>
                    <button type="button" onClick={() => toggleSort('stage')}>
                      Stage
                    </button>
                  </th>
                  <th>
                    <button type="button" onClick={() => toggleSort('assignedTo')}>
                      Executive
                    </button>
                  </th>
                  <th>
                    <button type="button" onClick={() => toggleSort('category')}>
                      Category
                    </button>
                  </th>
                  <th>Why</th>
                  <th>Remark</th>
                  <th>Next action</th>
                  <th>
                    <button type="button" onClick={() => toggleSort('stageEnteredAt')}>
                      Stage since
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr
                    key={`${row.customerId}-${row.salesProcessId}`}
                    onClick={() =>
                      setSelectedLead({
                        customerId: row.customerId,
                        salesProcessId: row.salesProcessId,
                      })
                    }
                  >
                    <td>
                      <div className="cell-primary">{row.name}</div>
                      <div className="cell-muted">
                        {row.mobile} · {row.customerId}
                      </div>
                    </td>
                    <td>{row.projectName}</td>
                    <td>{row.stage}</td>
                    <td>{row.assignedTo}</td>
                    <td>
                      <span className={`cat-pill tone-${row.category.toLowerCase()}`}>
                        {CATEGORY_LABELS[row.category]}
                      </span>
                      {row.callDataStatus === 'INSUFFICIENT_CALL_DATA' ? (
                        <div className="cell-warn">INSUFFICIENT CALL DATA</div>
                      ) : null}
                    </td>
                    <td className="cell-clamp">{row.reason || '—'}</td>
                    <td className="cell-clamp" title={row.remark || undefined}>
                      {row.remark || '—'}
                    </td>
                    <td className="cell-clamp">{row.recommendedAction}</td>
                    <td>{formatDate(row.stageEnteredAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-pagination">
            <button
              type="button"
              className="btn-ghost"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </button>
            <span>
              Page {page + 1} / {pageCount}
            </span>
            <button
              type="button"
              className="btn-ghost"
              disabled={page >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
