import { gzipSync } from 'zlib';
import { NextRequest, NextResponse } from 'next/server';
import {
  computeExecutivePerformance,
  computeOverviewMetrics,
  computeRecoveryMetrics,
} from '@/lib/crm/analytics';
import { toCompactWire } from '@/lib/crm/compactWire';
import { getSyncStatus, syncFromGoogleSheets } from '@/lib/crm/sheets';
import { loadSnapshot } from '@/lib/crm/store';
import type { CrmSnapshot } from '@/lib/crm/types';

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
    leads: [] as typeof wire.leads,
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
        const full = await loadSnapshot();
        const useFull = body.pack === 'full';
        const wire = useFull ? toCompactWire(full) : toOverviewWire(full);
        if (!useFull) {
          delete (wire as { processIdsByInteractionDay?: unknown })
            .processIdsByInteractionDay;
          delete (wire as { processIdsByCallDay?: unknown }).processIdsByCallDay;
        }
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
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      };
      const heartbeat = setInterval(() => {
        try {
          send({ ok: true, phase: 'working', t: Date.now() });
        } catch {
          // stream closed
        }
      }, 5000);

      try {
        send({ ok: true, phase: 'syncing-sheet' });
        const result = await syncFromGoogleSheets({
          mode: body.mode ?? 'published',
        });
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
            const full = await loadSnapshot();
            const useFull = body.pack === 'full';
            const wire = useFull ? toCompactWire(full) : toOverviewWire(full);
            if (!useFull) {
              delete (wire as { processIdsByInteractionDay?: unknown })
                .processIdsByInteractionDay;
              delete (wire as { processIdsByCallDay?: unknown }).processIdsByCallDay;
            }
            pack = useFull ? 'full' : 'overview';
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
        clearInterval(heartbeat);
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
