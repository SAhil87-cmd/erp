'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CallRecord, IntelligenceCategory } from '@/lib/crm/types';
import { CATEGORY_LABELS, formatDate } from './labels';
import { useCrmStore } from './useCrmStore';

const OVERRIDE_OPTIONS: IntelligenceCategory[] = [
  'GONE_DARK',
  'NOT_PICKING_UP',
  'MISMARKED_NI',
  'STUCK',
  'VERY_HIGH_INTENT',
  'HIGH_INTENT',
  'NONE',
];

export function CustomerDrawer() {
  const snapshot = useCrmStore((s) => s.snapshot);
  const selected = useCrmStore((s) => s.selectedLead);
  const setSelectedLead = useCrmStore((s) => s.setSelectedLead);
  const submitReview = useCrmStore((s) => s.submitReview);
  const submitOverride = useCrmStore((s) => s.submitOverride);

  const [reviewer, setReviewer] = useState('Manager');
  const [note, setNote] = useState('');
  const [disposition, setDisposition] = useState('');
  const [overrideCategory, setOverrideCategory] =
    useState<IntelligenceCategory>('NONE');
  const [overrideReason, setOverrideReason] = useState('');
  const [createdBy, setCreatedBy] = useState('Manager');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [remoteCalls, setRemoteCalls] = useState<CallRecord[] | null>(null);

  useEffect(() => {
    if (!selected?.customerId) {
      setRemoteCalls(null);
      return;
    }
    let cancelled = false;
    setRemoteCalls(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/crm/calls?customerId=${encodeURIComponent(selected.customerId)}`,
        );
        const json = await res.json();
        if (!cancelled && json.ok) {
          setRemoteCalls(
            (json.calls as CallRecord[]).sort((a, b) =>
              b.callAt.localeCompare(a.callAt),
            ),
          );
        }
      } catch {
        if (!cancelled) setRemoteCalls([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected?.customerId]);

  const data = useMemo(() => {
    if (!snapshot || !selected) return null;
    const customer = snapshot.customers.find((c) => c.customerId === selected.customerId);
    const process = snapshot.processes.find(
      (p) => p.salesProcessId === selected.salesProcessId,
    );
    const classification = snapshot.classifications.find(
      (c) => c.salesProcessId === selected.salesProcessId,
    );
    if (!customer || !process || !classification) return null;

    const interactions = snapshot.interactions
      .filter((i) => i.salesProcessId === selected.salesProcessId)
      .sort((a, b) => String(b.interactionDate).localeCompare(String(a.interactionDate)));
    const localCalls = snapshot.calls
      .filter((c) => c.customerId === selected.customerId)
      .sort((a, b) => b.callAt.localeCompare(a.callAt));
    const calls = remoteCalls ?? localCalls;
    const reviews = snapshot.reviews.filter(
      (r) =>
        r.customerId === selected.customerId &&
        (!r.salesProcessId || r.salesProcessId === selected.salesProcessId),
    );
    const overrides = snapshot.overrides.filter(
      (o) =>
        o.customerId === selected.customerId &&
        (!o.salesProcessId || o.salesProcessId === selected.salesProcessId),
    );

    return {
      customer,
      process,
      classification,
      interactions,
      calls,
      reviews,
      overrides,
    };
  }, [snapshot, selected, remoteCalls]);

  if (!selected || !data) return null;

  const { customer, process, classification, interactions, calls, reviews, overrides } =
    data;

  async function onReview(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await submitReview({
        customerId: customer.customerId,
        salesProcessId: process.salesProcessId,
        reviewer,
        note,
        disposition: disposition || undefined,
      });
      setNote('');
      setDisposition('');
      setMsg('Review saved');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Review failed');
    } finally {
      setBusy(false);
    }
  }

  async function onOverride(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await submitOverride({
        customerId: customer.customerId,
        salesProcessId: process.salesProcessId,
        overrideCategory,
        reason: overrideReason,
        createdBy,
        originalCategory: classification.primaryCategory,
      });
      setOverrideReason('');
      setMsg('Override saved (engine classification retained)');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Override failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="drawer-backdrop" onClick={() => setSelectedLead(null)}>
      <aside className="customer-drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-header">
          <div>
            <h2>{customer.name || customer.customerId}</h2>
            <p>
              {customer.mobileNum || 'No phone'} · {customer.customerId}
            </p>
          </div>
          <button type="button" className="btn-ghost" onClick={() => setSelectedLead(null)}>
            Close
          </button>
        </header>

        <div className="drawer-body">
          <section className="drawer-section">
            <h3>Profile</h3>
            <dl className="kv-grid">
              <div>
                <dt>Project</dt>
                <dd>{process.projectName || '—'}</dd>
              </div>
              <div>
                <dt>Stage</dt>
                <dd>{process.currentStage}</dd>
              </div>
              <div>
                <dt>Executive</dt>
                <dd>{process.assignedTo || 'Unassigned'}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{process.source || '—'}</dd>
              </div>
              <div>
                <dt>Remark</dt>
                <dd>{process.remark || '—'}</dd>
              </div>
              <div>
                <dt>Company</dt>
                <dd>{customer.companyName || customer.firmName || '—'}</dd>
              </div>
              <div>
                <dt>City</dt>
                <dd>{customer.city || '—'}</dd>
              </div>
            </dl>
          </section>

          <section className="drawer-section">
            <h3>Classification</h3>
            <p>
              <span className={`cat-pill tone-${classification.primaryCategory.toLowerCase()}`}>
                {CATEGORY_LABELS[classification.primaryCategory]}
              </span>
            </p>
            {classification.callDataStatus === 'INSUFFICIENT_CALL_DATA' ? (
              <p className="cell-warn">INSUFFICIENT CALL DATA</p>
            ) : null}
            <p className="drawer-reason">
              {classification.reasons[classification.primaryCategory] ||
                classification.recommendedAction}
            </p>
            <p>
              <strong>Recommended:</strong> {classification.recommendedAction}
            </p>
            <p>
              <strong>Responsible:</strong> {process.assignedTo || 'Unassigned'}
            </p>
            {classification.underlyingFlags.length > 0 ? (
              <p className="cell-muted">
                Underlying flags: {classification.underlyingFlags.join(', ')}
              </p>
            ) : null}
            <details className="evidence-block">
              <summary>Classification reasons</summary>
              <pre>
                {JSON.stringify(
                  Object.keys(classification.evidence || {}).length
                    ? classification.evidence
                    : classification.reasons,
                  null,
                  2,
                )}
              </pre>
            </details>
          </section>

          <section className="drawer-section">
            <h3>Stage history</h3>
            {process.stageHistory.length === 0 ? (
              <p className="cell-muted">No stage history</p>
            ) : (
              <ul className="timeline">
                {process.stageHistory.map((entry, i) => (
                  <li key={`${entry.stage}-${i}`}>
                    <strong>{entry.stage}</strong>
                    <span>{formatDate(entry.stageEntryDate)}</span>
                    <em>{entry.stageRaw}</em>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="drawer-section">
            <h3>Interaction timeline</h3>
            {interactions.length === 0 ? (
              <p className="cell-muted">No interactions</p>
            ) : (
              <ul className="timeline">
                {interactions.slice(0, 20).map((ix) => (
                  <li key={ix.interactionId}>
                    <strong>{ix.status}</strong>
                    <span>{formatDate(ix.interactionDate)}</span>
                    <em>{ix.notes || ix.statusRaw}</em>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="drawer-section">
            <h3>Call history</h3>
            {calls.length === 0 ? (
              <p className="cell-muted">No call records for this customer</p>
            ) : (
              <ul className="timeline">
                {calls.slice(0, 20).map((call) => (
                  <li key={call.callRecordId}>
                    <strong>{call.callOutcome}</strong>
                    <span>{formatDate(call.callAt)}</span>
                    <em>
                      {call.durationSeconds}s · {call.callExecutive || '—'}
                    </em>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="drawer-section">
            <h3>Manual review</h3>
            <form className="drawer-form" onSubmit={onReview}>
              <input
                className="dash-input"
                value={reviewer}
                onChange={(e) => setReviewer(e.target.value)}
                placeholder="Reviewer"
                required
              />
              <input
                className="dash-input"
                value={disposition}
                onChange={(e) => setDisposition(e.target.value)}
                placeholder="Disposition (optional)"
              />
              <textarea
                className="dash-input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Review note"
                rows={3}
                required
              />
              <button type="submit" className="btn-primary" disabled={busy}>
                Save review
              </button>
            </form>
            {reviews.length > 0 ? (
              <ul className="timeline compact">
                {reviews.map((r) => (
                  <li key={r.reviewId}>
                    <strong>{r.reviewer}</strong>
                    <span>{formatDate(r.createdAt)}</span>
                    <em>{r.note}</em>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="drawer-section">
            <h3>Classification override</h3>
            <p className="cell-muted">
              Overrides do not delete the engine classification.
            </p>
            <form className="drawer-form" onSubmit={onOverride}>
              <select
                className="dash-input"
                value={overrideCategory}
                onChange={(e) =>
                  setOverrideCategory(e.target.value as IntelligenceCategory)
                }
              >
                {OVERRIDE_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
              <input
                className="dash-input"
                value={createdBy}
                onChange={(e) => setCreatedBy(e.target.value)}
                placeholder="Created by"
                required
              />
              <textarea
                className="dash-input"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Override reason"
                rows={3}
                required
              />
              <button type="submit" className="btn-secondary" disabled={busy}>
                Save override
              </button>
            </form>
            {overrides.length > 0 ? (
              <ul className="timeline compact">
                {overrides.map((o) => (
                  <li key={o.overrideId}>
                    <strong>{CATEGORY_LABELS[o.overrideCategory]}</strong>
                    <span>{formatDate(o.createdAt)}</span>
                    <em>
                      {o.createdBy}: {o.reason}
                    </em>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {msg ? <p className="drawer-msg">{msg}</p> : null}
        </div>
      </aside>
    </div>
  );
}
