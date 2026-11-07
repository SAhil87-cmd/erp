import { gzipSync } from 'zlib';
import { NextRequest, NextResponse } from 'next/server';
import { toCompactWire } from '@/lib/crm/compactWire';
import { applyGlobalFilters } from '@/lib/crm/filters';
import { ensureSeeded } from '@/lib/crm/seed';
import { slimSnapshotForApi } from '@/lib/crm/slimSnapshot';
import type { CrmSnapshot, GlobalFilters } from '@/lib/crm/types';

export const runtime = 'nodejs';
/** Live Google Sheet sync on cold start can exceed default limits. */
export const maxDuration = 300;

function parseFilters(req: NextRequest): GlobalFilters | null {
  const raw = req.nextUrl.searchParams.get('filters');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GlobalFilters;
  } catch {
    return null;
  }
}

function filterSnapshot(snapshot: CrmSnapshot, filters: GlobalFilters): CrmSnapshot {
  const filtered = applyGlobalFilters(snapshot, filters);
  return {
    ...snapshot,
    customers: filtered.customers,
    processes: filtered.processes,
    interactions: filtered.interactions,
    calls: filtered.calls,
    followUps: filtered.followUps,
    classifications: filtered.classifications,
  };
}

export async function GET(req: NextRequest) {
  try {
    const includeAllCalls =
      req.nextUrl.searchParams.get('includeAllCalls') === '1';
    const result = await ensureSeeded(false);
    const filters = parseFilters(req);
    const full = filters ? filterSnapshot(result.snapshot, filters) : result.snapshot;
    const slim = includeAllCalls ? full : slimSnapshotForApi(full);
    const wire = toCompactWire(slim);
    const empty =
      (wire.leads?.length ?? 0) === 0 && (wire.callTotal ?? 0) === 0;

    if (empty) {
      return NextResponse.json({
        ok: true,
        seeded: result.seeded,
        snapshot: wire,
        empty: true,
      });
    }

    const snapshot = gzipSync(Buffer.from(JSON.stringify(wire), 'utf8'), {
      level: 6,
    }).toString('base64');

    return NextResponse.json(
      {
        ok: true,
        seeded: result.seeded,
        snapshotEncoding: 'gzip-base64',
        snapshot,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load snapshot';
    console.error('[api/crm/snapshot]', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
