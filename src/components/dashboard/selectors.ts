import { applyGlobalFilters } from '@/lib/crm/filters';
import type {
  ClassificationResult,
  CrmSnapshot,
  Customer,
  GlobalFilters,
  IntelligenceCategory,
  SalesProcess,
} from '@/lib/crm/types';
import { CATEGORY_LABELS } from './labels';

export interface LeadRow {
  customerId: string;
  salesProcessId: string;
  name: string;
  mobile: string;
  projectName: string;
  stage: string;
  assignedTo: string;
  category: IntelligenceCategory;
  recommendedAction: string;
  callDataStatus: string;
  reason: string;
  /** Sheet Notes column for this person. */
  remark: string;
  stageEnteredAt: string | null;
  /** Newest of last interaction / last call / stage entry — used for latest-first lists. */
  lastActivityAt: string | null;
  /** Call history summary when shipped with the snapshot. */
  callCount: number;
  answeredCalls: number;
  callDays: number;
  talkSeconds: number;
  customer: Customer;
  process: SalesProcess;
  classification: ClassificationResult;
}

function latestActivityAt(process: SalesProcess): string | null {
  const candidates = [
    process.lastInteractionDate,
    process.lastCallDate,
    process.stageEnteredAt,
  ]
    .map((v) => (v ? String(v) : ''))
    .filter(Boolean);
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => b.localeCompare(a))[0] ?? null;
}

export function filterSnapshotClient(
  snapshot: CrmSnapshot,
  filters: GlobalFilters,
): CrmSnapshot {
  const hasFilters =
    filters.dateFrom ||
    filters.dateTo ||
    (filters.executives && filters.executives.length) ||
    (filters.projects && filters.projects.length) ||
    (filters.stages && filters.stages.length) ||
    (filters.categories && filters.categories.length) ||
    (filters.processNames && filters.processNames.length) ||
    filters.search;

  if (!hasFilters) return snapshot;

  const filtered = applyGlobalFilters(snapshot, filters);
  const dateFiltered = Boolean(filters.dateFrom || filters.dateTo);
  return {
    ...snapshot,
    customers: filtered.customers,
    processes: filtered.processes,
    interactions: filtered.interactions,
    calls: filtered.calls,
    followUps: filtered.followUps,
    classifications: filtered.classifications,
    // Preview arrays are truncated — never treat their length as the sheet total.
    // Date-scoped call/interaction totals are patched from day indexes in the overview.
    callTotal: dateFiltered ? undefined : snapshot.callTotal,
    interactionTotal: dateFiltered ? undefined : snapshot.interactionTotal,
  };
}

export function buildLeadRows(
  snapshot: CrmSnapshot,
  category?: IntelligenceCategory | IntelligenceCategory[],
): LeadRow[] {
  const customers = new Map(snapshot.customers.map((c) => [c.customerId, c]));
  const clsByProcess = new Map(
    snapshot.classifications.map((c) => [c.salesProcessId, c]),
  );
  const cats = category
    ? Array.isArray(category)
      ? new Set(category)
      : new Set([category])
    : null;

  const rows: LeadRow[] = [];
  for (const process of snapshot.processes) {
    const classification = clsByProcess.get(process.salesProcessId);
    if (!classification) continue;
    if (cats && !cats.has(classification.primaryCategory)) continue;
    const customer = customers.get(process.customerId);
    if (!customer) continue;
    const reason =
      classification.reasons?.[classification.primaryCategory] ||
      classification.recommendedAction ||
      CATEGORY_LABELS[classification.primaryCategory] ||
      classification.primaryCategory;

    rows.push({
      customerId: process.customerId,
      salesProcessId: process.salesProcessId,
      name: customer.name || process.customerId,
      mobile: customer.mobileNum || '—',
      projectName: process.projectName || '—',
      stage: process.currentStage,
      assignedTo: process.assignedTo || 'Unassigned',
      category: classification.primaryCategory,
      recommendedAction: classification.recommendedAction || reason,
      callDataStatus: classification.callDataStatus,
      reason,
      remark: process.remark?.trim() || '',
      stageEnteredAt: process.stageEnteredAt,
      lastActivityAt: latestActivityAt(process),
      callCount: process.callStats?.totalCalls ?? 0,
      answeredCalls: process.callStats?.answeredCalls ?? 0,
      callDays: process.callStats?.distinctDays ?? 0,
      talkSeconds: process.callStats?.totalTalkSeconds ?? 0,
      customer,
      process,
      classification,
    });
  }

  // Latest activity first across All Leads / category tabs / etc.
  return rows.sort((a, b) => {
    const av = a.lastActivityAt || a.stageEnteredAt || '';
    const bv = b.lastActivityAt || b.stageEnteredAt || '';
    return bv.localeCompare(av);
  });
}
