/**
 * Vitest coverage for all six classification rules, exclusions,
 * duplicate/customer-id handling, and date parsing.
 */

import { describe, expect, it } from 'vitest';
import { parseFlexibleDate, calendarDateKey, toKolkataIso } from '../../dates';
import {
  buildRelationalModel,
  mapRawRow,
  normalizePhone,
  normalizeStage,
  detectDuplicates,
} from '../../normalize';
import { importFromCsv } from '../../import';
import { importCallsFromCsv } from '../../runo';
import {
  consecutiveUnansweredDistinctDates,
  answeredDistinctDates,
  longestAnsweredDuration,
  callsAfter,
  sortCallsChronologically,
} from '../helpers';
import {
  evaluateGoneDark,
  evaluateNotPickingUp,
  evaluateMismarkedNi,
  evaluateStuck,
  evaluateVeryHighIntent,
  evaluateHighIntent,
} from '../rules';
import { classifyLead } from '../engine';
import type { CallRecord, RawSheetRow } from '../../types';
import { readFileSync } from 'fs';
import path from 'path';

function call(
  partial: Partial<CallRecord> & { callAt: string; answered: boolean },
): CallRecord {
  return {
    callRecordId: partial.callRecordId ?? `c-${partial.callAt}`,
    customerId: partial.customerId ?? 'CUST-X',
    callAt: partial.callAt,
    callOutcome: partial.answered ? 'answered' : 'unanswered',
    answered: partial.answered,
    durationSeconds: partial.durationSeconds ?? (partial.answered ? 60 : 0),
    ...partial,
  };
}

function iso(y: number, m: number, d: number, h = 10): string {
  return toKolkataIso(y, m, d, h, 0, 0);
}

describe('date parsing', () => {
  it('parses DD/MM/YYYY', () => {
    const d = parseFlexibleDate('15/01/2026');
    expect(d).not.toBeNull();
    expect(calendarDateKey(d)).toBe('2026-01-15');
  });

  it('parses DD/MM/YYYY with time', () => {
    const d = parseFlexibleDate('15/01/2026 14:30');
    expect(d).not.toBeNull();
    expect(calendarDateKey(d)).toBe('2026-01-15');
  });

  it('parses ISO dates', () => {
    const d = parseFlexibleDate('2026-01-15T10:00:00+05:30');
    expect(calendarDateKey(d)).toBe('2026-01-15');
  });

  it('returns null for garbage', () => {
    expect(parseFlexibleDate('not-a-date')).toBeNull();
    expect(parseFlexibleDate('')).toBeNull();
    expect(parseFlexibleDate(null)).toBeNull();
  });

  it('calendarDateKey uses Asia/Kolkata', () => {
    const key = calendarDateKey(iso(2026, 3, 5, 1));
    expect(key).toBe('2026-03-05');
  });
});

describe('stage normalization', () => {
  it('maps Cold Followup variants', () => {
    expect(normalizeStage('Cold Followup')).toBe('Cold Followup');
    expect(normalizeStage('Cold Follow-up')).toBe('Cold Followup');
    expect(normalizeStage('Cold Follow')).toBe('Cold Followup');
  });

  it('maps Followup variants', () => {
    expect(normalizeStage('Followup')).toBe('Followup');
    expect(normalizeStage('Follow-up')).toBe('Followup');
    expect(normalizeStage('Follow Up')).toBe('Followup');
  });

  it('maps site visit / revisit / NI / closed aliases', () => {
    expect(normalizeStage('Site Visit Done')).toBe('Site Visit Done');
    expect(normalizeStage('SV Done')).toBe('Site Visit Done');
    expect(normalizeStage('Revisit Done')).toBe('Revisit Done');
    expect(normalizeStage('Not Interested')).toBe('Not Interested');
    expect(normalizeStage('NI')).toBe('Not Interested');
    expect(normalizeStage('Sales Closed')).toBe('Sales Closed');
    expect(normalizeStage('Booked')).toBe('Sales Closed');
    expect(normalizeStage('Booking Done')).toBe('Sales Closed');
  });

  it('maps Not Picking as status (not classification)', () => {
    expect(normalizeStage('Not Picking')).toBe('Not Picking');
  });
});

