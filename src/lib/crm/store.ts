/**
 * CRM store.
 * Local: JSON files under data/crm/
 * Vercel: in-memory store (serverless /tmp is not shared across instances).
 */

import { promises as fs } from 'fs';
import path from 'path';
import {
  forEachCallFromDisk,
  loadCallOffsetIndex,
  loadCallsForCustomerFromDisk,
  type CallOffsetIndex,
} from './callDisk';
import { classifyAllProcessesAsync } from './classification/engine';
import { calendarDateKey } from './dates';
import { buildProcessIdsByInteractionDay } from './dateIndex';
import { buildRelationalModel } from './normalize';
import {
  buildInteractionSeries,
  slimClassification,
  slimSnapshotForApi,
} from './slimSnapshot';
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
  /** Vercel: byte-offset index into /tmp JSONL (exact full history, low RAM). */
  callOffsets: CallOffsetIndex | null;
  callCountOnDisk: number;
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
      callOffsets: null,
      callCountOnDisk: 0,
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
  // On Vercel with disk-backed calls, do NOT auto-load the full history into RAM.
  if (IS_VERCEL) return memory().calls;
  return readJsonFile<CallRecord[]>(PATHS.calls, []);
}

export function getCallOffsetIndex(): CallOffsetIndex | null {
  return memory().callOffsets;
}

export function getDiskCallCount(): number {
  return memory().callCountOnDisk || memory().calls.length;
}

