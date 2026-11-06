import { NextRequest, NextResponse } from 'next/server';
import { loadCallsForCustomer } from '@/lib/crm/store';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const customerId = req.nextUrl.searchParams.get('customerId')?.trim();
    if (!customerId) {
      return NextResponse.json(
        { ok: false, error: 'customerId query param required' },
        { status: 400 },
      );
    }
    const calls = await loadCallsForCustomer(customerId);
    return NextResponse.json({ ok: true, customerId, calls, count: calls.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load calls';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
