import { describe, expect, it } from 'vitest';
import {
  buildProcessIdsByCallDay,
  buildProcessIdsByInteractionDay,
  processIdsMatchingDateRange,
  sumCallsInDateRange,
} from '../dateIndex';
import { applyGlobalFilters } from '../filters';
import type { CallRecord, Interaction, SalesProcess } from '../types';

describe('dateIndex', () => {
  it('indexes interaction days and matches date filters', () => {
    const interactions = [
      {
        salesProcessId: 'p1',
        interactionDate: '2026-11-06T10:00:00.000Z',
      },
      {
        salesProcessId: 'p2',
        interactionDate: '2026-11-05T10:00:00.000Z',
      },
    ] as Interaction[];

    const byDay = buildProcessIdsByInteractionDay(interactions);
    expect(byDay['2026-11-06']).toContain('p1');
    expect(processIdsMatchingDateRange(byDay, {
      dateFrom: '2026-11-06',
      dateTo: '2026-11-06',
    })?.has('p1')).toBe(true);
    expect(processIdsMatchingDateRange(byDay, {
      dateFrom: '2026-11-06',
      dateTo: '2026-11-06',
    })?.has('p2')).toBe(false);
  });

  it('filters processes via call-day index when calls preview is empty', () => {
    const processes = [
      {
        salesProcessId: 'p1',
        customerId: 'c1',
        processName: '',
        currentStage: 'Followup',
        currentStageRaw: '',
        stageEnteredAt: '2026-06-01T00:00:00.000Z',
        interactionIds: [],
        stageHistory: [],
      },
      {
        salesProcessId: 'p2',
        customerId: 'c2',
        processName: '',
        currentStage: 'Followup',
        currentStageRaw: '',
        stageEnteredAt: '2026-06-01T00:00:00.000Z',
        interactionIds: [],
        stageHistory: [],
      },
    ] as SalesProcess[];

    const calls = [
      {
        callRecordId: '1',
        customerId: 'c1',
        salesProcessId: 'p1',
        callAt: '2026-11-06T08:00:00.000Z',
        callExecutive: 'Shubham',
      },
    ] as CallRecord[];

    const processIdsByCallDay = buildProcessIdsByCallDay(calls);
    const filtered = applyGlobalFilters(
      {
        customers: [],
        processes,
        interactions: [],
        calls: [],
        followUps: [],
        classifications: [],
        processIdsByCallDay,
      },
      {
        dateFrom: '2026-11-06',
        dateTo: '2026-11-06',
        dateField: 'call',
      },
    );

    expect(filtered.processes.map((p) => p.salesProcessId)).toEqual(['p1']);
    expect(
      sumCallsInDateRange(
        [{ date: '2026-11-06', total: 42 }],
        { dateFrom: '2026-11-06', dateTo: '2026-11-06' },
      ),
    ).toBe(42);
  });
});
