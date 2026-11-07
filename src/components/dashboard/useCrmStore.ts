'use client';

import { create } from 'zustand';
import { fromCompactWire, isCompactCrmWire } from '@/lib/crm/compactWire';
import { resolveApiSnapshot } from '@/lib/crm/decodeSnapshot';
import type {
  ClassificationResult,
  CrmSnapshot,
  GlobalFilters,
  IntelligenceCategory,
} from '@/lib/crm/types';
import type { DashboardTab } from './labels';

function hydrateSnapshot(raw: unknown): CrmSnapshot {
  if (isCompactCrmWire(raw)) return fromCompactWire(raw);
  return raw as CrmSnapshot;
}

function isEmptySnapshot(snapshot: CrmSnapshot | null | undefined): boolean {
  if (!snapshot) return true;
  return (
    (snapshot.customers?.length ?? 0) === 0 &&
    (snapshot.callTotal ?? snapshot.syncMeta?.callCount ?? 0) === 0
  );
}

export interface SelectedLead {
  customerId: string;
  salesProcessId: string;
}

interface CrmStoreState {
  snapshot: CrmSnapshot | null;
  loading: boolean;
  error: string | null;
  activeTab: DashboardTab;
  filters: GlobalFilters;
  selectedLead: SelectedLead | null;
  loadSnapshot: () => Promise<void>;
  refresh: () => Promise<void>;
  setActiveTab: (tab: DashboardTab) => void;
  setFilters: (filters: GlobalFilters) => void;
  patchFilters: (partial: Partial<GlobalFilters>) => void;
  setSelectedLead: (lead: SelectedLead | null) => void;
  importFile: (file: File, kind?: 'crm' | 'calls') => Promise<void>;
  seed: () => Promise<void>;
  syncSheets: () => Promise<string>;
  submitReview: (input: {
    customerId: string;
    salesProcessId?: string;
    reviewer: string;
    note: string;
    disposition?: string;
  }) => Promise<void>;
  submitOverride: (input: {
    customerId: string;
    salesProcessId?: string;
    overrideCategory: IntelligenceCategory;
    reason: string;
    createdBy: string;
    originalCategory?: IntelligenceCategory;
  }) => Promise<void>;
}

type ApiJson = {
  ok?: boolean;
  error?: string;
  snapshot?: unknown;
  snapshotEncoding?: string;
  snapshotError?: string;
  result?: { message?: string; [key: string]: unknown };
  [key: string]: unknown;
};