/** Register disk-backed calls after streaming import (Vercel exact parity path). */
export async function saveCallsToDiskIndex(
  offsets: CallOffsetIndex,
  callCount: number,
): Promise<void> {
  invalidateSnapshotCache();
  const m = memory();
  m.calls = [];
  m.callOffsets = offsets;
  m.callCountOnDisk = callCount;
  m.syncMeta = {
    ...m.syncMeta,
    callCount,
  };
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
    m.callOffsets = null;
    m.callCountOnDisk = 0;
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

type SnapshotBuildOpts = {
  /** Skip call-aware classify (Vercel-safe). Stage/conversion KPIs still work. */
  stageOnly?: boolean;
};

async function buildSnapshotFromStore(
  opts: SnapshotBuildOpts = {},
): Promise<CrmSnapshot> {
  const [rawRows, loadedCalls, reviews, overrides, syncMeta] = await Promise.all([
    loadRawRows(),
    loadCalls(),
    loadReviews(),
    loadOverrides(),
    loadSyncMeta(),
  ]);

  // Exact parity: always classify/aggregate against the full imported call set.
  const calls = loadedCalls;

  const model = buildRelationalModel(rawRows);

  // Vercel: free fat intermediates ASAP so sync+snapshot fits in the worker.
  let interactionSeries: CrmSnapshot['interactionSeries'];
  let interactionTotal = model.interactions.length;
  let processIdsByInteractionDay: CrmSnapshot['processIdsByInteractionDay'];
  if (IS_VERCEL) {
    for (const ix of model.interactions) {
      ix.raw = {};
    }
    for (const p of model.processes) {
      p.stageHistory = [];
      p.interactionIds = [];
    }
    for (const customer of model.customers) {
      customer.callRecordIds = [];
      customer.interactionIds = [];
      customer.salesProcessIds = [];
    }
    for (const project of model.projects) {
      project.customerIds = [];
      project.processIds = [];
    }
    for (const exec of model.executives) {
      exec.customerIds = [];
      exec.processIds = [];
    }
    interactionSeries = buildInteractionSeries(model.interactions);
    processIdsByInteractionDay = buildProcessIdsByInteractionDay(
      model.interactions,
    );
    // Stamp last interaction day on processes before dropping interaction bodies.
    const lastIx = new Map<string, string>();
    for (const ix of model.interactions) {
      const key = calendarDateKey(ix.interactionDate);
      if (!key) continue;
      const prev = lastIx.get(ix.salesProcessId);
      if (!prev || key > prev) lastIx.set(ix.salesProcessId, key);
    }
    for (const p of model.processes) {
      p.lastInteractionDate =
        lastIx.get(p.salesProcessId) ?? calendarDateKey(p.stageEnteredAt);
    }
    // Drop interaction bodies before classification doubles peak memory.
    model.interactions = [];
  }

  let classifications: ClassificationResult[] = [];
  if (!opts.stageOnly) {
    const engineClassifications = await classifyAllProcessesAsync(
      model.processes.map((p) => ({
        customerId: p.customerId,
        salesProcessId: p.salesProcessId,
        currentStage: p.currentStage,
        stageEnteredAt: p.stageEnteredAt,
        stageHistory: p.stageHistory,
        remark: p.remark,
      })),
      calls,
    );

    classifications = applyOverridesToClassifications(
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

    if (IS_VERCEL) {
      classifications = classifications.map(slimClassification);
    }
  }

  // Avoid allocating tens of thousands of call-id arrays on Vercel (OOM risk).
  if (!IS_VERCEL) {
    const callIdsByCustomer = new Map<string, string[]>();
    for (const call of calls) {
      const list = callIdsByCustomer.get(call.customerId);
      if (list) list.push(call.callRecordId);
      else callIdsByCustomer.set(call.customerId, [call.callRecordId]);
    }
    for (const customer of model.customers) {
      customer.callRecordIds = callIdsByCustomer.get(customer.customerId) ?? [];
    }
  }

  const snapshot: CrmSnapshot = {
    customers: model.customers,
    processes: model.processes,
    interactions: model.interactions,
    // Don't hang the full 50k+ call array off the object that gets slim-copied.
    calls: IS_VERCEL ? [] : calls,
    projects: model.projects,
    executives: model.executives,
    followUps: model.followUps,
    classifications,
    reviews,
    overrides,
    dataHealth: {
      ...model.dataHealth,
      duplicatePhones: model.dataHealth.duplicatePhones.slice(0, 10),
      duplicateCustomerIds: model.dataHealth.duplicateCustomerIds.slice(0, 10),
      issues: model.dataHealth.issues.slice(0, 10),
    },
    syncMeta,
    builtAt: new Date().toISOString(),
    interactionTotal,
    interactionSeries,
    processIdsByInteractionDay,
  };

  // Localhost: stamp call stats while the full call array is still in hand.
  if (!IS_VERCEL && calls.length > 0) {
    type Acc = {
      totalCalls: number;
      answeredCalls: number;
      days: Set<string>;
      totalTalkSeconds: number;
    };
    const byCustomer = new Map<string, Acc>();
    for (const call of calls) {
      const id = call.customerId || '';
      if (!id) continue;
      let acc = byCustomer.get(id);
      if (!acc) {
        acc = {
          totalCalls: 0,
          answeredCalls: 0,
          days: new Set(),
          totalTalkSeconds: 0,
        };
        byCustomer.set(id, acc);
      }
      acc.totalCalls += 1;
      const day = calendarDateKey(call.callAt || call.callDate || null);
      if (day) acc.days.add(day);
      if (call.answered || call.callOutcome === 'answered') {
        acc.answeredCalls += 1;
        acc.totalTalkSeconds += Math.max(0, Number(call.durationSeconds) || 0);
      }
    }
    for (const p of snapshot.processes) {
      const acc = byCustomer.get(p.customerId);
      if (!acc) continue;
      p.callStats = {
        totalCalls: acc.totalCalls,
        answeredCalls: acc.answeredCalls,
        distinctDays: acc.days.size,
        totalTalkSeconds: acc.totalTalkSeconds,
        recentDates: [...acc.days]
          .sort((a, b) => b.localeCompare(a))
          .slice(0, 20),
      };
    }
  }

  if (IS_VERCEL) {
    if (opts.stageOnly) {
      // First-paint: never load the full disk-backed call history into RAM.
      // Exact callTotal comes from sync meta; aggregates upgrade after classify.
      const callSample =
        calls.length > 8_000
          ? [...calls]
              .sort((a, b) =>
                String(b.callAt || '').localeCompare(String(a.callAt || '')),
              )
              .slice(0, 8_000)
          : calls;
      const slim = slimSnapshotForApi({ ...snapshot, calls: callSample });
      slim.callTotal =
        syncMeta.callCount ??
        memory().callCountOnDisk ??
        loadedCalls.length ??
        calls.length;
      memory().snapshot = slim;
      return slim;
    }
    // Full path: walk every call for exact today/exec aggregates, then drop the fat copy.
    const slim = slimSnapshotForApi({ ...snapshot, calls });
    slim.callTotal = syncMeta.callCount ?? loadedCalls.length ?? calls.length;
    memory().snapshot = slim;
    return slim;
  }

  return snapshot;
}

/**
 * Stage/conversion snapshot without call-aware classify.
 * Safe on Vercel where full classify OOMs the worker.
 */
export async function loadStageOnlySnapshot(): Promise<CrmSnapshot> {
  return buildSnapshotFromStore({ stageOnly: true });
}

/**
 * Build a dashboard snapshot. On Vercel, skip huge per-customer call id lists and
 * immediately slim for API so sync responses don't OOM the serverless worker.
 */
export async function loadSnapshot(
  opts?: { force?: boolean },
): Promise<CrmSnapshot> {
  if (opts?.force) invalidateSnapshotCache();
  if (IS_VERCEL && memory().snapshot && !opts?.force) {
    return memory().snapshot!;
  }
  return buildSnapshotFromStore({ stageOnly: false });
}

/** Replace classifications on the in-memory slim snapshot (Vercel upgrade path). */
export function attachClassifications(
  classifications: ClassificationResult[],
): CrmSnapshot | null {
  const snap = memory().snapshot;
  if (!snap) return null;
  snap.classifications = classifications;
  memory().snapshot = snap;
  return snap;
}

/** Replace the whole cached slim snapshot (Vercel classify upgrade with exact aggregates). */
export function replaceCachedSnapshot(snapshot: CrmSnapshot): void {
  if (IS_VERCEL) {
    memory().snapshot = snapshot;
  }
}

/**
 * Take ownership of the in-memory call array (Vercel).
 * Clears the store reference so classify/slim can free peak RAM before packing the wire.
 */
export function takeCallsFromMemory(): CallRecord[] {
  if (!IS_VERCEL) return [];
  const calls = memory().calls;
  memory().calls = [];
  return calls;
}

/** Drop retained calls after aggregates/classify (Vercel peak-memory control). */
export function releaseCallsFromMemory(): void {
  if (IS_VERCEL) memory().calls = [];
}

export async function ensureCallOffsetsLoaded(): Promise<CallOffsetIndex> {
  const m = memory();
  if (m.callOffsets && m.callOffsets.size > 0) return m.callOffsets;
  const loaded = await loadCallOffsetIndex();
  m.callOffsets = loaded;
  return loaded;
}

/** Stream disk calls into slim aggregates without loading the full array. */
export async function slimSnapshotFromDiskCalls(
  snapshot: CrmSnapshot,
): Promise<CrmSnapshot> {
  const calls: CallRecord[] = [];
  // For exact exec/today aggregates we still need one full pass in memory briefly.
  // Prefer streaming aggregation when the set is huge — collect into a temp array
  // only if disk count is modest; otherwise aggregate on the fly via a shim.
  const diskCount = memory().callCountOnDisk;
  if (diskCount > 0 && diskCount <= 30_000) {
    await forEachCallFromDisk((c) => {
      calls.push(c);
    });
    const slim = slimSnapshotForApi({ ...snapshot, calls });
    slim.callTotal = diskCount;
    return slim;
  }

  // Large sets: aggregate on the fly, keep only a small call preview.
  const { calendarDateKey: dayKey, todayCalendarKey } = await import('./dates');
  const calendarToday = todayCalendarKey();
  const allByExec = new Map<string, number>();
  const byDayExec = new Map<string, Map<string, number>>();
  const lastCallByProcess = new Map<string, string>();
  const lastCallByCustomer = new Map<string, string>();
  let latestCallDay: string | null = null;
  const preview: CallRecord[] = [];
  const PREVIEW = 90;

  await forEachCallFromDisk((call) => {
    const exec = call.callExecutive?.trim() || 'Unassigned';
    allByExec.set(exec, (allByExec.get(exec) ?? 0) + 1);
    const day = dayKey(call.callAt || call.callDate || null);
    if (day) {
      if (!latestCallDay || day > latestCallDay) latestCallDay = day;
      let dayMap = byDayExec.get(day);
      if (!dayMap) {
        dayMap = new Map();
        byDayExec.set(day, dayMap);
      }
      dayMap.set(exec, (dayMap.get(exec) ?? 0) + 1);
      if (call.salesProcessId) {
        const prev = lastCallByProcess.get(call.salesProcessId);
        if (!prev || day > prev) lastCallByProcess.set(call.salesProcessId, day);
      }
      if (call.customerId) {
        const prev = lastCallByCustomer.get(call.customerId);
        if (!prev || day > prev) lastCallByCustomer.set(call.customerId, day);
      }
    }
    preview.push(call);
    if (preview.length > PREVIEW) preview.shift();
  });

  const base = slimSnapshotForApi({ ...snapshot, calls: preview });
  base.callTotal = diskCount || preview.length;
  // Overlay exact aggregates collected from the full disk pass.
  const activityDate =
    (byDayExec.get(calendarToday)?.size ?? 0) > 0
      ? calendarToday
      : (latestCallDay ?? calendarToday);
  const activityByExec = byDayExec.get(activityDate) ?? new Map();
  let todayCallCount = 0;
  for (const n of activityByExec.values()) todayCallCount += n;
  base.activityDate = activityDate;
  base.activityDateIsFallback = activityDate !== calendarToday;
  base.todayCallCount = todayCallCount;
  base.todayCallsByExecutive = [...activityByExec.entries()]
    .map(([executiveName, callCount]) => ({ executiveName, callCount }))
    .sort(
      (a, b) =>
        b.callCount - a.callCount ||
        a.executiveName.localeCompare(b.executiveName),
    );
  base.callsByExecutive = [...allByExec.entries()]
    .map(([executiveName, callCount]) => ({ executiveName, callCount }))
    .sort(
      (a, b) =>
        b.callCount - a.callCount ||
        a.executiveName.localeCompare(b.executiveName),
    );
  for (const p of base.processes) {
    p.lastCallDate =
      lastCallByProcess.get(p.salesProcessId) ??
      lastCallByCustomer.get(p.customerId) ??
      p.lastCallDate ??
      null;
  }
  memory().snapshot = base;
  return base;
}

export async function loadCallsForCustomer(
  customerId: string,
): Promise<CallRecord[]> {
  if (IS_VERCEL) {
    const m = memory();
    if (m.calls.length > 0) {
      return m.calls.filter((c) => c.customerId === customerId);
    }
    const offsets = await ensureCallOffsetsLoaded();
    if (offsets.size > 0) {
      return loadCallsForCustomerFromDisk(customerId, offsets);
    }
    return [];
  }
  const calls = await loadCalls();
  return calls.filter((c) => c.customerId === customerId);
}

/**
 * Stamp per-customer call history summaries onto processes (times / days / talk).
 * Used so Site Visit Scheduled and the drawer show call stats without reloading
 * the full call array into the browser.
 */
export async function attachCallStatsToSnapshot(
  snapshot: CrmSnapshot,
): Promise<CrmSnapshot> {
  type Acc = {
    totalCalls: number;
    answeredCalls: number;
    days: Set<string>;
    totalTalkSeconds: number;
  };
  const byCustomer = new Map<string, Acc>();

  const ingest = (call: CallRecord) => {
    const id = call.customerId || '';
    if (!id) return;
    let acc = byCustomer.get(id);
    if (!acc) {
      acc = {
        totalCalls: 0,
        answeredCalls: 0,
        days: new Set(),
        totalTalkSeconds: 0,
      };
      byCustomer.set(id, acc);
    }
    acc.totalCalls += 1;
    const day = calendarDateKey(call.callAt || call.callDate || null);
    if (day) acc.days.add(day);
    const answered = call.answered || call.callOutcome === 'answered';
    if (answered) {
      acc.answeredCalls += 1;
      acc.totalTalkSeconds += Math.max(0, Number(call.durationSeconds) || 0);
    }
  };

  if (IS_VERCEL && (memory().callCountOnDisk > 0 || memory().callOffsets)) {
    await forEachCallFromDisk((call) => {
      ingest(call);
    });
  } else {
    const calls = await loadCalls();
    for (const call of calls) ingest(call);
  }

  for (const p of snapshot.processes) {
    const acc = byCustomer.get(p.customerId);
    if (!acc) continue;
    p.callStats = {
      totalCalls: acc.totalCalls,
      answeredCalls: acc.answeredCalls,
      distinctDays: acc.days.size,
      totalTalkSeconds: acc.totalTalkSeconds,
      recentDates: [...acc.days].sort((a, b) => b.localeCompare(a)).slice(0, 20),
    };
  }
  return snapshot;
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
