'use client';

import { useMemo } from 'react';
import type { IntelligenceCategory } from '@/lib/crm/types';
import { InsufficientCallDataBanner } from './InsufficientCallDataBanner';
import { LeadsTable } from './LeadsTable';
import { MetricCards } from './MetricCards';
import { CATEGORY_LABELS } from './labels';
import { buildLeadRows, filterSnapshotClient } from './selectors';
import { useCrmStore } from './useCrmStore';

export function CategoryLeadView({
  category,
  title,
  description,
}: {
  category: IntelligenceCategory;
  title: string;
  description: string;
}) {
  const snapshot = useCrmStore((s) => s.snapshot);
  const filters = useCrmStore((s) => s.filters);

  const { rows, insufficientCount, responsible } = useMemo(() => {
    if (!snapshot) {
      return { rows: [], insufficientCount: 0, responsible: [] as string[] };
    }
    const filtered = filterSnapshotClient(snapshot, filters);
    const leadRows = buildLeadRows(filtered, category);
    const insufficient = leadRows.filter(
      (r) => r.callDataStatus === 'INSUFFICIENT_CALL_DATA',
    ).length;
    const byExec = new Map<string, number>();
    for (const r of leadRows) {
      byExec.set(r.assignedTo, (byExec.get(r.assignedTo) ?? 0) + 1);
    }
    return {
      rows: leadRows,
      insufficientCount: insufficient,
      responsible: [...byExec.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, count]) => `${name} (${count})`),
    };
  }, [snapshot, filters, category]);

  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </header>
      <MetricCards
        items={[
          {
            label: CATEGORY_LABELS[category],
            value: rows.length,
            tone:
              category === 'GONE_DARK'
                ? 'urgent'
                : category.includes('INTENT')
                  ? 'opportunity'
                  : 'warning',
          },
          {
            label: 'Insufficient call data',
            value: insufficientCount,
            tone: insufficientCount ? 'warning' : 'neutral',
          },
          {
            label: 'Top owners',
            value: responsible[0] || '—',
            hint: responsible.slice(1).join(' · ') || undefined,
          },
        ]}
      />
      <InsufficientCallDataBanner
        count={insufficientCount}
        callTotal={
          (snapshot as { callTotal?: number } | null)?.callTotal ??
          snapshot?.syncMeta.callCount ??
          snapshot?.calls.length
        }
      />
      <section className="dash-card">
        <LeadsTable
          rows={rows}
          emptyMessage={`No ${CATEGORY_LABELS[category]} leads in the current filter set.`}
        />
      </section>
    </div>
  );
}
