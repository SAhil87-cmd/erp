/**
 * Google Sheets sync.
 *
 * Primary path: published spreadsheet CSV (no service-account credentials).
 * Fallback: service-account API stub when only private sheet access is available.
 *
 * NEVER expose credentials to the frontend.
 */

import {
  PUBLISHED_SHEET_HTML_URL,
  getPublishedCallsCsvUrl,
  getPublishedSheetCsvUrl,
  toPublishedCsvUrl,
} from './dataset';
import { parseFlexibleDate } from './dates';
import { importFromCsv } from './import';
import {
  deriveCrmRowsFromCallExport,
  importCallsFromCsv,
} from './runo';
import {
  loadCalls,
  loadRawRows,
  loadSnapshot,
  loadSyncMeta,
  saveCalls,
  saveRawRows,
  saveSyncMeta,
} from './store';
import type { CallRecord, CrmSnapshot, RawSheetRow, SyncMeta } from './types';

export interface SheetsSyncResult {
  status: SyncMeta['status'] | 'pending_implementation';
  message: string;
  rowCount?: number;
  callCount?: number;
  syncedAt?: string;
  latestDataAt?: string | null;
  snapshot?: CrmSnapshot;
  sourceUrl?: string;
}

function maxIsoTimestamp(values: Array<string | null | undefined>): string | null {
  let bestMs = -Infinity;
  let bestIso: string | null = null;
  for (const value of values) {
    if (!value) continue;
    const d = parseFlexibleDate(value);
    if (!d) continue;
    const ms = d.getTime();
    if (ms > bestMs) {
      bestMs = ms;
      bestIso = d.toISOString();
    }
  }
  return bestIso;
}

function latestFromCalls(calls: CallRecord[]): string | null {
  return maxIsoTimestamp(calls.map((c) => c.callAt));
}

function latestFromRows(rows: RawSheetRow[]): string | null {
  return maxIsoTimestamp(
    rows.map((r) => r.interactionDate || r.nextFollowUp || null),
  );
}

