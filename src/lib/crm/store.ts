/**
 * File-based CRM store under data/crm/.
 * Reviews and overrides are additive — never delete original classifications.
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

/** On Vercel the app filesystem is read-only; persist under /tmp. */
const DATA_DIR = process.env.VERCEL
  ? path.join('/tmp', 'yashodhan-crm')
  : path.join(process.cwd(), 'data', 'crm');

const PATHS = {
  rawRows: path.join(DATA_DIR, 'raw_rows.json'),
  calls: path.join(DATA_DIR, 'calls.json'),
  reviews: path.join(DATA_DIR, 'reviews.json'),
  overrides: path.join(DATA_DIR, 'overrides.json'),
  syncMeta: path.join(DATA_DIR, 'sync_meta.json'),
} as const;

async function ensureDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await ensureDir();
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

const DEFAULT_SYNC_META: SyncMeta = {
  lastSyncAt: null,
  lastImportAt: null,
  source: 'unknown',
  status: 'idle',
};

export async function loadRawRows(): Promise<RawSheetRow[]> {
  return readJson<RawSheetRow[]>(PATHS.rawRows, []);
}

export async function loadCalls(): Promise<CallRecord[]> {
  return readJson<CallRecord[]>(PATHS.calls, []);
}

export async function loadReviews(): Promise<ManualReview[]> {
  return readJson<ManualReview[]>(PATHS.reviews, []);
}

export async function loadOverrides(): Promise<ClassificationOverride[]> {
  return readJson<ClassificationOverride[]>(PATHS.overrides, []);
}

export async function loadSyncMeta(): Promise<SyncMeta> {
  return readJson<SyncMeta>(PATHS.syncMeta, DEFAULT_SYNC_META);
}

export async function saveRawRows(
  rows: RawSheetRow[],
  source: SyncMeta['source'] = 'manual',
): Promise<void> {
  await writeJson(PATHS.rawRows, rows);
  const meta = await loadSyncMeta();
  meta.lastImportAt = new Date().toISOString();
  meta.source = source;
  meta.rowCount = rows.length;
  meta.status = 'ok';
  await writeJson(PATHS.syncMeta, meta);
}

export async function saveCalls(calls: CallRecord[]): Promise<void> {
  await writeJson(PATHS.calls, calls);
  const meta = await loadSyncMeta();
  meta.callCount = calls.length;
  await writeJson(PATHS.syncMeta, meta);
}

/**
 * Append a manual review. Does not mutate classifications.
 */
export async function addReview(
  review: Omit<ManualReview, 'reviewId' | 'createdAt'> & {
    reviewId?: string;
    createdAt?: string;
  },
): Promise<ManualReview> {
  const reviews = await loadReviews();
  const entry: ManualReview = {
    reviewId: review.reviewId ?? `REV-${Date.now()}`,
    customerId: review.customerId,
    salesProcessId: review.salesProcessId,
    reviewer: review.reviewer,
    note: review.note,
    disposition: review.disposition,
    createdAt: review.createdAt ?? new Date().toISOString(),
  };
  reviews.push(entry);
  await writeJson(PATHS.reviews, reviews);
  return entry;
}

/**
 * Append a classification override. Original engine category is preserved
 * on the override record — never deleted from the snapshot's engine results.
 */
export async function addOverride(
  override: Omit<ClassificationOverride, 'overrideId' | 'createdAt'> & {
    overrideId?: string;
    createdAt?: string;
  },
): Promise<ClassificationOverride> {
  const overrides = await loadOverrides();
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
  overrides.push(entry);
  await writeJson(PATHS.overrides, overrides);
  return entry;
}

/**
 * Apply overrides on top of engine classifications without mutating originals.
 * Returns a new array where overridden results carry the override category
 * as primaryCategory, with original preserved in evidence._originalCategory.
 */
export function applyOverridesToClassifications(
  classifications: ClassificationResult[],
  overrides: ClassificationOverride[],
): ClassificationResult[] {
  if (!overrides.length) return classifications;

  // Latest override per process (or customer if no process) wins
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

/** Build a full CrmSnapshot from persisted files. */
export async function loadSnapshot(): Promise<CrmSnapshot> {
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
    })),
    calls,
  );

  // Stamp original categories onto overrides that lack them
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

  // Attach call ids onto customers via one-pass index
  const callIdsByCustomer = new Map<string, string[]>();
  for (const call of calls) {
    const list = callIdsByCustomer.get(call.customerId);
    if (list) list.push(call.callRecordId);
    else callIdsByCustomer.set(call.customerId, [call.callRecordId]);
  }
  for (const customer of model.customers) {
    customer.callRecordIds = callIdsByCustomer.get(customer.customerId) ?? [];
  }

  return {
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
}

/** Calls for one customer — used by drawer instead of shipping full call dump. */
export async function loadCallsForCustomer(
  customerId: string,
): Promise<CallRecord[]> {
  const calls = await loadCalls();
  return calls.filter((c) => c.customerId === customerId);
}

export async function saveSyncMeta(meta: SyncMeta): Promise<void> {
  await writeJson(PATHS.syncMeta, meta);
}

export { PATHS as STORE_PATHS, DATA_DIR };
