/**
 * Build compact day → processId indexes so date filters work after
 * interactions/calls arrays are stripped from the API snapshot.
 */

import { calendarDateKey, isCalendarKeyInRange } from './dates';
import type { CallRecord, GlobalFilters, Interaction } from './types';

const MAX_DAYS = 45;
const MAX_IDS_PER_DAY = 2500;

function trimRecentDays(
  map: Map<string, Set<string>>,
): Record<string, string[]> {
  const days = [...map.keys()].sort((a, b) => a.localeCompare(b)).slice(-MAX_DAYS);
  const out: Record<string, string[]> = {};
  for (const day of days) {
    const ids = [...(map.get(day) ?? [])];
    out[day] = ids.length > MAX_IDS_PER_DAY ? ids.slice(0, MAX_IDS_PER_DAY) : ids;
  }
  return out;
}

export function buildProcessIdsByInteractionDay(
  interactions: Interaction[],
): Record<string, string[]> {
  const map = new Map<string, Set<string>>();
  for (const ix of interactions) {
    const day = calendarDateKey(ix.interactionDate);
    if (!day || !ix.salesProcessId) continue;
    let set = map.get(day);
    if (!set) {
      set = new Set();
      map.set(day, set);
    }
    set.add(ix.salesProcessId);
  }
  return trimRecentDays(map);
}

export function buildProcessIdsByCallDay(
  calls: CallRecord[],
): Record<string, string[]> {
  const map = new Map<string, Set<string>>();
  for (const call of calls) {
    const day = calendarDateKey(call.callAt || call.callDate || null);
    if (!day) continue;
    const id = call.salesProcessId || `customer:${call.customerId}`;
    if (!id) continue;
    let set = map.get(day);
    if (!set) {
      set = new Set();
      map.set(day, set);
    }
    set.add(id);
  }
  return trimRecentDays(map);
}

/** Process ids active on any day inside the inclusive filter range. */
export function processIdsMatchingDateRange(
  byDay: Record<string, string[]> | undefined,
  filters: Pick<GlobalFilters, 'dateFrom' | 'dateTo'>,
): Set<string> | null {
  if (!byDay) return null;
  if (!filters.dateFrom && !filters.dateTo) return null;
  const matched = new Set<string>();
  for (const [day, ids] of Object.entries(byDay)) {
    if (!isCalendarKeyInRange(day, filters.dateFrom, filters.dateTo)) continue;
    for (const id of ids) matched.add(id);
  }
  return matched;
}

export function sumCallsInDateRange(
  days:
    | Array<{ date: string; total: number }>
    | undefined,
  filters: Pick<GlobalFilters, 'dateFrom' | 'dateTo'>,
): number | null {
  if (!days?.length) return null;
  if (!filters.dateFrom && !filters.dateTo) return null;
  let sum = 0;
  let any = false;
  for (const d of days) {
    if (!isCalendarKeyInRange(d.date, filters.dateFrom, filters.dateTo)) continue;
    sum += d.total;
    any = true;
  }
  return any ? sum : 0;
}

export function sumInteractionsInDateRange(
  daily: Array<{ name: string; value: number }> | undefined,
  filters: Pick<GlobalFilters, 'dateFrom' | 'dateTo'>,
  yearHint?: string,
): number | null {
  if (!daily?.length) return null;
  if (!filters.dateFrom && !filters.dateTo) return null;
  // daily names are MM-DD; reconstruct YYYY-MM-DD using from/to year when possible.
  const year =
    (filters.dateFrom ?? filters.dateTo ?? yearHint ?? '').slice(0, 4) ||
    String(new Date().getFullYear());
  let sum = 0;
  let any = false;
  for (const d of daily) {
    const key = d.name.includes('-') && d.name.length === 5 ? `${year}-${d.name}` : d.name;
    if (!isCalendarKeyInRange(key, filters.dateFrom, filters.dateTo)) continue;
    sum += d.value;
    any = true;
  }
  return any ? sum : 0;
}
