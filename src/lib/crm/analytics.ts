/**
 * Overview metrics, executive performance, project intelligence,
 * follow-up buckets, recovery metrics, booking forecast tiers.
 *
 * Booking tiers are transparent rule-based reasons — NOT AI probability.
 */

import { calendarDateKey, todayCalendarKey } from './dates';
import type {
  BookingOpportunityTier,
  ClassificationResult,
  CrmSnapshot,
  FollowUpActivity,
  IntelligenceCategory,
  SalesProcess,
} from './types';

export interface OverviewMetrics {
  totalCustomers: number;
  totalProcesses: number;
  totalInteractions: number;
  totalCalls: number;
  byStage: Record<string, number>;
  byCategory: Record<IntelligenceCategory, number>;
  salesClosed: number;
  notInterested: number;
  /** Closed / (Closed + Not Interested + active pipeline) — denominator documented. */
  conversionRate: number;
  conversionDenominator: number;
  conversionNumerator: number;
  conversionDenominatorDescription: string;
}

export interface ExecutivePerformance {
  executiveName: string;
  processCount: number;
  customerCount: number;
  closedCount: number;
  goneDarkCount: number;
  notPickingUpCount: number;
  stuckCount: number;
  highIntentCount: number;
  veryHighIntentCount: number;
  conversionRate: number;
}

export interface ProjectIntelligence {
  projectName: string;
  processCount: number;
  customerCount: number;
  closedCount: number;
  highIntentCount: number;
  veryHighIntentCount: number;
  goneDarkCount: number;
  conversionRate: number;
}

export type FollowUpBucket =
  | 'today'
  | 'overdue'
  | 'upcoming'
  | 'missed'
  | 'revisit'
  | 'no-followup';

export interface FollowUpBucketResult {
  bucket: FollowUpBucket;
  items: FollowUpActivity[];
  count: number;
}

export interface RecoveryMetrics {
  goneDark: number;
  notPickingUp: number;
  mismarkedNi: number;
  stuck: number;
  recoverableTotal: number;
}

export interface BookingForecastItem {
  customerId: string;
  salesProcessId: string;
  projectName?: string;
  assignedTo?: string;
  tier: BookingOpportunityTier;
  reasons: string[];
  primaryCategory: IntelligenceCategory;
}

function countByCategory(
  classifications: ClassificationResult[],
): Record<IntelligenceCategory, number> {
  const base: Record<IntelligenceCategory, number> = {
    GONE_DARK: 0,
    NOT_PICKING_UP: 0,
    MISMARKED_NI: 0,
    STUCK: 0,
    VERY_HIGH_INTENT: 0,
    HIGH_INTENT: 0,
    NONE: 0,
  };
  for (const c of classifications) {
    base[c.primaryCategory] = (base[c.primaryCategory] ?? 0) + 1;
  }
  return base;
}

export function computeOverviewMetrics(snapshot: CrmSnapshot): OverviewMetrics {
  const byStage: Record<string, number> = {};
  let salesClosed = 0;
  let notInterested = 0;
  let activePipeline = 0;

  for (const p of snapshot.processes) {
    byStage[p.currentStage] = (byStage[p.currentStage] ?? 0) + 1;
    if (p.currentStage === 'Sales Closed') salesClosed += 1;
    else if (p.currentStage === 'Not Interested') notInterested += 1;
    else if (p.currentStage !== 'Spam' && p.currentStage !== 'DND') {
      activePipeline += 1;
    }
  }

  const conversionNumerator = salesClosed;
  const conversionDenominator = salesClosed + notInterested + activePipeline;
  const conversionRate =
    conversionDenominator === 0 ? 0 : conversionNumerator / conversionDenominator;

  const totalCalls =
    snapshot.callTotal ??
    snapshot.syncMeta.callCount ??
    snapshot.calls.length;

  return {
    totalCustomers: snapshot.customers.length,
    totalProcesses: snapshot.processes.length,
    totalInteractions: snapshot.interactions.length,
    totalCalls,
    byStage,
    byCategory: countByCategory(snapshot.classifications),
    salesClosed,
    notInterested,
    conversionRate,
    conversionDenominator,
    conversionNumerator,
    conversionDenominatorDescription:
      'Sales Closed + Not Interested + active pipeline (excludes Spam/DND)',
  };
}

