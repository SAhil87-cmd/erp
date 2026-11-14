/**
 * Shrink CRM snapshots for API responses so Vercel/browser don't OOM on large sheets.
 */

import { calendarDateKey, todayCalendarKey } from './dates';
import {
  buildProcessIdsByCallDay,
  buildProcessIdsByInteractionDay,
} from './dateIndex';
import type {
  CallRecord,
  ClassificationResult,
  CrmSnapshot,
  Customer,
  Interaction,
  SalesProcess,
} from './types';

function toExecRows(
  map: Map<string, number>,
): Array<{ executiveName: string; callCount: number }> {
  return [...map.entries()]
    .map(([executiveName, callCount]) => ({ executiveName, callCount }))
    .sort(
      (a, b) =>
        b.callCount - a.callCount ||
        a.executiveName.localeCompare(b.executiveName),
    );
}

export function buildInteractionSeries(interactions: Interaction[]): {
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

export function slimClassification(c: ClassificationResult): ClassificationResult {
  // Reasons/actions are reconstructed on the client from primaryCategory labels.
  // Omitting them here cuts ~2MB off the sync payload.
  return {
    customerId: c.customerId,
    salesProcessId: c.salesProcessId,
    currentStage: c.currentStage,
    primaryCategory: c.primaryCategory,
    underlyingFlags: c.underlyingFlags?.length ? c.underlyingFlags : [],
    callDataStatus: c.callDataStatus,
    missingFields: [],
    recommendedAction: '',
    reasons: {},
    evidence: {},
    ruleResults: {},
  };
}

export function slimCustomer(c: Customer): Customer {
  return {
    customerId: c.customerId,
    name: c.name,
    mobileNum: c.mobileNum,
    email: undefined,
    companyName: c.companyName || c.firmName,
    city: c.city,
    matchedByPhone: c.matchedByPhone,
    unmatched: c.unmatched,
    dataQualityFlags: [],
    salesProcessIds: [],
    interactionIds: [],
    callRecordIds: [],
  };
}

export function slimProcess(p: SalesProcess): SalesProcess {
  return {
    salesProcessId: p.salesProcessId,
    customerId: p.customerId,
    processName: p.processName,
    currentStage: p.currentStage,
    currentStageRaw: '',
    stageEnteredAt: p.stageEnteredAt,
    projectName: p.projectName,
    assignedTo: p.assignedTo,
    source: p.source,
    interactionIds: [],
    stageHistory: [],
    remark: p.remark,
    callStats: p.callStats,
  };
}

function slimCall(c: CallRecord): CallRecord {
  return {
    callRecordId: c.callRecordId,
    customerId: c.customerId,
    callAt: c.callAt,
    callDate: c.callDate,
    answered: c.answered,
    callOutcome: c.callOutcome,
    durationSeconds: c.durationSeconds,
    callExecutive: c.callExecutive,
    salesProcessId: c.salesProcessId,
    salesProcessName: c.salesProcessName,
  } as CallRecord;
}

/**
 * Build a browser-safe snapshot from the full in-memory model.
 * `calls` must be the full call list (used for aggregates); it is not retained.
 */
export function slimSnapshotForApi(snapshot: CrmSnapshot): CrmSnapshot {
  const calendarToday = todayCalendarKey();
  const TODAY_CALL_PREVIEW = 60;
  const OTHER_CALL_CAP = 30;
  const DAY_HISTORY = 14;

  const allByExec = new Map<string, number>();
  const byDayExec = new Map<string, Map<string, number>>();
  const lastCallByProcess = new Map<string, string>();
  const lastCallByCustomer = new Map<string, string>();
  let latestCallDay: string | null = null;

  const calls = snapshot.calls;
  for (let i = 0; i < calls.length; i += 1) {
    const call = calls[i]!;
    const exec = call.callExecutive?.trim() || 'Unassigned';
    allByExec.set(exec, (allByExec.get(exec) ?? 0) + 1);
    const day = calendarDateKey(call.callAt || call.callDate || null);
    if (!day) continue;
    if (!latestCallDay || day > latestCallDay) latestCallDay = day;

    let dayMap = byDayExec.get(day);
    if (!dayMap) {
      dayMap = new Map();
      byDayExec.set(day, dayMap);
    }
    dayMap.set(exec, (dayMap.get(exec) ?? 0) + 1);

    if (call.salesProcessId) {
      const prev = lastCallByProcess.get(call.salesProcessId);
      if (!prev || day > prev) lastCallByProcess.set(call.salesProcessId, day);
    }
    if (call.customerId) {
      const prev = lastCallByCustomer.get(call.customerId);
      if (!prev || day > prev) lastCallByCustomer.set(call.customerId, day);
    }
  }

  // If the published sheet has no rows for calendar-today, show the latest day
  // that does — otherwise every exec "calls today" KPI stays stuck at 0.
  const activityDate =
    (byDayExec.get(calendarToday)?.size ?? 0) > 0
      ? calendarToday
      : (latestCallDay ?? calendarToday);
  const activityDateIsFallback = activityDate !== calendarToday;

  const activityByExec = byDayExec.get(activityDate) ?? new Map<string, number>();
  let todayCallCount = 0;
  for (const n of activityByExec.values()) todayCallCount += n;

  const activityIdx: number[] = [];
  const otherIdx: number[] = [];
  for (let i = 0; i < calls.length; i += 1) {
    const call = calls[i]!;
    const day = calendarDateKey(call.callAt || call.callDate || null);
    if (day === activityDate) {
      activityIdx.push(i);
      if (activityIdx.length > TODAY_CALL_PREVIEW) activityIdx.shift();
    } else {
      otherIdx.push(i);
      if (otherIdx.length > OTHER_CALL_CAP) otherIdx.shift();
    }
  }

  const lastIxByProcess = new Map<string, string>();
  let todayInteractionCount = 0;
  for (const ix of snapshot.interactions) {
    const key = calendarDateKey(ix.interactionDate);
    if (!key) continue;
    if (key === activityDate) todayInteractionCount += 1;
    const prev = lastIxByProcess.get(ix.salesProcessId);
    if (!prev || key > prev) lastIxByProcess.set(ix.salesProcessId, key);
  }

  const interactionSeries =
    snapshot.interactionSeries ?? buildInteractionSeries(snapshot.interactions);

  const callsByDayByExecutive = [...byDayExec.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-DAY_HISTORY)
    .map(([date, execMap]) => {
      const byExecutive = toExecRows(execMap);
      return {
        date,
        total: byExecutive.reduce((sum, r) => sum + r.callCount, 0),
        byExecutive,
      };
    });

  // When interactions were already dropped (Vercel), recover the activity-day
  // interaction count from the pre-built series.
  if (todayInteractionCount === 0 && interactionSeries?.daily?.length) {
    const needle = activityDate.slice(5);
    const hit = interactionSeries.daily.find((d) => d.name === needle);
    if (hit) todayInteractionCount = hit.value;
  }

  const processes = snapshot.processes.map((p) => ({
    ...slimProcess(p),
    lastInteractionDate:
      p.lastInteractionDate ??
      lastIxByProcess.get(p.salesProcessId) ??
      calendarDateKey(p.stageEnteredAt),
    lastCallDate:
      lastCallByProcess.get(p.salesProcessId) ??
      lastCallByCustomer.get(p.customerId) ??
      null,
    remark: p.remark,
  }));

  return {
    customers: snapshot.customers.map(slimCustomer),
    processes,
    interactions: [],
    calls: [
      ...activityIdx.map((i) => slimCall(calls[i]!)),
      ...otherIdx.map((i) => slimCall(calls[i]!)),
    ],
    projects: (snapshot.projects ?? []).map((p) => ({
      projectName: p.projectName,
      customerIds: [],
      processIds: [],
    })),
    executives: (snapshot.executives ?? []).map((e) => ({
      executiveName: e.executiveName,
      customerIds: [],
      processIds: [],
    })),
    followUps: (snapshot.followUps ?? []).filter((fu) => {
      const terminal =
        fu.currentStage === 'Sales Closed' ||
        fu.currentStage === 'Spam' ||
        fu.currentStage === 'DND';
      if (terminal && !fu.nextFollowUpDate && !fu.revisitDate) return false;
      return true;
    }),
    classifications: snapshot.classifications.map(slimClassification),
    reviews: snapshot.reviews ?? [],
    overrides: snapshot.overrides ?? [],
    dataHealth: {
      totalRows: snapshot.dataHealth?.totalRows ?? 0,
      validCustomers: snapshot.dataHealth?.validCustomers ?? 0,
      unmatchedRows: snapshot.dataHealth?.unmatchedRows ?? 0,
      duplicateCustomerIds: (snapshot.dataHealth?.duplicateCustomerIds ?? []).slice(
        0,
        10,
      ),
      duplicatePhones: (snapshot.dataHealth?.duplicatePhones ?? []).slice(0, 10),
      missingCustomerIds: snapshot.dataHealth?.missingCustomerIds ?? 0,
      missingPhones: snapshot.dataHealth?.missingPhones ?? 0,
      issues: (snapshot.dataHealth?.issues ?? []).slice(0, 10),
    },
    syncMeta: snapshot.syncMeta,
    builtAt: snapshot.builtAt,
    callTotal: snapshot.callTotal ?? snapshot.calls.length,
    callsTruncated: true,
    interactionTotal:
      snapshot.interactionTotal ?? snapshot.interactions.length,
    interactionsTruncated: true,
    interactionSeries,
    activityDate,
    activityDateIsFallback,
    todayCallCount,
    todayInteractionCount,
    todayCallsByExecutive: toExecRows(activityByExec),
    callsByExecutive: toExecRows(allByExec),
    callsByDayByExecutive,
    processIdsByInteractionDay:
      snapshot.processIdsByInteractionDay ??
      buildProcessIdsByInteractionDay(snapshot.interactions ?? []),
    processIdsByCallDay: buildProcessIdsByCallDay(calls),
  };
}
