/**
 * Date parsing and calendar helpers.
 * Business timezone: Asia/Kolkata (IST, UTC+5:30).
 */

export const BUSINESS_TIMEZONE = 'Asia/Kolkata';

const DD_MM_YYYY =
  /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/;

const ISO_LIKE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?/;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Expand 2-digit year: 00–69 → 2000–2069, 70–99 → 1970–1999. */
function expandYear(y: number): number {
  if (y >= 100) return y;
  return y >= 70 ? 1900 + y : 2000 + y;
}

/**
 * Build an ISO-8601 string representing a wall-clock moment in Asia/Kolkata.
 * Stored as offset +05:30 so consumers can parse unambiguously.
 */
export function toKolkataIso(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): string {
  return `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}+05:30`;
}

/**
 * Parse DD/MM/YYYY (optionally with time) or ISO-like strings into a Date.
 * Returns null if unparseable. Does not invent dates.
 */
export function parseFlexibleDate(input: string | null | undefined): Date | null {
  if (input == null) return null;
  // Normalize "01/06/2026, 14:37:46" (Google Sheets / Runo export style)
  const raw = String(input).trim().replace(/,\s+/g, ' ');
  if (!raw) return null;

  // Excel serial date (number as string)
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    if (serial > 20000 && serial < 80000) {
      // Excel epoch 1899-12-30
      const ms = (serial - 25569) * 86400 * 1000;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }

  let m = raw.match(DD_MM_YYYY);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = expandYear(Number(m[3]));
    const hour = m[4] != null ? Number(m[4]) : 0;
    const minute = m[5] != null ? Number(m[5]) : 0;
    const second = m[6] != null ? Number(m[6]) : 0;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const iso = toKolkataIso(year, month, day, hour, minute, second);
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  m = raw.match(ISO_LIKE);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const hour = m[4] != null ? Number(m[4]) : 0;
    const minute = m[5] != null ? Number(m[5]) : 0;
    const second = m[6] != null ? Number(m[6]) : 0;
    // If original had Z or offset, prefer native parse; else treat as Kolkata wall time
    if (/[Zz]|[+-]\d{2}:?\d{2}$/.test(raw)) {
      const d = new Date(raw);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const iso = toKolkataIso(year, month, day, hour, minute, second);
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Last resort: Date.parse (may be locale-sensitive — avoid inventing)
  const fallback = new Date(raw);
  if (!Number.isNaN(fallback.getTime()) && /\d{4}/.test(raw)) {
    return fallback;
  }
  return null;
}

/**
 * Calendar date key YYYY-MM-DD in Asia/Kolkata for distinct-date counting.
 */
export function calendarDateKey(date: Date | string | null | undefined): string | null {
  if (date == null) return null;
  const d = typeof date === 'string' ? parseFlexibleDate(date) : date;
  if (!d || Number.isNaN(d.getTime())) return null;

  // Format in Asia/Kolkata
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: BUSINESS_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    if (y && m && day) return `${y}-${m}-${day}`;
  } catch {
    // fall through
  }
  // Fallback: use UTC+5:30 offset manually
  const shifted = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/** Compare two calendar keys (YYYY-MM-DD). Negative if a < b. */
export function compareCalendarKeys(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Today's calendar key in Asia/Kolkata. */
export function todayCalendarKey(now: Date = new Date()): string {
  return calendarDateKey(now) ?? now.toISOString().slice(0, 10);
}

/** Format a Date as DD/MM/YYYY in Kolkata. */
export function formatDdMmYyyy(date: Date | string | null | undefined): string | null {
  const key = calendarDateKey(date);
  if (!key) return null;
  const [y, m, d] = key.split('-');
  return `${d}/${m}/${y}`;
}

/** Parse to ISO string in Kolkata, or null. */
export function toIsoOrNull(input: string | null | undefined): string | null {
  const d = parseFlexibleDate(input);
  return d ? d.toISOString() : null;
}

/** True if calendar key falls within inclusive [from, to] range (YYYY-MM-DD). */
export function isCalendarKeyInRange(
  key: string | null | undefined,
  from?: string | null,
  to?: string | null,
): boolean {
  if (!key) return false;
  if (from && key < from) return false;
  if (to && key > to) return false;
  return true;
}