describe('phone + customer grouping', () => {
  it('normalizePhone strips +91 and leading 0', () => {
    expect(normalizePhone('+91 98765 43210')).toBe('9876543210');
    expect(normalizePhone('09876543210')).toBe('9876543210');
  });

  it('groups multiple interactions under one Customer Id', () => {
    const rows: RawSheetRow[] = [
      mapRawRow({
        'Customer Id': 'CUST-A',
        Name: 'A',
        'Mobile Num': '9876500001',
        Status: 'Interested',
        'Process Name': 'Primary',
        'Interaction Date': '01/01/2026',
      }),
      mapRawRow({
        'Customer Id': 'CUST-A',
        Name: 'A',
        'Mobile Num': '9876500001',
        Status: 'Interested',
        'Process Name': 'Primary',
        'Interaction Date': '05/01/2026',
      }),
    ];
    const model = buildRelationalModel(rows);
    expect(model.customers).toHaveLength(1);
    expect(model.interactions).toHaveLength(2);
    expect(model.processes).toHaveLength(1);
  });

  it('never merges different Customer Ids by name', () => {
    const rows: RawSheetRow[] = [
      mapRawRow({
        'Customer Id': 'CUST-1',
        Name: 'Same Name',
        'Mobile Num': '9876500011',
        Status: 'Interested',
        'Interaction Date': '01/01/2026',
      }),
      mapRawRow({
        'Customer Id': 'CUST-2',
        Name: 'Same Name',
        'Mobile Num': '9876500012',
        Status: 'Interested',
        'Interaction Date': '02/01/2026',
      }),
    ];
    const model = buildRelationalModel(rows);
    expect(model.customers).toHaveLength(2);
  });

  it('keeps unmatched row when Customer Id missing and phone unsafe', () => {
    const rows: RawSheetRow[] = [
      mapRawRow({
        'Customer Id': 'CUST-AMB',
        Name: 'With Id',
        'Mobile Num': '9876500999',
        Status: 'Cold',
        'Interaction Date': '01/01/2026',
      }),
      mapRawRow({
        Name: 'No Id Same Phone',
        'Mobile Num': '9876500999',
        Status: 'Cold',
        'Interaction Date': '02/01/2026',
      }),
      mapRawRow({
        Name: 'No Id No Phone',
        Status: 'Interested',
        'Interaction Date': '03/01/2026',
      }),
    ];
    const model = buildRelationalModel(rows);
    expect(model.unmatchedRows.length).toBeGreaterThanOrEqual(1);
    expect(
      model.dataHealth.issues.some((i) => i.code === 'UNMATCHED_ROW'),
    ).toBe(true);
  });

  it('detectDuplicates flags phone multi-customer', () => {
    const rows: RawSheetRow[] = [
      mapRawRow({
        'Customer Id': 'A',
        'Mobile Num': '9876500888',
        Status: 'Cold',
      }),
      mapRawRow({
        'Customer Id': 'B',
        'Mobile Num': '9876500888',
        Status: 'Cold',
      }),
    ];
    const issues = detectDuplicates(rows);
    expect(
      issues.some((i) => i.code === 'DUPLICATE_PHONE_MULTI_CUSTOMER'),
    ).toBe(true);
  });
});

