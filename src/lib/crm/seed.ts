/**
 * Seed CRM store from synthetic CSV datasets when empty (or force reload).
 */

import { promises as fs } from 'fs';
import path from 'path';
import { importFromCsv } from './import';
import { importCallsFromCsv } from './runo';
import {
  loadRawRows,
  loadSnapshot,
  saveCalls,
  saveRawRows,
  saveSyncMeta,
  loadSyncMeta,
} from './store';
import type { CrmSnapshot } from './types';

const SYNTHETIC_DIR = path.join(process.cwd(), 'data', 'synthetic');
const CRM_CSV = path.join(SYNTHETIC_DIR, 'yashodhan_crm_synthetic.csv');
const CALLS_CSV = path.join(SYNTHETIC_DIR, 'yashodhan_calls_synthetic.csv');

export interface SeedResult {
  seeded: boolean;
  rowCount: number;
  callCount: number;
  message: string;
  snapshot: CrmSnapshot;
}

async function readSyntheticFiles(): Promise<{ crmText: string; callsText: string }> {
  const [crmText, callsText] = await Promise.all([
    fs.readFile(CRM_CSV, 'utf8'),
    fs.readFile(CALLS_CSV, 'utf8'),
  ]);
  return { crmText, callsText };
}

/** Load synthetic CRM + calls into the store (overwrites existing raw rows/calls). */
export async function seedFromSynthetic(): Promise<SeedResult> {
  const { crmText, callsText } = await readSyntheticFiles();
  const imported = importFromCsv(crmText);
  const { calls, errors } = importCallsFromCsv(callsText);

  await saveRawRows(imported.rows, 'csv');
  await saveCalls(calls);

  const meta = await loadSyncMeta();
  meta.lastImportAt = new Date().toISOString();
  meta.source = 'csv';
  meta.status = 'ok';
  meta.rowCount = imported.rows.length;
  meta.callCount = calls.length;
  meta.message = errors.length
    ? `Seeded synthetic data with ${errors.length} call parse warning(s)`
    : 'Seeded from synthetic CSV datasets';
  await saveSyncMeta(meta);

  const snapshot = await loadSnapshot();
  return {
    seeded: true,
    rowCount: imported.rows.length,
    callCount: calls.length,
    message: meta.message,
    snapshot,
  };
}

/**
 * Ensure the store has data for first dashboard load.
 * Uses synthetic CSV when empty (fast). Sync the published Google Sheet
 * explicitly from Data Health — that workbook is large (~10MB).
 */
export async function ensureSeeded(force = false): Promise<SeedResult> {
  const existing = await loadRawRows();
  if (!force && existing.length > 0) {
    const snapshot = await loadSnapshot();
    return {
      seeded: false,
      rowCount: existing.length,
      callCount: snapshot.calls.length,
      message: 'Store already populated',
      snapshot,
    };
  }
  return seedFromSynthetic();
}
