import { gzipSync } from 'zlib';
import { NextRequest, NextResponse } from 'next/server';
import {
  computeExecutivePerformance,
  computeOverviewMetrics,
  computeRecoveryMetrics,
} from '@/lib/crm/analytics';
import { toCompactWire } from '@/lib/crm/compactWire';
import {
  getSyncStatus,
  loadPublishedCrmRemarks,
  stampRemarksOnProcesses,
  syncFromGoogleSheets,
} from '@/lib/crm/sheets';
import { slimSnapshotForApi } from '@/lib/crm/slimSnapshot';
import {
  classifyAllProcessesAsync,
  classifyAllProcessesFromDisk,
} from '@/lib/crm/classification/engine';
import { slimClassification } from '@/lib/crm/slimSnapshot';
import {
  applyOverridesToClassifications,
  ensureCallOffsetsLoaded,
  getDiskCallCount,
  loadCalls,
  loadOverrides,
  loadSnapshot,
  loadStageOnlySnapshot,
  releaseCallsFromMemory,
  replaceCachedSnapshot,
  slimSnapshotFromDiskCalls,
  takeCallsFromMemory,
} from '@/lib/crm/store';
import type { CrmSnapshot } from '@/lib/crm/types';

/** Always slim before wire — localhost fat snapshots lack activityDate / day indexes. */
function packSnapshot(full: CrmSnapshot): CrmSnapshot {
  if (full.activityDate && full.callsByDayByExecutive?.length) return full;
  return slimSnapshotForApi(full);
}

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const jsonReplacer = (_key: string, value: unknown) => {
  if (value == null) return undefined;
  if (
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value as object).length === 0
  ) {
    return undefined;
  }
  return value;
};

function toOverviewWire(
  snapshot: CrmSnapshot,
  opts?: { omitLeads?: boolean },
) {
  const wire = toCompactWire(snapshot, opts);
  return {
    ...wire,
    pack: 'overview' as const,
    // Keep compact leads + day indexes when possible so date filters recompute KPIs.
    // On Vercel we first ship omitLeads=true so KPIs arrive before the connection drops.
    followUps: [] as typeof wire.followUps,
    calls: wire.calls?.slice(0, 40) ?? [],
    overviewMetrics: computeOverviewMetrics(snapshot),
    recoveryMetrics: computeRecoveryMetrics(snapshot.classifications),
    executivePerformance: computeExecutivePerformance(snapshot),
  };
}

function gzipWire(wire: unknown): string {
  return gzipSync(Buffer.from(JSON.stringify(wire, jsonReplacer), 'utf8'), {
    level: 6,
  }).toString('base64');
}

