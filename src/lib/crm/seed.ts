/**
 * Seed CRM store when empty.
 * On Vercel: prefer published Google Sheet (live data).
 * Locally: prefer synthetic CSV for fast boot.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { importFromCsv } from './import';
import { importCallsFromCsv } from './runo';
import {
  IS_VERCEL,
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

export async function seedFromPublishedSheet(): Promise<SeedResult | null> {
  try {
    const { syncFromPublishedSheet } = await import('./sheets');
    const synced = await syncFromPublishedSheet();
    if (synced.status !== 'ok') return null;
    const snapshot = await loadSnapshot();
    return {
      seeded: true,
      rowCount: synced.rowCount ?? snapshot.customers.length,
      callCount: synced.callCount ?? snapshot.calls.length,
      message: synced.message,
      snapshot,
    };
  } catch (err) {
    console.error('[seed] published sheet fallback failed', err);
    return null;
  }
}

function isSyntheticMeta(meta: { source?: string; message?: string | null }): boolean {
  return (
    meta.source === 'csv' &&
    (meta.message || '').toLowerCase().includes('synthetic')
  );
}

/**
 * Ensure the store has data for first dashboard load.
 * Vercel → published Google Sheet first (live data). Freshness refreshes happen via
 * POST /api/crm/sync (dashboard auto-sync + Refresh sheet), not on every snapshot GET.
 * Local → synthetic CSV first (fast), then published sheet.
 */
export async function ensureSeeded(force = false): Promise<SeedResult> {
  const existing = await loadRawRows();
  const meta = await loadSyncMeta();

  // On Vercel, never keep synthetic demo data — always upgrade to published sheet.
  const needsLiveUpgrade =
    IS_VERCEL &&
    (existing.length === 0 ||
      isSyntheticMeta(meta) ||
      meta.source !== 'google_sheets');

  if (!force && existing.length > 0 && !needsLiveUpgrade) {
    const snapshot = await loadSnapshot();
    return {
      seeded: false,
      rowCount: existing.length,
      callCount: snapshot.calls.length,
      message: 'Store already populated',
      snapshot,
    };
  }

  if (IS_VERCEL) {
    const fromSheet = await seedFromPublishedSheet();
    if (fromSheet) return fromSheet;
    // Prefer any previously loaded live data over empty/error when sheet is briefly down.
    if (existing.length > 0 && !isSyntheticMeta(meta)) {
      const snapshot = await loadSnapshot();
      return {
        seeded: false,
        rowCount: existing.length,
        callCount: snapshot.calls.length,
        message: 'Using last synced sheet data (live refresh failed)',
        snapshot,
      };
    }
    // Do NOT fall back to synthetic on Vercel — return empty with clear error.
    const snapshot = await loadSnapshot();
    const errMeta = await loadSyncMeta();
    errMeta.status = 'error';
    errMeta.message =
      'Could not sync the published Google Sheet. Open Data Health and click Sync, or retry in a minute.';
    await saveSyncMeta(errMeta);
    return {
      seeded: false,
      rowCount: 0,
      callCount: 0,
      message: errMeta.message,
      snapshot: { ...snapshot, syncMeta: errMeta },
    };
  }

  const hasSynthetic =
    (await fileExists(CRM_CSV)) && (await fileExists(CALLS_CSV));

  if (hasSynthetic) {
    return seedFromSynthetic();
  }

  const fromSheet = await seedFromPublishedSheet();
  if (fromSheet) return fromSheet;

  const snapshot = await loadSnapshot();
  const errMeta = await loadSyncMeta();
  errMeta.status = 'error';
  errMeta.message =
    'No seed data available. Sync the published Google Sheet from Data Health, or ensure data/synthetic CSVs are deployed.';
  await saveSyncMeta(errMeta);

  return {
    seeded: false,
    rowCount: 0,
    callCount: 0,
    message: errMeta.message,
    snapshot: { ...snapshot, syncMeta: errMeta },
  };
}
