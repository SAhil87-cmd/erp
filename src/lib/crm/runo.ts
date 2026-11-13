/**
 * Runo call-history sync — STUB / PENDING IMPLEMENTATION.
 * Fallback: importCallsFromCsv for offline / synthetic call data.
 */

import Papa from 'papaparse';
import { parseFlexibleDate, toKolkataIso } from './dates';
import { normalizePhone } from './normalize';
import type { CallOutcome, CallRecord, RawSheetRow } from './types';
import { yieldEventLoop } from './yield';

/**
 * Stable customer key for call ↔ CRM linking.
 * Prefer Customer Id; else PHONE:{normalizedDigits}. Never invent customers from names.
 */
export function resolveCallCustomerKey(
  customerId: string | null | undefined,
  phone: string | null | undefined,
): { key: string; matchedByPhone: boolean } | null {
  const id = (customerId ?? '').trim();
  if (id) return { key: id, matchedByPhone: false };
  const digits = normalizePhone(phone);
  if (digits) return { key: `PHONE:${digits}`, matchedByPhone: true };
  return null;
}

export interface RunoSyncResult {
  status: 'pending_credentials' | 'pending_implementation' | 'ok' | 'error';
  message: string;
  callCount?: number;
}

function readRunoEnv(): { apiKey?: string; missing: string[] } {
  const apiKey = process.env.RUNO_API_KEY;
  const missing: string[] = [];
  if (!apiKey) missing.push('RUNO_API_KEY');
  return { apiKey, missing };
}

/**
 * PENDING: Live Runo API sync is not implemented.
 * Never expose API keys to the frontend.
 */
export async function syncCallsFromRuno(): Promise<RunoSyncResult> {
  const env = readRunoEnv();
  if (env.missing.length > 0) {
    return {
      status: 'pending_credentials',
      message: `Runo sync pending credentials. Missing: ${env.missing.join(', ')}. Use importCallsFromCsv as fallback.`,
    };
  }
  return {
    status: 'pending_implementation',
    message:
      'PENDING: Runo API client is stubbed. Credentials detected; wire Runo call-history fetch and persist via store.saveCalls.',
  };
}

function parseAnswered(raw: string | undefined): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === 'yes' || v === 'true' || v === '1' || v === 'answered';
}

function parseOutcome(raw: string | undefined, answered: boolean): CallOutcome {
  if (raw) {
    const v = raw.trim().toLowerCase();
    if (v === 'answered' || v === 'yes') return 'answered';
    if (v === 'unanswered' || v === 'no' || v === 'missed' || v === 'not answered') {
      return 'unanswered';
    }
  }
  return answered ? 'answered' : 'unanswered';
}

