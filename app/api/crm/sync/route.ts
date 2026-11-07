import { gzipSync } from 'zlib';
import { NextRequest, NextResponse } from 'next/server';
import { toCompactWire } from '@/lib/crm/compactWire';
import { getSyncStatus, syncFromGoogleSheets } from '@/lib/crm/sheets';
import { loadSnapshot } from '@/lib/crm/store';

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

    let snapshot: string | null = null;
    let snapshotEncoding: 'gzip-base64' | null = null;
    let snapshotError: string | null = null;

    if (body.includeSnapshot !== false) {
      try {
        // Compact wire gzipped+base64 inside normal JSON.
        // - Raw multi-MB JSON stalls on Vercel
        // - application/octet-stream gzip breaks browser fetch ("Failed to fetch")
        const wire = toCompactWire(await loadSnapshot());
        const wireJson = JSON.stringify(wire, jsonReplacer);
        snapshot = gzipSync(Buffer.from(wireJson, 'utf8'), { level: 6 }).toString(
          'base64',
        );
        snapshotEncoding = 'gzip-base64';
      } catch (snapErr) {
        snapshotError =
          snapErr instanceof Error ? snapErr.message : 'Snapshot build failed';
        console.error('[api/crm/sync] snapshot build failed after sync', snapErr);
      }
    }

    return NextResponse.json(
      {
        ok: true,
        result,
        syncMeta,
        snapshotEncoding,
        snapshot,
        snapshotError,
      },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed';
    console.error('[api/crm/sync]', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
