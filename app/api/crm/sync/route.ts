import { NextRequest, NextResponse } from 'next/server';
import { getSyncStatus, syncFromGoogleSheets } from '@/lib/crm/sheets';
import { slimSnapshotForApi } from '@/lib/crm/slimSnapshot';
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

    // Return slim snapshot from THIS serverless instance so the client does not
    // hit a different empty instance after sync.
    const includeSnapshot = body.includeSnapshot !== false;
    const snapshot = includeSnapshot
      ? slimSnapshotForApi(await loadSnapshot())
      : null;

    return NextResponse.json({
      ok: true,
      result,
      syncMeta,
      snapshot,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed';
    console.error('[api/crm/sync]', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
