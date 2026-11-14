'use client';

import { useEffect } from 'react';
import { calendarDateKey, todayCalendarKey } from '@/lib/crm/dates';
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
import { StageLeadView } from './StageLeadView';
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
          description="Two or more verified completed site visits."
        />
      );
    case 'high-intent':
      return (
        <CategoryLeadView
          category="HIGH_INTENT"
          title="High Intent"
          description="At least one verified completed site visit."
        />
      );
    case 'not-interested':
      return (
        <StageLeadView
          stages={['Not Interested']}
          title="Not Interested"
          description="Leads the sales executive marked Not Interested (including visit-done leads with an NI remark). These stay out of High Intent / Very High Intent / Stuck."
          includeRemarkNotInterested
        />
      );
    case 'cold-follow':
      return (
        <StageLeadView
          stages={['Cold Followup', 'Cold', 'Followup']}
          title="Cold Follow"
          description="Leads the sales executive marked Cold / Followup / Cold Follow. These stay out of Stuck and Intent buckets."
        />
      );
    case 'site-visit-scheduled':
      return (
        <StageLeadView
          stages={['Site Visit Scheduled']}
          title="Site Visit Scheduled"
          description="Customers planning a site visit. Table shows call count, call days, and talk time — open a lead for full dated call history."
          showCallStats
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

export function DashboardShell() {
  const syncSheets = useCrmStore((s) => s.syncSheets);
  const loading = useCrmStore((s) => s.loading);
  const error = useCrmStore((s) => s.error);
  const snapshot = useCrmStore((s) => s.snapshot);
  const activeTab = useCrmStore((s) => s.activeTab);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Always sync on boot. Do NOT fall back to an empty snapshot from another
      // Vercel instance — that paints a fake all-zero dashboard.
      try {
        await syncSheets();
      } catch {
        if (cancelled) return;
        // Retry once — covers stage-only frames and brief network blips.
        await new Promise((r) => setTimeout(r, 2000));
        if (!cancelled) {
          try {
            await syncSheets();
          } catch {
            // error already set
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // syncSheets is a stable zustand action; mount once on boot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabLabel = TAB_ITEMS.find((t) => t.id === activeTab)?.label ?? 'Dashboard';
  const lastSyncAt = snapshot?.syncMeta?.lastSyncAt;
  const syncSource = snapshot?.syncMeta?.source;
  const latestDataAt = snapshot?.syncMeta?.latestDataAt ?? null;
  const latestDataDay = latestDataAt ? calendarDateKey(latestDataAt) : null;
  const todayKey = todayCalendarKey();
  const sourceBehindToday =
    Boolean(latestDataDay) && Boolean(todayKey) && latestDataDay! < todayKey;

  return (
    <div className="dash-shell">
      <Sidebar />
      <div className="dash-main">
        <header className="dash-topbar">
          <div>
            <p className="topbar-kicker">Yashodhan Group · Sales Intelligence ERP</p>
            <h1 className="topbar-title">{tabLabel}</h1>
          </div>
          <div className="topbar-meta">
            {snapshot ? (
              <span className="topbar-chip" title="Live sheet sync status">
                {syncSource === 'google_sheets' && lastSyncAt
                  ? `Synced ${new Date(lastSyncAt).toLocaleString('en-IN', {
                      timeZone: 'Asia/Kolkata',
                    })}`
                  : `Built ${new Date(snapshot.builtAt).toLocaleString('en-IN', {
                      timeZone: 'Asia/Kolkata',
                    })}`}
                {latestDataAt
                  ? ` · Sheet ${new Date(latestDataAt).toLocaleString('en-IN', {
                      timeZone: 'Asia/Kolkata',
                    })}`
                  : ''}
              </span>
            ) : null}
            <button
              type="button"
              className="btn-primary"
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
          {sourceBehindToday ? (
            <div className="insufficient-banner" role="status">
              <strong>Published sheet is behind</strong>
              <span>
                Google&apos;s published CSV still ends on{' '}
                {new Date(latestDataAt!).toLocaleString('en-IN', {
                  timeZone: 'Asia/Kolkata',
                })}
                . The dashboard is synced to that publish — new calls after that will appear only
                after the sheet auto-republishes. In Google Sheets: File → Share → Publish to web →
                enable &quot;Automatically republish when changes are made&quot;, or open Data Health
                for details.
              </span>
            </div>
          ) : null}
          {error ? (
            <div className="error-banner" role="alert">
              {error}
              <button
                type="button"
                className="btn-ghost"
                disabled={loading}
                onClick={() => {
                  void syncSheets().catch(() => undefined);
                }}
              >
                Retry
              </button>
            </div>
          ) : null}
          {!snapshot && loading ? (
            <div className="empty-state">
              Syncing published Google Sheet… first load can take 1–2 minutes. Keep this tab open.
            </div>
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