export function computeExecutivePerformance(
  snapshot: CrmSnapshot,
): ExecutivePerformance[] {
  const clsByProcess = new Map(
    snapshot.classifications.map((c) => [c.salesProcessId, c]),
  );
  const byExec = new Map<string, SalesProcess[]>();

  for (const p of snapshot.processes) {
    const name = p.assignedTo?.trim() || 'Unassigned';
    if (!byExec.has(name)) byExec.set(name, []);
    byExec.get(name)!.push(p);
  }

  return [...byExec.entries()].map(([executiveName, processes]) => {
    let closedCount = 0;
    let goneDarkCount = 0;
    let notPickingUpCount = 0;
    let stuckCount = 0;
    let highIntentCount = 0;
    let veryHighIntentCount = 0;
    let ni = 0;
    let active = 0;

    for (const p of processes) {
      if (p.currentStage === 'Sales Closed') closedCount += 1;
      else if (p.currentStage === 'Not Interested') ni += 1;
      else if (p.currentStage !== 'Spam' && p.currentStage !== 'DND') active += 1;

      const cls = clsByProcess.get(p.salesProcessId);
      if (!cls) continue;
      if (cls.primaryCategory === 'GONE_DARK') goneDarkCount += 1;
      if (cls.primaryCategory === 'NOT_PICKING_UP') notPickingUpCount += 1;
      if (cls.primaryCategory === 'STUCK') stuckCount += 1;
      if (cls.primaryCategory === 'HIGH_INTENT') highIntentCount += 1;
      if (cls.primaryCategory === 'VERY_HIGH_INTENT') veryHighIntentCount += 1;
    }

    const denom = closedCount + ni + active;
    return {
      executiveName,
      processCount: processes.length,
      customerCount: new Set(processes.map((p) => p.customerId)).size,
      closedCount,
      goneDarkCount,
      notPickingUpCount,
      stuckCount,
      highIntentCount,
      veryHighIntentCount,
      conversionRate: denom === 0 ? 0 : closedCount / denom,
    };
  });
}

export function computeProjectIntelligence(
  snapshot: CrmSnapshot,
): ProjectIntelligence[] {
  const clsByProcess = new Map(
    snapshot.classifications.map((c) => [c.salesProcessId, c]),
  );
  const byProject = new Map<string, SalesProcess[]>();

  for (const p of snapshot.processes) {
    const name = p.projectName?.trim() || 'Unassigned Project';
    if (!byProject.has(name)) byProject.set(name, []);
    byProject.get(name)!.push(p);
  }

  return [...byProject.entries()].map(([projectName, processes]) => {
    let closedCount = 0;
    let highIntentCount = 0;
    let veryHighIntentCount = 0;
    let goneDarkCount = 0;
    let ni = 0;
    let active = 0;

    for (const p of processes) {
      if (p.currentStage === 'Sales Closed') closedCount += 1;
      else if (p.currentStage === 'Not Interested') ni += 1;
      else if (p.currentStage !== 'Spam' && p.currentStage !== 'DND') active += 1;

      const cls = clsByProcess.get(p.salesProcessId);
      if (!cls) continue;
      if (cls.primaryCategory === 'HIGH_INTENT') highIntentCount += 1;
      if (cls.primaryCategory === 'VERY_HIGH_INTENT') veryHighIntentCount += 1;
      if (cls.primaryCategory === 'GONE_DARK') goneDarkCount += 1;
    }

    const denom = closedCount + ni + active;
    return {
      projectName,
      processCount: processes.length,
      customerCount: new Set(processes.map((p) => p.customerId)).size,
      closedCount,
      highIntentCount,
      veryHighIntentCount,
      goneDarkCount,
      conversionRate: denom === 0 ? 0 : closedCount / denom,
    };
  });
}

/**
 * Follow-up buckets:
 * - today: nextFollowUpDate == today
 * - overdue: nextFollowUpDate < today (and stage not terminal closed)
 * - upcoming: nextFollowUpDate > today within 7 days
 * - missed: overdue AND follow-up owner empty / unassigned
 * - revisit: has revisitDate >= today or overdue revisit
 * - no-followup: no nextFollowUpDate set, non-terminal stage
 */
export function computeFollowUpBuckets(
  followUps: FollowUpActivity[],
  today: string = todayCalendarKey(),
): FollowUpBucketResult[] {
  const buckets: Record<FollowUpBucket, FollowUpActivity[]> = {
    today: [],
    overdue: [],
    upcoming: [],
    missed: [],
    revisit: [],
    'no-followup': [],
  };

  const terminal = new Set(['Sales Closed', 'Spam', 'DND']);

  for (const fu of followUps) {
    const nextKey = calendarDateKey(fu.nextFollowUpDate);
    const revisitKey = calendarDateKey(fu.revisitDate);
    const isTerminal = terminal.has(fu.currentStage);

    if (revisitKey) {
      buckets.revisit.push(fu);
    }

    if (!nextKey) {
      if (!isTerminal && fu.currentStage !== 'Not Interested') {
        buckets['no-followup'].push(fu);
      }
      continue;
    }

    if (nextKey === today) {
      buckets.today.push(fu);
    } else if (nextKey < today) {
      if (!isTerminal) {
        buckets.overdue.push(fu);
        if (!fu.followupOwner && !fu.assignedTo) {
          buckets.missed.push(fu);
        }
      }
    } else {
      // upcoming within 7 days
      const todayDate = new Date(`${today}T00:00:00+05:30`);
      const nextDate = new Date(`${nextKey}T00:00:00+05:30`);
      const diffDays =
        (nextDate.getTime() - todayDate.getTime()) / (86400 * 1000);
      if (diffDays <= 7) {
        buckets.upcoming.push(fu);
      }
    }
  }

  return (Object.keys(buckets) as FollowUpBucket[]).map((bucket) => ({
    bucket,
    items: buckets[bucket],
    count: buckets[bucket].length,
  }));
}

