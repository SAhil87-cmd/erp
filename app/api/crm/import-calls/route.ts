import { NextRequest, NextResponse } from 'next/server';
import { importCallsFromCsv } from '@/lib/crm/runo';
import { loadSnapshot, saveCalls } from '@/lib/crm/store';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: 'Missing file field (multipart CSV)' },
        { status: 400 },
      );
    }

    const text = await file.text();
    const { calls, errors } = importCallsFromCsv(text);
    await saveCalls(calls);
    const snapshot = await loadSnapshot();

    return NextResponse.json({
      ok: true,
      callCount: calls.length,
      errors,
      snapshot,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Call import failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
