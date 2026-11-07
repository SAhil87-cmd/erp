import { NextRequest, NextResponse } from 'next/server';
import { toCompactWire } from '@/lib/crm/compactWire';
import { getSyncStatus, syncFromGoogleSheets } from '@/lib/crm/sheets';
import { loadSnapshot } from '@/lib/crm/store';

export const runtime = 'nodejs';
/** Published call sheet is ~10MB / 50k+ rows. */
export const maxDuration = 300;

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
  try {
    const body = (await req.json().catch(() => ({}))) as {
      mode?: 'published' | 'api';
      includeSnapshot?: boolean;
    };
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

    // Always try to return a slim snapshot from THIS instance. Without it the
    // next GET /snapshot often hits a different empty Vercel instance (all zeros).
    let snapshot: unknown = null;
    let snapshotError: string | null = null;
    if (body.includeSnapshot !== false) {
      try {
        // Compact wire — full CrmSnapshot JSON (~10MB) crashes browser tabs.
        // Let the platform gzip; manual Content-Encoding: gzip breaks some browsers
        // when the CDN compresses again ("Failed to fetch").
        snapshot = toCompactWire(await loadSnapshot());
      } catch (snapErr) {
        snapshotError =
          snapErr instanceof Error ? snapErr.message : 'Snapshot build failed';
        console.error('[api/crm/sync] snapshot build failed after sync', snapErr);
      }
    }

    const payload = {
      ok: true as const,
      result,
      syncMeta,
      snapshot,
      snapshotError,
    };
    const json = JSON.stringify(payload, (_key, value) => {
      if (value == null) return undefined;
      if (value === '') return undefined;
      if (
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.keys(value as object).length === 0
      ) {
        return undefined;
      }
      return value;
    });
    return new NextResponse(json, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed';
    console.error('[api/crm/sync]', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
