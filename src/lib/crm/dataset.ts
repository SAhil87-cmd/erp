/**
 * Primary published Google Sheets dataset for Yashodhan CRM.
 * Published sheets require no API credentials — fetched server-side as CSV.
 *
 * Workbook has two tabs:
 * - gid=0           → Runo-style call history
 * - gid=808608767   → 35-column CRM interactions
 */

/** User-facing published HTML link (canonical). */
export const PUBLISHED_SHEET_HTML_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQS0n24NGhCYCBE7bHdGScggtbPVyui4iHpfcuNq9-RYtw3AZXjnS8SjXUM01E4n_giJDJb6CFd4yNW/pubhtml';

export const PUBLISHED_SHEET_KEY =
  '2PACX-1vQS0n24NGhCYCBE7bHdGScggtbPVyui4iHpfcuNq9-RYtw3AZXjnS8SjXUM01E4n_giJDJb6CFd4yNW';

/** Call-history tab (Runo export). */
export const PUBLISHED_CALLS_GID = '0';

/** Official 35-column CRM interactions tab. */
export const PUBLISHED_CRM_GID = '808608767';

export function publishedCsvUrlForGid(gid: string): string {
  return `https://docs.google.com/spreadsheets/d/e/${PUBLISHED_SHEET_KEY}/pub?gid=${gid}&single=true&output=csv`;
}

/**
 * Default CSV URL (calls tab). Override with GOOGLE_SHEETS_PUBLISHED_CSV_URL
 * if a different workbook is needed.
 */
export const DEFAULT_PUBLISHED_SHEET_CSV_URL = publishedCsvUrlForGid(
  PUBLISHED_CALLS_GID,
);

export function getPublishedSheetCsvUrl(): string {
  return (
    process.env.GOOGLE_SHEETS_PUBLISHED_CSV_URL?.trim() ||
    DEFAULT_PUBLISHED_SHEET_CSV_URL
  );
}

export function getPublishedCallsCsvUrl(): string {
  return (
    process.env.GOOGLE_SHEETS_CALLS_CSV_URL?.trim() ||
    publishedCsvUrlForGid(PUBLISHED_CALLS_GID)
  );
}

export function getPublishedCrmCsvUrl(): string {
  return (
    process.env.GOOGLE_SHEETS_CRM_CSV_URL?.trim() ||
    publishedCsvUrlForGid(PUBLISHED_CRM_GID)
  );
}

/** Convert a /pubhtml link to /pub?output=csv when possible. */
export function toPublishedCsvUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return getPublishedSheetCsvUrl();
  if (trimmed.includes('output=csv')) return trimmed;
  if (trimmed.includes('/pubhtml')) {
    return trimmed.replace('/pubhtml', '/pub?output=csv');
  }
  if (trimmed.includes('/pub')) {
    return trimmed.includes('?')
      ? `${trimmed}&output=csv`
      : `${trimmed}?output=csv`;
  }
  return trimmed;
}
