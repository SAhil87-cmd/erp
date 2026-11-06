'use client';

import { useEffect } from 'react';
import { AllLeadsView } from './AllLeadsView';
import { CategoryLeadView } from './CategoryLeadView';
import { CustomerDrawer } from './CustomerDrawer';
import { DataHealthView } from './DataHealthView';
import { ExecutiveOverview } from './ExecutiveOverview';
import { ExecutivePerformanceView } from './ExecutivePerformanceView';
import { GlobalFiltersBar } from './GlobalFiltersBar';
import { OverrideView } from './OverrideView';
import { ProjectIntelligenceView } from './ProjectIntelligenceView';
import { ReportsView } from './ReportsView';
import { ReviewedLeadsView } from './ReviewedLeadsView';
import { SalesClosedView } from './SalesClosedView';
import { Sidebar } from './Sidebar';
import { TodaysActivityView } from './TodaysActivityView';
import { TAB_ITEMS } from './labels';
import { useCrmStore } from './useCrmStore';

function ActiveView() {
  const activeTab = useCrmStore((s) => s.activeTab);

  switch (activeTab) {
    case 'executive-overview':
      return <ExecutiveOverview />;
    case 'gone-dark':
      return (
        <CategoryLeadView
          category="GONE_DARK"
          title="Gone Dark"
          description="Customers with answered history who have gone silent — who, why, evidence, and next action."
        />
      );
    case 'not-picking-up':
      return (
        <CategoryLeadView
          category="NOT_PICKING_UP"
          title="Not Picking Up"
          description="Repeated unanswered attempts requiring alternate outreach."
        />
      );
    case 'mismarked-ni':
      return (
        <CategoryLeadView
          category="MISMARKED_NI"
          title="Mismarked NI"
          description="Marked Not Interested despite engagement signals that warrant review."
        />
      );
    case 'stuck-leads':
      return (
        <CategoryLeadView
          category="STUCK"
          title="Stuck Leads"
          description="Leads lingering too long in the same stage."
        />
      );
    case 'very-high-intent':
      return (
        <CategoryLeadView
          category="VERY_HIGH_INTENT"
          title="Very High Intent"
          description="Revisit Done with strong answered-call evidence."
        />
      );
    case 'high-intent':
      return (
        <CategoryLeadView
          category="HIGH_INTENT"
          title="High Intent"
          description="Site Visit Done with strong answered-call evidence."
        />
      );
    case 'all-leads':
      return <AllLeadsView />;
    case 'reviewed-leads':
      return <ReviewedLeadsView />;
    case 'override':
      return <OverrideView />;
    case 'sales-closed':
      return <SalesClosedView />;
    case 'todays-activity':
      return <TodaysActivityView />;
    case 'executive-performance':
      return <ExecutivePerformanceView />;
    case 'project-intelligence':
      return <ProjectIntelligenceView />;
    case 'reports':
      return <ReportsView />;
    case 'data-health':
      return <DataHealthView />;
    default:
      return <ExecutiveOverview />;
  }
}

const CLIENT_STALE_MS = 2 * 60 * 1000;

function needsFreshSheetSync(snapshot: {
  syncMeta?: {
    source?: string;
    lastSyncAt?: string | null;
    message?: string | null;
  };
} | null): boolean {
  if (!snapshot?.syncMeta) return true;
  const meta = snapshot.syncMeta;
  const synthetic =
    meta.source === 'csv' &&
    (meta.message || '').toLowerCase().includes('synthetic');
  if (synthetic || meta.source !== 'google_sheets') return true;
  if (!meta.lastSyncAt) return true;
  const age = Date.now() - new Date(meta.lastSyncAt).getTime();
  return !Number.isFinite(age) || age > CLIENT_STALE_MS;
}

export function DashboardShell() {
  const loadSnapshot = useCrmStore((s) => s.loadSnapshot);
  const syncSheets = useCrmStore((s) => s.syncSheets);
  const loading = useCrmStore((s) => s.loading);
  const error = useCrmStore((s) => s.error);
  const snapshot = useCrmStore((s) => s.snapshot);
  const activeTab = useCrmStore((s) => s.activeTab);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadSnapshot();
      if (cancelled) return;
      const current = useCrmStore.getState().snapshot;
      if (needsFreshSheetSync(current)) {
        try {
          await syncSheets();
        } catch {
          // Snapshot (even if stale) remains visible; error banner shows sync failure.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSnapshot, syncSheets]);

  const tabLabel = TAB_ITEMS.find((t) => t.id === activeTab)?.label ?? 'Dashboard';
  const lastSyncAt = snapshot?.syncMeta?.lastSyncAt;
  const syncSource = snapshot?.syncMeta?.source;

  return (
    <div className="dash-shell">
      <Sidebar />
      <div className="dash-main">
        <header className="dash-topbar">
          <div>
            <p className="topbar-kicker">Sales Intelligence</p>
            <h1 className="topbar-title">{tabLabel}</h1>
          </div>
          <div className="topbar-meta">
            {snapshot ? (
              <span>
                {syncSource === 'google_sheets' && lastSyncAt
                  ? `Sheet synced ${new Date(lastSyncAt).toLocaleString('en-IN', {
                      timeZone: 'Asia/Kolkata',
                    })}`
                  : `Built ${new Date(snapshot.builtAt).toLocaleString('en-IN', {
                      timeZone: 'Asia/Kolkata',
                    })}`}
              </span>
            ) : null}
            <button
              type="button"
              className="btn-ghost"
              disabled={loading}
              onClick={() => {
                void syncSheets().catch(() => undefined);
              }}
            >
              Refresh sheet
            </button>
            {loading ? <span className="topbar-loading">Loading…</span> : null}
          </div>
        </header>
        <GlobalFiltersBar />
        <main className="dash-content">
          {error ? (
            <div className="error-banner" role="alert">
              {error}
              <button type="button" className="btn-ghost" onClick={() => loadSnapshot()}>
                Retry
              </button>
            </div>
          ) : null}
          {!snapshot && loading ? (
            <div className="empty-state">Loading CRM snapshot…</div>
          ) : null}
          {snapshot ? <ActiveView /> : null}
          {!snapshot && !loading && !error ? (
            <div className="empty-state">No CRM data loaded.</div>
          ) : null}
        </main>
      </div>
      <CustomerDrawer />
    </div>
  );
}
