/**
 * CRM store.
 * Local: JSON files under data/crm/
 * Vercel: in-memory store (serverless /tmp is not shared across instances).
 */

import { promises as fs } from 'fs';
import path from 'path';
import { classifyAllProcesses } from './classification/engine';
import { buildRelationalModel } from './normalize';
import type {
  CallRecord,
  ClassificationOverride,
  ClassificationResult,
  CrmSnapshot,
  ManualReview,
  RawSheetRow,
  SyncMeta,
} from './types';

const IS_VERCEL = Boolean(process.env.VERCEL);

const DATA_DIR = IS_VERCEL
  ? path.join('/tmp', 'yashodhan-crm')
  : path.join(process.cwd(), 'data', 'crm');

const PATHS = {
  rawRows: path.join(DATA_DIR, 'raw_rows.json'),
  calls: path.join(DATA_DIR, 'calls.json'),
  reviews: path.join(DATA_DIR, 'reviews.json'),
  overrides: path.join(DATA_DIR, 'overrides.json'),
  syncMeta: path.join(DATA_DIR, 'sync_meta.json'),
} as const;

type MemoryStore = {
  rawRows: RawSheetRow[];
  calls: CallRecord[];
  reviews: ManualReview[];
  overrides: ClassificationOverride[];
  syncMeta: SyncMeta;
  snapshot: CrmSnapshot | null;
};

const globalStore = globalThis as typeof globalThis & {
  __yashodhanCrmStore?: MemoryStore;
};

function memory(): MemoryStore {
  if (!globalStore.__yashodhanCrmStore) {
    globalStore.__yashodhanCrmStore = {
      rawRows: [],
      calls: [],
      reviews: [],
      overrides: [],
      syncMeta: {
        lastSyncAt: null,
        lastImportAt: null,
        source: 'unknown',
        status: 'idle',
      },
      snapshot: null,
    };
  }
  return globalStore.__yashodhanCrmStore;
}

function invalidateSnapshotCache(): void {
  memory().snapshot = null;
}

async function ensureDir(): Promise<void> {
  if (IS_VERCEL) return;
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await ensureDir();
  // Compact JSON — much faster for large call dumps
  await fs.writeFile(filePath, JSON.stringify(data), 'utf8');
}

const DEFAULT_SYNC_META: SyncMeta = {
  lastSyncAt: null,
  lastImportAt: null,
  source: 'unknown',
  status: 'idle',
};

export async function loadRawRows(): Promise<RawSheetRow[]> {
  if (IS_VERCEL) return memory().rawRows;
  return readJsonFile<RawSheetRow[]>(PATHS.rawRows, []);
}

export async function loadCalls(): Promise<CallRecord[]> {
  if (IS_VERCEL) return memory().calls;
  return readJsonFile<CallRecord[]>(PATHS.calls, []);
}

export async function loadReviews(): Promise<ManualReview[]> {
  if (IS_VERCEL) return memory().reviews;
  return readJsonFile<ManualReview[]>(PATHS.reviews, []);
}

export async function loadOverrides(): Promise<ClassificationOverride[]> {
  if (IS_VERCEL) return memory().overrides;
  return readJsonFile<ClassificationOverride[]>(PATHS.overrides, []);
}

export async function loadSyncMeta(): Promise<SyncMeta> {
  if (IS_VERCEL) return { ...memory().syncMeta };
  return readJsonFile<SyncMeta>(PATHS.syncMeta, DEFAULT_SYNC_META);
}

export async function saveRawRows(
  rows: RawSheetRow[],
  source: SyncMeta['source'] = 'manual',
): Promise<void> {
  invalidateSnapshotCache();
  if (IS_VERCEL) {
    const m = memory();
    m.rawRows = rows;
    m.syncMeta = {
      ...m.syncMeta,
      lastImportAt: new Date().toISOString(),
      source,
      rowCount: rows.length,
      status: 'ok',
    };
    return;
  }
  await writeJsonFile(PATHS.rawRows, rows);
  const meta = await loadSyncMeta();
  meta.lastImportAt = new Date().toISOString();
  meta.source = source;
  meta.rowCount = rows.length;
  meta.status = 'ok';
  await writeJsonFile(PATHS.syncMeta, meta);
}

export async function saveCalls(calls: CallRecord[]): Promise<void> {
  invalidateSnapshotCache();
  if (IS_VERCEL) {
    const m = memory();
    m.calls = calls;
    m.syncMeta = {
      ...m.syncMeta,
      callCount: calls.length,
    };
    return;
  }
  await writeJsonFile(PATHS.calls, calls);
  const meta = await loadSyncMeta();
  meta.callCount = calls.length;
  await writeJsonFile(PATHS.syncMeta, meta);
}

export async function addReview(
  review: Omit<ManualReview, 'reviewId' | 'createdAt'> & {
    reviewId?: string;
    createdAt?: string;
  },
): Promise<ManualReview> {
  invalidateSnapshotCache();
  const entry: ManualReview = {
    reviewId: review.reviewId ?? `REV-${Date.now()}`,
    customerId: review.customerId,
    salesProcessId: review.salesProcessId,
    reviewer: review.reviewer,
    note: review.note,
    disposition: review.disposition,
    createdAt: review.createdAt ?? new Date().toISOString(),
  };
  if (IS_VERCEL) {
    memory().reviews.push(entry);
    return entry;
  }
  const reviews = await loadReviews();
  reviews.push(entry);
  await writeJsonFile(PATHS.reviews, reviews);
  return entry;
}

