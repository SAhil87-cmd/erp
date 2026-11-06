'use client';

import { useCrmStore } from './useCrmStore';

const REPORTS = [
  { id: 'classifications', label: 'Classifications' },
  { id: 'customers', label: 'Customers' },
  { id: 'processes', label: 'Processes' },
  { id: 'calls', label: 'Calls' },
  { id: 'overview', label: 'Overview metrics' },
  { id: 'executives', label: 'Executive performance' },
  { id: 'projects', label: 'Project intelligence' },
  { id: 'booking', label: 'Booking forecast tiers' },
  { id: 'health', label: 'Data health issues' },
  { id: 'template', label: 'Blank CRM sheet template' },
];

export function ReportsView() {
  const filters = useCrmStore((s) => s.filters);

  function download(report: string) {
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
          <p>CSV exports from the current snapshot. Active global filters are applied.</p>
        </div>
      </header>
      <section className="dash-card report-grid">
        {REPORTS.map((r) => (
          <article key={r.id} className="report-card">
            <h3>{r.label}</h3>
            <button type="button" className="btn-primary" onClick={() => download(r.id)}>
              Download CSV
            </button>
          </article>
        ))}
      </section>
    </div>
  );
}
