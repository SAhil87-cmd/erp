/**
 * Lightweight extract of CRM-tab Notes → latest remark per customer.
 * Avoids keeping the full 35-column CRM sheet in memory.
 */

import Papa from 'papaparse';
import { parseFlexibleDate } from './dates';
import { yieldEventLoop } from './yield';

function cell(row: Record<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    const direct = row[key];
    if (direct != null && String(direct).trim()) return String(direct).trim();
  }
  const lowerMap = new Map(
    Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]),
  );
  for (const key of keys) {
    const v = lowerMap.get(key.trim().toLowerCase());
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

/**
 * Parse CRM CSV and return the newest non-empty Notes value per Customer Id.
 */
export async function loadCrmRemarksByCustomer(
  csvText: string,
): Promise<Map<string, string>> {
  const best = new Map<string, { notes: string; ms: number }>();
  let sinceYield = 0;

  await new Promise<void>((resolve, reject) => {
    Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      step: (result, parser) => {
        const row = result.data;
        if (!row || typeof row !== 'object') return;

        const customerId = cell(
          row,
          'Customer Id',
          'customerId',
          'CustomerId',
          'Customer ID',
        );
        const notes = cell(row, 'Notes', 'notes', 'Note', 'Remark', 'Remarks');
        if (!customerId || !notes) return;

        const dateRaw = cell(
          row,
          'Interaction Date',
          'interactionDate',
          'InteractionDate',
        );
        const d = parseFlexibleDate(dateRaw);
        const ms = d?.getTime() ?? 0;
        const prev = best.get(customerId);
        if (!prev || ms >= prev.ms) {
          best.set(customerId, { notes, ms });
        }

        sinceYield += 1;
        if (sinceYield >= 1500) {
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

  const out = new Map<string, string>();
  for (const [id, v] of best) out.set(id, v.notes);
  return out;
}

export function applyRemarksToRows<T extends { customerId?: string; notes?: string }>(
  rows: T[],
  remarks: Map<string, string>,
): T[] {
  if (remarks.size === 0) return rows;
  return rows.map((row) => {
    const id = row.customerId?.trim();
    if (!id) return row;
    const remark = remarks.get(id);
    if (!remark) return row;
    return { ...row, notes: remark };
  });
}
