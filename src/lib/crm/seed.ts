/**
 * Seed CRM store from synthetic CSV datasets when empty (or force reload).
 * On Vercel, falls back to published Google Sheet if synthetic files are missing.
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readSyntheticFiles(): Promise<{ crmText: string; callsText: string }> {
  const [crmOk, callsOk] = await Promise.all([
    fileExists(CRM_CSV),
    fileExists(CALLS_CSV),
  ]);
  if (!crmOk || !callsOk) {
    throw new Error(
      `Synthetic seed files missing under data/synthetic (looked for ${CRM_CSV}).`,
    );
  }
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

async function seedFromPublishedSheet(): Promise<SeedResult | null> {
  try {
    const { syncFromPublishedSheet } = await import('./sheets');
    const synced = await syncFromPublishedSheet();
    if (synced.status === 'ok' && synced.snapshot) {
      return {
        seeded: true,
        rowCount: synced.rowCount ?? 0,
        callCount: synced.callCount ?? 0,
        message: synced.message,
        snapshot: synced.snapshot,
      };
    }
    // Sync may omit snapshot — reload from store
    if (synced.status === 'ok') {
      const snapshot = await loadSnapshot();
      return {
        seeded: true,
        rowCount: synced.rowCount ?? snapshot.customers.length,
        callCount: synced.callCount ?? snapshot.calls.length,
        message: synced.message,
        snapshot,
      };
    }
  } catch (err) {
    console.error('[seed] published sheet fallback failed', err);
  }
  return null;
}

/**
 * Ensure the store has data for first dashboard load.
 * Order: existing store → synthetic CSV → published Google Sheet.
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

  const hasSynthetic =
    (await fileExists(CRM_CSV)) && (await fileExists(CALLS_CSV));

  if (hasSynthetic) {
    return seedFromSynthetic();
  }

  const fromSheet = await seedFromPublishedSheet();
  if (fromSheet) return fromSheet;

  // Last resort: empty snapshot so the UI loads with a clear data-health message
  const snapshot = await loadSnapshot();
  const meta = await loadSyncMeta();
  meta.status = 'error';
  meta.message =
    'No seed data available. Add data/synthetic CSVs to the deploy, or sync the published Google Sheet from Data Health.';
  await saveSyncMeta(meta);

  return {
    seeded: false,
    rowCount: 0,
    callCount: 0,
    message: meta.message,
    snapshot: { ...snapshot, syncMeta: meta },
  };
}
