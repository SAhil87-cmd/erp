/**
 * Compact on-the-wire CRM snapshot for Vercel → browser.
 * Full CrmSnapshot JSON is ~10MB and crashes mobile/Edge tabs on parse.
 */

import { calendarDateKey, todayCalendarKey } from './dates';
import type {
  CallDataStatus,
  CallRecord,
  CanonicalStage,
  ClassificationResult,
  CrmSnapshot,
  Customer,
  FollowUpActivity,
  IntelligenceCategory,
  SalesProcess,
  SyncMeta,
} from './types';

const CAT_TO_CODE: Record<IntelligenceCategory, string> = {
  GONE_DARK: 'G',
  NOT_PICKING_UP: 'N',
  MISMARKED_NI: 'M',
  STUCK: 'S',
  VERY_HIGH_INTENT: 'V',
  HIGH_INTENT: 'H',
  NONE: '-',
};

const CODE_TO_CAT: Record<string, IntelligenceCategory> = {
  G: 'GONE_DARK',
  N: 'NOT_PICKING_UP',
  M: 'MISMARKED_NI',
  S: 'STUCK',
  V: 'VERY_HIGH_INTENT',
  H: 'HIGH_INTENT',
  '-': 'NONE',
};

/** [pid, cid, name, mobile, stage, assigned, project, source, catCode, cds, stageEnteredAt, flags, lastIx, lastCall, remark] */
export type CompactLeadRow = [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

/** [cid, pid, nextFollowUp, revisit, owner, stage] */
export type CompactFollowUpRow = [string, string, string, string, string, string];

export interface CompactCrmWire {
  v: 1;
  pack?: 'overview' | 'full';
  builtAt: string;
  syncMeta: SyncMeta;
  callTotal: number;
  interactionTotal: number;
  interactionSeries?: CrmSnapshot['interactionSeries'];
  activityDate?: string;
  activityDateIsFallback?: boolean;
  todayCallCount?: number;
  todayInteractionCount?: number;
  todayCallsByExecutive?: CrmSnapshot['todayCallsByExecutive'];
  callsByExecutive?: CrmSnapshot['callsByExecutive'];
  callsByDayByExecutive?: CrmSnapshot['callsByDayByExecutive'];
  processIdsByInteractionDay?: CrmSnapshot['processIdsByInteractionDay'];
  processIdsByCallDay?: CrmSnapshot['processIdsByCallDay'];
  overviewMetrics?: CrmSnapshot['overviewMetrics'];
  recoveryMetrics?: CrmSnapshot['recoveryMetrics'];
  executivePerformance?: CrmSnapshot['executivePerformance'];
  leads: CompactLeadRow[];
  followUps: CompactFollowUpRow[];
  calls: CallRecord[];
  projects: string[];
  executives: string[];
  reviews: CrmSnapshot['reviews'];
  overrides: CrmSnapshot['overrides'];
  dataHealth: CrmSnapshot['dataHealth'];
}

export function isCompactCrmWire(value: unknown): value is CompactCrmWire {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    (value as CompactCrmWire).v === 1 &&
    Array.isArray((value as CompactCrmWire).leads)
  );
}

