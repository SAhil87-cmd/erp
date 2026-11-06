'use client';

import { TAB_ITEMS, type DashboardTab } from './labels';
import { useCrmStore } from './useCrmStore';
import { filterSnapshotClient } from './selectors';
import { useMemo } from 'react';

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
    return {
      'all-leads': filtered.processes.length,
      'gone-dark': byCat.GONE_DARK ?? 0,
      'not-picking-up': byCat.NOT_PICKING_UP ?? 0,
      'mismarked-ni': byCat.MISMARKED_NI ?? 0,
      'stuck-leads': byCat.STUCK ?? 0,
      'very-high-intent': byCat.VERY_HIGH_INTENT ?? 0,
      'high-intent': byCat.HIGH_INTENT ?? 0,
      'reviewed-leads': filtered.reviews?.length
        ? new Set(snapshot.reviews.map((r) => r.customerId)).size
        : snapshot.reviews.length,
      override: snapshot.overrides.length,
      'sales-closed': filtered.processes.filter((p) => p.currentStage === 'Sales Closed')
        .length,
    } as Record<DashboardTab, number>;
  }, [snapshot, filters]);

  return (
    <aside className="dash-sidebar">
      <div className="sidebar-brand">
        <span className="sidebar-brand-mark">YG</span>
        <div>
          <strong>Yashodhan Group</strong>
          <span>Sales Intelligence</span>
        </div>
      </div>
      <nav className="sidebar-nav" aria-label="Dashboard sections">
        {TAB_ITEMS.map((item) => {
          const count = counts[item.id];
          return (
            <button
              key={item.id}
              type="button"
              className={`sidebar-link${activeTab === item.id ? ' active' : ''}`}
              onClick={() => setActiveTab(item.id)}
            >
              <span>{item.label}</span>
              {typeof count === 'number' ? <em>{count}</em> : null}
            </button>
          );
        })}
      </nav>
      <footer className="sidebar-footer">
        <span>Call-aware classifications</span>
        <span>Asia/Kolkata</span>
      </footer>
    </aside>
  );
}
