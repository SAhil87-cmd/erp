/**
 * Client-side lead exports (CSV / XLSX / PDF) from the loaded snapshot.
 * Separate files per intelligence category so data stays exact to the UI.
 */

import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { CanonicalStage, IntelligenceCategory } from '@/lib/crm/types';
import { CATEGORY_LABELS, formatDate } from './labels';
import type { LeadRow } from './selectors';

export type LeadExportFormat = 'csv' | 'xlsx' | 'pdf';

export type LeadExportKind =
  | IntelligenceCategory
  | 'ALL_LEADS'
  | 'SALES_CLOSED'
  | 'NOT_INTERESTED_STAGE'
  | 'COLD_FOLLOW_STAGE'
  | 'SITE_VISIT_SCHEDULED_STAGE';

export const LEAD_EXPORT_KINDS: Array<{
  id: LeadExportKind;
  label: string;
  category?: IntelligenceCategory | IntelligenceCategory[];
  stage?: CanonicalStage;
  stages?: CanonicalStage[];
}> = [
  { id: 'GONE_DARK', label: 'Gone Dark', category: 'GONE_DARK' },
  { id: 'NOT_PICKING_UP', label: 'Not Picking Up', category: 'NOT_PICKING_UP' },
  { id: 'MISMARKED_NI', label: 'Mismarked NI', category: 'MISMARKED_NI' },
  { id: 'STUCK', label: 'Stuck Leads', category: 'STUCK' },
  {
    id: 'VERY_HIGH_INTENT',
    label: 'Very High Intent',
    category: 'VERY_HIGH_INTENT',
  },
  { id: 'HIGH_INTENT', label: 'High Intent', category: 'HIGH_INTENT' },
  {
    id: 'NOT_INTERESTED_STAGE',
    label: 'Not Interested',
    stage: 'Not Interested',
  },
  {
    id: 'COLD_FOLLOW_STAGE',
    label: 'Cold Follow',
    stages: ['Cold Followup', 'Cold', 'Followup'],
  },
  {
    id: 'SITE_VISIT_SCHEDULED_STAGE',
    label: 'Site Visit Scheduled',
    stage: 'Site Visit Scheduled',
  },
  {
    id: 'ALL_LEADS',
    label: 'All Leads',
  },
  { id: 'SALES_CLOSED', label: 'Sales Closed', stage: 'Sales Closed' },
];

const HEADERS = [
  'Customer ID',
  'Name',
  'Mobile',
  'Project',
  'Stage',
  'Executive',
  'Category',
  'Call data',
  'Remark',
  'Reason / action',
  'Stage entered',
  'Last activity',
  'Process ID',
] as const;

function categoryLabel(cat: IntelligenceCategory): string {
  return CATEGORY_LABELS[cat] ?? cat;
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function leadExportFilename(
  kindLabel: string,
  format: LeadExportFormat,
): string {
  return `yashodhan-${slugify(kindLabel)}-${stamp()}.${format}`;
}

function toMatrix(rows: LeadRow[]): string[][] {
  return rows.map((r) => [
    r.customerId,
    r.name,
    r.mobile,
    r.projectName,
    r.stage,
    r.assignedTo,
    categoryLabel(r.category),
    r.callDataStatus,
    r.remark || '',
    r.reason || r.recommendedAction || '',
    formatDate(r.stageEnteredAt),
    formatDate(r.lastActivityAt),
    r.salesProcessId,
  ]);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function escapeCsvCell(value: unknown): string {
  if (value == null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function exportLeadsCsv(rows: LeadRow[], kindLabel: string): void {
  const lines = [
    [...HEADERS].map(escapeCsvCell).join(','),
    ...toMatrix(rows).map((r) => r.map(escapeCsvCell).join(',')),
  ];
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], {
    type: 'text/csv;charset=utf-8',
  });
  downloadBlob(blob, leadExportFilename(kindLabel, 'csv'));
}

export function exportLeadsXlsx(rows: LeadRow[], kindLabel: string): void {
  const sheetRows = [ [...HEADERS], ...toMatrix(rows) ];
  const ws = XLSX.utils.aoa_to_sheet(sheetRows);
  ws['!cols'] = HEADERS.map((h) => ({
    wch: Math.min(40, Math.max(12, h.length + 2)),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, kindLabel.slice(0, 31) || 'Leads');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(
    new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    leadExportFilename(kindLabel, 'xlsx'),
  );
}

export function exportLeadsPdf(rows: LeadRow[], kindLabel: string): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const margin = 28;
  doc.setFontSize(14);
  doc.text(`Yashodhan Group — ${kindLabel}`, margin, 36);
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text(
    `${rows.length.toLocaleString()} leads · exported ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
    margin,
    52,
  );
  doc.setTextColor(0);

  const body = toMatrix(rows).map((r) => [
    r[1], // name
    r[2], // mobile
    r[3], // project
    r[4], // stage
    r[5], // executive
    r[6], // category
    r[8], // remark
    r[10], // stage entered
  ]);

  autoTable(doc, {
    startY: 64,
    head: [
      [
        'Name',
        'Mobile',
        'Project',
        'Stage',
        'Executive',
        'Category',
        'Remark',
        'Stage entered',
      ],
    ],
    body,
    styles: { fontSize: 7, cellPadding: 3, overflow: 'linebreak' },
    headStyles: { fillColor: [30, 64, 175], textColor: 255 },
    margin: { left: margin, right: margin },
    didDrawPage: (data) => {
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(
        `Page ${data.pageNumber}`,
        doc.internal.pageSize.getWidth() - margin - 40,
        doc.internal.pageSize.getHeight() - 16,
      );
    },
  });

  doc.save(leadExportFilename(kindLabel, 'pdf'));
}

export function downloadLeadExport(
  rows: LeadRow[],
  kindLabel: string,
  format: LeadExportFormat,
): void {
  if (format === 'csv') exportLeadsCsv(rows, kindLabel);
  else if (format === 'xlsx') exportLeadsXlsx(rows, kindLabel);
  else exportLeadsPdf(rows, kindLabel);
}
