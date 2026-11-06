import { NextRequest, NextResponse } from 'next/server';
import { getSyncStatus, syncFromGoogleSheets } from '@/lib/crm/sheets';

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

    return NextResponse.json({
      ok: true,
      result,
      syncMeta,
      snapshot: result.snapshot ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
