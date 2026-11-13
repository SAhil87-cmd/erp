import { gzipSync } from 'zlib';
import { NextRequest, NextResponse } from 'next/server';
import {
  computeExecutivePerformance,
  computeOverviewMetrics,
  computeRecoveryMetrics,
} from '@/lib/crm/analytics';
import { toCompactWire } from '@/lib/crm/compactWire';
import { getSyncStatus, syncFromGoogleSheets } from '@/lib/crm/sheets';
import { slimSnapshotForApi } from '@/lib/crm/slimSnapshot';
import { loadSnapshot } from '@/lib/crm/store';
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
        const full = packSnapshot(await loadSnapshot());
        const useFull = body.pack === 'full';
        // Non-stream path: prefer light overview on Vercel to avoid OOM/timeouts.
        const omitLeads =
          !useFull && process.env.VERCEL === '1';
        const wire = useFull
          ? toCompactWire(full)
          : toOverviewWire(full, { omitLeads });
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
        const result = await awaitWithHeartbeats(
          send,
          'syncing-sheet',
          syncFromGoogleSheets({ mode: body.mode ?? 'published' }),
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

        let snapshot: string | null = null;
        let snapshotEncoding: 'gzip-base64' | null = null;
        let snapshotError: string | null = null;
        let pack: 'overview' | 'full' | null = null;

        if (body.includeSnapshot !== false) {
          // Bootstrap FIRST and yield so Vercel can flush bytes to the browser
          // before classify/loadSnapshot burns CPU/memory and resets the socket.
          try {
            const callTotal =
              result.callCount ??
              (syncMeta as { callCount?: number }).callCount ??
              0;
            const rowTotal =
              result.rowCount ??
              (syncMeta as { rowCount?: number }).rowCount ??
              0;
            const slimMeta = {
              lastSyncAt: (syncMeta as { lastSyncAt?: string }).lastSyncAt,
              lastImportAt: (syncMeta as { lastImportAt?: string }).lastImportAt,
              source: (syncMeta as { source?: string }).source,
              status: (syncMeta as { status?: string }).status,
              rowCount: rowTotal,
              callCount: callTotal,
              latestDataAt: (syncMeta as { latestDataAt?: string | null })
                .latestDataAt,
            };
            const bootWire = {
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
            snapshot = gzipWire(bootWire);
            snapshotEncoding = 'gzip-base64';
            pack = 'overview';
            send({
              ok: true,
              phase: 'done',
              result: {
                status: result.status,
                message: result.message,
                rowCount: rowTotal,
                callCount: callTotal,
              },
              syncMeta: slimMeta,
              pack,
              snapshotEncoding,
              snapshot,
              snapshotError: null,
              light: true,
              bootstrap: true,
            });
            // Critical: let the runtime flush NDJSON to the client before heavy work.
            await new Promise((r) => setTimeout(r, 500));
          } catch (bootErr) {
            console.warn('[api/crm/sync] bootstrap pack skipped', bootErr);
          }

          // On Vercel, stop after bootstrap — full classify/snapshot OOMs and
          // resets the socket (browser shows Network error). Localhost still
          // upgrades to the full intelligence pack below.
          if (process.env.VERCEL === '1' && snapshot) {
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
