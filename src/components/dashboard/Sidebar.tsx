'use client';

import Image from 'next/image';
import { useMemo } from 'react';
import { NAV_SECTIONS, TAB_ITEMS, type DashboardTab } from './labels';
import { filterSnapshotClient } from './selectors';
import { useCrmStore } from './useCrmStore';

const LABEL_BY_ID = Object.fromEntries(
  TAB_ITEMS.map((t) => [t.id, t.label]),
) as Record<DashboardTab, string>;

export function Sidebar() {
  const activeTab = useCrmStore((s) => s.activeTab);
  const setActiveTab = useCrmStore((s) => s.setActiveTab);
  const snapshot = useCrmStore((s) => s.snapshot);
  const filters = useCrmStore((s) => s.filters);

  const counts = useMemo(() => {
    if (!snapshot) return {} as Record<string, number>;
    const filtered = filterSnapshotClient(snapshot, filters);
    const byCat: Record<string, number> = {};
    for (const c of filtered.classifications) {
      byCat[c.primaryCategory] = (byCat[c.primaryCategory] ?? 0) + 1;
    }
    const pre = snapshot.overviewMetrics;
    const usePre =
      filtered.processes.length === 0 &&
      Boolean(pre?.byCategory || pre?.byStage);
    const preCat: Record<string, number> = pre?.byCategory ?? {};
    const byStage: Record<string, number> = pre?.byStage ?? {};
    const stageCount = (...names: string[]) =>
      names.reduce((sum, name) => sum + (byStage[name] ?? 0), 0);
    const processStageCount = (...names: string[]) =>
      filtered.processes.filter((p) => names.includes(p.currentStage)).length;

    return {
      'all-leads': usePre
        ? (pre?.totalCustomers ?? pre?.totalProcesses ?? 0)
        : filtered.processes.length,
      'gone-dark': usePre
        ? (preCat.GONE_DARK ?? 0)
        : (byCat.GONE_DARK ?? 0),
      'not-picking-up': usePre
        ? (preCat.NOT_PICKING_UP ?? 0)
        : (byCat.NOT_PICKING_UP ?? 0),
      'mismarked-ni': usePre
        ? (preCat.MISMARKED_NI ?? 0)
        : (byCat.MISMARKED_NI ?? 0),
      'stuck-leads': usePre ? (preCat.STUCK ?? 0) : (byCat.STUCK ?? 0),
      'very-high-intent': usePre
        ? (preCat.VERY_HIGH_INTENT ?? 0)
        : (byCat.VERY_HIGH_INTENT ?? 0),
      'high-intent': usePre
        ? (preCat.HIGH_INTENT ?? 0)
        : (byCat.HIGH_INTENT ?? 0),
      'not-interested':
        filtered.processes.length === 0
          ? (pre?.notInterested ?? stageCount('Not Interested'))
          : processStageCount('Not Interested'),
      'cold-follow':
        filtered.processes.length === 0
          ? stageCount('Cold Followup', 'Cold', 'Followup')
          : processStageCount('Cold Followup', 'Cold', 'Followup'),
      'site-visit-scheduled':
        filtered.processes.length === 0
          ? stageCount('Site Visit Scheduled')
          : processStageCount('Site Visit Scheduled'),
      'reviewed-leads': filtered.reviews?.length
        ? new Set(snapshot.reviews.map((r) => r.customerId)).size
        : snapshot.reviews.length,
      override: snapshot.overrides.length,
      'sales-closed':
        filtered.processes.length === 0
          ? (pre?.salesClosed ?? stageCount('Sales Closed'))
          : processStageCount('Sales Closed'),
    } as Record<DashboardTab, number>;
  }, [snapshot, filters]);

  return (
    <aside className="dash-sidebar">
      <div className="sidebar-brand">
        <Image
          src="/yashodhan-logo.png"
          alt="Yashodhan Group"
          width={200}
          height={56}
          className="sidebar-logo"
          priority
        />
        <p className="sidebar-product">Sales Intelligence ERP</p>
      </div>

      <nav className="sidebar-nav" aria-label="ERP modules">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title} className="sidebar-section">
            <p className="sidebar-section-title">{section.title}</p>
            <div className="sidebar-section-links">
              {section.items.map((id) => {
                const count = counts[id];
                return (
                  <button
                    key={id}
                    type="button"
                    className={`sidebar-link${activeTab === id ? ' active' : ''}`}
                    onClick={() => setActiveTab(id)}
                  >
                    <span>{LABEL_BY_ID[id]}</span>
                    {typeof count === 'number' ? (
                      <em>{count.toLocaleString('en-IN')}</em>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <footer className="sidebar-footer">
        <span>Yashodhan Group</span>
        <span>Asia/Kolkata · Live sheet sync</span>
      </footer>
    </aside>
  );
}
