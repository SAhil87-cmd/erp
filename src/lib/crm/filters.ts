/**
 * Global filter application across leads/processes.
 *
 * Date semantics (dateField):
 * - interaction: latest interaction date of the process (YYYY-MM-DD Asia/Kolkata)
 * - stageEntry: current stage entry date
 * - followUp: next follow-up date
 * - call: any call for the customer/process falls in range
 *
 * All dateFrom/dateTo comparisons use inclusive calendar-date keys.
 */

import { calendarDateKey, isCalendarKeyInRange } from './dates';
import { processIdsMatchingDateRange } from './dateIndex';
import type {
  CallRecord,
  ClassificationResult,
  Customer,
  FollowUpActivity,
  GlobalFilters,
  Interaction,
  SalesProcess,
} from './types';

export interface FilterableSnapshot {
  customers: Customer[];
  processes: SalesProcess[];
  interactions: Interaction[];
  calls: CallRecord[];
  followUps: FollowUpActivity[];
  classifications: ClassificationResult[];
  processIdsByInteractionDay?: Record<string, string[]>;
  processIdsByCallDay?: Record<string, string[]>;
}

export interface FilteredResult extends FilterableSnapshot {
  matchedProcessIds: string[];
  matchedCustomerIds: string[];
}

function latestInteractionDate(
  processId: string,
  interactions: Interaction[],
): string | null {
  let best: string | null = null;
  for (const ix of interactions) {
    if (ix.salesProcessId !== processId || !ix.interactionDate) continue;
    const key = calendarDateKey(ix.interactionDate);
    if (key && (!best || key > best)) best = key;
  }
  return best;
}

function processMatchesDate(
  process: SalesProcess,
  filters: GlobalFilters,
  interactions: Interaction[],
  followUps: FollowUpActivity[],
  calls: CallRecord[],
): boolean {
  if (!filters.dateFrom && !filters.dateTo) return true;
  const field = filters.dateField ?? 'interaction';

  let key: string | null = null;
  switch (field) {
    case 'stageEntry':
      key = calendarDateKey(process.stageEnteredAt);
      break;
    case 'followUp': {
      const fu = followUps.find((f) => f.salesProcessId === process.salesProcessId);
      key = calendarDateKey(fu?.nextFollowUpDate ?? null);
      break;
    }
    case 'call': {
      if (calls.length > 0) {
        const relevant = calls.filter((c) => c.customerId === process.customerId);
        return relevant.some((c) => {
          const k = calendarDateKey(c.callAt || c.callDate || null);
          return isCalendarKeyInRange(k, filters.dateFrom, filters.dateTo);
        });
      }
      // Preview calls are truncated — use stamped lastCallDate from full sync.
      key = process.lastCallDate ?? null;
      break;
    }
    case 'interaction':
    default:
      key =
        latestInteractionDate(process.salesProcessId, interactions) ??
        process.lastInteractionDate ??
        calendarDateKey(process.stageEnteredAt);
      break;
  }
  return isCalendarKeyInRange(key, filters.dateFrom, filters.dateTo);
}

export function applyGlobalFilters(
  snapshot: FilterableSnapshot,
  filters: GlobalFilters,
): FilteredResult {
  const classificationByProcess = new Map(
    snapshot.classifications.map((c) => [c.salesProcessId, c]),
  );
  const customerById = new Map(snapshot.customers.map((c) => [c.customerId, c]));

  const dateField = filters.dateField ?? 'interaction';
  const dateIndexIds =
    filters.dateFrom || filters.dateTo
      ? processIdsMatchingDateRange(
          dateField === 'call'
            ? snapshot.processIdsByCallDay
            : dateField === 'interaction'
              ? snapshot.processIdsByInteractionDay
              : undefined,
          filters,
        )
      : null;

  const matchedProcesses = snapshot.processes.filter((process) => {
    if (dateIndexIds) {
      const callFallbackId = `customer:${process.customerId}`;
      const inIndex =
        dateIndexIds.has(process.salesProcessId) ||
        (dateField === 'call' && dateIndexIds.has(callFallbackId));
      if (!inIndex) return false;
    }
    if (filters.stages?.length && !filters.stages.includes(process.currentStage)) {
      return false;
    }
    if (filters.projects?.length) {
      const pn = process.projectName ?? '';
      if (!filters.projects.some((p) => p.toLowerCase() === pn.toLowerCase())) {
        return false;
      }
    }
    if (filters.executives?.length) {
      const exec = process.assignedTo ?? '';
      if (
        !filters.executives.some((e) => e.toLowerCase() === exec.toLowerCase())
      ) {
        return false;
      }
    }
    if (filters.processNames?.length) {
      if (
        !filters.processNames.some(
          (n) => n.toLowerCase() === process.processName.toLowerCase(),
        )
      ) {
        return false;
      }
    }
    if (filters.categories?.length) {
      const cls = classificationByProcess.get(process.salesProcessId);
      const cat = cls?.primaryCategory ?? 'NONE';
      if (!filters.categories.includes(cat)) return false;
    }
    if (filters.search?.trim()) {
      const q = filters.search.trim().toLowerCase();
      const customer = customerById.get(process.customerId);
      const hay = [
        process.customerId,
        customer?.name,
        customer?.mobileNum,
        customer?.email,
        customer?.companyName,
        process.projectName,
        process.processName,
        process.assignedTo,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    // Day-index already applied for interaction/call. Other date fields still use row stamps.
    if (
      !dateIndexIds &&
      !processMatchesDate(
        process,
        filters,
        snapshot.interactions,
        snapshot.followUps,
        snapshot.calls,
      )
    ) {
      return false;
    }
    return true;
  });

  const matchedProcessIds = matchedProcesses.map((p) => p.salesProcessId);
  const matchedCustomerIds = [
    ...new Set(matchedProcesses.map((p) => p.customerId)),
  ];
  const processIdSet = new Set(matchedProcessIds);
  const customerIdSet = new Set(matchedCustomerIds);

  return {
    customers: snapshot.customers.filter((c) => customerIdSet.has(c.customerId)),
    processes: matchedProcesses,
    interactions: snapshot.interactions.filter((i) =>
      processIdSet.has(i.salesProcessId),
    ),
    calls: snapshot.calls.filter((c) => customerIdSet.has(c.customerId)),
    followUps: snapshot.followUps.filter((f) =>
      processIdSet.has(f.salesProcessId),
    ),
    classifications: snapshot.classifications.filter((c) =>
      processIdSet.has(c.salesProcessId),
    ),
    matchedProcessIds,
    matchedCustomerIds,
  };
}