function cell(
  row: Record<string, string>,
  ...keys: string[]
): string {
  for (const key of keys) {
    const direct = row[key];
    if (direct != null && String(direct).trim()) return String(direct).trim();
  }
  // Case-insensitive fallback
  const lowerMap = new Map(
    Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]),
  );
  for (const key of keys) {
    const v = lowerMap.get(key.trim().toLowerCase());
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

function deriveOutcomeFromRunoRow(row: Record<string, string>): {
  answered: boolean;
  callOutcome: CallOutcome;
} {
  const callType = cell(row, 'Call Type', 'callType', 'call_type').toLowerCase();
  const callTag = cell(row, 'Call Tag', 'callTag', 'callOutcome', 'CallOutcome', 'answered', 'Answered');
  const status = cell(row, 'Status', 'status').toLowerCase();

  if (callType === 'missed') {
    return { answered: false, callOutcome: 'unanswered' };
  }

  const answered = parseAnswered(callTag) || callTag.toLowerCase() === 'answered';
  if (answered) return { answered: true, callOutcome: 'answered' };

  const fromTag = parseOutcome(callTag, false);
  if (callTag) return { answered: fromTag === 'answered', callOutcome: fromTag };

  if (status === 'spam' || status === 'dnd') {
    // Status alone does not prove answer — rely on duration if present
  }

  const duration = Number(cell(row, 'Duration (in Sec)', 'durationSeconds', 'DurationSeconds', 'duration'));
  if (Number.isFinite(duration) && duration > 0) {
    return { answered: true, callOutcome: 'answered' };
  }

  return { answered: false, callOutcome: 'unanswered' };
}

/**
 * Fallback CSV importer for call history.
 * Supports synthetic columns and published Runo/Google exports:
 * Call Id, Caller Name, Name, Phone, Call Start Date, Duration (in Sec),
 * Call Type, Call Tag, Status, Caller Id, Customer Id, Process Name
 */
export function importCallsFromCsv(csvText: string): {
  calls: CallRecord[];
  errors: string[];
} {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const errors: string[] = [];
  for (const err of parsed.errors ?? []) {
    errors.push(err.message);
  }

  const calls: CallRecord[] = [];
  (parsed.data ?? []).forEach((row, idx) => {
    const rawCustomerId = cell(
      row,
      'customerId',
      'CustomerId',
      'Customer Id',
      'Customer ID',
    );
    const phone = cell(row, 'Phone', 'mobileNum', 'Mobile Num', 'phone');
    const resolved = resolveCallCustomerKey(rawCustomerId, phone);
    if (!resolved) {
      errors.push(
        `Row ${idx}: missing Customer Id and usable Phone — retained with UNKNOWN id`,
      );
    } else if (resolved.matchedByPhone) {
      errors.push(
        `Row ${idx}: missing Customer Id — linked by phone key ${resolved.key}`,
      );
    }
    const customerId = resolved?.key ?? `UNKNOWN-${idx}`;

    const { answered, callOutcome } = deriveOutcomeFromRunoRow(row);
    const startRaw = cell(
      row,
      'Call Start Date',
      'callStartDate',
      'callDate',
      'CallDate',
      'callAt',
      'CallAt',
    );
    const callDate = cell(row, 'callDate', 'CallDate') || startRaw;
    const callTime = cell(row, 'callTime', 'CallTime');
    let callAt = cell(row, 'callAt', 'CallAt');

    if (!callAt && (startRaw || callDate)) {
      const combined = callTime && !startRaw.includes(':')
        ? `${callDate} ${callTime}`
        : startRaw || callDate;
      const d = parseFlexibleDate(combined);
      if (d) {
        callAt = d.toISOString();
      } else {
        const normalized = combined.replace(/,\s+/g, ' ');
        const m = normalized.match(
          /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
        );
        if (m) {
          const day = Number(m[1]);
          const month = Number(m[2]);
          let year = Number(m[3]);
          if (year < 100) year += 2000;
          callAt = toKolkataIso(
            year,
            month,
            day,
            m[4] != null ? Number(m[4]) : 0,
            m[5] != null ? Number(m[5]) : 0,
            m[6] != null ? Number(m[6]) : 0,
          );
        } else {
          errors.push(`Row ${idx}: unparseable callDate "${combined}"`);
          callAt = combined;
        }
      }
    }

    const durationSeconds = Number(
      cell(
        row,
        'Duration (in Sec)',
        'durationSeconds',
        'DurationSeconds',
        'duration',
      ) || 0,
    );

    const record: CallRecord = {
      callRecordId: cell(row, 'Call Id', 'callRecordId', 'CallRecordId') || `CALL-IMPORT-${idx}`,
      customerId,
      callAt: callAt || new Date().toISOString(),
      callDate: callDate || undefined,
      callTime: callTime || undefined,
      callOutcome,
      answered: callOutcome === 'answered' ? true : answered,
      durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
      callExecutive:
        cell(row, 'Caller Name', 'callExecutive', 'CallExecutive') || undefined,
      salesProcessId:
        cell(row, 'salesProcessId', 'SalesProcessId') || undefined,
      salesProcessName:
        cell(row, 'Process Name', 'salesProcessName', 'SalesProcessName') ||
        undefined,
    };

    calls.push(record);
  });

  return { calls, errors };
}

/**
 * One-pass published call-sheet import that yields the event loop so NDJSON
 * heartbeats can flush during large Papa parses on Vercel.
 */
export async function importPublishedCallSheetAsync(
  csvText: string,
  opts?: { maxAgeDays?: number; maxCalls?: number },
): Promise<{
  calls: CallRecord[];
  errors: string[];
  derivedRows: RawSheetRow[];
}> {
  type Agg = {
    customerId: string;
    name: string;
    phone: string;
    processName: string;
    assignedTo: string;
    status: string;
    earliestAt: string;
    latestAt: string;
    statusEnteredAt: string;
  };

  const maxAgeDays = opts?.maxAgeDays;
  const maxCalls = opts?.maxCalls ?? 0;
  const cutoffMs =
    maxAgeDays && maxAgeDays > 0
      ? Date.now() - maxAgeDays * 86_400_000
      : null;

  const calls: CallRecord[] = [];
  const errors: string[] = [];
  const byKey = new Map<string, Agg>();
  const statusFirst = new Map<string, string>();
  let idx = 0;
  let sinceYield = 0;

  await new Promise<void>((resolve, reject) => {
    Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      step: (result, parser) => {
        const row = result.data;
        if (!row || typeof row !== 'object') return;

        const startProbe = cell(
          row,
          'Call Start Date',
          'callStartDate',
          'callDate',
          'CallDate',
          'callAt',
          'CallAt',
        );
        if (cutoffMs != null && startProbe) {
          const parsed = parseFlexibleDate(startProbe);
          if (parsed && parsed.getTime() < cutoffMs) {
            idx += 1;
            sinceYield += 1;
            if (sinceYield >= 2000) {
              sinceYield = 0;
              parser.pause();
              setImmediate(() => parser.resume());
            }
            return;
          }
        }
        if (maxCalls > 0 && calls.length >= maxCalls) {
          parser.abort();
          return;
        }

        const rawCustomerId = cell(
          row,
          'customerId',
          'CustomerId',
          'Customer Id',
          'Customer ID',
        );
        const phone = cell(row, 'Phone', 'mobileNum', 'Mobile Num', 'phone');
        const resolved = resolveCallCustomerKey(rawCustomerId, phone);
        if (!resolved) {
          errors.push(
            `Row ${idx}: missing Customer Id and usable Phone — retained with UNKNOWN id`,
          );
        } else if (resolved.matchedByPhone) {
          errors.push(
            `Row ${idx}: missing Customer Id — linked by phone key ${resolved.key}`,
          );
        }
        const customerId = resolved?.key ?? `UNKNOWN-${idx}`;

        const { answered, callOutcome } = deriveOutcomeFromRunoRow(row);
        const startRaw = cell(
          row,
          'Call Start Date',
          'callStartDate',
          'callDate',
          'CallDate',
          'callAt',
          'CallAt',
        );
        const callDate = cell(row, 'callDate', 'CallDate') || startRaw;
        const callTime = cell(row, 'callTime', 'CallTime');
        let callAt = cell(row, 'callAt', 'CallAt');

        if (!callAt && (startRaw || callDate)) {
          const combined =
            callTime && !startRaw.includes(':')
              ? `${callDate} ${callTime}`
              : startRaw || callDate;
          const d = parseFlexibleDate(combined);
          if (d) {
            callAt = d.toISOString();
          } else {
            const normalized = combined.replace(/,\s+/g, ' ');
            const m = normalized.match(
              /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
            );
            if (m) {
              const day = Number(m[1]);
              const month = Number(m[2]);
              let year = Number(m[3]);
              if (year < 100) year += 2000;
              callAt = toKolkataIso(
                year,
                month,
                day,
                m[4] != null ? Number(m[4]) : 0,
                m[5] != null ? Number(m[5]) : 0,
                m[6] != null ? Number(m[6]) : 0,
              );
            } else {
              errors.push(`Row ${idx}: unparseable callDate "${combined}"`);
              callAt = combined;
            }
          }
        }

        const durationSeconds = Number(
          cell(
            row,
            'Duration (in Sec)',
            'durationSeconds',
            'DurationSeconds',
            'duration',
          ) || 0,
        );

        calls.push({
          callRecordId:
            cell(row, 'Call Id', 'callRecordId', 'CallRecordId') ||
            `CALL-IMPORT-${idx}`,
          customerId,
          callAt: callAt || new Date().toISOString(),
          callDate: callDate || undefined,
          callTime: callTime || undefined,
          callOutcome,
          answered: callOutcome === 'answered' ? true : answered,
          durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
          callExecutive:
            cell(row, 'Caller Name', 'callExecutive', 'CallExecutive') ||
            undefined,
          salesProcessId:
            cell(row, 'salesProcessId', 'SalesProcessId') || undefined,
          salesProcessName:
            cell(row, 'Process Name', 'salesProcessName', 'SalesProcessName') ||
            undefined,
        });

        if (resolved && startRaw) {
          const name = cell(row, 'Name', 'name');
          const processName = cell(row, 'Process Name', 'processName');
          const assignedTo = cell(row, 'Caller Name', 'assignedTo');
          const statusRaw = cell(row, 'Status', 'status');
          const status = normalizeExportStatus(statusRaw);
          const key = resolved.key;
          const prev = byKey.get(key);
          if (!prev) {
            byKey.set(key, {
              customerId: key,
              name,
              phone,
              processName,
              assignedTo,
              status,
              earliestAt: startRaw,
              latestAt: startRaw,
              statusEnteredAt: startRaw,
            });
          } else {
            if (isEarlier(startRaw, prev.earliestAt)) prev.earliestAt = startRaw;
            if (isLater(startRaw, prev.latestAt)) {
              prev.latestAt = startRaw;
              if (name) prev.name = name;
              if (processName) prev.processName = processName;
              if (assignedTo) prev.assignedTo = assignedTo;
              if (statusRaw) {
                if (status !== prev.status) {
                  prev.status = status;
                  prev.statusEnteredAt = startRaw;
                }
              }
            } else if (
              statusRaw &&
              status === prev.status &&
              isEarlier(startRaw, prev.statusEnteredAt)
            ) {
              prev.statusEnteredAt = startRaw;
            }
          }

          const agg = byKey.get(key);
          if (agg) {
            const st = normalizeExportStatus(statusRaw);
            if (st === agg.status) {
              const prevFirst = statusFirst.get(key);
              if (!prevFirst || isEarlier(startRaw, prevFirst)) {
                statusFirst.set(key, startRaw);
              }
            }
          }
        }

        idx += 1;
        sinceYield += 1;
        if (sinceYield >= 600) {
          sinceYield = 0;
          parser.pause();
          setImmediate(() => parser.resume());
        }
      },
      complete: () => resolve(),
      error: (err: Error) => reject(err),
    });
  });

  await yieldEventLoop();

  const derivedRows: RawSheetRow[] = [...byKey.values()].map((agg, i) => {
    const sameStatusFirst = statusFirst.get(agg.customerId);
    const sameStatusOnlyOnLatest =
      sameStatusFirst &&
      !isEarlier(sameStatusFirst, agg.latestAt) &&
      isEarlier(agg.earliestAt, agg.latestAt);
    const stageEntry = sameStatusOnlyOnLatest
      ? agg.earliestAt
      : sameStatusFirst || agg.statusEnteredAt || agg.earliestAt;

    return {
      _rowIndex: i,
      interactionDate: stageEntry,
      customerId: agg.customerId,
      name: agg.name,
      mobileNum: agg.phone,
      assignedTo: agg.assignedTo,
      processName: agg.processName,
      status: agg.status,
      projectName: agg.processName,
      notes: `Last call: ${agg.latestAt}`,
      nextFollowUp: agg.latestAt,
      _flags: sameStatusOnlyOnLatest
        ? ['DERIVED_FROM_CALL_EXPORT', 'STAGE_ENTRY_ASSUMED_EARLIEST_CALL']
        : ['DERIVED_FROM_CALL_EXPORT'],
    };
  });

  return { calls, errors, derivedRows };
}

