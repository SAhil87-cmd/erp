/**
 * Row mapping, phone normalization, and relational model builder.
 * Customer Id is primary key. Phone is secondary only when safe. Never merge by name.
 */

import {
  SHEET_COLUMNS,
  buildHeaderMap,
  resolveColumnKey,
  type SheetColumnKey,
} from './columns';
import { calendarDateKey, parseFlexibleDate, toIsoOrNull } from './dates';
import type {
  CanonicalStage,
  Customer,
  DataHealthIssue,
  DataHealthReport,
  Interaction,
  RawSheetRow,
  SalesProcess,
  StageHistoryEntry,
  FollowUpActivity,
  Project,
  ExecutiveAssignment,
} from './types';

// ─── Phone ───────────────────────────────────────────────────────────────────

/** Digits-only phone; strips +91 / 0 prefix when resulting length is 10. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  if (digits.length < 8) return null;
  return digits;
}

// ─── Stage normalization ─────────────────────────────────────────────────────

const STAGE_ALIASES: Array<[RegExp | string, CanonicalStage]> = [
  [/^(cold\s*follow[-\s]?up|cold\s*follow|cold\s*fu)$/i, 'Cold Followup'],
  [/^(follow[-\s]?up|followup|follow\s*up|fu)$/i, 'Followup'],
  [/^(site\s*visit\s*done|sv\s*done|svd)$/i, 'Site Visit Done'],
  [/^(site\s*visit\s*scheduled|sv\s*scheduled|svs|site\s*visit\s*sched)$/i, 'Site Visit Scheduled'],
  [/^(revisit\s*done|rv\s*done|re-?visit\s*done)$/i, 'Revisit Done'],
  [/^(not\s*interested|ni)$/i, 'Not Interested'],
  [/^(sales\s*closed|booked|booking\s*done|closed\s*won|won)$/i, 'Sales Closed'],
  [/^(not\s*picking(\s*up)?|npu)$/i, 'Not Picking'],
  [/^(interested)$/i, 'Interested'],
  [/^(cold)$/i, 'Cold'],
  [/^(spam)$/i, 'Spam'],
  [/^(dnd|do\s*not\s*disturb)$/i, 'DND'],
];

export function normalizeStage(raw: string | null | undefined): CanonicalStage {
  if (raw == null || !String(raw).trim()) return 'Unknown';
  const s = String(raw).trim();
  for (const [pattern, stage] of STAGE_ALIASES) {
    if (typeof pattern === 'string') {
      if (s.toLowerCase() === pattern.toLowerCase()) return stage;
    } else if (pattern.test(s)) {
      return stage;
    }
  }
  return 'Unknown';
}

// ─── Row mapping ─────────────────────────────────────────────────────────────

export function mapRawRow(
  cells: Record<string, unknown> | string[],
  headers?: string[],
  rowIndex?: number,
): RawSheetRow {
  const row: RawSheetRow = {
    _rowIndex: rowIndex,
    _flags: [],
    _errors: [],
  };

  if (Array.isArray(cells)) {
    const headerMap =
      headers && headers.length
        ? buildHeaderMap(headers)
        : new Map(SHEET_COLUMNS.map((k, i) => [i, k] as const));
    headerMap.forEach((key, idx) => {
      const val = cells[idx];
      row[key] = val == null ? '' : String(val).trim();
    });
    // Unmapped extra cells → flag
    if (cells.length > 0 && headerMap.size === 0) {
      row._errors!.push('NO_HEADER_MAPPING');
    }
  } else {
    for (const [header, value] of Object.entries(cells)) {
      const key = resolveColumnKey(header) ?? (SHEET_COLUMNS.includes(header as SheetColumnKey)
        ? (header as SheetColumnKey)
        : null);
      if (key) {
        row[key] = value == null ? '' : String(value).trim();
      }
    }
  }

  return row;
}

function parseCount(raw: string | undefined): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = Number(String(raw).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

function makeProcessId(customerId: string, processName: string): string {
  const slug = (processName || 'default')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${customerId}::${slug || 'default'}`;
}

function makeInteractionId(customerId: string, rowIndex: number, processId: string): string {
  return `INT-${customerId}-${processId.split('::')[1] ?? 'p'}-${rowIndex}`;
}

// ─── Relational model ────────────────────────────────────────────────────────

export interface RelationalModel {
  customers: Customer[];
  processes: SalesProcess[];
  interactions: Interaction[];
  followUps: FollowUpActivity[];
  projects: Project[];
  executives: ExecutiveAssignment[];
  dataHealth: DataHealthReport;
  unmatchedRows: RawSheetRow[];
}

export function buildRelationalModel(rows: RawSheetRow[]): RelationalModel {
  const issues: DataHealthIssue[] = [];
  const customersById = new Map<string, Customer>();
  const phoneToCustomerId = new Map<string, string>();
  const phoneCollision = new Set<string>();
  const unmatchedRows: RawSheetRow[] = [];

  // First pass: inventory phones for safe uniqueness check
  const phoneCounts = new Map<string, number>();
  for (const row of rows) {
    const phone = normalizePhone(row.mobileNum);
    if (phone) phoneCounts.set(phone, (phoneCounts.get(phone) ?? 0) + 1);
  }

  // Phones that appear with multiple distinct Customer Ids → unsafe
  const phoneToIds = new Map<string, Set<string>>();
  for (const row of rows) {
    const cid = (row.customerId ?? '').trim();
    const phone = normalizePhone(row.mobileNum);
    if (phone && cid) {
      if (!phoneToIds.has(phone)) phoneToIds.set(phone, new Set());
      phoneToIds.get(phone)!.add(cid);
    }
  }
  for (const [phone, ids] of phoneToIds) {
    if (ids.size > 1) phoneCollision.add(phone);
  }

  const processesById = new Map<string, SalesProcess>();
  const interactions: Interaction[] = [];
  let missingCustomerIds = 0;
  let missingPhones = 0;

  rows.forEach((row, idx) => {
    const rowIndex = row._rowIndex ?? idx;
    let customerId = (row.customerId ?? '').trim();
    const phone = normalizePhone(row.mobileNum);
    const flags: string[] = [...(row._flags ?? [])];

    if (!phone) missingPhones += 1;

    if (!customerId) {
      missingCustomerIds += 1;
      // Safe phone fallback: phone present, unique customer-id mapping, not colliding
      if (
        phone &&
        !phoneCollision.has(phone) &&
        phoneToIds.has(phone) &&
        phoneToIds.get(phone)!.size === 1
      ) {
        customerId = [...phoneToIds.get(phone)!][0];
        flags.push('MATCHED_BY_PHONE_TO_EXISTING_ID');
      } else if (
        phone &&
        !phoneCollision.has(phone) &&
        !phoneToIds.has(phone) &&
        (phoneCounts.get(phone) ?? 0) >= 1
      ) {
        // No Customer Id anywhere for this phone — synthetic id from phone (safe unique phone)
        // Only when ALL rows with this phone also lack customer id
        const synthetic = `PHONE-${phone}`;
        customerId = synthetic;
        flags.push('SYNTHETIC_ID_FROM_PHONE');
      } else {
        flags.push('MISSING_CUSTOMER_ID');
        const unmatched = { ...row, _flags: flags, _rowIndex: rowIndex };
        unmatched._errors = [...(row._errors ?? []), 'UNMATCHED_NO_SAFE_KEY'];
        unmatchedRows.push(unmatched);
        issues.push({
          code: 'UNMATCHED_ROW',
          severity: 'warning',
          message: 'Row missing Customer Id and cannot be safely matched by phone',
          rowIndex,
          field: 'customerId',
        });
        return;
      }
    }

    // Register phone → customer (detect collisions across ids)
    if (phone) {
      const existing = phoneToCustomerId.get(phone);
      if (existing && existing !== customerId) {
        phoneCollision.add(phone);
        flags.push('PHONE_COLLISION');
        issues.push({
          code: 'PHONE_COLLISION',
          severity: 'warning',
          message: `Phone ${phone} maps to multiple Customer Ids`,
          rowIndex,
          customerId,
          field: 'mobileNum',
        });
      } else {
        phoneToCustomerId.set(phone, customerId);
      }
    }

    let customer = customersById.get(customerId);
    if (!customer) {
      customer = {
        customerId,
        name: row.name || undefined,
        mobileNum: phone ?? undefined,
        email: row.email || undefined,
        companyName: row.companyName || undefined,
        city: row.city || undefined,
        state: row.state || undefined,
        country: row.country || undefined,
        pincode: row.pincode || undefined,
        alternateContact: row.alternateContact || undefined,
        kdmPhone: row.kdmPhone || undefined,
        firmName: row.firmName || undefined,
        matchedByPhone: flags.includes('MATCHED_BY_PHONE_TO_EXISTING_ID') ||
          flags.includes('SYNTHETIC_ID_FROM_PHONE'),
        dataQualityFlags: [...flags],
        salesProcessIds: [],
        interactionIds: [],
        callRecordIds: [],
      };
      customersById.set(customerId, customer);
    } else {
      // Fill missing profile fields from later rows
      if (!customer.name && row.name) customer.name = row.name;
      if (!customer.mobileNum && phone) customer.mobileNum = phone;
      if (!customer.email && row.email) customer.email = row.email;
      if (!customer.companyName && row.companyName) customer.companyName = row.companyName;
      if (!customer.firmName && row.firmName) customer.firmName = row.firmName;
      for (const f of flags) {
        if (!customer.dataQualityFlags.includes(f)) customer.dataQualityFlags.push(f);
      }
    }

    const processName = (row.processName || 'Default').trim();
    const processId = makeProcessId(customerId, processName);
    const statusRaw = (row.status || '').trim();
    const status = normalizeStage(statusRaw);
    const interactionDateIso = toIsoOrNull(row.interactionDate);
    const interactionId = makeInteractionId(customerId, rowIndex, processId);

    const interaction: Interaction = {
      interactionId,
      customerId,
      salesProcessId: processId,
      interactionDate: interactionDateIso,
      statusRaw,
      status,
      assignedTo: row.assignedTo || undefined,
      assignedBy: row.assignedBy || undefined,
      notes: row.notes || undefined,
      source: row.source || undefined,
      processName,
      projectName: row.projectName || undefined,
      projectLocation: row.projectLocation || undefined,
      expectedBudget: row.expectedBudget || undefined,
      preferredLocation: row.preferredLocation || undefined,
      nextFollowUp: row.nextFollowUp || undefined,
      nextFollowUpDate: toIsoOrNull(row.nextFollowUpDate) ?? toIsoOrNull(row.nextFollowUp),
      revisitDate: toIsoOrNull(row.revisitDate),
      followUpCount: parseCount(row.followUpCount),
      revisitCount: parseCount(row.revisitCount),
      followupOwner: row.followupOwner || undefined,
      priority: row.priority || undefined,
      reason: row.reason || undefined,
      issue: row.issue || undefined,
      coldFollowUp: row.coldFollowUp || undefined,
      raw: row,
    };
    interactions.push(interaction);
    customer.interactionIds.push(interactionId);

    let process = processesById.get(processId);
    if (!process) {
      process = {
        salesProcessId: processId,
        customerId,
        processName,
        currentStage: status,
        currentStageRaw: statusRaw,
        stageEnteredAt: interactionDateIso,
        projectName: row.projectName || undefined,
        assignedTo: row.assignedTo || undefined,
        source: row.source || undefined,
        interactionIds: [interactionId],
        stageHistory: [],
      };
      processesById.set(processId, process);
      customer.salesProcessIds.push(processId);
    } else {
      process.interactionIds.push(interactionId);
      // Latest interaction by date determines current stage
      const prevDate = process.stageEnteredAt
        ? parseFlexibleDate(process.stageEnteredAt)?.getTime() ?? 0
        : 0;
      // We'll finalize current stage after sorting — accumulate for now
      if (row.projectName) process.projectName = row.projectName;
      if (row.assignedTo) process.assignedTo = row.assignedTo;
      if (row.source) process.source = row.source;
      void prevDate;
    }
  });

  // Finalize current stage + stage history per process
  for (const process of processesById.values()) {
    const procInteractions = interactions
      .filter((i) => i.salesProcessId === process.salesProcessId)
      .sort((a, b) => {
        const ta = a.interactionDate ? new Date(a.interactionDate).getTime() : 0;
        const tb = b.interactionDate ? new Date(b.interactionDate).getTime() : 0;
        return ta - tb;
      });

    if (procInteractions.length === 0) continue;

    const latest = procInteractions[procInteractions.length - 1];
    process.currentStage = latest.status;
    process.currentStageRaw = latest.statusRaw;
    if (latest.assignedTo) process.assignedTo = latest.assignedTo;
    if (latest.projectName) process.projectName = latest.projectName;

    // Stage history: earliest interaction date where each status appears
    const stageFirst = new Map<CanonicalStage, StageHistoryEntry>();
    for (const ix of procInteractions) {
      if (ix.status === 'Unknown') continue;
      const existing = stageFirst.get(ix.status);
      if (!existing) {
        stageFirst.set(ix.status, {
          customerId: process.customerId,
          salesProcessId: process.salesProcessId,
          stage: ix.status,
          stageRaw: ix.statusRaw,
          stageEntryDate: ix.interactionDate,
        });
      } else if (
        ix.interactionDate &&
        (!existing.stageEntryDate ||
          new Date(ix.interactionDate).getTime() <
            new Date(existing.stageEntryDate).getTime())
      ) {
        existing.stageEntryDate = ix.interactionDate;
        existing.stageRaw = ix.statusRaw;
      }
    }

    // Fallback: if current stage not found in process interactions, use earliest
    // customer-level interaction with that status
    if (!stageFirst.has(process.currentStage)) {
      const customerIx = interactions
        .filter(
          (i) =>
            i.customerId === process.customerId &&
            i.status === process.currentStage,
        )
        .sort((a, b) => {
          const ta = a.interactionDate ? new Date(a.interactionDate).getTime() : Infinity;
          const tb = b.interactionDate ? new Date(b.interactionDate).getTime() : Infinity;
          return ta - tb;
        });
      if (customerIx[0]) {
        stageFirst.set(process.currentStage, {
          customerId: process.customerId,
          salesProcessId: process.salesProcessId,
          stage: process.currentStage,
          stageRaw: process.currentStageRaw,
          stageEntryDate: customerIx[0].interactionDate,
        });
      }
    }

    process.stageHistory = [...stageFirst.values()];
    const currentEntry = stageFirst.get(process.currentStage);
    process.stageEnteredAt =
      currentEntry?.stageEntryDate ??
      procInteractions[0]?.interactionDate ??
      null;
  }

  // Follow-ups
  const followUps: FollowUpActivity[] = [];
  for (const process of processesById.values()) {
    const procIx = interactions.filter(
      (i) => i.salesProcessId === process.salesProcessId,
    );
    const latest = [...procIx].sort((a, b) => {
      const ta = a.interactionDate ? new Date(a.interactionDate).getTime() : 0;
      const tb = b.interactionDate ? new Date(b.interactionDate).getTime() : 0;
      return tb - ta;
    })[0];
    followUps.push({
      customerId: process.customerId,
      salesProcessId: process.salesProcessId,
      nextFollowUpDate: latest?.nextFollowUpDate ?? null,
      revisitDate: latest?.revisitDate ?? null,
      followupOwner: latest?.followupOwner,
      assignedTo: process.assignedTo,
      currentStage: process.currentStage,
    });
  }

  // Projects & executives
  const projectMap = new Map<string, Project>();
  const execMap = new Map<string, ExecutiveAssignment>();
  for (const process of processesById.values()) {
    if (process.projectName) {
      let p = projectMap.get(process.projectName);
      if (!p) {
        p = { projectName: process.projectName, customerIds: [], processIds: [] };
        projectMap.set(process.projectName, p);
      }
      if (!p.processIds.includes(process.salesProcessId)) {
        p.processIds.push(process.salesProcessId);
      }
      if (!p.customerIds.includes(process.customerId)) {
        p.customerIds.push(process.customerId);
      }
    }
    if (process.assignedTo) {
      let e = execMap.get(process.assignedTo);
      if (!e) {
        e = {
          executiveName: process.assignedTo,
          customerIds: [],
          processIds: [],
        };
        execMap.set(process.assignedTo, e);
      }
      if (!e.processIds.includes(process.salesProcessId)) {
        e.processIds.push(process.salesProcessId);
      }
      if (!e.customerIds.includes(process.customerId)) {
        e.customerIds.push(process.customerId);
      }
    }
  }

  const duplicateCustomerIds = detectDuplicateIds([...customersById.keys()]);
  const duplicatePhones = [...phoneCollision];

  for (const phone of duplicatePhones) {
    issues.push({
      code: 'DUPLICATE_PHONE',
      severity: 'warning',
      message: `Phone ${phone} associated with multiple customers`,
      field: 'mobileNum',
    });
  }

  const dataHealth: DataHealthReport = {
    totalRows: rows.length,
    validCustomers: customersById.size,
    unmatchedRows: unmatchedRows.length,
    duplicateCustomerIds,
    duplicatePhones,
    missingCustomerIds,
    missingPhones,
    issues,
  };

  return {
    customers: [...customersById.values()],
    processes: [...processesById.values()],
    interactions,
    followUps,
    projects: [...projectMap.values()],
    executives: [...execMap.values()],
    dataHealth,
    unmatchedRows,
  };
}

/** Detect duplicate customer id strings (normally unique in map — kept for health API). */
export function detectDuplicateIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return [...dupes];
}

