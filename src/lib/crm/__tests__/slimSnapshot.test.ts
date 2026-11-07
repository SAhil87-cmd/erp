import { describe, expect, it } from 'vitest';
import { slimSnapshotForApi } from '../slimSnapshot';
import type { CallRecord, CrmSnapshot } from '../types';

function call(
  partial: Partial<CallRecord> & { callAt: string; callExecutive: string },
): CallRecord {
  return {
    callRecordId: partial.callRecordId ?? `c-${partial.callAt}`,
    customerId: partial.customerId ?? 'cust',
    callAt: partial.callAt,
    callDate: partial.callDate ?? null,
    answered: true,
    callOutcome: 'Connected',
    durationSeconds: 30,
    callExecutive: partial.callExecutive,
    salesProcessId: partial.salesProcessId ?? 'p1',
    salesProcessName: null,
  } as CallRecord;
}

describe('slimSnapshotForApi activity day', () => {
  it('falls back to latest call day when calendar today has no calls', () => {
    const snapshot = {
      customers: [],
      processes: [
        {
          salesProcessId: 'p1',
          customerId: 'cust',
          processName: '',
          currentStage: 'Followup',
          currentStageRaw: '',
          stageEnteredAt: '2026-11-06T10:00:00.000Z',
          interactionIds: [],
          stageHistory: [],
        },
      ],
      interactions: [],
      calls: [
        call({
          callAt: '2026-11-06T08:00:00.000Z',
          callExecutive: 'Shubham',
          salesProcessId: 'p1',
        }),
        call({
          callAt: '2026-11-06T09:00:00.000Z',
          callExecutive: 'Vishal',
          salesProcessId: 'p1',
          callRecordId: 'c2',
        }),
        call({
          callAt: '2026-11-05T09:00:00.000Z',
          callExecutive: 'Kavya',
          salesProcessId: 'p1',
          callRecordId: 'c3',
        }),
      ],
      projects: [],
      executives: [],
      followUps: [],
      classifications: [],
      reviews: [],
      overrides: [],
      dataHealth: {
        totalRows: 0,
        validCustomers: 0,
        unmatchedRows: 0,
        duplicateCustomerIds: [],
        duplicatePhones: [],
        missingCustomerIds: 0,
        missingPhones: 0,
        issues: [],
      },
      syncMeta: {
        lastSyncAt: null,
        lastImportAt: null,
        source: 'google_sheets',
        status: 'ok',
      },
      builtAt: new Date().toISOString(),
    } as CrmSnapshot;

    const slim = slimSnapshotForApi(snapshot);
    expect(slim.activityDate).toBe('2026-11-06');
    expect(slim.activityDateIsFallback).toBe(true);
    expect(slim.todayCallCount).toBe(2);
    expect(slim.todayCallsByExecutive?.map((r) => r.executiveName).sort()).toEqual([
      'Shubham',
      'Vishal',
    ]);
    expect(slim.processes[0]?.lastCallDate).toBe('2026-11-06');
    expect(slim.callsByDayByExecutive?.some((d) => d.date === '2026-11-06')).toBe(
      true,
    );
  });
});
