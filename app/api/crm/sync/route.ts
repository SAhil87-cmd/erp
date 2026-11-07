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
/** Published call sheet is ~10MB / 50k+ rows. */
export const maxDuration = 300;

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
  // Drop the 10k lead rows — they make the browser fetch die on long TTFB/large body.
  // Overview KPIs are precomputed below and attached after hydrate.
  return {
    ...wire,
    pack: 'overview' as const,
    leads: [] as typeof wire.leads,
    followUps: [] as typeof wire.followUps,
    calls: wire.calls?.slice(0, 40) ?? [],
    // Keep day indexes for date filters; omit huge process id lists if enormous.
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
    /** overview = small boot pack (default). full = include all leads. */
    pack?: 'overview' | 'full';
  };

  // Stream whitespace keepalives so browsers/proxies do not kill the connection
  // during the 30–90s sheet sync + classify (that surfaces as "Failed to fetch").
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();

  void (async () => {
    const heartbeat = setInterval(() => {
      void writer.write(encoder.encode(' '));
    }, 4000);
    try {
      const result = await syncFromGoogleSheets({
        mode: body.mode ?? 'published',
      });
      const syncMeta = await getSyncStatus();

      if (result.status === 'error') {
        await writer.write(
          encoder.encode(
            JSON.stringify({
              ok: false,
              error: result.message,
              result,
              syncMeta,
            }),
          ),
        );
        return;
      }

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
            // Overview boot does not need day→processId maps (keeps payload tiny).
            delete (wire as { processIdsByInteractionDay?: unknown })
              .processIdsByInteractionDay;
            delete (wire as { processIdsByCallDay?: unknown }).processIdsByCallDay;
          }
          pack = useFull ? 'full' : 'overview';
          const wireJson = JSON.stringify(wire, jsonReplacer);
          snapshot = gzipSync(Buffer.from(wireJson, 'utf8'), {
            level: 6,
          }).toString('base64');
          snapshotEncoding = 'gzip-base64';
        } catch (snapErr) {
          snapshotError =
            snapErr instanceof Error ? snapErr.message : 'Snapshot build failed';
          console.error('[api/crm/sync] snapshot build failed after sync', snapErr);
        }
      }

      await writer.write(
        encoder.encode(
          JSON.stringify({
            ok: true,
            result,
            syncMeta,
            pack,
            snapshotEncoding,
            snapshot,
            snapshotError,
          }),
        ),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sync failed';
      console.error('[api/crm/sync]', err);
      try {
        await writer.write(
          encoder.encode(JSON.stringify({ ok: false, error: message })),
        );
      } catch {
        // ignore write failures after abort
      }
    } finally {
      clearInterval(heartbeat);
      try {
        await writer.close();
      } catch {
        // ignore
      }
    }
  })();

  return new NextResponse(stream.readable, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}
