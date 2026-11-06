"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  SERVICE_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
} from "@/lib/labels";
import type { Lead, LeadStatus } from "@/lib/types";

type Stats = {
  total: number;
  new: number;
  contacted: number;
  qualified: number;
  closed: number;
};

const FILTERS: Array<"all" | LeadStatus> = [
  "all",
  "new",
  "contacted",
  "qualified",
  "closed",
];

export function AdminDashboard() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filter, setFilter] = useState<"all" | LeadStatus>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/leads", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load leads");
      const data = (await res.json()) as { leads: Lead[]; stats: Stats };
      setLeads(data.leads);
      setStats(data.stats);
    } catch {
      setError("Could not load leads. Refresh and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    if (filter === "all") return leads;
    return leads.filter((lead) => lead.status === filter);
  }, [filter, leads]);

  async function updateStatus(id: string, status: LeadStatus) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Update failed");
      await load();
    } catch {
      setError("Could not update lead status.");
    } finally {
      setBusyId(null);
    }
  }

  async function removeLead(id: string) {
    if (!confirm("Delete this lead permanently?")) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/leads/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      await load();
    } catch {
      setError("Could not delete lead.");
    } finally {
      setBusyId(null);
    }
  }

  function exportCsv() {
    const header = [
      "Name",
      "Email",
      "Phone",
      "Company",
      "Service",
      "Budget",
      "Status",
      "Source",
      "Created",
      "Message",
    ];
    const rows = visible.map((lead) =>
      [
        lead.name,
        lead.email,
        lead.phone,
        lead.company,
        SERVICE_LABELS[lead.service],
        lead.budget ?? "",
        STATUS_LABELS[lead.status],
        SOURCE_LABELS[lead.source],
        new Date(lead.createdAt).toLocaleString(),
        lead.message.replace(/\n/g, " "),
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...rows].join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `asa-scaliq-leads-${filter}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="admin-shell">
      <div className="admin-top">
        <div>
          <p className="admin-kicker">ASA Scaliq Media House</p>
          <h1>Lead pipeline</h1>
        </div>
        <div className="admin-actions">
          <button type="button" className="btn-secondary" onClick={() => void load()}>
            Refresh
          </button>
          <button type="button" className="btn-primary" onClick={exportCsv}>
            Export CSV
          </button>
        </div>
      </div>

      {stats ? (
        <div className="stat-row">
          <div>
            <strong>{stats.total}</strong>
            <span>Total</span>
          </div>
          <div>
            <strong>{stats.new}</strong>
            <span>New</span>
          </div>
          <div>
            <strong>{stats.contacted}</strong>
            <span>Contacted</span>
          </div>
          <div>
            <strong>{stats.qualified}</strong>
            <span>Qualified</span>
          </div>
          <div>
            <strong>{stats.closed}</strong>
            <span>Closed</span>
          </div>
        </div>
      ) : null}

      <div className="filter-row" role="tablist" aria-label="Filter by status">
        {FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            className={filter === key ? "filter active" : "filter"}
            onClick={() => setFilter(key)}
          >
            {key === "all" ? "All" : STATUS_LABELS[key]}
          </button>
        ))}
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      {loading ? (
        <p className="muted">Loading leads…</p>
      ) : visible.length === 0 ? (
        <p className="muted">No leads in this view yet.</p>
      ) : (
        <div className="lead-table-wrap">
          <table className="lead-table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Service</th>
                <th>Status</th>
                <th>Received</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((lead) => (
                <tr key={lead.id}>
                  <td>
                    <div className="lead-cell">
                      <strong>{lead.name}</strong>
                      <span>
                        {lead.company} · {lead.email}
                      </span>
                      <span>{lead.phone}</span>
                      <p>{lead.message}</p>
                    </div>
                  </td>
                  <td>
                    <div className="lead-cell">
                      <strong>{SERVICE_LABELS[lead.service]}</strong>
                      <span>{lead.budget || "Budget TBD"}</span>
                      <span>{SOURCE_LABELS[lead.source]}</span>
                    </div>
                  </td>
                  <td>
                    <select
                      value={lead.status}
                      disabled={busyId === lead.id}
                      onChange={(e) =>
                        void updateStatus(lead.id, e.target.value as LeadStatus)
                      }
                    >
                      {(Object.keys(STATUS_LABELS) as LeadStatus[]).map(
                        (status) => (
                          <option key={status} value={status}>
                            {STATUS_LABELS[status]}
                          </option>
                        ),
                      )}
                    </select>
                  </td>
                  <td>
                    {new Date(lead.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="link-danger"
                      disabled={busyId === lead.id}
                      onClick={() => void removeLead(lead.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
