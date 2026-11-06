/**
 * CSV builders for CRM reports.
 */

import { CANONICAL_HEADERS, SHEET_COLUMNS } from './columns';
import type {
  ClassificationResult,
  Customer,
  SalesProcess,
  CallRecord,
  DataHealthReport,
} from './types';
import type {
  BookingForecastItem,
  ExecutivePerformance,
  OverviewMetrics,
  ProjectIntelligence,
} from './analytics';

function escapeCsvCell(value: unknown): string {
  if (value == null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((r) => r.map(escapeCsvCell).join(',')),
  ];
  return lines.join('\n');
}

export function exportClassificationsCsv(
  results: ClassificationResult[],
): string {
  return toCsv(
    [
      'customerId',
      'salesProcessId',
      'currentStage',
      'primaryCategory',
      'underlyingFlags',
      'callDataStatus',
      'missingFields',
      'recommendedAction',
    ],
    results.map((r) => [
      r.customerId,
      r.salesProcessId,
      r.currentStage,
      r.primaryCategory,
      r.underlyingFlags.join('|'),
      r.callDataStatus,
      r.missingFields.join('|'),
      r.recommendedAction,
    ]),
  );
}

export function exportCustomersCsv(customers: Customer[]): string {
  return toCsv(
    [
      'customerId',
      'name',
      'mobileNum',
      'email',
      'companyName',
      'city',
      'matchedByPhone',
      'dataQualityFlags',
    ],
    customers.map((c) => [
      c.customerId,
      c.name,
      c.mobileNum,
      c.email,
      c.companyName,
      c.city,
      c.matchedByPhone ? 'yes' : 'no',
      c.dataQualityFlags.join('|'),
    ]),
  );
}

export function exportProcessesCsv(processes: SalesProcess[]): string {
  return toCsv(
    [
      'salesProcessId',
      'customerId',
      'processName',
      'currentStage',
      'stageEnteredAt',
      'projectName',
      'assignedTo',
      'source',
    ],
    processes.map((p) => [
      p.salesProcessId,
      p.customerId,
      p.processName,
      p.currentStage,
      p.stageEnteredAt,
      p.projectName,
      p.assignedTo,
      p.source,
    ]),
  );
}

export function exportCallsCsv(calls: CallRecord[]): string {
  return toCsv(
    [
      'callRecordId',
      'customerId',
      'callAt',
      'callOutcome',
      'answered',
      'durationSeconds',
      'callExecutive',
      'salesProcessId',
      'salesProcessName',
    ],
    calls.map((c) => [
      c.callRecordId,
      c.customerId,
      c.callAt,
      c.callOutcome,
      c.answered ? 'yes' : 'no',
      c.durationSeconds,
      c.callExecutive,
      c.salesProcessId,
      c.salesProcessName,
    ]),
  );
}

export function exportOverviewCsv(metrics: OverviewMetrics): string {
  return toCsv(
    ['metric', 'value'],
    [
      ['totalCustomers', metrics.totalCustomers],
      ['totalProcesses', metrics.totalProcesses],
      ['totalInteractions', metrics.totalInteractions],
      ['totalCalls', metrics.totalCalls],
      ['salesClosed', metrics.salesClosed],
      ['notInterested', metrics.notInterested],
      ['conversionRate', metrics.conversionRate.toFixed(4)],
      ['conversionNumerator', metrics.conversionNumerator],
      ['conversionDenominator', metrics.conversionDenominator],
      ['conversionDenominatorDescription', metrics.conversionDenominatorDescription],
    ],
  );
}

export function exportExecutivePerformanceCsv(
  rows: ExecutivePerformance[],
): string {
  return toCsv(
    [
      'executiveName',
      'processCount',
      'customerCount',
      'closedCount',
      'goneDarkCount',
      'notPickingUpCount',
      'stuckCount',
      'highIntentCount',
      'veryHighIntentCount',
      'conversionRate',
    ],
    rows.map((r) => [
      r.executiveName,
      r.processCount,
      r.customerCount,
      r.closedCount,
      r.goneDarkCount,
      r.notPickingUpCount,
      r.stuckCount,
      r.highIntentCount,
      r.veryHighIntentCount,
      r.conversionRate.toFixed(4),
    ]),
  );
}

export function exportProjectIntelligenceCsv(
  rows: ProjectIntelligence[],
): string {
  return toCsv(
    [
      'projectName',
      'processCount',
      'customerCount',
      'closedCount',
      'highIntentCount',
      'veryHighIntentCount',
      'goneDarkCount',
      'conversionRate',
    ],
    rows.map((r) => [
      r.projectName,
      r.processCount,
      r.customerCount,
      r.closedCount,
      r.highIntentCount,
      r.veryHighIntentCount,
      r.goneDarkCount,
      r.conversionRate.toFixed(4),
    ]),
  );
}

export function exportBookingForecastCsv(rows: BookingForecastItem[]): string {
  return toCsv(
    [
      'customerId',
      'salesProcessId',
      'projectName',
      'assignedTo',
      'tier',
      'primaryCategory',
      'reasons',
    ],
    rows.map((r) => [
      r.customerId,
      r.salesProcessId,
      r.projectName,
      r.assignedTo,
      r.tier,
      r.primaryCategory,
      r.reasons.join(' | '),
    ]),
  );
}

export function exportDataHealthCsv(report: DataHealthReport): string {
  return toCsv(
    ['code', 'severity', 'message', 'rowIndex', 'customerId', 'field'],
    report.issues.map((i) => [
      i.code,
      i.severity,
      i.message,
      i.rowIndex,
      i.customerId,
      i.field,
    ]),
  );
}

/** Headers-only template matching the 35-column sheet. */
export function exportSheetTemplateCsv(): string {
  return toCsv(
    SHEET_COLUMNS.map((k) => CANONICAL_HEADERS[k]),
    [],
  );
}