export async function addOverride(
  override: Omit<ClassificationOverride, 'overrideId' | 'createdAt'> & {
    overrideId?: string;
    createdAt?: string;
  },
): Promise<ClassificationOverride> {
  invalidateSnapshotCache();
  const entry: ClassificationOverride = {
    overrideId: override.overrideId ?? `OVR-${Date.now()}`,
    customerId: override.customerId,
    salesProcessId: override.salesProcessId,
    overrideCategory: override.overrideCategory,
    reason: override.reason,
    createdBy: override.createdBy,
    createdAt: override.createdAt ?? new Date().toISOString(),
    originalCategory: override.originalCategory,
  };
  if (IS_VERCEL) {
    memory().overrides.push(entry);
    return entry;
  }
  const overrides = await loadOverrides();
  overrides.push(entry);
  await writeJsonFile(PATHS.overrides, overrides);
  return entry;
}

export function applyOverridesToClassifications(
  classifications: ClassificationResult[],
  overrides: ClassificationOverride[],
): ClassificationResult[] {
  if (!overrides.length) return classifications;

  const latest = new Map<string, ClassificationOverride>();
  for (const o of overrides) {
    const key = o.salesProcessId
      ? `${o.customerId}::${o.salesProcessId}`
      : `${o.customerId}::*`;
    const prev = latest.get(key);
    if (!prev || o.createdAt >= prev.createdAt) {
      latest.set(key, o);
    }
  }

  return classifications.map((cls) => {
    const specific = latest.get(`${cls.customerId}::${cls.salesProcessId}`);
    const wildcard = latest.get(`${cls.customerId}::*`);
    const ovr = specific ?? wildcard;
    if (!ovr) return cls;

    return {
      ...cls,
      primaryCategory: ovr.overrideCategory,
      recommendedAction: `[OVERRIDE] ${ovr.reason}`,
      evidence: {
        ...cls.evidence,
        _originalCategory: cls.primaryCategory,
        _override: {
          overrideId: ovr.overrideId,
          reason: ovr.reason,
          createdBy: ovr.createdBy,
          createdAt: ovr.createdAt,
        },
      } as unknown as ClassificationResult['evidence'],
    };
  });
}

/** Build a full CrmSnapshot from persisted files / memory. */
export async function loadSnapshot(): Promise<CrmSnapshot> {
  if (IS_VERCEL && memory().snapshot) {
    return memory().snapshot!;
  }

  const [rawRows, calls, reviews, overrides, syncMeta] = await Promise.all([
    loadRawRows(),
    loadCalls(),
    loadReviews(),
    loadOverrides(),
    loadSyncMeta(),
  ]);

  const model = buildRelationalModel(rawRows);
  const engineClassifications = classifyAllProcesses(
    model.processes.map((p) => ({
      customerId: p.customerId,
      salesProcessId: p.salesProcessId,
      currentStage: p.currentStage,
      stageEnteredAt: p.stageEnteredAt,
      stageHistory: p.stageHistory,
    })),
    calls,
  );

  const classifications = applyOverridesToClassifications(
    engineClassifications,
    overrides.map((o) => {
      if (o.originalCategory) return o;
      const orig = engineClassifications.find(
        (c) =>
          c.customerId === o.customerId &&
          (!o.salesProcessId || c.salesProcessId === o.salesProcessId),
      );
      return { ...o, originalCategory: orig?.primaryCategory };
    }),
  );

  const callIdsByCustomer = new Map<string, string[]>();
  for (const call of calls) {
    const list = callIdsByCustomer.get(call.customerId);
    if (list) list.push(call.callRecordId);
    else callIdsByCustomer.set(call.customerId, [call.callRecordId]);
  }
  for (const customer of model.customers) {
    customer.callRecordIds = callIdsByCustomer.get(customer.customerId) ?? [];
  }

  const snapshot: CrmSnapshot = {
    customers: model.customers,
    processes: model.processes,
    interactions: model.interactions,
    calls,
    projects: model.projects,
    executives: model.executives,
    followUps: model.followUps,
    classifications,
    reviews,
    overrides,
    dataHealth: model.dataHealth,
    syncMeta,
    builtAt: new Date().toISOString(),
  };

  if (IS_VERCEL) {
    // Cache the API-slimmed snapshot so sync/snapshot responses stay small.
    const { slimSnapshotForApi } = await import('./slimSnapshot');
    memory().snapshot = slimSnapshotForApi(snapshot);
    return memory().snapshot!;
  }

  return snapshot;
}

export async function loadCallsForCustomer(
  customerId: string,
): Promise<CallRecord[]> {
  const calls = await loadCalls();
  return calls.filter((c) => c.customerId === customerId);
}

export async function saveSyncMeta(meta: SyncMeta): Promise<void> {
  invalidateSnapshotCache();
  if (IS_VERCEL) {
    memory().syncMeta = { ...meta };
    return;
  }
  await writeJsonFile(PATHS.syncMeta, meta);
}

export { PATHS as STORE_PATHS, DATA_DIR, IS_VERCEL };
