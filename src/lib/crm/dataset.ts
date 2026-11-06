/**
 * Primary published Google Sheets dataset for Yashodhan CRM.
 * Published sheets require no API credentials — fetched server-side as CSV.
 */

/** User-facing published HTML link (canonical). */
export const PUBLISHED_SHEET_HTML_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQS0n24NGhCYCBE7bHdGScggtbPVyui4iHpfcuNq9-RYtw3AZXjnS8SjXUM01E4n_giJDJb6CFd4yNW/pubhtml';

/**
 * CSV export of the same published workbook.
 * Override with GOOGLE_SHEETS_PUBLISHED_CSV_URL if a different gid/tab is needed.
 */
export const DEFAULT_PUBLISHED_SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQS0n24NGhCYCBE7bHdGScggtbPVyui4iHpfcuNq9-RYtw3AZXjnS8SjXUM01E4n_giJDJb6CFd4yNW/pub?output=csv';

export function getPublishedSheetCsvUrl(): string {
  return (
    process.env.GOOGLE_SHEETS_PUBLISHED_CSV_URL?.trim() ||
    DEFAULT_PUBLISHED_SHEET_CSV_URL
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
