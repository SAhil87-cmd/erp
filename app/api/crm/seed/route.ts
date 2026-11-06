import { NextResponse } from 'next/server';
import { seedFromSynthetic } from '@/lib/crm/seed';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const result = await seedFromSynthetic();
    return NextResponse.json({
      ok: true,
      seeded: result.seeded,
      rowCount: result.rowCount,
      callCount: result.callCount,
      message: result.message,
      snapshot: result.snapshot,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Seed failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