describe('call helpers', () => {
  it('sorts chronologically', () => {
    const calls = [
      call({ callAt: iso(2026, 1, 3), answered: false }),
      call({ callAt: iso(2026, 1, 1), answered: true }),
      call({ callAt: iso(2026, 1, 2), answered: false }),
    ];
    const sorted = sortCallsChronologically(calls);
    expect(calendarDateKey(sorted[0].callAt)).toBe('2026-01-01');
    expect(calendarDateKey(sorted[2].callAt)).toBe('2026-01-03');
  });

  it('counts same-day unanswered as one distinct date', () => {
    const calls = [
      call({ callAt: iso(2026, 1, 10, 9), answered: false }),
      call({ callAt: iso(2026, 1, 10, 15), answered: false }),
      call({ callAt: iso(2026, 1, 11, 9), answered: false }),
      call({ callAt: iso(2026, 1, 12, 9), answered: false }),
    ];
    expect(consecutiveUnansweredDistinctDates(calls)).toBe(3);
  });

  it('answered resets unanswered streak', () => {
    const calls = [
      call({ callAt: iso(2026, 1, 10), answered: false }),
      call({ callAt: iso(2026, 1, 11), answered: false }),
      call({ callAt: iso(2026, 1, 12), answered: true }),
      call({ callAt: iso(2026, 1, 13), answered: false }),
    ];
    expect(consecutiveUnansweredDistinctDates(calls)).toBe(1);
  });

  it('answeredDistinctDates only counts answered', () => {
    const calls = [
      call({ callAt: iso(2026, 1, 10), answered: true }),
      call({ callAt: iso(2026, 1, 10, 15), answered: true }),
      call({ callAt: iso(2026, 1, 11), answered: false }),
      call({ callAt: iso(2026, 1, 12), answered: true }),
    ];
    expect(answeredDistinctDates(calls)).toEqual(['2026-01-10', '2026-01-12']);
  });

  it('longestAnsweredDuration', () => {
    const calls = [
      call({ callAt: iso(2026, 1, 10), answered: true, durationSeconds: 15 }),
      call({ callAt: iso(2026, 1, 11), answered: true, durationSeconds: 20 }),
      call({ callAt: iso(2026, 1, 12), answered: false, durationSeconds: 0 }),
    ];
    expect(longestAnsweredDuration(calls)).toBe(20);
  });

  it('callsAfter filters by stage entry', () => {
    const calls = [
      call({ callAt: iso(2026, 1, 5), answered: true }),
      call({ callAt: iso(2026, 1, 10), answered: false }),
      call({ callAt: iso(2026, 1, 12), answered: false }),
    ];
    const post = callsAfter(calls, iso(2026, 1, 10));
    expect(post).toHaveLength(2);
  });
});

describe('GONE DARK', () => {
  const stageEnteredAt = iso(2026, 1, 5);

  it('flags >=2 consecutive unanswered distinct dates after SV Scheduled', () => {
    const result = evaluateGoneDark({
      currentStage: 'Site Visit Scheduled',
      stageEnteredAt,
      calls: [
        call({ callAt: iso(2026, 1, 6), answered: true }),
        call({ callAt: iso(2026, 1, 20), answered: false }),
        call({ callAt: iso(2026, 1, 22), answered: false }),
      ],
    });
    expect(result.flagged).toBe(true);
  });

  it('flags for Site Visit Done and Revisit Done', () => {
    const calls = [
      call({ callAt: iso(2026, 1, 20), answered: false }),
      call({ callAt: iso(2026, 1, 21), answered: false }),
    ];
    expect(
      evaluateGoneDark({
        currentStage: 'Site Visit Done',
        stageEnteredAt,
        calls,
      }).flagged,
    ).toBe(true);
    expect(
      evaluateGoneDark({
        currentStage: 'Revisit Done',
        stageEnteredAt,
        calls,
      }).flagged,
    ).toBe(true);
  });

  it('does not flag Interested stage', () => {
    expect(
      evaluateGoneDark({
        currentStage: 'Interested',
        stageEnteredAt,
        calls: [
          call({ callAt: iso(2026, 1, 20), answered: false }),
          call({ callAt: iso(2026, 1, 21), answered: false }),
        ],
      }).flagged,
    ).toBe(false);
  });

  it('answered resets streak below threshold', () => {
    const result = evaluateGoneDark({
      currentStage: 'Site Visit Scheduled',
      stageEnteredAt,
      calls: [
        call({ callAt: iso(2026, 1, 20), answered: false }),
        call({ callAt: iso(2026, 1, 21), answered: true }),
        call({ callAt: iso(2026, 1, 22), answered: false }),
      ],
    });
    expect(result.flagged).toBe(false);
  });

  it('returns INSUFFICIENT when no calls', () => {
    const result = evaluateGoneDark({
      currentStage: 'Site Visit Scheduled',
      stageEnteredAt,
      calls: [],
    });
    expect(result.flagged).toBe(false);
    expect(result.insufficientCallData).toBe(true);
    expect(result.missingFields).toContain('calls');
  });
});

