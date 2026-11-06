import { NextRequest, NextResponse } from 'next/server';
import { addOverride, loadSnapshot } from '@/lib/crm/store';
import type { IntelligenceCategory } from '@/lib/crm/types';

export const runtime = 'nodejs';

const CATEGORIES: IntelligenceCategory[] = [
  'GONE_DARK',
  'NOT_PICKING_UP',
  'MISMARKED_NI',
  'STUCK',
  'VERY_HIGH_INTENT',
  'HIGH_INTENT',
  'NONE',
];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body?.customerId || !body?.overrideCategory || !body?.reason || !body?.createdBy) {
      return NextResponse.json(
        {
          ok: false,
          error: 'customerId, overrideCategory, reason, and createdBy are required',
        },
        { status: 400 },
      );
    }

    const overrideCategory = String(body.overrideCategory) as IntelligenceCategory;
    if (!CATEGORIES.includes(overrideCategory)) {
      return NextResponse.json(
        { ok: false, error: `Invalid overrideCategory: ${overrideCategory}` },
        { status: 400 },
      );
    }

    const override = await addOverride({
      customerId: String(body.customerId),
      salesProcessId: body.salesProcessId ? String(body.salesProcessId) : undefined,
      overrideCategory,
      reason: String(body.reason),
      createdBy: String(body.createdBy),
      originalCategory: body.originalCategory
        ? (String(body.originalCategory) as IntelligenceCategory)
        : undefined,
    });

    const snapshot = await loadSnapshot();
    return NextResponse.json({ ok: true, override, snapshot });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to add override';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