async function parseJson(res: Response): Promise<ApiJson> {
  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();
  const looksHtml =
    contentType.includes('text/html') ||
    text.trimStart().startsWith('<!DOCTYPE') ||
    text.trimStart().startsWith('<html');

  if (looksHtml) {
    throw new Error(
      res.status === 504 || res.status === 408
        ? 'Server timed out while loading sheet data. Click Retry in a moment.'
        : `Server returned an error page (${res.status || 'unknown'}). Click Retry — first sync can take up to a minute.`,
    );
  }

  let data: ApiJson;
  try {
    data = JSON.parse(text) as ApiJson;
  } catch {
    throw new Error(
      `Invalid server response (${res.status}). ${text.slice(0, 120) || 'Empty body'}`,
    );
  }

  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

async function snapshotFromApi(data: ApiJson): Promise<CrmSnapshot | null> {
  const raw = await resolveApiSnapshot(data);
  if (!raw) return null;
  return hydrateSnapshot(raw);
}

function toUserError(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  const msg = err.message || fallback;
  if (/failed to fetch|networkerror|load failed|fetch failed/i.test(msg)) {
    return 'Network error while loading sheet data. Check your connection, then click Retry (first sync can take up to a minute).';
  }
  return msg;
}

export const useCrmStore = create<CrmStoreState>((set, get) => ({
  snapshot: null,
  loading: false,
  error: null,
  activeTab: 'executive-overview',
  filters: {},
  selectedLead: null,

  loadSnapshot: async () => {
    try {
      await get().syncSheets();
      return;
    } catch {
      // Fall through to GET only if sync fails.
    }
    set({ loading: true, error: null });
    try {
      const res = await fetch(`/api/crm/snapshot?t=${Date.now()}`, {
        cache: 'no-store',
      });
      const data = await parseJson(res);
      const snapshot = await snapshotFromApi(data);
      if (isEmptySnapshot(snapshot)) {
        set({
          loading: false,
          error:
            'No sheet data on this server instance. Click Retry / Refresh sheet to sync.',
        });
        return;
      }
      set({ snapshot, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: toUserError(err, 'Failed to load snapshot'),
      });
    }
  },

  refresh: async () => {
    await get().syncSheets();
  },

  setActiveTab: (tab) => set({ activeTab: tab }),

  setFilters: (filters) => set({ filters }),

  patchFilters: (partial) =>
    set((state) => ({ filters: { ...state.filters, ...partial } })),

  setSelectedLead: (lead) => set({ selectedLead: lead }),

  importFile: async (file, kind = 'crm') => {
    set({ loading: true, error: null });
    try {
      const form = new FormData();
      form.append('file', file);
      const endpoint = kind === 'calls' ? '/api/crm/import-calls' : '/api/crm/import';
      const res = await fetch(endpoint, { method: 'POST', body: form });
      const data = await parseJson(res);
      set({
        snapshot: await snapshotFromApi(data),
        loading: false,
      });
    } catch (err) {
      set({
        loading: false,
        error: toUserError(err, 'Import failed'),
      });
      throw err;
    }
  },

  seed: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch('/api/crm/seed', { method: 'POST' });
      const data = await parseJson(res);
      set({
        snapshot: await snapshotFromApi(data),
        loading: false,
      });
    } catch (err) {
      set({
        loading: false,
        error: toUserError(err, 'Seed failed'),
      });
      throw err;
    }
  },

  syncSheets: async () => {
    set({ loading: true, error: null });
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 180_000);
      let res: Response;
      try {
        res = await fetch('/api/crm/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          cache: 'no-store',
          signal: controller.signal,
          body: JSON.stringify({
            mode: 'published',
            force: true,
            includeSnapshot: true,
          }),
        });
      } finally {
        clearTimeout(timer);
      }
      const data = await parseJson(res);
      const snapshot = await snapshotFromApi(data);
      if (!snapshot) {
        set({
          loading: false,
          error:
            (typeof data.snapshotError === 'string' && data.snapshotError) ||
            'Sheet synced but dashboard data was empty. Click Refresh sheet again.',
        });
        throw new Error(
          (typeof data.snapshotError === 'string' && data.snapshotError) ||
            'Snapshot missing after sync',
        );
      }
      if (isEmptySnapshot(snapshot)) {
        set({
          loading: false,
          error:
            'Sync finished but returned 0 customers. Click Retry — the sheet may still be publishing.',
        });
        throw new Error('Empty snapshot after sync');
      }
      set({
        snapshot,
        loading: false,
        error: null,
      });
      return (data.result?.message as string) || 'Sync completed';
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === 'AbortError'
          ? 'Sync timed out after 3 minutes. Click Retry.'
          : toUserError(err, 'Sync failed');
      set({ loading: false, error: message });
      throw err;
    }
  },

  submitReview: async (input) => {
    const res = await fetch('/api/crm/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await parseJson(res);
    const snapshot = await snapshotFromApi(data);
    if (snapshot) set({ snapshot });
  },

  submitOverride: async (input) => {
    const res = await fetch('/api/crm/overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await parseJson(res);
    const snapshot = await snapshotFromApi(data);
    if (snapshot) set({ snapshot });
  },
}));

export function getClassificationForProcess(
  snapshot: CrmSnapshot | null,
  salesProcessId: string,
): ClassificationResult | undefined {
  return snapshot?.classifications.find((c) => c.salesProcessId === salesProcessId);
}