describe('NOT PICKING UP', () => {
  const stageEnteredAt = iso(2026, 1, 10);

  it('flags >=3 consecutive unanswered distinct dates for Interested', () => {
    const result = evaluateNotPickingUp({
      currentStage: 'Interested',
      stageEnteredAt,
      calls: [
        call({ callAt: iso(2026, 1, 11), answered: false }),
        call({ callAt: iso(2026, 1, 11, 15), answered: false }),
        call({ callAt: iso(2026, 1, 13), answered: false }),
        call({ callAt: iso(2026, 1, 15), answered: false }),
      ],
    });
    expect(result.flagged).toBe(true);
    expect(result.evidence.consecutiveUnansweredDates).toBe(3);
  });

  it('qualifies Cold, Followup, Cold Followup', () => {
    const calls = [
      call({ callAt: iso(2026, 1, 12), answered: false }),
      call({ callAt: iso(2026, 1, 14), answered: false }),
      call({ callAt: iso(2026, 1, 16), answered: false }),
    ];
    for (const stage of ['Cold', 'Followup', 'Cold Followup'] as const) {
      expect(
        evaluateNotPickingUp({ currentStage: stage, stageEnteredAt, calls })
          .flagged,
      ).toBe(true);
    }
  });

  it('does not treat status Not Picking as this rule by stage alone without calls pattern', () => {
    // Stage Not Picking is NOT a qualifying stage for the rule
    const result = evaluateNotPickingUp({
      currentStage: 'Not Picking',
      stageEnteredAt,
      calls: [
        call({ callAt: iso(2026, 1, 12), answered: false }),
        call({ callAt: iso(2026, 1, 14), answered: false }),
        call({ callAt: iso(2026, 1, 16), answered: false }),
      ],
    });
    expect(result.flagged).toBe(false);
  });

  it('insufficient without calls', () => {
    const result = evaluateNotPickingUp({
      currentStage: 'Interested',
      stageEnteredAt,
      calls: undefined,
    });
    expect(result.insufficientCallData).toBe(true);
    expect(result.flagged).toBe(false);
  });
});

describe('MISMARKED NI', () => {
  it('flags never answered when call records exist', () => {
    const result = evaluateMismarkedNi({
      currentStage: 'Not Interested',
      stageEnteredAt: iso(2026, 1, 10),
      calls: [
        call({ callAt: iso(2026, 1, 9), answered: false }),
        call({ callAt: iso(2026, 1, 10), answered: false }),
      ],
    });
    expect(result.flagged).toBe(true);
    expect(result.evidence.neverAnswered).toBe(true);
  });

  it('flags when longest answered duration <= 20s (20 qualifies)', () => {
    expect(
      evaluateMismarkedNi({
        currentStage: 'Not Interested',
        stageEnteredAt: iso(2026, 1, 10),
        calls: [
          call({ callAt: iso(2026, 1, 9), answered: true, durationSeconds: 20 }),
        ],
      }).flagged,
    ).toBe(true);
  });

  it('does not flag when longest answered duration is 21s', () => {
    expect(
      evaluateMismarkedNi({
        currentStage: 'Not Interested',
        stageEnteredAt: iso(2026, 1, 10),
        calls: [
          call({ callAt: iso(2026, 1, 9), answered: true, durationSeconds: 21 }),
        ],
      }).flagged,
    ).toBe(false);
  });

  it('insufficient when NO call records', () => {
    const result = evaluateMismarkedNi({
      currentStage: 'Not Interested',
      stageEnteredAt: iso(2026, 1, 10),
      calls: [],
    });
    expect(result.flagged).toBe(false);
    expect(result.insufficientCallData).toBe(true);
  });

  it('does not apply outside Not Interested', () => {
    expect(
      evaluateMismarkedNi({
        currentStage: 'Interested',
        stageEnteredAt: iso(2026, 1, 10),
        calls: [
          call({ callAt: iso(2026, 1, 9), answered: true, durationSeconds: 5 }),
        ],
      }).flagged,
    ).toBe(false);
  });
});

