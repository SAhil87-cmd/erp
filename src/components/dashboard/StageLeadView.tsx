'use client';

import { useMemo } from 'react';
import type {
  CanonicalStage,
  ClassificationResult,
  CrmSnapshot,
} from '@/lib/crm/types';
import { remarkIndicatesNotInterested } from '@/lib/crm/classification/config';
import { ExportLeadsBar } from './ExportLeadsBar';
import { LeadsTable } from './LeadsTable';
import { MetricCards } from './MetricCards';
import { buildLeadRows, filterSnapshotClient, type LeadRow } from './selectors';
import { useCrmStore } from './useCrmStore';

function withSyntheticClassifications(snapshot: CrmSnapshot): CrmSnapshot {
  const have = new Set(snapshot.classifications.map((c) => c.salesProcessId));
  const extra: ClassificationResult[] = [];
  for (const p of snapshot.processes) {
    if (have.has(p.salesProcessId)) continue;
    extra.push({
      customerId: p.customerId,
      salesProcessId: p.salesProcessId,
      currentStage: p.currentStage,
      primaryCategory: 'NONE',
      underlyingFlags: [],
      callDataStatus: 'OK',
      missingFields: [],
      recommendedAction: '',
      reasons: {},
      evidence: {},
      ruleResults: {},
    });
  }
  if (extra.length === 0) return snapshot;
  return {
    ...snapshot,
    classifications: [...snapshot.classifications, ...extra],
  };
}

export function StageLeadView({
  stages,
  title,
  description,
  /** Also include leads whose Notes/remark say Not Interested. */
  includeRemarkNotInterested,
  showCallStats,
}: {
  stages: CanonicalStage[];
  title: string;
  description: string;
  includeRemarkNotInterested?: boolean;
  showCallStats?: boolean;
}) {
  const snapshot = useCrmStore((s) => s.snapshot);
  const filters = useCrmStore((s) => s.filters);

  const { rows, metricCount } = useMemo(() => {
    if (!snapshot) return { rows: [] as LeadRow[], metricCount: 0 };
    const filtered = withSyntheticClassifications(
      filterSnapshotClient(snapshot, filters),
    );
    const stageSet = new Set(stages);
    const byStage = snapshot.overviewMetrics?.byStage ?? {};
    const preCount = stages.reduce((sum, s) => sum + (byStage[s] ?? 0), 0);

    if (filtered.processes.length === 0) {
      return { rows: [] as LeadRow[], metricCount: preCount };
    }

    const leadRows = buildLeadRows(filtered).filter((r) => {
      if (stageSet.has(r.stage as CanonicalStage)) return true;
      if (includeRemarkNotInterested && remarkIndicatesNotInterested(r.remark)) {
        return true;
      }
      return false;
    });
    return {
      rows: leadRows,
      metricCount: leadRows.length || preCount,
    };
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
            value: metricCount,
            tone: 'neutral',
          },
        ]}
      />
      <section className="dash-card">
        <LeadsTable
          rows={rows}
          emptyMessage={
            metricCount > 0 && rows.length === 0
              ? `${metricCount.toLocaleString()} ${title} leads are in the sheet. Click Refresh sheet and wait for the full lead list to finish loading.`
              : `No ${title} leads in the current filter set.`
          }
          showCallStats={showCallStats}
        />
      </section>
    </div>
  );
}
