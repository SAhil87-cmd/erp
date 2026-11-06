import { NextRequest, NextResponse } from 'next/server';
import { addReview, loadSnapshot } from '@/lib/crm/store';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body?.customerId || !body?.reviewer || !body?.note) {
      return NextResponse.json(
        { ok: false, error: 'customerId, reviewer, and note are required' },
        { status: 400 },
      );
    }

    const review = await addReview({
      customerId: String(body.customerId),
      salesProcessId: body.salesProcessId ? String(body.salesProcessId) : undefined,
      reviewer: String(body.reviewer),
      note: String(body.note),
      disposition: body.disposition ? String(body.disposition) : undefined,
    });

    const snapshot = await loadSnapshot();
    return NextResponse.json({ ok: true, review, snapshot });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to add review';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
