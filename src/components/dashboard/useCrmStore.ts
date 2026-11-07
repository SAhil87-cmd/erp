'use client';

import { create } from 'zustand';
import { fromCompactWire, isCompactCrmWire } from '@/lib/crm/compactWire';
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
    set({ loading: true, error: null });
    try {
      const res = await fetch(`/api/crm/snapshot?t=${Date.now()}`, {
        cache: 'no-store',
      });
      const data = await parseJson(res);
      set({
        snapshot: data.snapshot ? hydrateSnapshot(data.snapshot) : null,
        loading: false,
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load snapshot',
      });
    }
  },

  refresh: async () => {
    await get().loadSnapshot();
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
        snapshot: data.snapshot ? hydrateSnapshot(data.snapshot) : null,
        loading: false,
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Import failed',
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
        snapshot: data.snapshot ? hydrateSnapshot(data.snapshot) : null,
        loading: false,
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Seed failed',
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
          headers: { 'Content-Type': 'application/json' },
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
      // Prefer snapshot from the same serverless instance that just synced.
      // A follow-up GET /snapshot often hits a different empty Vercel instance.
      if (data.snapshot) {
        set({
          snapshot: hydrateSnapshot(data.snapshot),
          loading: false,
          error: null,
        });
      } else {
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
    if (data.snapshot) set({ snapshot: hydrateSnapshot(data.snapshot) });
  },

  submitOverride: async (input) => {
    const res = await fetch('/api/crm/overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await parseJson(res);
    if (data.snapshot) set({ snapshot: hydrateSnapshot(data.snapshot) });
  },
}));

export function getClassificationForProcess(
  snapshot: CrmSnapshot | null,
  salesProcessId: string,
): ClassificationResult | undefined {
  return snapshot?.classifications.find((c) => c.salesProcessId === salesProcessId);
}