export function computeRecoveryMetrics(
  classifications: ClassificationResult[],
): RecoveryMetrics {
  let goneDark = 0;
  let notPickingUp = 0;
  let mismarkedNi = 0;
  let stuck = 0;

  for (const c of classifications) {
    if (c.underlyingFlags.includes('GONE_DARK') || c.primaryCategory === 'GONE_DARK') {
      goneDark += 1;
    }
    if (
      c.underlyingFlags.includes('NOT_PICKING_UP') ||
      c.primaryCategory === 'NOT_PICKING_UP'
    ) {
      notPickingUp += 1;
    }
    if (
      c.underlyingFlags.includes('MISMARKED_NI') ||
      c.primaryCategory === 'MISMARKED_NI'
    ) {
      mismarkedNi += 1;
    }
    if (c.underlyingFlags.includes('STUCK') || c.primaryCategory === 'STUCK') {
      stuck += 1;
    }
  }

  return {
    goneDark,
    notPickingUp,
    mismarkedNi,
    stuck,
    recoverableTotal: goneDark + notPickingUp + mismarkedNi + stuck,
  };
}

/**
 * Booking opportunity tiers with transparent rule-based reasons.
 * These are NOT labeled as AI probability scores.
 */
export function computeBookingForecast(
  snapshot: CrmSnapshot,
): BookingForecastItem[] {
  const processById = new Map(
    snapshot.processes.map((p) => [p.salesProcessId, p]),
  );

  return snapshot.classifications.map((cls) => {
    const process = processById.get(cls.salesProcessId);
    const reasons: string[] = [];
    let tier: BookingOpportunityTier = 'COLD';

    if (
      ['Sales Closed', 'Spam', 'DND', 'Not Interested'].includes(cls.currentStage) &&
      cls.primaryCategory !== 'MISMARKED_NI'
    ) {
      tier = 'EXCLUDED';
      reasons.push(`Excluded: current stage is ${cls.currentStage}`);
    } else if (cls.primaryCategory === 'VERY_HIGH_INTENT') {
      tier = 'HOT';
      reasons.push(
        'Primary category VERY_HIGH_INTENT (≥2 verified completed site visits)',
      );
      reasons.push(cls.reasons.VERY_HIGH_INTENT ?? '');
    } else if (cls.primaryCategory === 'HIGH_INTENT') {
      tier = 'WARM';
      reasons.push(
        'Primary category HIGH_INTENT (≥1 verified completed site visit)',
      );
      reasons.push(cls.reasons.HIGH_INTENT ?? '');
    } else if (
      cls.underlyingFlags.includes('STUCK') &&
      (cls.currentStage === 'Revisit Done' || cls.currentStage === 'Site Visit Done')
    ) {
      tier = 'WARM';
      reasons.push('Late-stage Stuck — still engaged but needs unblock');
      reasons.push(cls.reasons.STUCK ?? '');
    } else if (
      ['GONE_DARK', 'NOT_PICKING_UP', 'MISMARKED_NI'].includes(cls.primaryCategory)
    ) {
      tier = 'COOL';
      reasons.push(`Ops alert ${cls.primaryCategory} — recovery before booking push`);
    } else if (
      ['Site Visit Scheduled', 'Site Visit Done', 'Revisit Done'].includes(
        cls.currentStage,
      )
    ) {
      tier = 'COOL';
      reasons.push(`Late stage ${cls.currentStage} without strong intent flags`);
    } else {
      tier = 'COLD';
      reasons.push(`Early/other stage ${cls.currentStage}`);
    }

    return {
      customerId: cls.customerId,
      salesProcessId: cls.salesProcessId,
      projectName: process?.projectName,
      assignedTo: process?.assignedTo,
      tier,
      reasons: reasons.filter(Boolean),
      primaryCategory: cls.primaryCategory,
    };
  });
}
