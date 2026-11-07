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
    underlyingFlags: c.underlyingFlags ?? [],
    callDataStatus: c.callDataStatus,
    missingFields: c.missingFields?.length ? c.missingFields : [],
    recommendedAction: c.recommendedAction,
    reasons: primaryReason ? { [c.primaryCategory]: primaryReason } : {},
    evidence: {},
    ruleResults: {},
  };
}

function slimCustomer(c: Customer): Customer {
  return {
    customerId: c.customerId,
    name: c.name,
    mobileNum: c.mobileNum,
    email: c.email,
    companyName: c.companyName,
    city: c.city,
    matchedByPhone: c.matchedByPhone,
    unmatched: c.unmatched,
    dataQualityFlags: c.dataQualityFlags?.slice(0, 2) ?? [],
    salesProcessIds: [],
    interactionIds: [],
    callRecordIds: [],
  };
}

function slimProcess(p: SalesProcess): SalesProcess {
  return {
    salesProcessId: p.salesProcessId,
    customerId: p.customerId,
    processName: p.processName,
    currentStage: p.currentStage,
    currentStageRaw: p.currentStageRaw,
    stageEnteredAt: p.stageEnteredAt,
    projectName: p.projectName,
    assignedTo: p.assignedTo,
    source: p.source,
    interactionIds: [],
    stageHistory: [],
  };
}

/**
 * Build a browser-safe snapshot from the full in-memory model.
 */
export function slimSnapshotForApi(snapshot: CrmSnapshot): CrmSnapshot {
  const today = todayCalendarKey();
  const TODAY_CALL_PREVIEW = 80;
  const OTHER_CALL_CAP = 40;

  const todayPreview: CallRecord[] = [];
  const otherPreview: CallRecord[] = [];
  let todayCallCount = 0;
  const todayByExec = new Map<string, number>();
  const allByExec = new Map<string, number>();

  // Calls are typically oldest-first; keep a trailing window so previews
  // are the most recent rows, not June leftovers from the head of the array.
  for (const call of snapshot.calls) {
    const exec = call.callExecutive?.trim() || 'Unassigned';
    allByExec.set(exec, (allByExec.get(exec) ?? 0) + 1);
    const day = calendarDateKey(call.callAt || call.callDate || null);
    if (day === today) {
      todayCallCount += 1;
      todayByExec.set(exec, (todayByExec.get(exec) ?? 0) + 1);
      todayPreview.push(call);
      if (todayPreview.length > TODAY_CALL_PREVIEW) todayPreview.shift();
    } else {
      otherPreview.push(call);
      if (otherPreview.length > OTHER_CALL_CAP) otherPreview.shift();
    }
  }

  let todayInteractionCount = 0;
  for (const ix of snapshot.interactions) {
    if (calendarDateKey(ix.interactionDate) === today) todayInteractionCount += 1;
  }

  return {
    customers: snapshot.customers.map(slimCustomer),
    processes: snapshot.processes.map(slimProcess),
    interactions: [],
    calls: [...todayPreview, ...otherPreview],
    projects: snapshot.projects,
    executives: snapshot.executives.map((e) => ({
      executiveName: e.executiveName,
      customerIds: [],
      processIds: [],
    })),
    followUps: snapshot.followUps,
    classifications: snapshot.classifications.map(slimClassification),
    reviews: snapshot.reviews ?? [],
    overrides: snapshot.overrides ?? [],
    dataHealth: {
      ...snapshot.dataHealth,
      issues: (snapshot.dataHealth?.issues ?? []).slice(0, 20),
    },
    syncMeta: snapshot.syncMeta,
    builtAt: snapshot.builtAt,
    callTotal: snapshot.calls.length,
    callsTruncated: true,
    interactionTotal: snapshot.interactions.length,
    interactionsTruncated: true,
    interactionSeries: buildInteractionSeries(snapshot.interactions),
    activityDate: today,
    todayCallCount,
    todayInteractionCount,
    todayCallsByExecutive: toExecRows(todayByExec),
    callsByExecutive: toExecRows(allByExec),
  };
}