export function toCompactWire(snapshot: CrmSnapshot): CompactCrmWire {
  const customers = new Map(
    snapshot.customers.map((c) => [c.customerId, c] as const),
  );
  const clsByProcess = new Map(
    snapshot.classifications.map((c) => [c.salesProcessId, c] as const),
  );

  const leads: CompactLeadRow[] = snapshot.processes.map((p) => {
    const customer = customers.get(p.customerId);
    const cls = clsByProcess.get(p.salesProcessId);
    const cat = cls?.primaryCategory ?? 'NONE';
    return [
      p.salesProcessId,
      p.customerId,
      customer?.name ?? '',
      customer?.mobileNum ?? '',
      p.currentStage,
      p.assignedTo ?? '',
      p.projectName ?? '',
      p.source ?? '',
      CAT_TO_CODE[cat] ?? '-',
      cls?.callDataStatus === 'INSUFFICIENT_CALL_DATA' ? 'I' : 'O',
      (p.stageEnteredAt ?? '').slice(0, 10),
      (cls?.underlyingFlags ?? []).map((f) => CAT_TO_CODE[f] ?? '').filter(Boolean).join(''),
      p.lastInteractionDate ?? calendarDateKey(p.stageEnteredAt) ?? '',
      p.lastCallDate ?? '',
      p.remark ?? '',
    ];
  });

  // Only ship actionable follow-ups (overdue → +14 days, or any revisit).
  const today = todayCalendarKey();
  const todayDate = new Date(`${today}T00:00:00+05:30`);
  const followUps: CompactFollowUpRow[] = [];
  for (const fu of snapshot.followUps ?? []) {
    if (!fu.nextFollowUpDate && !fu.revisitDate) continue;
    const nextKey = calendarDateKey(fu.nextFollowUpDate);
    const revisitKey = calendarDateKey(fu.revisitDate);
    let keep = Boolean(revisitKey);
    if (nextKey) {
      const nextDate = new Date(`${nextKey}T00:00:00+05:30`);
      const diffDays =
        (nextDate.getTime() - todayDate.getTime()) / (86400 * 1000);
      if (diffDays <= 14) keep = true;
    }
    if (!keep) continue;
    followUps.push([
      fu.customerId,
      fu.salesProcessId,
      fu.nextFollowUpDate ?? '',
      fu.revisitDate ?? '',
      fu.followupOwner || fu.assignedTo || '',
      fu.currentStage,
    ]);
  }

  const syncMeta = { ...snapshot.syncMeta };
  // Long status blurb duplicates published URL and bloats every response.
  delete (syncMeta as { message?: string }).message;
  delete (syncMeta as { publishedUrl?: string }).publishedUrl;

  return {
    v: 1,
    builtAt: snapshot.builtAt,
    syncMeta,
    callTotal: snapshot.callTotal ?? snapshot.calls.length,
    interactionTotal: snapshot.interactionTotal ?? 0,
    interactionSeries: snapshot.interactionSeries,
    activityDate: snapshot.activityDate,
    activityDateIsFallback: snapshot.activityDateIsFallback,
    todayCallCount: snapshot.todayCallCount,
    todayInteractionCount: snapshot.todayInteractionCount,
    todayCallsByExecutive: snapshot.todayCallsByExecutive,
    callsByExecutive: snapshot.callsByExecutive,
    callsByDayByExecutive: snapshot.callsByDayByExecutive,
    processIdsByInteractionDay: snapshot.processIdsByInteractionDay,
    processIdsByCallDay: snapshot.processIdsByCallDay,
    leads,
    followUps,
    calls: snapshot.calls ?? [],
    projects: (snapshot.projects ?? []).map((p) => p.projectName).filter(Boolean),
    executives: (snapshot.executives ?? [])
      .map((e) => e.executiveName)
      .filter(Boolean),
    reviews: snapshot.reviews ?? [],
    overrides: snapshot.overrides ?? [],
    dataHealth: {
      totalRows: snapshot.dataHealth?.totalRows ?? 0,
      validCustomers: snapshot.dataHealth?.validCustomers ?? 0,
      unmatchedRows: snapshot.dataHealth?.unmatchedRows ?? 0,
      duplicateCustomerIds: [],
      duplicatePhones: [],
      missingCustomerIds: snapshot.dataHealth?.missingCustomerIds ?? 0,
      missingPhones: snapshot.dataHealth?.missingPhones ?? 0,
      issues: [],
    },
  };
}

