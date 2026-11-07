/**
 * Shrink CRM snapshots for API responses so Vercel/browser don't hang on 40–90MB JSON.
 */

import { calendarDateKey, todayCalendarKey } from './dates';
import type {
  CallRecord,
  ClassificationResult,
  CrmSnapshot,
  Interaction,
} from './types';

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
    .sort(
      (a, b) =>
        b.callCount - a.callCount ||
        a.executiveName.localeCompare(b.executiveName),
    );
}

function buildInteractionSeries(interactions: Interaction[]): {
  daily: Array<{ name: string; value: number }>;
  monthly: Array<{ name: string; value: number }>;
} {
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

function slimClassification(c: ClassificationResult): ClassificationResult {
  const primaryReason =
    c.reasons?.[c.primaryCategory] || c.recommendedAction || '';
  return {
    customerId: c.customerId,
    salesProcessId: c.salesProcessId,
    currentStage: c.currentStage,
    primaryCategory: c.primaryCategory,
    underlyingFlags: c.underlyingFlags,
    callDataStatus: c.callDataStatus,
    missingFields: c.missingFields?.length ? c.missingFields : [],
    recommendedAction: c.recommendedAction,
    reasons: primaryReason ? { [c.primaryCategory]: primaryReason } : {},
    evidence: {},
    ruleResults: {},
  };
}

function slimInteraction(ix: Interaction): Interaction {
  const { raw: _raw, ...rest } = ix;
  return { ...rest, raw: {} };
}

/**
 * Build a browser-safe snapshot from the full in-memory model.
 */
export function slimSnapshotForApi(snapshot: CrmSnapshot): CrmSnapshot {
  const today = todayCalendarKey();
  const TODAY_CALL_PREVIEW = 120;
  const OTHER_CALL_CAP = 180;

  const todayCalls: CallRecord[] = [];
  const otherCalls: CallRecord[] = [];
  for (const call of snapshot.calls) {
    const day = calendarDateKey(call.callAt || call.callDate || null);
    if (day === today) todayCalls.push(call);
    else otherCalls.push(call);
  }
  todayCalls.sort((a, b) => b.callAt.localeCompare(a.callAt));
  otherCalls.sort((a, b) => b.callAt.localeCompare(a.callAt));

  const calls = [
    ...todayCalls.slice(0, TODAY_CALL_PREVIEW),
    ...otherCalls.slice(0, OTHER_CALL_CAP),
  ];

  const todayInteractions = snapshot.interactions.filter(
    (ix) => calendarDateKey(ix.interactionDate) === today,
  );

  const latestByProcess = new Map<string, Interaction>();
  for (const ix of snapshot.interactions) {
    const key = ix.salesProcessId || ix.interactionId;
    const prev = latestByProcess.get(key);
    const ixAt = ix.interactionDate || '';
    const prevAt = prev?.interactionDate || '';
    if (!prev || ixAt >= prevAt) latestByProcess.set(key, ix);
  }

  return {
    ...snapshot,
    customers: snapshot.customers.map((c) => ({
      ...c,
      // Drop large id arrays from the wire payload.
      interactionIds: [],
      callRecordIds: [],
    })),
    processes: snapshot.processes.map((p) => ({
      ...p,
      interactionIds: [],
      stageHistory: p.stageHistory?.slice(-3) ?? [],
    })),
    interactions: [...latestByProcess.values()].map(slimInteraction),
    calls,
    classifications: snapshot.classifications.map(slimClassification),
    callTotal: snapshot.calls.length,
    callsTruncated: calls.length < snapshot.calls.length,
    interactionTotal: snapshot.interactions.length,
    interactionsTruncated: true,
    interactionSeries: buildInteractionSeries(snapshot.interactions),
    activityDate: today,
    todayCallCount: todayCalls.length,
    todayInteractionCount: todayInteractions.length,
    todayCallsByExecutive: countCallsByExecutive(todayCalls),
    callsByExecutive: countCallsByExecutive(snapshot.calls),
  };
}
