import { describe, expect, it } from 'vitest';
import { fromCompactWire, toCompactWire } from '../compactWire';
import type { CrmSnapshot } from '../types';

function sampleSnapshot(): CrmSnapshot {
  return {
    customers: [
      {
        customerId: 'c1',
        name: 'Ada',
        mobileNum: '999',
        dataQualityFlags: [],
        salesProcessIds: [],
        interactionIds: [],
        callRecordIds: [],
      },
    ],
    processes: [
      {
        salesProcessId: 'p1',
        customerId: 'c1',
        processName: 'SP',
        currentStage: 'Followup',
        currentStageRaw: 'Followup',
        stageEnteredAt: '2026-11-01T00:00:00.000Z',
        projectName: 'Alpha',
        assignedTo: 'Ram',
        source: 'CP',
        interactionIds: [],
        stageHistory: [],
      },
    ],
    interactions: [],
    calls: [],
    projects: [{ projectName: 'Alpha', customerIds: [], processIds: [] }],
    executives: [{ executiveName: 'Ram', customerIds: [], processIds: [] }],
    followUps: [
      {
        customerId: 'c1',
        salesProcessId: 'p1',
        nextFollowUpDate: '2026-11-08T00:00:00.000Z',
        revisitDate: null,
        assignedTo: 'Ram',
        currentStage: 'Followup',
      },
    ],
    classifications: [
      {
        customerId: 'c1',
        salesProcessId: 'p1',
        currentStage: 'Followup',
        primaryCategory: 'GONE_DARK',
        underlyingFlags: ['GONE_DARK', 'STUCK'],
        callDataStatus: 'OK',
        missingFields: [],
        recommendedAction: 'act',
        reasons: {},
        evidence: {},
        ruleResults: {},
      },
    ],
    reviews: [],
    overrides: [],
    dataHealth: {
      totalRows: 1,
      validCustomers: 1,
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
    builtAt: '2026-11-07T00:00:00.000Z',
    callTotal: 0,
    interactionTotal: 0,
  };
}

describe('compactWire', () => {
  it('round-trips lead fields', () => {
    const wire = toCompactWire(sampleSnapshot());
    expect(wire.v).toBe(1);
    expect(wire.leads).toHaveLength(1);
    expect(JSON.stringify(wire).length).toBeLessThan(1500);

    const restored = fromCompactWire(wire);
    expect(restored.customers[0]?.name).toBe('Ada');
    expect(restored.processes[0]?.assignedTo).toBe('Ram');
    expect(restored.classifications[0]?.primaryCategory).toBe('GONE_DARK');
    expect(restored.classifications[0]?.underlyingFlags).toEqual([
      'GONE_DARK',
      'STUCK',
    ]);
    expect(restored.followUps).toHaveLength(1);
  });

  it('tolerates nulls in lead tuples from JSON replacer', () => {
    const wire = toCompactWire(sampleSnapshot());
    wire.leads[0] = [
      'p1',
      'c1',
      'Ada',
      '999',
      'Followup',
      'Ram',
      'Alpha',
      null as unknown as string,
      'G',
      'O',
      '2026-11-01',
      null as unknown as string,
      '2026-11-01',
      '2026-11-06',
    ];
    const restored = fromCompactWire(wire);
    expect(restored.customers).toHaveLength(1);
    expect(restored.classifications[0]?.primaryCategory).toBe('GONE_DARK');
    expect(restored.classifications[0]?.underlyingFlags).toEqual([]);
    expect(restored.processes[0]?.lastCallDate).toBe('2026-11-06');
  });
});
