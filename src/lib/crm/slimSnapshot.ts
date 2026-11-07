/**
 * Shrink CRM snapshots for API responses so Vercel/browser don't OOM on large sheets.
 */

import { calendarDateKey, todayCalendarKey } from './dates';
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
  const primaryReason =
    c.reasons?.[c.primaryCategory] || c.recommendedAction || '';
  return {
    customerId: c.customerId,
    salesProcessId: c.salesProcessId,
    currentStage: c.currentStage,
    primaryCategory: c.primaryCategory,
    underlyingFlags: c.underlyingFlags?.length ? c.underlyingFlags : [],
    callDataStatus: c.callDataStatus,
    missingFields: [],
    recommendedAction: primaryReason.slice(0, 160),
    reasons: primaryReason ? { [c.primaryCategory]: primaryReason.slice(0, 160) } : {},
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
  const today = todayCalendarKey();
  const TODAY_CALL_PREVIEW = 60;
  const OTHER_CALL_CAP = 30;

  let todayCallCount = 0;
  const todayByExec = new Map<string, number>();
  const allByExec = new Map<string, number>();
  // Index of last N matches without O(n) shift on every push.
  const todayIdx: number[] = [];
  const otherIdx: number[] = [];

  const calls = snapshot.calls;
  for (let i = 0; i < calls.length; i += 1) {
    const call = calls[i]!;
    const exec = call.callExecutive?.trim() || 'Unassigned';
    allByExec.set(exec, (allByExec.get(exec) ?? 0) + 1);
    const day = calendarDateKey(call.callAt || call.callDate || null);
    if (day === today) {
      todayCallCount += 1;
      todayByExec.set(exec, (todayByExec.get(exec) ?? 0) + 1);
      todayIdx.push(i);
      if (todayIdx.length > TODAY_CALL_PREVIEW) todayIdx.shift();
    } else {
      otherIdx.push(i);
      if (otherIdx.length > OTHER_CALL_CAP) otherIdx.shift();
    }
  }

  const todayPreview = todayIdx.map((i) => slimCall(calls[i]!));
  const otherPreview = otherIdx.map((i) => slimCall(calls[i]!));

  let todayInteractionCount = 0;
  for (const ix of snapshot.interactions) {
    if (calendarDateKey(ix.interactionDate) === today) todayInteractionCount += 1;
  }

  const interactionSeries =
    snapshot.interactionSeries ?? buildInteractionSeries(snapshot.interactions);

  return {
    customers: snapshot.customers.map(slimCustomer),
    processes: snapshot.processes.map(slimProcess),
    interactions: [],
    calls: [...todayPreview, ...otherPreview],
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
    followUps: snapshot.followUps ?? [],
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
    activityDate: today,
    todayCallCount,
    todayInteractionCount,
    todayCallsByExecutive: toExecRows(todayByExec),
    callsByExecutive: toExecRows(allByExec),
  };
}
