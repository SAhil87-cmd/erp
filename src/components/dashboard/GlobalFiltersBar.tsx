'use client';

import { useMemo } from 'react';
import type { CanonicalStage } from '@/lib/crm/types';
import { useCrmStore } from './useCrmStore';

const STAGES: CanonicalStage[] = [
  'Interested',
  'Cold',
  'Followup',
  'Cold Followup',
  'Not Picking',
  'Site Visit Scheduled',
  'Site Visit Done',
  'Revisit Done',
  'Not Interested',
  'Sales Closed',
  'Spam',
  'DND',
  'Unknown',
];

export function GlobalFiltersBar() {
  const snapshot = useCrmStore((s) => s.snapshot);
  const filters = useCrmStore((s) => s.filters);
  const patchFilters = useCrmStore((s) => s.patchFilters);
  const setFilters = useCrmStore((s) => s.setFilters);
  const refresh = useCrmStore((s) => s.refresh);
  const loading = useCrmStore((s) => s.loading);

  const executives = useMemo(() => {
    if (!snapshot) return [];
    return [...new Set(snapshot.processes.map((p) => p.assignedTo).filter(Boolean))]
      .sort() as string[];
  }, [snapshot]);

  const projects = useMemo(() => {
    if (!snapshot) return [];
    return [...new Set(snapshot.processes.map((p) => p.projectName).filter(Boolean))]
      .sort() as string[];
  }, [snapshot]);

  return (
    <div className="global-filters">
      <div className="filter-field">
        <label htmlFor="filter-search">Search</label>
        <input
          id="filter-search"
          className="dash-input"
          value={filters.search ?? ''}
          placeholder="Name, phone, customer ID…"
          onChange={(e) => patchFilters({ search: e.target.value || undefined })}
        />
      </div>
      <div className="filter-field">
        <label htmlFor="filter-from">From</label>
        <input
          id="filter-from"
          type="date"
          className="dash-input"
          value={filters.dateFrom ?? ''}
          onChange={(e) => patchFilters({ dateFrom: e.target.value || null })}
        />
      </div>
      <div className="filter-field">
        <label htmlFor="filter-to">To</label>
        <input
          id="filter-to"
          type="date"
          className="dash-input"
          value={filters.dateTo ?? ''}
          onChange={(e) => patchFilters({ dateTo: e.target.value || null })}
        />
      </div>
      <div className="filter-field">
        <label htmlFor="filter-date-field">Date field</label>
        <select
          id="filter-date-field"
          className="dash-input"
          value={filters.dateField ?? 'interaction'}
          onChange={(e) =>
            patchFilters({
              dateField: e.target.value as 'interaction' | 'stageEntry' | 'followUp' | 'call',
            })
          }
        >
          <option value="interaction">Interaction</option>
          <option value="stageEntry">Stage entry</option>
          <option value="followUp">Follow-up</option>
          <option value="call">Call</option>
        </select>
      </div>
      <div className="filter-field">
        <label htmlFor="filter-exec">Executive</label>
        <select
          id="filter-exec"
          className="dash-input"
          value={filters.executives?.[0] ?? ''}
          onChange={(e) =>
            patchFilters({
              executives: e.target.value ? [e.target.value] : undefined,
            })
          }
        >
          <option value="">All</option>
          {executives.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <div className="filter-field">
        <label htmlFor="filter-project">Project</label>
        <select
          id="filter-project"
          className="dash-input"
          value={filters.projects?.[0] ?? ''}
          onChange={(e) =>
            patchFilters({
              projects: e.target.value ? [e.target.value] : undefined,
            })
          }
        >
          <option value="">All</option>
          {projects.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <div className="filter-field">
        <label htmlFor="filter-stage">Stage</label>
        <select
          id="filter-stage"
          className="dash-input"
          value={filters.stages?.[0] ?? ''}
          onChange={(e) =>
            patchFilters({
              stages: e.target.value ? [e.target.value as CanonicalStage] : undefined,
            })
          }
        >
          <option value="">All</option>
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="filter-actions">
        <button type="button" className="btn-ghost" onClick={() => setFilters({})}>
          Clear
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => refresh()}
          disabled={loading}
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