function normalizeExportStatus(statusRaw: string): string {
  const lower = statusRaw.toLowerCase().trim();
  if (!lower) return 'Followup';
  if (lower === 'spam') return 'Spam';
  if (lower === 'dnd') return 'DND';
  if (lower.includes('not picking')) return 'Not Picking';
  if (lower === 'not interested' || lower === 'ni') return 'Not Interested';
  return statusRaw.trim();
}

function isEarlier(a: string, b: string): boolean {
  const da = parseFlexibleDate(a);
  const db = parseFlexibleDate(b);
  if (!da) return false;
  if (!db) return true;
  return da.getTime() < db.getTime();
}

function isLater(a: string, b: string): boolean {
  const da = parseFlexibleDate(a);
  const db = parseFlexibleDate(b);
  if (!da) return false;
  if (!db) return true;
  return da.getTime() > db.getTime();
}

/**
 * Derive CRM interaction rows from a published call export.
 *
 * IMPORTANT: stage entry must NOT be the latest call time — that zeroes out
 * Gone Dark / Stuck / Intent rules that require post-stage calls.
 * We set interactionDate to the earliest call where the current status appears
 * (fallback: earliest call overall). Last contact is kept in notes.
 */
export function deriveCrmRowsFromCallExport(
  csvText: string,
): import('./types').RawSheetRow[] {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  type Agg = {
    customerId: string;
    name: string;
    phone: string;
    processName: string;
    assignedTo: string;
    status: string;
    earliestAt: string;
    latestAt: string;
    /** Earliest call timestamp observed with the current status string. */
    statusEnteredAt: string;
  };

  const byKey = new Map<string, Agg>();

  for (const row of parsed.data ?? []) {
    const rawCustomerId = cell(row, 'Customer Id', 'customerId', 'CustomerId');
    const phone = cell(row, 'Phone', 'mobileNum', 'Mobile Num');
    const resolved = resolveCallCustomerKey(rawCustomerId, phone);
    if (!resolved) continue;

    const key = resolved.key;
    const startRaw = cell(row, 'Call Start Date', 'callDate', 'CallDate');
    if (!startRaw) continue;

    const name = cell(row, 'Name', 'name');
    const processName = cell(row, 'Process Name', 'processName');
    const assignedTo = cell(row, 'Caller Name', 'assignedTo');
    const statusRaw = cell(row, 'Status', 'status');
    const status = normalizeExportStatus(statusRaw);

    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, {
        customerId: key,
        name,
        phone,
        processName,
        assignedTo,
        status,
        earliestAt: startRaw,
        latestAt: startRaw,
        statusEnteredAt: startRaw,
      });
      continue;
    }

    if (isEarlier(startRaw, prev.earliestAt)) prev.earliestAt = startRaw;
    if (isLater(startRaw, prev.latestAt)) {
      prev.latestAt = startRaw;
      if (name) prev.name = name;
      if (processName) prev.processName = processName;
      if (assignedTo) prev.assignedTo = assignedTo;
      // Current status follows the newest call that carries a status
      if (statusRaw) {
        if (status !== prev.status) {
          prev.status = status;
          prev.statusEnteredAt = startRaw;
        }
      }
    } else if (statusRaw && status === prev.status && isEarlier(startRaw, prev.statusEnteredAt)) {
      prev.statusEnteredAt = startRaw;
    }
  }

  // Second pass: earliest call that already carries the final status (when
  // Status is stamped historically). If status only appears on the newest
  // row, fall back to earliest call overall so Gone Dark / Stuck can evaluate.
  const statusFirst = new Map<string, string>();
  for (const row of parsed.data ?? []) {
    const rawCustomerId = cell(row, 'Customer Id', 'customerId', 'CustomerId');
    const phone = cell(row, 'Phone', 'mobileNum', 'Mobile Num');
    const resolved = resolveCallCustomerKey(rawCustomerId, phone);
    if (!resolved) continue;
    const agg = byKey.get(resolved.key);
    if (!agg) continue;
    const startRaw = cell(row, 'Call Start Date', 'callDate', 'CallDate');
    if (!startRaw) continue;
    const status = normalizeExportStatus(cell(row, 'Status', 'status'));
    if (status !== agg.status) continue;
    const prev = statusFirst.get(resolved.key);
    if (!prev || isEarlier(startRaw, prev)) statusFirst.set(resolved.key, startRaw);
  }

  return [...byKey.values()].map((agg, idx) => {
    const sameStatusFirst = statusFirst.get(agg.customerId);
    const sameStatusOnlyOnLatest =
      sameStatusFirst &&
      !isEarlier(sameStatusFirst, agg.latestAt) &&
      isEarlier(agg.earliestAt, agg.latestAt);
    const stageEntry = sameStatusOnlyOnLatest
      ? agg.earliestAt
      : sameStatusFirst || agg.statusEnteredAt || agg.earliestAt;

    return {
      _rowIndex: idx,
      // Stage-entry date for classification (NOT last call)
      interactionDate: stageEntry,
      customerId: agg.customerId,
      name: agg.name,
      mobileNum: agg.phone,
      assignedTo: agg.assignedTo,
      processName: agg.processName,
      status: agg.status,
      projectName: agg.processName,
      notes: `Last call: ${agg.latestAt}`,
      nextFollowUp: agg.latestAt,
      _flags: sameStatusOnlyOnLatest
        ? ['DERIVED_FROM_CALL_EXPORT', 'STAGE_ENTRY_ASSUMED_EARLIEST_CALL']
        : ['DERIVED_FROM_CALL_EXPORT'],
    };
  });
}

