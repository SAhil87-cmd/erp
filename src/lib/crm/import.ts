/**
 * CSV / XLSX import with header-based mapping.
 * Invalid rows are retained with errors — never silently discarded.
 */

import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { CANONICAL_HEADERS, SHEET_COLUMNS, buildHeaderMap } from './columns';
import { detectDuplicates, mapRawRow } from './normalize';
import type { DataHealthIssue, RawSheetRow } from './types';

export interface ImportResult {
  rows: RawSheetRow[];
  headers: string[];
  mappedKeys: string[];
  unmappedHeaders: string[];
  issues: DataHealthIssue[];
}

function objectRowsFromMatrix(
  matrix: string[][],
): { headers: string[]; rows: RawSheetRow[]; issues: DataHealthIssue[] } {
  const issues: DataHealthIssue[] = [];
  if (matrix.length === 0) {
    return { headers: [], rows: [], issues };
  }

  const headers = matrix[0].map((h) => String(h ?? '').trim());
  const headerMap = buildHeaderMap(headers);
  const mappedKeys = [...new Set(headerMap.values())];

  if (mappedKeys.length === 0) {
    issues.push({
      code: 'NO_HEADERS_MATCHED',
      severity: 'error',
      message: 'No headers matched the expected 35-column schema',
    });
  }

  const expected = new Set(SHEET_COLUMNS);
  for (const key of expected) {
    if (!mappedKeys.includes(key)) {
      issues.push({
        code: 'MISSING_COLUMN',
        severity: 'warning',
        message: `Expected column missing: ${CANONICAL_HEADERS[key]}`,
        field: key,
      });
    }
  }

  const rows: RawSheetRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const cells = matrix[i].map((c) => (c == null ? '' : String(c)));
    // Skip completely empty rows
    if (cells.every((c) => !c.trim())) continue;

    const row = mapRawRow(cells, headers, i - 1);
    if (!row.customerId && !row.mobileNum && !row.name) {
      row._errors = [...(row._errors ?? []), 'EMPTY_IDENTITY_FIELDS'];
      issues.push({
        code: 'EMPTY_IDENTITY_FIELDS',
        severity: 'warning',
        message: 'Row has no Customer Id, Mobile, or Name',
        rowIndex: i - 1,
      });
    }
    // Retain even if invalid
    rows.push(row);
  }

  issues.push(...detectDuplicates(rows));
  return { headers, rows, issues };
}

export function importFromCsv(csvText: string): ImportResult {
  const parsed = Papa.parse<string[]>(csvText, {
    header: false,
    skipEmptyLines: false,
    dynamicTyping: false,
  });

  const matrix = (parsed.data as string[][]).map((row) =>
    (row ?? []).map((c) => (c == null ? '' : String(c))),
  );

  const issues: DataHealthIssue[] = [];
  if (parsed.errors?.length) {
    for (const err of parsed.errors) {
      issues.push({
        code: 'CSV_PARSE_ERROR',
        severity: 'warning',
        message: err.message,
        rowIndex: err.row,
      });
    }
  }

  const result = objectRowsFromMatrix(matrix);
  const headerMap = buildHeaderMap(result.headers);
  const mappedKeys = [...new Set([...headerMap.values()])];
  const unmappedHeaders = result.headers.filter((h, i) => h && !headerMap.has(i));

  return {
    rows: result.rows,
    headers: result.headers,
    mappedKeys,
    unmappedHeaders,
    issues: [...issues, ...result.issues],
  };
}

export function importFromXlsx(buffer: ArrayBuffer | Buffer): ImportResult {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return {
      rows: [],
      headers: [],
      mappedKeys: [],
      unmappedHeaders: [],
      issues: [
        {
          code: 'EMPTY_WORKBOOK',
          severity: 'error',
          message: 'Workbook has no sheets',
        },
      ],
    };
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  }) as string[][];

  const normalized = matrix.map((row) =>
    (row ?? []).map((c) => (c == null ? '' : String(c))),
  );

  const result = objectRowsFromMatrix(normalized);
  const headerMap = buildHeaderMap(result.headers);
  const mappedKeys = [...new Set([...headerMap.values()])];
  const unmappedHeaders = result.headers.filter((h, i) => h && !headerMap.has(i));

  return {
    rows: result.rows,
    headers: result.headers,
    mappedKeys,
    unmappedHeaders,
    issues: result.issues,
  };
}

/** Parse a File / Blob in Node or browser-like environments. */
export async function importFromFile(
  file: { name: string; arrayBuffer(): Promise<ArrayBuffer> } | Buffer,
  fileName?: string,
): Promise<ImportResult> {
  const name =
    fileName ??
    ('name' in file ? file.name : 'upload.csv');

  if (name.toLowerCase().endsWith('.xlsx') || name.toLowerCase().endsWith('.xls')) {
    const buf =
      Buffer.isBuffer(file)
        ? file
        : Buffer.from(await file.arrayBuffer());
    return importFromXlsx(buf);
  }

  const text =
    Buffer.isBuffer(file)
      ? file.toString('utf8')
      : new TextDecoder('utf-8').decode(await file.arrayBuffer());
  return importFromCsv(text);
}