export function detectDuplicates(rows: RawSheetRow[]): DataHealthIssue[] {
  const issues: DataHealthIssue[] = [];
  const idCounts = new Map<string, number[]>();
  const phoneCounts = new Map<string, { ids: Set<string>; rows: number[] }>();

  rows.forEach((row, idx) => {
    const rowIndex = row._rowIndex ?? idx;
    const cid = (row.customerId ?? '').trim();
    if (cid) {
      if (!idCounts.has(cid)) idCounts.set(cid, []);
      idCounts.get(cid)!.push(rowIndex);
    }
    const phone = normalizePhone(row.mobileNum);
    if (phone) {
      if (!phoneCounts.has(phone)) {
        phoneCounts.set(phone, { ids: new Set(), rows: [] });
      }
      const entry = phoneCounts.get(phone)!;
      entry.rows.push(rowIndex);
      if (cid) entry.ids.add(cid);
    }
  });

  // Multiple rows with same Customer Id is EXPECTED (interactions) — not a dupe.
  // Flag only when same phone maps to different Customer Ids.
  for (const [phone, entry] of phoneCounts) {
    if (entry.ids.size > 1) {
      issues.push({
        code: 'DUPLICATE_PHONE_MULTI_CUSTOMER',
        severity: 'warning',
        message: `Phone ${phone} used by Customer Ids: ${[...entry.ids].join(', ')}`,
        field: 'mobileNum',
      });
    }
  }

  // Exact duplicate rows (same customer + process + date + status)
  const signatureCounts = new Map<string, number>();
  rows.forEach((row, idx) => {
    const sig = [
      (row.customerId ?? '').trim(),
      (row.processName ?? '').trim(),
      calendarDateKey(row.interactionDate) ?? '',
      (row.status ?? '').trim(),
    ].join('|');
    signatureCounts.set(sig, (signatureCounts.get(sig) ?? 0) + 1);
    if ((signatureCounts.get(sig) ?? 0) === 2) {
      issues.push({
        code: 'DUPLICATE_INTERACTION_SIGNATURE',
        severity: 'info',
        message: `Possible duplicate interaction: ${sig}`,
        rowIndex: row._rowIndex ?? idx,
      });
    }
  });

  return issues;
}
