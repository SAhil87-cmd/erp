'use client';

import { useMemo, useState } from 'react';
import { computeOverviewMetrics } from '@/lib/crm/analytics';
import {
  downloadLeadExport,
  LEAD_EXPORT_KINDS,
  type LeadExportFormat,
  type LeadExportKind,
} from './exportLeads';
import { buildLeadRows, filterSnapshotClient } from './selectors';
import { useCrmStore } from './useCrmStore';

const FORMATS: Array<{ id: LeadExportFormat; label: string }> = [
  { id: 'csv', label: 'CSV' },
  { id: 'xlsx', label: 'Excel' },
  { id: 'pdf', label: 'PDF' },
];

const LEGACY_REPORTS = [
  { id: 'classifications', label: 'Classifications (all)' },
  { id: 'customers', label: 'Customers' },
  { id: 'processes', label: 'Processes' },
  { id: 'calls', label: 'Calls (preview)' },
  { id: 'overview', label: 'Overview metrics' },
  { id: 'executives', label: 'Executive performance' },
  { id: 'projects', label: 'Project intelligence' },
  { id: 'booking', label: 'Booking forecast tiers' },
  { id: 'health', label: 'Data health issues' },
  { id: 'template', label: 'Blank CRM sheet template' },
];

export function ReportsView() {
  const snapshot = useCrmStore((s) => s.snapshot);
  const filters = useCrmStore((s) => s.filters);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const rowsByKind = useMemo(() => {
    const map = new Map<LeadExportKind, ReturnType<typeof buildLeadRows>>();
    if (!snapshot) return map;
    const filtered = filterSnapshotClient(snapshot, filters);
    for (const kind of LEAD_EXPORT_KINDS) {
      if (kind.stage) {
        const staged = filterSnapshotClient(snapshot, {
          ...filters,
          stages: [kind.stage],
        });
        map.set(kind.id, buildLeadRows(staged));
      } else if (kind.category) {
        map.set(kind.id, buildLeadRows(filtered, kind.category));
      } else {
        map.set(kind.id, buildLeadRows(filtered));
      }
    }
    return map;
  }, [snapshot, filters]);

  const overview = useMemo(() => {
    if (!snapshot) return null;
    return computeOverviewMetrics(filterSnapshotClient(snapshot, filters));
  }, [snapshot, filters]);

  async function exportKind(kind: (typeof LEAD_EXPORT_KINDS)[number], format: LeadExportFormat) {
    const key = `${kind.id}:${format}`;
    setBusy(key);
    setMessage(null);
    try {
      const rows = rowsByKind.get(kind.id) ?? [];
      if (!rows.length) {
        setMessage(`No ${kind.label} leads in the current filters.`);
        return;
      }
      await new Promise<void>((r) => setTimeout(r, 0));
      downloadLeadExport(rows, kind.label, format);
      setMessage(`Downloaded ${kind.label} (${format.toUpperCase()}) — ${rows.length.toLocaleString()} rows.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(null);
    }
  }

  function downloadLegacy(report: string) {
    const params = new URLSearchParams({ report });
    const hasFilters = Object.values(filters).some((v) =>
      Array.isArray(v) ? v.length > 0 : v != null && v !== '',
    );
    if (hasFilters) {
      params.set('filters', JSON.stringify(filters));
    }
    window.location.href = `/api/crm/export?${params.toString()}`;
  }

  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <h1>Reports</h1>
          <p>
            Separate exports per lead type (Gone Dark, Intent, etc.) as CSV, Excel, or PDF.
            Active global filters are applied. Prefer these downloads — they match the dashboard
            data already loaded in your browser.
          </p>
        </div>
      </header>

      {message ? (
        <p className="export-leads-hint" role="status">
          {message}
        </p>
      ) : null}

      <section className="dash-card">
        <header className="view-header compact">
          <div>
            <h2>Lead category exports</h2>
            <p>
              {overview
                ? `${overview.totalCustomers.toLocaleString()} customers in filter · pick a type and format`
                : 'Sync the sheet first, then export.'}
            </p>
          </div>
        </header>
        <div className="report-grid lead-export-grid">
          {LEAD_EXPORT_KINDS.map((kind) => {
            const count = rowsByKind.get(kind.id)?.length ?? 0;
            return (
              <article key={kind.id} className="report-card">
                <h3>{kind.label}</h3>
                <p className="report-card-meta">{count.toLocaleString()} leads</p>
                <div className="export-leads-actions">
                  {FORMATS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className="btn-primary"
                      disabled={busy != null || count === 0}
                      onClick={() => void exportKind(kind, f.id)}
                    >
                      {busy === `${kind.id}:${f.id}` ? '…' : f.label}
                    </button>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="dash-card">
        <header className="view-header compact">
          <div>
            <h2>Other CSV reports</h2>
            <p>Server snapshot CSVs (may be empty on a cold Vercel instance — use category exports above when possible).</p>
          </div>
        </header>
        <div className="report-grid">
          {LEGACY_REPORTS.map((r) => (
            <article key={r.id} className="report-card">
              <h3>{r.label}</h3>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => downloadLegacy(r.id)}
              >
                Download CSV
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