/**
 * Repair already-imported derived CRM rows: move stage entry off the latest call
 * onto the earliest call for each customer so post-stage rules can fire.
 */
export function repairDerivedStageEntryDates(
  rows: RawSheetRow[],
  calls: CallRecord[],
): { rows: RawSheetRow[]; repaired: number } {
  const earliestByCustomer = new Map<string, string>();
  for (const call of calls) {
    const at = call.callAt || call.callDate;
    if (!at || !call.customerId) continue;
    const prev = earliestByCustomer.get(call.customerId);
    if (!prev || isEarlier(at, prev)) earliestByCustomer.set(call.customerId, at);
  }

  let repaired = 0;
  const next = rows.map((row) => {
    const derived = row._flags?.includes('DERIVED_FROM_CALL_EXPORT');
    if (!derived || !row.customerId) return row;
    const earliest = earliestByCustomer.get(row.customerId);
    if (!earliest) return row;
    const current = row.interactionDate || '';
    // Only repair when interactionDate looks like last-contact (equal/near latest)
    // or is later than earliest — always snap derived rows to earliest call.
    if (current !== earliest) {
      repaired += 1;
      return {
        ...row,
        interactionDate: earliest,
        notes: row.notes?.includes('Last call:')
          ? row.notes
          : `Last call: ${current || 'unknown'}`,
        _flags: [...(row._flags ?? []), 'STAGE_ENTRY_REPAIRED'],
      };
    }
    return row;
  });

  return { rows: next, repaired };
}