describe('STUCK', () => {
  it('flags >=3 answered distinct dates with No Progress for Interested', () => {
    const result = evaluateStuck({
      currentStage: 'Interested',
      stageEnteredAt: iso(2026, 1, 5),
      calls: [
        call({ callAt: iso(2026, 1, 6), answered: true }),
        call({ callAt: iso(2026, 1, 8), answered: true }),
        call({ callAt: iso(2026, 1, 10), answered: true }),
      ],
    });
    expect(result.flagged).toBe(true);
    expect(result.evidence.stuckReason).toBe('No Progress');
  });

  it('uses stage-specific reasons', () => {
    const calls = [
      call({ callAt: iso(2026, 1, 6), answered: true }),
      call({ callAt: iso(2026, 1, 8), answered: true }),
      call({ callAt: iso(2026, 1, 10), answered: true }),
    ];
    expect(
      evaluateStuck({
        currentStage: 'Site Visit Scheduled',
        stageEnteredAt: iso(2026, 1, 5),
        calls,
      }).evidence.stuckReason,
    ).toBe('Site Visit Pending');
    expect(
      evaluateStuck({
        currentStage: 'Site Visit Done',
        stageEnteredAt: iso(2026, 1, 5),
        calls,
      }).evidence.stuckReason,
    ).toBe('Decision Pending');
    expect(
      evaluateStuck({
        currentStage: 'Revisit Done',
        stageEnteredAt: iso(2026, 1, 5),
        calls,
      }).evidence.stuckReason,
    ).toBe('Booking Pending');
  });

  it('only answered calls count', () => {
    const result = evaluateStuck({
      currentStage: 'Cold',
      stageEnteredAt: iso(2026, 1, 5),
      calls: [
        call({ callAt: iso(2026, 1, 6), answered: true }),
        call({ callAt: iso(2026, 1, 7), answered: false }),
        call({ callAt: iso(2026, 1, 8), answered: false }),
        call({ callAt: iso(2026, 1, 9), answered: false }),
      ],
    });
    expect(result.flagged).toBe(false);
  });

  it('insufficient without calls', () => {
    const result = evaluateStuck({
      currentStage: 'Interested',
      stageEnteredAt: iso(2026, 1, 5),
      calls: null,
    });
    expect(result.insufficientCallData).toBe(true);
    expect(result.flagged).toBe(false);
  });
});

describe('VERY HIGH INTENT', () => {
  it('flags Revisit Done with >=2 answered distinct dates', () => {
    const result = evaluateVeryHighIntent({
      currentStage: 'Revisit Done',
      stageEnteredAt: iso(2026, 1, 20),
      calls: [
        call({ callAt: iso(2026, 1, 21), answered: true }),
        call({ callAt: iso(2026, 1, 23), answered: true }),
      ],
    });
    expect(result.flagged).toBe(true);
  });

  it('does not flag other stages', () => {
    expect(
      evaluateVeryHighIntent({
        currentStage: 'Site Visit Done',
        stageEnteredAt: iso(2026, 1, 20),
        calls: [
          call({ callAt: iso(2026, 1, 21), answered: true }),
          call({ callAt: iso(2026, 1, 23), answered: true }),
        ],
      }).flagged,
    ).toBe(false);
  });
});

describe('HIGH INTENT', () => {
  it('flags Site Visit Done with >=2 answered distinct dates', () => {
    const result = evaluateHighIntent({
      currentStage: 'Site Visit Done',
      stageEnteredAt: iso(2026, 1, 22),
      calls: [
        call({ callAt: iso(2026, 1, 23), answered: true }),
        call({ callAt: iso(2026, 1, 25), answered: true }),
      ],
    });
    expect(result.flagged).toBe(true);
  });

  it('insufficient without calls', () => {
    const result = evaluateHighIntent({
      currentStage: 'Site Visit Done',
      stageEnteredAt: iso(2026, 1, 22),
      calls: [],
    });
    expect(result.insufficientCallData).toBe(true);
    expect(result.flagged).toBe(false);
  });
});

