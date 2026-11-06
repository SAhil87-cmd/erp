import { describe, expect, it } from 'vitest';
import { parseFlexibleDate } from '../../dates';
import {
  deriveCrmRowsFromCallExport,
  importCallsFromCsv,
  repairDerivedStageEntryDates,
} from '../../runo';
import type { CallRecord, RawSheetRow } from '../../types';

const SAMPLE = `Call Id,Caller Name,Name,Phone,Call Start Date,Duration (in Sec),Call Type,Call Tag,Status,Caller Id,Customer Id,Process Name
6a1,Shubham,Spam,+916746646510,"01/06/2026, 16:44:24",7,incoming,answered,SPAM,b811,6a1d69b26ed28fc4d25e3aa8,Dwarika dham
6a2,Vishal,Nilesh,+917020575644,"01/06/2026, 17:52:49",,outgoing,unanswered,,ff45,699c56a55877cf2e0f1a6a04,Dwarika dham
6a3,Shubham,Unknown,+911408948235,"01/06/2026, 14:37:46",,missed,,,b811,,Dwarika dham
`;

describe('published Runo/Google call sheet import', () => {
  it('parses Call Start Date with comma separator', () => {
    const d = parseFlexibleDate('01/06/2026, 14:37:46');
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2026);
  });

  it('maps answered / unanswered / missed correctly', () => {
    const { calls, errors } = importCallsFromCsv(SAMPLE);
    expect(calls).toHaveLength(3);
    expect(calls[0].answered).toBe(true);
    expect(calls[0].durationSeconds).toBe(7);
    expect(calls[0].customerId).toBe('6a1d69b26ed28fc4d25e3aa8');
    expect(calls[0].callExecutive).toBe('Shubham');
    expect(calls[0].salesProcessName).toBe('Dwarika dham');

    expect(calls[1].answered).toBe(false);
    expect(calls[1].callOutcome).toBe('unanswered');

    expect(calls[2].answered).toBe(false);
    expect(calls[2].callOutcome).toBe('unanswered');
    // Missing Customer Id → stable phone key (must match CRM derivation)
    expect(calls[2].customerId).toBe('PHONE:1408948235');
    expect(errors.some((e) => e.includes('linked by phone'))).toBe(true);
  });

  it('derives CRM customer rows from call export', () => {
    const rows = deriveCrmRowsFromCallExport(SAMPLE);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const spam = rows.find((r) => r.customerId === '6a1d69b26ed28fc4d25e3aa8');
    expect(spam?.name).toBe('Spam');
    expect(spam?.status).toBe('Spam');
    expect(spam?.processName).toBe('Dwarika dham');
    const phoneLinked = rows.find((r) => r.customerId === 'PHONE:1408948235');
    expect(phoneLinked?.mobileNum).toContain('1408948235');
  });

  it('assumes earliest call as stage entry when status only appears on latest call', () => {
    const csv = `Call Id,Caller Name,Name,Phone,Call Start Date,Duration (in Sec),Call Type,Call Tag,Status,Caller Id,Customer Id,Process Name
c1,Ram,Akash,+917249376873,"03/06/2026, 14:19:38",,outgoing,unanswered,,x,CUST-GD-LIVE,Dwarika dham
c2,Ram,Akash,+917249376873,"05/06/2026, 16:13:03",40,outgoing,answered,,x,CUST-GD-LIVE,Dwarika dham
c3,Ram,Akash,+917249376873,"13/07/2026, 17:45:17",,outgoing,unanswered,Site Visit Done,x,CUST-GD-LIVE,Dwarika dham
`;
    const rows = deriveCrmRowsFromCallExport(csv);
    const row = rows.find((r) => r.customerId === 'CUST-GD-LIVE');
    expect(row?.status).toBe('Site Visit Done');
    // Status only on latest row → assume earliest call so Gone Dark can evaluate
    expect(row?.interactionDate).toContain('03/06/2026');
    expect(row?._flags).toContain('STAGE_ENTRY_ASSUMED_EARLIEST_CALL');
  });

  it('repairDerivedStageEntryDates snaps latest-call stage entry to earliest call', () => {
    const rows: RawSheetRow[] = [
      {
        customerId: 'C1',
        interactionDate: '2026-07-13T12:15:17.000Z',
        status: 'Site Visit Done',
        _flags: ['DERIVED_FROM_CALL_EXPORT'],
      },
    ];
    const calls: CallRecord[] = [
      {
        callRecordId: '1',
        customerId: 'C1',
        callAt: '2026-06-03T08:49:38.000Z',
        callOutcome: 'unanswered',
        answered: false,
        durationSeconds: 0,
      },
      {
        callRecordId: '2',
        customerId: 'C1',
        callAt: '2026-07-13T12:15:17.000Z',
        callOutcome: 'unanswered',
        answered: false,
        durationSeconds: 0,
      },
    ];
    const { rows: next, repaired } = repairDerivedStageEntryDates(rows, calls);
    expect(repaired).toBe(1);
    expect(next[0].interactionDate).toBe('2026-06-03T08:49:38.000Z');
  });
});
