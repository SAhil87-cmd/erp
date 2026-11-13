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

function toOverviewWire(snapshot: CrmSnapshot) {
  const wire = toCompactWire(snapshot);
  return {
    ...wire,
    pack: 'overview' as const,
    // Keep compact leads + day indexes so date filters can recompute KPIs client-side.
    // Only trim bulky call/follow-up previews; metrics still use callTotal / series.
    followUps: [] as typeof wire.followUps,
    calls: wire.calls?.slice(0, 40) ?? [],
    overviewMetrics: computeOverviewMetrics(snapshot),
    recoveryMetrics: computeRecoveryMetrics(snapshot.classifications),
    executivePerformance: computeExecutivePerformance(snapshot),
  };
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
        const wire = useFull ? toCompactWire(full) : toOverviewWire(full);
        pack = useFull ? 'full' : 'overview';
        snapshot = gzipSync(
          Buffer.from(JSON.stringify(wire, jsonReplacer), 'utf8'),
          { level: 6 },
        ).toString('base64');
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

        send({ ok: true, phase: 'building-dashboard', syncMeta });

        let snapshot: string | null = null;
        let snapshotEncoding: 'gzip-base64' | null = null;
        let snapshotError: string | null = null;
        let pack: 'overview' | 'full' | null = null;

        if (body.includeSnapshot !== false) {
          try {
            const loaded = await awaitWithHeartbeats(
              send,
              'building-dashboard',
              loadSnapshot(),
            );
            const full = packSnapshot(loaded);
            // Yield so a heartbeat can flush before heavy JSON/gzip work.
            await new Promise((r) => setImmediate(r));
            send({ ok: true, phase: 'packing-dashboard', t: Date.now() });
            const useFull = body.pack === 'full';
            const wire = useFull ? toCompactWire(full) : toOverviewWire(full);
            pack = useFull ? 'full' : 'overview';
            await new Promise((r) => setImmediate(r));
            snapshot = gzipSync(
              Buffer.from(JSON.stringify(wire, jsonReplacer), 'utf8'),
              { level: 6 },
            ).toString('base64');
            snapshotEncoding = 'gzip-base64';
          } catch (snapErr) {
            snapshotError =
              snapErr instanceof Error ? snapErr.message : 'Snapshot build failed';
            console.error('[api/crm/sync] snapshot build failed', snapErr);
          }
        }

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
