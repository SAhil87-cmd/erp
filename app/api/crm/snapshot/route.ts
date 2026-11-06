import { NextRequest, NextResponse } from 'next/server';
import { applyGlobalFilters } from '@/lib/crm/filters';
import { ensureSeeded } from '@/lib/crm/seed';
import type { CallRecord, CrmSnapshot, GlobalFilters } from '@/lib/crm/types';

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

/**
 * Full call arrays (~50k+) freeze the browser and hang JSON serialization.
 * Keep a small sample for today's activity; load per-customer calls via /api/crm/calls.
 */
function slimSnapshot(snapshot: CrmSnapshot): CrmSnapshot & {
  callTotal: number;
  callsTruncated: boolean;
} {
  const CALL_CAP = 500;
  const truncated = snapshot.calls.length > CALL_CAP;
  const calls: CallRecord[] = truncated
    ? [...snapshot.calls]
        .sort((a, b) => b.callAt.localeCompare(a.callAt))
        .slice(0, CALL_CAP)
    : snapshot.calls;

  return {
    ...snapshot,
    calls,
    callTotal: snapshot.calls.length,
    callsTruncated: truncated,
  };
}

export async function GET(req: NextRequest) {
  try {
    const includeAllCalls =
      req.nextUrl.searchParams.get('includeAllCalls') === '1';
    const result = await ensureSeeded(false);
    const filters = parseFilters(req);
    const full = filters ? filterSnapshot(result.snapshot, filters) : result.snapshot;
    const snapshot = includeAllCalls ? full : slimSnapshot(full);

    return NextResponse.json({
      ok: true,
      seeded: result.seeded,
      snapshot,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load snapshot';
    console.error('[api/crm/snapshot]', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
