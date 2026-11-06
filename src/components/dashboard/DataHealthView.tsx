'use client';

import { useRef, useState } from 'react';
import { MetricCards } from './MetricCards';
import { InsufficientCallDataBanner } from './InsufficientCallDataBanner';
import { useCrmStore } from './useCrmStore';
import { formatDate } from './labels';

export function DataHealthView() {
  const snapshot = useCrmStore((s) => s.snapshot);
  const importFile = useCrmStore((s) => s.importFile);
  const seed = useCrmStore((s) => s.seed);
  const syncSheets = useCrmStore((s) => s.syncSheets);
  const loading = useCrmStore((s) => s.loading);
  const crmInput = useRef<HTMLInputElement>(null);
  const callsInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);

  const health = snapshot?.dataHealth;
  const sync = snapshot?.syncMeta;
  const insufficient =
    snapshot?.classifications.filter((c) => c.callDataStatus === 'INSUFFICIENT_CALL_DATA')
      .length ?? 0;
  const withCalls = new Set(snapshot?.calls.map((c) => c.customerId) ?? []).size;
  const customers = snapshot?.customers.length ?? 0;
  const coverage =
    customers === 0 ? 0 : Math.round((withCalls / customers) * 1000) / 10;

  async function onImport(kind: 'crm' | 'calls', file: File | undefined) {
    if (!file) return;
    setMessage(null);
    try {
      await importFile(file, kind);
      setMessage(`${kind === 'crm' ? 'CRM' : 'Calls'} import complete: ${file.name}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Import failed');
    }
  }

  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <h1>Data Health & Settings</h1>
          <p>Import CRM/call files, seed synthetic data, and review sync status.</p>
        </div>
      </header>

      <MetricCards
        items={[
          { label: 'Total rows', value: health?.totalRows ?? 0 },
          { label: 'Valid customers', value: health?.validCustomers ?? 0 },
          { label: 'Unmatched rows', value: health?.unmatchedRows ?? 0, tone: 'warning' },
          { label: 'Call coverage', value: `${coverage}%`, hint: `${withCalls} / ${customers} customers` },
          {
            label: 'Insufficient call data',
            value: insufficient,
            tone: insufficient ? 'warning' : 'neutral',
          },
          { label: 'Health issues', value: health?.issues.length ?? 0 },
        ]}
      />

      <InsufficientCallDataBanner
        count={insufficient}
        callTotal={
          snapshot?.callTotal ??
          snapshot?.syncMeta.callCount ??
          snapshot?.calls.length
        }
      />

      <div className="split-grid">
        <section className="dash-card">
          <h2 className="section-title">Import & seed</h2>
          <div className="action-stack">
            <input
              ref={crmInput}
              type="file"
              accept=".csv,.xlsx,.xls"
              hidden
              onChange={(e) => onImport('crm', e.target.files?.[0])}
            />
            <input
              ref={callsInput}
              type="file"
              accept=".csv"
              hidden
              onChange={(e) => onImport('calls', e.target.files?.[0])}
            />
            <button
              type="button"
              className="btn-primary"
              disabled={loading}
              onClick={() => crmInput.current?.click()}
            >
              Import CRM CSV / XLSX
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={loading}
              onClick={() => callsInput.current?.click()}
            >
              Import calls CSV
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={loading}
              onClick={async () => {
                setMessage(null);
                try {
                  await seed();
                  setMessage('Synthetic dataset reloaded');
                } catch (err) {
                  setMessage(err instanceof Error ? err.message : 'Seed failed');
                }
              }}
            >
              Reload synthetic seed
            </button>
            {message ? <p className="drawer-msg">{message}</p> : null}
          </div>
        </section>

        <section className="dash-card">
          <h2 className="section-title">Published Google Sheet</h2>
          <p className="cell-muted" style={{ marginBottom: '0.75rem' }}>
            Live dataset (published call history tab):{' '}
            <a
              href="https://docs.google.com/spreadsheets/d/e/2PACX-1vQS0n24NGhCYCBE7bHdGScggtbPVyui4iHpfcuNq9-RYtw3AZXjnS8SjXUM01E4n_giJDJb6CFd4yNW/pubhtml"
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--accent, #0f766e)', textDecoration: 'underline' }}
            >
              Open published sheet
            </a>
            . If today&apos;s leads are missing, republish in Google Sheets (File → Share → Publish
            to web) and turn on automatic republish — the CRM can only show what that published
            CSV contains.
          </p>
          <dl className="kv-grid">
            <div>
              <dt>Source</dt>
              <dd>{sync?.source ?? '—'}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{sync?.status ?? '—'}</dd>
            </div>
            <div>
              <dt>Last import</dt>
              <dd>{formatDate(sync?.lastImportAt)}</dd>
            </div>
            <div>
              <dt>Last Sheets sync</dt>
              <dd>{formatDate(sync?.lastSyncAt)}</dd>
            </div>
            <div>
              <dt>Newest row in sheet</dt>
              <dd>{formatDate(sync?.latestDataAt)}</dd>
            </div>
            <div>
              <dt>Rows</dt>
              <dd>{sync?.rowCount ?? '—'}</dd>
            </div>
            <div>
              <dt>Calls</dt>
              <dd>{sync?.callCount ?? '—'}</dd>
            </div>
          </dl>
          {sync?.message ? <p className="cell-muted">{sync.message}</p> : null}
          <button
            type="button"
            className="btn-primary"
            disabled={loading}
            onClick={async () => {
              setMessage(null);
              try {
                const msg = await syncSheets();
                setMessage(msg);
              } catch (err) {
                setMessage(err instanceof Error ? err.message : 'Sync failed');
              }
            }}
          >
            {loading ? 'Syncing published sheet…' : 'Sync published Google Sheet'}
          </button>
          <p className="cell-muted" style={{ marginTop: '0.75rem' }}>
            This workbook is a call-history export. Sync pulls calls server-side and derives
            customer rows when CRM data is empty. Full 35-column CRM CSV/XLSX import remains
            available above. Runo API sync is still pending credentials.
          </p>
        </section>
      </div>

      <section className="dash-card">
        <h2 className="section-title">Health issues</h2>
        {!health?.issues.length ? (
          <div className="empty-state">No data health issues reported.</div>
        ) : (
          <div className="table-scroll">
            <table className="leads-table">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Code</th>
                  <th>Message</th>
                  <th>Row</th>
                  <th>Customer</th>
                  <th>Field</th>
                </tr>
              </thead>
              <tbody>
                {health.issues.slice(0, 100).map((issue, idx) => (
                  <tr key={`${issue.code}-${idx}`}>
                    <td>{issue.severity}</td>
                    <td>{issue.code}</td>
                    <td className="cell-clamp">{issue.message}</td>
                    <td>{issue.rowIndex ?? '—'}</td>
                    <td>{issue.customerId ?? '—'}</td>
                    <td>{issue.field ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