describe('classifyLead engine — priority & exclusions', () => {
  it('prefers GONE_DARK over STUCK when both flag', () => {
    // Revisit Done + 3 answered dates (stuck) + 2 trailing unanswered (gone dark)
    const result = classifyLead({
      customerId: 'X',
      salesProcessId: 'X::p',
      currentStage: 'Revisit Done',
      stageEnteredAt: iso(2026, 1, 5),
      calls: [
        call({ callAt: iso(2026, 1, 6), answered: true }),
        call({ callAt: iso(2026, 1, 8), answered: true }),
        call({ callAt: iso(2026, 1, 10), answered: true }),
        call({ callAt: iso(2026, 1, 20), answered: false }),
        call({ callAt: iso(2026, 1, 21), answered: false }),
      ],
    });
    expect(result.underlyingFlags).toContain('GONE_DARK');
    expect(result.underlyingFlags).toContain('STUCK');
    expect(result.primaryCategory).toBe('GONE_DARK');
    // VHI excluded due to ops flags
    expect(result.underlyingFlags).not.toContain('VERY_HIGH_INTENT');
  });

  it('excludes HIGH INTENT when Stuck', () => {
    const result = classifyLead({
      customerId: 'X',
      salesProcessId: 'X::p',
      currentStage: 'Site Visit Done',
      stageEnteredAt: iso(2026, 1, 5),
      calls: [
        call({ callAt: iso(2026, 1, 6), answered: true }),
        call({ callAt: iso(2026, 1, 8), answered: true }),
        call({ callAt: iso(2026, 1, 10), answered: true }),
      ],
    });
    expect(result.underlyingFlags).toContain('STUCK');
    expect(result.underlyingFlags).not.toContain('HIGH_INTENT');
    expect(result.primaryCategory).toBe('STUCK');
  });

  it('excludes opportunity categories for Sales Closed / NI / Spam / DND', () => {
    for (const stage of ['Sales Closed', 'Not Interested', 'Spam', 'DND'] as const) {
      const result = classifyLead({
        customerId: 'X',
        salesProcessId: 'X::p',
        currentStage: stage,
        stageEnteredAt: iso(2026, 1, 5),
        calls: [
          call({ callAt: iso(2026, 1, 6), answered: true }),
          call({ callAt: iso(2026, 1, 8), answered: true }),
        ],
      });
      expect(result.underlyingFlags).not.toContain('HIGH_INTENT');
      expect(result.underlyingFlags).not.toContain('VERY_HIGH_INTENT');
    }
  });

  it('returns VERY_HIGH_INTENT when clean Revisit Done', () => {
    const result = classifyLead({
      customerId: 'CUST-VHI-001',
      salesProcessId: 'p',
      currentStage: 'Revisit Done',
      stageEnteredAt: iso(2026, 1, 20),
      calls: [
        call({ callAt: iso(2026, 1, 21), answered: true }),
        call({ callAt: iso(2026, 1, 23), answered: true }),
      ],
    });
    expect(result.primaryCategory).toBe('VERY_HIGH_INTENT');
    expect(result.callDataStatus).toBe('OK');
  });

  it('returns HIGH_INTENT when clean Site Visit Done', () => {
    const result = classifyLead({
      customerId: 'CUST-HI-001',
      salesProcessId: 'p',
      currentStage: 'Site Visit Done',
      stageEnteredAt: iso(2026, 1, 22),
      calls: [
        call({ callAt: iso(2026, 1, 23), answered: true }),
        call({ callAt: iso(2026, 1, 25), answered: true }),
      ],
    });
    expect(result.primaryCategory).toBe('HIGH_INTENT');
  });

  it('sets INSUFFICIENT_CALL_DATA when qualifying stage has no calls', () => {
    const result = classifyLead({
      customerId: 'X',
      salesProcessId: 'p',
      currentStage: 'Site Visit Scheduled',
      stageEnteredAt: iso(2026, 1, 5),
      calls: [],
    });
    expect(result.callDataStatus).toBe('INSUFFICIENT_CALL_DATA');
    expect(result.primaryCategory).toBe('NONE');
    expect(result.missingFields).toContain('calls');
  });

  it('preserves evidence for every rule', () => {
    const result = classifyLead({
      customerId: 'X',
      salesProcessId: 'p',
      currentStage: 'Interested',
      stageEnteredAt: iso(2026, 1, 5),
      calls: [
        call({ callAt: iso(2026, 1, 6), answered: true }),
        call({ callAt: iso(2026, 1, 8), answered: true }),
        call({ callAt: iso(2026, 1, 10), answered: true }),
      ],
    });
    expect(result.evidence.GONE_DARK).toBeDefined();
    expect(result.evidence.NOT_PICKING_UP).toBeDefined();
    expect(result.evidence.MISMARKED_NI).toBeDefined();
    expect(result.evidence.STUCK).toBeDefined();
    expect(result.evidence.VERY_HIGH_INTENT).toBeDefined();
    expect(result.evidence.HIGH_INTENT).toBeDefined();
    expect(result.recommendedAction.length).toBeGreaterThan(10);
  });
});

