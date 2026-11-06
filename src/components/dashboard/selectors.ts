import { applyGlobalFilters } from '@/lib/crm/filters';
import type {
  ClassificationResult,
  CrmSnapshot,
  Customer,
  GlobalFilters,
  IntelligenceCategory,
  SalesProcess,
} from '@/lib/crm/types';

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
  stageEnteredAt: string | null;
  customer: Customer;
  process: SalesProcess;
  classification: ClassificationResult;
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
      classification.reasons[classification.primaryCategory] ||
      classification.recommendedAction;

    rows.push({
      customerId: process.customerId,
      salesProcessId: process.salesProcessId,
      name: customer.name || process.customerId,
      mobile: customer.mobileNum || '—',
      projectName: process.projectName || '—',
      stage: process.currentStage,
      assignedTo: process.assignedTo || 'Unassigned',
      category: classification.primaryCategory,
      recommendedAction: classification.recommendedAction,
      callDataStatus: classification.callDataStatus,
      reason,
      stageEnteredAt: process.stageEnteredAt,
      customer,
      process,
      classification,
    });
  }
  return rows;
}