export async function GET() {
  try {
    const status = await getSyncStatus();
    return NextResponse.json({ ok: true, syncMeta: status });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read sync status';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    mode?: 'published' | 'api';
    includeSnapshot?: boolean;
    pack?: 'overview' | 'full';
    /** When true, respond with NDJSON progress lines (keeps browser connection alive). */
    stream?: boolean;
  };

  const wantStream = body.stream !== false;

  if (!wantStream) {
    // Non-streaming fallback (curl / tests).
    try {
      const result = await syncFromGoogleSheets({
        mode: body.mode ?? 'published',
      });
      const syncMeta = await getSyncStatus();
      if (result.status === 'error') {
        return NextResponse.json(
          { ok: false, error: result.message, result, syncMeta },
          { status: 502 },
        );
      }
      let snapshot: string | null = null;
      let snapshotEncoding: 'gzip-base64' | null = null;
      let snapshotError: string | null = null;
      let pack: 'overview' | 'full' | null = null;
      if (body.includeSnapshot !== false) {
        const onVercel = process.env.VERCEL === '1';
        const full = packSnapshot(
          await (onVercel ? loadStageOnlySnapshot() : loadSnapshot()),
        );
        const useFull = body.pack === 'full' && !onVercel;
        const wire = useFull
          ? toCompactWire(full)
          : toOverviewWire(full, { omitLeads: false });
        pack = useFull ? 'full' : 'overview';
        snapshot = gzipWire(wire);
        snapshotEncoding = 'gzip-base64';
      }
      return NextResponse.json({
        ok: true,
        result,
        syncMeta,
        pack,
        snapshotEncoding,
        snapshot,
        snapshotError,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sync failed';
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  }

  const encoder = new TextEncoder();
  // Pad lines so Vercel/CDN proxy buffers flush during long sync.
  const pad = ' '.repeat(2048);

  async function awaitWithHeartbeats<T>(
    send: (obj: unknown) => void,
    phase: string,
    promise: Promise<T>,
  ): Promise<T> {
    const pending = promise.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    for (;;) {
      const winner = await Promise.race([
        pending,
        new Promise<'tick'>((resolve) => {
          setTimeout(() => resolve('tick'), 2000);
        }),
      ]);
      if (winner === 'tick') {
        try {
          send({ ok: true, phase, t: Date.now() });
        } catch {
          // stream closed
        }
        continue;
      }
      if (winner.ok) return winner.value;
      throw winner.error;
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(obj)}${pad}\n`));
      };

      try {
        send({ ok: true, phase: 'syncing-sheet' });
        let lastParseLog = 0;
        const result = await awaitWithHeartbeats(
          send,
          'syncing-sheet',
          syncFromGoogleSheets({
            mode: body.mode ?? 'published',
            onProgress: (info) => {
              const now = Date.now();
              if (now - lastParseLog < 1500) return;
              lastParseLog = now;
              try {
                send({
                  ok: true,
                  phase: 'syncing-sheet',
                  detail: info.phase,
                  calls: info.calls,
                  rows: info.rows,
                  t: now,
                });
              } catch {
                // stream closed
              }
            },
          }),
        );
        const syncMeta = await getSyncStatus();

        if (result.status === 'error') {
          send({
            ok: false,
            phase: 'error',
            error: result.message,
            result,
            syncMeta,
          });
          return;
        }

        let snapshot: string | Record<string, unknown> | null = null;
        let snapshotEncoding: 'gzip-base64' | null = null;
        let snapshotError: string | null = null;
        let pack: 'overview' | 'full' | null = null;

        if (body.includeSnapshot !== false) {
          const onVercel = Boolean(process.env.VERCEL);
          const callTotal =
            result.callCount ??
            (syncMeta as { callCount?: number }).callCount ??
            0;
          const rowTotal =
            result.rowCount ??
            (syncMeta as { rowCount?: number }).rowCount ??
            0;
          let slimMeta = {
            lastSyncAt: (syncMeta as { lastSyncAt?: string }).lastSyncAt ?? undefined,
            lastImportAt:
              (syncMeta as { lastImportAt?: string }).lastImportAt ?? undefined,
            source: (syncMeta as { source?: string }).source ?? 'google_sheets',
            status: (syncMeta as { status?: string }).status ?? 'ok',
            rowCount: rowTotal,
            callCount: callTotal,
            latestDataAt:
              (syncMeta as { latestDataAt?: string | null }).latestDataAt ??
              undefined,
          };

          // Vercel: ship stage KPIs first (so the UI never blanks), then upgrade
          // with call-aware classify (Gone Dark / Mismarked NI / Intent) when memory allows.
          if (onVercel) {
            send({ ok: true, phase: 'building-dashboard', t: Date.now() });
            let resultLite = {
              status: result.status,
              message: result.message,
              rowCount: rowTotal,
              callCount: callTotal,
            };

            // Tiny count pack first — guarantees the browser gets *something*
            // before any heavy snapshot work.
            try {
              const countWire = {
                v: 1 as const,
                pack: 'overview' as const,
                builtAt: new Date().toISOString(),
                syncMeta: slimMeta,
                callTotal,
                interactionTotal: rowTotal,
                leads: [] as [],
                followUps: [] as [],
                calls: [] as [],
                projects: [] as string[],
                executives: [] as string[],
                reviews: [] as [],
                overrides: [] as [],
                dataHealth: {
                  totalRows: rowTotal,
                  validCustomers: rowTotal,
                  unmatchedRows: 0,
                  duplicateCustomerIds: [] as string[],
                  duplicatePhones: [] as string[],
                  missingCustomerIds: 0,
                  missingPhones: 0,
                  issues: [] as string[],
                },
                overviewMetrics: {
                  totalCustomers: rowTotal,
                  totalProcesses: rowTotal,
                  totalInteractions: rowTotal,
                  totalCalls: callTotal,
                  byStage: {},
                  byCategory: {
                    GONE_DARK: 0,
                    NOT_PICKING_UP: 0,
                    MISMARKED_NI: 0,
                    STUCK: 0,
                    VERY_HIGH_INTENT: 0,
                    HIGH_INTENT: 0,
                    NONE: 0,
                  },
                  salesClosed: 0,
                  notInterested: 0,
                  conversionRate: 0,
                  conversionDenominator: 0,
                  conversionNumerator: 0,
                  conversionDenominatorDescription:
                    'Sales Closed + Not Interested + active pipeline (excludes Spam/DND)',
                },
              };
              snapshot = countWire;
              snapshotEncoding = null;
              pack = 'overview';
              send({
                ok: true,
                phase: 'done',
                result: resultLite,
                syncMeta: slimMeta,
                pack,
                snapshotEncoding: null,
                snapshot: countWire,
                snapshotError: null,
                light: true,
                bootstrap: true,
                countsOnly: true,
              });
            } catch (countErr) {
              console.warn('[api/crm/sync] count bootstrap skipped', countErr);
            }

            try {
              const stageSnap = packSnapshot(
                await awaitWithHeartbeats(
                  send,
                  'building-dashboard',
                  loadStageOnlySnapshot(),
                ),
              );
              // Omit lead rows here to keep the NDJSON frame small; upgrade adds them.
              const bootWire = toOverviewWire(stageSnap, { omitLeads: true });
              snapshot = bootWire;
              snapshotEncoding = null;
              pack = 'overview';
              send({
                ok: true,
                phase: 'done',
                result: resultLite,
                syncMeta: slimMeta,
                pack,
                snapshotEncoding: null,
                snapshot: bootWire,
                snapshotError: null,
                light: true,
                bootstrap: true,
                stageOnly: true,
              });

              // Upgrade: classify against the FULL call set (exact parity with localhost).
              send({ ok: true, phase: 'classifying', t: Date.now() });
              try {
                const processInputs = stageSnap.processes.map((p) => ({
                  customerId: p.customerId,
                  salesProcessId: p.salesProcessId,
                  currentStage: p.currentStage,
                  stageEnteredAt: p.stageEnteredAt,
                  stageHistory: p.stageHistory,
                  remark: p.remark,
                }));

                const diskCount = getDiskCallCount();
                const offsets =
                  diskCount > 0 ? await ensureCallOffsetsLoaded() : null;

                let engineClassifications;
                if (offsets && offsets.size > 0) {
                  // Exact: one customer at a time from /tmp JSONL.
                  engineClassifications = await awaitWithHeartbeats(
                    send,
                    'classifying',
                    classifyAllProcessesFromDisk(processInputs, offsets),
                  );
                } else {
                  let calls = takeCallsFromMemory();
                  if (!calls.length) calls = await loadCalls();
                  engineClassifications = await awaitWithHeartbeats(
                    send,
                    'classifying',
                    classifyAllProcessesAsync(processInputs, calls),
                  );
                  calls = [];
                  releaseCallsFromMemory();
                }

                const overrides = await loadOverrides();
                const withOverrides = applyOverridesToClassifications(
                  engineClassifications,
                  overrides.map((o) => {
                    if (o.originalCategory) return o;
                    const orig = engineClassifications.find(
                      (c) =>
                        c.customerId === o.customerId &&
                        (!o.salesProcessId ||
                          c.salesProcessId === o.salesProcessId),
                    );
                    return { ...o, originalCategory: orig?.primaryCategory };
                  }),
                );
                const classifications = withOverrides.map(slimClassification);

                // Ship intelligence KPIs IMMEDIATELY (before disk slim / remarks /
                // leads) so the browser never sticks on stage-only zeros.
                const intelSlim: CrmSnapshot = {
                  ...stageSnap,
                  classifications,
                  callTotal:
                    slimMeta.callCount ??
                    diskCount ??
                    stageSnap.callTotal ??
                    0,
                };
                replaceCachedSnapshot(intelSlim);
                const kpiWire = toOverviewWire(intelSlim, { omitLeads: true });
                snapshot = kpiWire;
                send({
                  ok: true,
                  phase: 'done',
                  result: resultLite,
                  syncMeta: slimMeta,
                  pack: 'overview',
                  snapshotEncoding: null,
                  snapshot: kpiWire,
                  snapshotError: null,
                  light: true,
                  bootstrap: false,
                  stageOnly: false,
                  classified: true,
                });

                // Exact today/exec aggregates from full disk history (best-effort).
                let exactSlim: CrmSnapshot = intelSlim;
                try {
                  exactSlim = offsets?.size
                    ? await awaitWithHeartbeats(
                        send,
                        'classifying',
                        slimSnapshotFromDiskCalls({
                          ...stageSnap,
                          classifications,
                        }),
                      )
                    : slimSnapshotForApi({
                        ...stageSnap,
                        classifications,
                        calls: await loadCalls(),
                      });
                  exactSlim.classifications = classifications;
                  exactSlim.callTotal =
                    slimMeta.callCount ?? diskCount ?? exactSlim.callTotal;
                  replaceCachedSnapshot(exactSlim);
                } catch (aggErr) {
                  console.warn(
                    '[api/crm/sync] call-aggregate upgrade skipped',
                    aggErr,
                  );
                }

                // Remarks after intelligence KPIs are already on the wire.
                try {
                  send({ ok: true, phase: 'merging-remarks', t: Date.now() });
                  const remarks = await awaitWithHeartbeats(
                    send,
                    'merging-remarks',
                    loadPublishedCrmRemarks(),
                  );
                  const stamped = stampRemarksOnProcesses(
                    exactSlim.processes,
                    remarks,
                  );
                  replaceCachedSnapshot(exactSlim);
                  resultLite = {
                    ...resultLite,
                    message: `${resultLite.message} Merged Notes remarks for ${remarks.size.toLocaleString()} customers (${stamped.toLocaleString()} processes).`,
                  };
                } catch (remarkErr) {
                  console.warn(
                    '[api/crm/sync] remarks merge skipped',
                    remarkErr,
                  );
                }

                send({ ok: true, phase: 'packing-leads', t: Date.now() });
                const richWire = toOverviewWire(exactSlim, {
                  omitLeads: false,
                });
                snapshot = richWire;
                send({
                  ok: true,
                  phase: 'done',
                  result: resultLite,
                  syncMeta: slimMeta,
                  pack: 'overview',
                  snapshotEncoding: null,
                  snapshot: richWire,
                  snapshotError: null,
                  light: false,
                  bootstrap: false,
                  stageOnly: false,
                  classified: true,
                });
              } catch (classifyErr) {
                console.warn(
                  '[api/crm/sync] classify upgrade skipped',
                  classifyErr,
                );
              }
            } catch (stageErr) {
              console.error('[api/crm/sync] stage-only bootstrap failed', stageErr);
              snapshotError =
                stageErr instanceof Error
                  ? stageErr.message
                  : 'Stage snapshot failed';
              send({
                ok: false,
                phase: 'error',
                error: snapshotError,
                result: resultLite,
                syncMeta: slimMeta,
              });
            }
            return;
          }

          send({ ok: true, phase: 'building-dashboard', t: Date.now() });

          try {
            const loaded = await awaitWithHeartbeats(
              send,
              'building-dashboard',
              loadSnapshot(),
            );
            const full = packSnapshot(loaded);
            await new Promise((r) => setImmediate(r));
            send({ ok: true, phase: 'packing-dashboard', t: Date.now() });

            const useFull = body.pack === 'full';
            pack = useFull ? 'full' : 'overview';
            snapshotEncoding = 'gzip-base64';

            // 1) Light pack first (no lead rows) so the browser gets KPIs quickly.
            const lightWire = useFull
              ? toCompactWire(full)
              : toOverviewWire(full, { omitLeads: true });
            snapshot = gzipWire(lightWire);
            send({
              ok: true,
              phase: 'done',
              result,
              syncMeta,
              pack,
              snapshotEncoding,
              snapshot,
              snapshotError: null,
              light: true,
            });

            // 2) Best-effort richer pack with lead rows (may OOM on small Vercel plans).
            if (!useFull) {
              await new Promise((r) => setImmediate(r));
              send({ ok: true, phase: 'packing-leads', t: Date.now() });
              try {
                const richWire = toOverviewWire(full, { omitLeads: false });
                const richSnapshot = gzipWire(richWire);
                send({
                  ok: true,
                  phase: 'done',
                  result,
                  syncMeta,
                  pack,
                  snapshotEncoding,
                  snapshot: richSnapshot,
                  snapshotError: null,
                  light: false,
                });
                snapshot = richSnapshot;
              } catch (richErr) {
                console.warn(
                  '[api/crm/sync] rich overview pack skipped',
                  richErr,
                );
              }
            }
          } catch (snapErr) {
            snapshotError =
              snapErr instanceof Error ? snapErr.message : 'Snapshot build failed';
            console.error('[api/crm/sync] snapshot build failed', snapErr);
            send({
              ok: true,
              phase: 'done',
              result,
              syncMeta,
              pack,
              snapshotEncoding,
              snapshot,
              snapshotError,
            });
          }
        } else {
          send({
            ok: true,
            phase: 'done',
            result,
            syncMeta,
            pack,
            snapshotEncoding,
            snapshot,
            snapshotError,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Sync failed';
        console.error('[api/crm/sync]', err);
        try {
          send({ ok: false, phase: 'error', error: message });
        } catch {
          // ignore
        }
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}
