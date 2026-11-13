'use client';

import { useState } from 'react';
import type { LeadRow } from './selectors';
import {
  downloadLeadExport,
  type LeadExportFormat,
} from './exportLeads';

const FORMATS: Array<{ id: LeadExportFormat; label: string }> = [
  { id: 'csv', label: 'CSV' },
  { id: 'xlsx', label: 'Excel' },
  { id: 'pdf', label: 'PDF' },
];

export function ExportLeadsBar({
  rows,
  label,
  compact,
}: {
  rows: LeadRow[];
  /** Human label used in filename and PDF title, e.g. "Gone Dark". */
  label: string;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState<LeadExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(format: LeadExportFormat) {
    setError(null);
    if (!rows.length) {
      setError('No leads to export in the current view/filters.');
      return;
    }
    setBusy(format);
    try {
      // Yield so the busy label paints before heavy XLSX/PDF work.
      await new Promise<void>((r) => setTimeout(r, 0));
      downloadLeadExport(rows, label, format);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={`export-leads-bar${compact ? ' compact' : ''}`}>
      <span className="export-leads-label">Export {label}</span>
      <div className="export-leads-actions">
        {FORMATS.map((f) => (
          <button
            key={f.id}
            type="button"
            className="btn-secondary"
            disabled={busy != null || rows.length === 0}
            onClick={() => void run(f.id)}
          >
            {busy === f.id ? 'Preparing…' : f.label}
          </button>
        ))}
      </div>
      {error ? (
        <p className="export-leads-error" role="alert">
          {error}
        </p>
      ) : (
        <p className="export-leads-hint">
          {rows.length.toLocaleString()} row{rows.length === 1 ? '' : 's'} · CSV /
          Excel / PDF
        </p>
      )}
    </div>
  );
}
