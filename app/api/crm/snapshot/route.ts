import { NextRequest, NextResponse } from 'next/server';
import { calendarDateKey, todayCalendarKey } from '@/lib/crm/dates';
import { applyGlobalFilters } from '@/lib/crm/filters';
import { ensureSeeded } from '@/lib/crm/seed';
import type {
  CallRecord,
  CrmSnapshot,
  GlobalFilters,
  Interaction,
} from '@/lib/crm/types';

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

function buildInteractionSeries(
  interactions: Interaction[],
): { daily: Array<{ name: string; value: number }>; monthly: Array<{ name: string; value: number }> } {
  const dailyMap = new Map<string, number>();
  for (const ix of interactions) {
    const key = calendarDateKey(ix.interactionDate);
    if (!key) continue;
    dailyMap.set(key, (dailyMap.get(key) ?? 0) + 1);
  }
  const daily = [...dailyMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-30)
    .map(([name, value]) => ({ name: name.slice(5), value }));

  const monthlyMap = new Map<string, number>();
  for (const [key, value] of dailyMap) {
    const month = key.slice(0, 7);
    monthlyMap.set(month, (monthlyMap.get(month) ?? 0) + value);
  }
  const monthly = [...monthlyMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, value]) => ({ name, value }));

  return { daily, monthly };
}

function countCallsByExecutive(
  calls: CallRecord[],
): Array<{ executiveName: string; callCount: number }> {
  const map = new Map<string, number>();
  for (const call of calls) {
    const name = call.callExecutive?.trim() || 'Unassigned';
    map.set(name, (map.get(name) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([executiveName, callCount]) => ({ executiveName, callCount }))
    .sort((a, b) => b.callCount - a.callCount || a.executiveName.localeCompare(b.executiveName));
}

/**
 * Full call/interaction arrays (~50k+) hang JSON serialization on Vercel and
 * freeze the browser. Keep ALL of today's calls + a recent sample; KPIs use
 * pre-aggregated totals from the full store.
 */
function slimSnapshot(snapshot: CrmSnapshot): CrmSnapshot {
  const today = todayCalendarKey();
  const OTHER_CAP = 300;

  const todayCalls: CallRecord[] = [];
  const otherCalls: CallRecord[] = [];
  for (const call of snapshot.calls) {
    const day = calendarDateKey(call.callAt || call.callDate || null);
    if (day === today) todayCalls.push(call);
    else otherCalls.push(call);
  }

  todayCalls.sort((a, b) => b.callAt.localeCompare(a.callAt));
  otherCalls.sort((a, b) => b.callAt.localeCompare(a.callAt));

  const calls = [...todayCalls, ...otherCalls.slice(0, OTHER_CAP)];
  const callsTruncated = calls.length < snapshot.calls.length;

  const todayInteractions = snapshot.interactions.filter(
    (ix) => calendarDateKey(ix.interactionDate) === today,
  );

  const interactionSeries = buildInteractionSeries(snapshot.interactions);

  // Keep only the latest interaction per sales process for payload size.
  const latestByProcess = new Map<string, Interaction>();
  for (const ix of snapshot.interactions) {
    const key = ix.salesProcessId || ix.interactionId;
    const prev = latestByProcess.get(key);
    const ixAt = ix.interactionDate || '';
    const prevAt = prev?.interactionDate || '';
    if (!prev || ixAt >= prevAt) latestByProcess.set(key, ix);
  }
  const interactions = [...latestByProcess.values()];
  const interactionsTruncated =
    interactions.length < snapshot.interactions.length;

  return {
    ...snapshot,
    calls,
    interactions,
    callTotal: snapshot.calls.length,
    callsTruncated,
    interactionTotal: snapshot.interactions.length,
    interactionsTruncated,
    interactionSeries,
    activityDate: today,
    todayCallCount: todayCalls.length,
    todayInteractionCount: todayInteractions.length,
    todayCallsByExecutive: countCallsByExecutive(todayCalls),
    callsByExecutive: countCallsByExecutive(snapshot.calls),
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