export function fromCompactWire(wire: CompactCrmWire): CrmSnapshot {
  const customers: Customer[] = [];
  const seenCustomer = new Set<string>();
  const processes: SalesProcess[] = [];
  const classifications: ClassificationResult[] = [];

  for (const row of wire.leads) {
    const salesProcessId = String(row[0] ?? '');
    const customerId = String(row[1] ?? '');
    const name = row[2] == null ? '' : String(row[2]);
    const mobile = row[3] == null ? '' : String(row[3]);
    const stage = String(row[4] ?? 'Unknown');
    const assignedTo = row[5] == null ? '' : String(row[5]);
    const projectName = row[6] == null ? '' : String(row[6]);
    const source = row[7] == null ? '' : String(row[7]);
    const catCode = row[8] == null ? '-' : String(row[8]);
    const cds = row[9] == null ? 'O' : String(row[9]);
    const stageEnteredAt = row[10] == null ? '' : String(row[10]);
    const flagsRaw = row[11] == null ? '' : String(row[11]);
    const lastInteractionDate = row[12] == null ? '' : String(row[12]);
    const lastCallDate = row[13] == null ? '' : String(row[13]);
    const remark = row[14] == null ? '' : String(row[14]);
    if (!salesProcessId || !customerId) continue;

    if (!seenCustomer.has(customerId)) {
      seenCustomer.add(customerId);
      customers.push({
        customerId,
        name: name || undefined,
        mobileNum: mobile || undefined,
        dataQualityFlags: [],
        salesProcessIds: [],
        interactionIds: [],
        callRecordIds: [],
      });
    }

    processes.push({
      salesProcessId,
      customerId,
      processName: '',
      currentStage: stage as CanonicalStage,
      currentStageRaw: '',
      stageEnteredAt: stageEnteredAt || null,
      projectName: projectName || undefined,
      assignedTo: assignedTo || undefined,
      source: source || undefined,
      interactionIds: [],
      stageHistory: [],
      lastInteractionDate: lastInteractionDate || null,
      lastCallDate: lastCallDate || null,
      remark: remark || undefined,
    });

    const primaryCategory = CODE_TO_CAT[catCode] ?? 'NONE';
    const underlyingFlags = [...flagsRaw]
      .map((ch) => CODE_TO_CAT[ch])
      .filter((v): v is IntelligenceCategory => Boolean(v));

    classifications.push({
      customerId,
      salesProcessId,
      currentStage: stage as CanonicalStage,
      primaryCategory,
      underlyingFlags,
      callDataStatus: (cds === 'I'
        ? 'INSUFFICIENT_CALL_DATA'
        : 'OK') as CallDataStatus,
      missingFields: [],
      recommendedAction: '',
      reasons: {},
      evidence: {},
      ruleResults: {},
    });
  }

  const followUps: FollowUpActivity[] = wire.followUps.map((row) => ({
    customerId: row[0],
    salesProcessId: row[1],
    nextFollowUpDate: row[2] || null,
    revisitDate: row[3] || null,
    followupOwner: row[4] || undefined,
    assignedTo: row[4] || undefined,
    currentStage: row[5] as CanonicalStage,
  }));

  return {
    customers,
    processes,
    interactions: [],
    calls: wire.calls ?? [],
    projects: (wire.projects ?? []).map((projectName) => ({
      projectName,
      customerIds: [],
      processIds: [],
    })),
    executives: (wire.executives ?? []).map((executiveName) => ({
      executiveName,
      customerIds: [],
      processIds: [],
    })),
    followUps,
    classifications,
    reviews: wire.reviews ?? [],
    overrides: wire.overrides ?? [],
    dataHealth: wire.dataHealth,
    syncMeta: wire.syncMeta,
    builtAt: wire.builtAt,
    callTotal: wire.callTotal,
    callsTruncated: true,
    interactionTotal: wire.interactionTotal,
    interactionsTruncated: true,
    interactionSeries: wire.interactionSeries,
    activityDate: wire.activityDate,
    activityDateIsFallback: wire.activityDateIsFallback,
    todayCallCount: wire.todayCallCount,
    todayInteractionCount: wire.todayInteractionCount,
    todayCallsByExecutive: wire.todayCallsByExecutive,
    callsByExecutive: wire.callsByExecutive,
    callsByDayByExecutive: wire.callsByDayByExecutive,
    processIdsByInteractionDay: wire.processIdsByInteractionDay,
    processIdsByCallDay: wire.processIdsByCallDay,
    pack: wire.pack ?? (wire.leads.length ? 'full' : 'overview'),
    overviewMetrics: wire.overviewMetrics,
    recoveryMetrics: wire.recoveryMetrics,
    executivePerformance: wire.executivePerformance,
  };
}