function readSheetsEnv(): {
  email?: string;
  privateKey?: string;
  sheetId?: string;
  range?: string;
  missing: string[];
} {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  const range = process.env.GOOGLE_SHEETS_RANGE ?? 'Sheet1!A:AI';

  const missing: string[] = [];
  if (!email) missing.push('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  if (!privateKey) missing.push('GOOGLE_PRIVATE_KEY');
  if (!sheetId) missing.push('GOOGLE_SHEETS_ID');

  return { email, privateKey, sheetId, range, missing };
}

function detectDatasetKind(csvText: string): 'calls' | 'crm' | 'unknown' {
  const headerLine = csvText.split(/\r?\n/, 1)[0]?.toLowerCase() ?? '';
  const hasCallId = headerLine.includes('call id');
  const hasCallStart = headerLine.includes('call start date');
  const hasCustomerId = headerLine.includes('customer id');
  const hasInteraction = headerLine.includes('interaction');
  const hasMobile = headerLine.includes('mobile');
  const hasStatus = headerLine.includes('status');

  if (hasCallId || hasCallStart) return 'calls';
  if (hasInteraction && hasCustomerId && (hasMobile || hasStatus)) return 'crm';
  if (hasCustomerId && hasStatus && hasMobile) return 'crm';
  return 'unknown';
}

async function fetchPublishedCsv(url: string): Promise<string> {
  // Bust CDN / browser / Google intermediate caches so sync gets the latest publish.
  const bust = `t=${Date.now()}`;
  const fetchUrl = url.includes('?') ? `${url}&${bust}` : `${url}?${bust}`;
  const res = await fetch(fetchUrl, {
    cache: 'no-store',
    next: { revalidate: 0 },
    headers: {
      Accept: 'text/csv,text/plain,*/*',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      'User-Agent': 'YashodhanSalesIntelligence/1.0',
    },
  });
  if (!res.ok) {
    throw new Error(`Published sheet fetch failed (${res.status} ${res.statusText})`);
  }
  const text = await res.text();
  if (!text.trim()) {
    throw new Error('Published sheet returned empty CSV');
  }
  return text;
}

/** Deduplicate concurrent published-sheet syncs on the same serverless instance. */
let inFlightPublishedSync: Promise<SheetsSyncResult> | null = null;

/**
 * Sync from the configured published Google Sheet CSV URL.
 * Detects call-history vs CRM 35-column formats automatically.
 */
export async function syncFromPublishedSheet(
  urlOverride?: string,
): Promise<SheetsSyncResult> {
  if (inFlightPublishedSync && !urlOverride) {
    return inFlightPublishedSync;
  }

  const run = doSyncFromPublishedSheet(urlOverride);
  if (!urlOverride) {
    inFlightPublishedSync = run.finally(() => {
      inFlightPublishedSync = null;
    });
    return inFlightPublishedSync;
  }
  return run;
}

async function doSyncFromPublishedSheet(
  urlOverride?: string,
): Promise<SheetsSyncResult> {
  const syncedAt = new Date().toISOString();

  try {
    // Default path: calls tab only. Importing the full 47k-row CRM tab OOMs / times
    // out on Vercel serverless — derive customers from the call export instead.
    if (!urlOverride) {
      const callsText = await fetchPublishedCsv(getPublishedCallsCsvUrl());
      const { calls, errors } = importCallsFromCsv(callsText);
      await saveCalls(calls);
      const callCount = calls.length;

      const derived = deriveCrmRowsFromCallExport(callsText);
      await saveRawRows(derived, 'google_sheets');
      const rowCount = derived.length;
      let message = `Synced ${callCount.toLocaleString()} calls and ${rowCount.toLocaleString()} customer rows from published call sheet.`;
      if (errors.length) {
        message += ` ${errors.length} call parse warning(s).`;
      }

      const latestDataAt = latestFromCalls(calls);

      await saveSyncMeta({
        ...(await loadSyncMeta()),
        lastSyncAt: syncedAt,
        lastImportAt: syncedAt,
        source: 'google_sheets',
        status: 'ok',
        message: `${message} Source: ${PUBLISHED_SHEET_HTML_URL}`,
        rowCount,
        callCount,
        latestDataAt,
      });

      return {
        status: 'ok',
        message,
        rowCount,
        callCount,
        syncedAt,
        latestDataAt,
        sourceUrl: PUBLISHED_SHEET_HTML_URL,
      };
    }

    const sourceUrl = toPublishedCsvUrl(urlOverride || getPublishedSheetCsvUrl());
    const csvText = await fetchPublishedCsv(sourceUrl);
    const kind = detectDatasetKind(csvText);

    let rowCount = 0;
    let callCount = 0;
    let message = '';
    let latestDataAt: string | null = null;

    if (kind === 'calls') {
      const { calls, errors } = importCallsFromCsv(csvText);
      await saveCalls(calls);
      callCount = calls.length;

      const derived = deriveCrmRowsFromCallExport(csvText);
      await saveRawRows(derived, 'google_sheets');
      rowCount = derived.length;
      message = `Synced ${callCount.toLocaleString()} calls and ${rowCount.toLocaleString()} customer rows from published call sheet.`;
      latestDataAt = latestFromCalls(calls);

      if (errors.length) {
        message += ` ${errors.length} call parse warning(s).`;
      }
    } else if (kind === 'crm') {
      const imported = importFromCsv(csvText);
      await saveRawRows(imported.rows, 'google_sheets');
      rowCount = imported.rows.length;
      callCount = (await loadCalls()).length;
      message = `Synced ${rowCount.toLocaleString()} CRM rows from published sheet.`;
      latestDataAt = maxIsoTimestamp([
        latestFromRows(imported.rows),
        latestFromCalls(await loadCalls()),
      ]);
    } else {
      const { calls } = importCallsFromCsv(csvText);
      if (calls.length > 0 && calls.some((c) => c.callRecordId && !c.callRecordId.startsWith('CALL-IMPORT-'))) {
        await saveCalls(calls);
        callCount = calls.length;
        const existingRows = await loadRawRows();
        if (existingRows.length === 0) {
          const derived = deriveCrmRowsFromCallExport(csvText);
          await saveRawRows(derived, 'google_sheets');
          rowCount = derived.length;
        } else {
          rowCount = existingRows.length;
        }
        message = `Synced published sheet as call export (${callCount.toLocaleString()} calls).`;
        latestDataAt = latestFromCalls(calls);
      } else {
        const imported = importFromCsv(csvText);
        await saveRawRows(imported.rows, 'google_sheets');
        rowCount = imported.rows.length;
        callCount = (await loadCalls()).length;
        message = `Synced published sheet as CRM export (${rowCount.toLocaleString()} rows).`;
        latestDataAt = latestFromRows(imported.rows);
      }
    }

    await saveSyncMeta({
      ...(await loadSyncMeta()),
      lastSyncAt: syncedAt,
      lastImportAt: syncedAt,
      source: 'google_sheets',
      status: 'ok',
      message: `${message} Source: ${PUBLISHED_SHEET_HTML_URL}`,
      rowCount,
      callCount,
      latestDataAt,
    });

    return {
      status: 'ok',
      message,
      rowCount,
      callCount,
      syncedAt,
      latestDataAt,
      sourceUrl: PUBLISHED_SHEET_HTML_URL,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Published sheet sync failed';
    await saveSyncMeta({
      ...(await loadSyncMeta()),
      source: 'google_sheets',
      status: 'error',
      message,
      lastSyncAt: syncedAt,
    });
    return {
      status: 'error',
      message,
      syncedAt,
      sourceUrl: PUBLISHED_SHEET_HTML_URL,
    };
  }
}

/**
 * Prefer published-sheet sync. Falls back to service-account stub messaging
 * only when explicitly requested via mode=api.
 */
export async function syncFromGoogleSheets(
  options?: { mode?: 'published' | 'api' },
): Promise<SheetsSyncResult> {
  const mode = options?.mode ?? 'published';
  if (mode === 'published') {
    return syncFromPublishedSheet();
  }

  const env = readSheetsEnv();
  if (env.missing.length > 0) {
    const result: SheetsSyncResult = {
      status: 'pending_credentials',
      message: `Google Sheets API sync pending credentials. Missing: ${env.missing.join(', ')}. Published sheet sync is available without credentials.`,
      sourceUrl: PUBLISHED_SHEET_HTML_URL,
    };
    await saveSyncMeta({
      ...(await loadSyncMeta()),
      status: 'pending_credentials',
      message: result.message,
      source: 'google_sheets',
    });
    return result;
  }

  const result: SheetsSyncResult = {
    status: 'pending_implementation',
    message:
      'PENDING: Google Sheets API client is stubbed. Use published sheet sync instead, or implement googleapis fetch for range ' +
      (env.range ?? 'Sheet1!A:AI') +
      '.',
    sourceUrl: PUBLISHED_SHEET_HTML_URL,
  };
  await saveSyncMeta({
    ...(await loadSyncMeta()),
    status: 'idle',
    message: result.message,
    source: 'google_sheets',
  });
  return result;
}

export async function getSyncStatus(): Promise<SyncMeta & { publishedUrl: string }> {
  const meta = await loadSyncMeta();
  return {
    ...meta,
    publishedUrl: PUBLISHED_SHEET_HTML_URL,
  };
}
