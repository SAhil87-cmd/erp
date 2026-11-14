'use client';

import { useMemo } from 'react';
import type { CanonicalStage } from '@/lib/crm/types';
import { remarkIndicatesNotInterested } from '@/lib/crm/classification/config';
import { ExportLeadsBar } from './ExportLeadsBar';
import { LeadsTable } from './LeadsTable';
import { MetricCards } from './MetricCards';
import { buildLeadRows, filterSnapshotClient, type LeadRow } from './selectors';
import { useCrmStore } from './useCrmStore';

export function StageLeadView({
  stages,
  title,
  description,
  /** Also include leads whose Notes/remark say Not Interested. */
  includeRemarkNotInterested,
}: {
  stages: CanonicalStage[];
  title: string;
  description: string;
  includeRemarkNotInterested?: boolean;
}) {
  const snapshot = useCrmStore((s) => s.snapshot);
  const filters = useCrmStore((s) => s.filters);

  const rows = useMemo(() => {
    if (!snapshot) return [] as LeadRow[];
    const filtered = filterSnapshotClient(snapshot, filters);
    const stageSet = new Set(stages);
    return buildLeadRows(filtered).filter((r) => {
      if (stageSet.has(r.stage as CanonicalStage)) return true;
      if (includeRemarkNotInterested && remarkIndicatesNotInterested(r.remark)) {
        return true;
      }
      return false;
    });
  }, [snapshot, filters, stages, includeRemarkNotInterested]);

  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <ExportLeadsBar rows={rows} label={title} compact />
      </header>
      <MetricCards
        items={[
          {
            label: title,
            value: rows.length,
            tone: 'neutral',
          },
        ]}
      />
      <section className="dash-card">
        <LeadsTable
          rows={rows}
          emptyMessage={`No ${title} leads in the current filter set.`}
        />
      </section>
    </div>
  );
}