describe('synthetic dataset integration', () => {
  const crmPath = path.join(
    process.cwd(),
    'data/synthetic/yashodhan_crm_synthetic.csv',
  );
  const callsPath = path.join(
    process.cwd(),
    'data/synthetic/yashodhan_calls_synthetic.csv',
  );

  it('imports CRM CSV with 35 headers and retains invalid rows', () => {
    const csv = readFileSync(crmPath, 'utf8');
    const result = importFromCsv(csv);
    expect(result.rows.length).toBeGreaterThanOrEqual(40);
    expect(result.mappedKeys).toContain('customerId');
    expect(result.mappedKeys).toContain('projectName');
    // Unmatchable row retained
    expect(result.rows.some((r) => !r.customerId && !r.mobileNum)).toBe(true);
  });

  it('builds model and classifies synthetic customers as expected', () => {
    const crm = importFromCsv(readFileSync(crmPath, 'utf8'));
    const { calls } = importCallsFromCsv(readFileSync(callsPath, 'utf8'));
    const model = buildRelationalModel(crm.rows);

    expect(model.customers.length).toBeGreaterThan(10);
    // Multiple interactions for CUST-GD-001 → still one customer
    const gd = model.customers.find((c) => c.customerId === 'CUST-GD-001');
    expect(gd).toBeDefined();
    expect(gd!.interactionIds.length).toBeGreaterThan(1);

    const byId = (id: string) =>
      model.processes.find((p) => p.customerId === id)!;

    const classify = (id: string) => {
      const p = byId(id);
      const c = calls.filter((x) => x.customerId === id);
      return classifyLead({
        customerId: id,
        salesProcessId: p.salesProcessId,
        currentStage: p.currentStage,
        stageEnteredAt: p.stageEnteredAt,
        calls: c,
      });
    };

    expect(classify('CUST-GD-001').primaryCategory).toBe('GONE_DARK');
    expect(classify('CUST-NPU-001').primaryCategory).toBe('NOT_PICKING_UP');
    expect(classify('CUST-MNI-001').primaryCategory).toBe('MISMARKED_NI');
    expect(classify('CUST-MNI-002').primaryCategory).toBe('MISMARKED_NI');
    expect(classify('CUST-STK-001').primaryCategory).toBe('STUCK');
    expect(classify('CUST-VHI-001').primaryCategory).toBe('VERY_HIGH_INTENT');
    expect(classify('CUST-HI-001').primaryCategory).toBe('HIGH_INTENT');

    // Genuine NI with long call should NOT be mismarked
    expect(classify('CUST-MNI-003').primaryCategory).toBe('NONE');
    expect(classify('CUST-MNI-003').underlyingFlags).not.toContain('MISMARKED_NI');

    // Closed / Spam
    expect(classify('CUST-CLOSED-001').primaryCategory).toBe('NONE');
    expect(classify('CUST-SPAM-001').currentStage).toBe('Spam');
  });
});
