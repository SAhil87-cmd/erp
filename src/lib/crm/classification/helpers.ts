/**
 * Pure call-history helpers for classification rules.
 */

import { calendarDateKey, parseFlexibleDate } from '../dates';
import type { CallRecord } from '../types';

function callTimestamp(call: CallRecord): number {
  const raw = call.callAt || [call.callDate, call.callTime].filter(Boolean).join(' ');
  const d = parseFlexibleDate(raw);
  return d ? d.getTime() : 0;
}

/** Sort calls ascending by call time. */
export function sortCallsChronologically(calls: CallRecord[]): CallRecord[] {
  return [...calls].sort((a, b) => callTimestamp(a) - callTimestamp(b));
}

/** Calls strictly after the given stage-entry date (ISO or parseable). */
export function callsAfter(
  calls: CallRecord[],
  date: string | Date | null | undefined,
): CallRecord[] {
  if (!date) return sortCallsChronologically(calls);
  const cutoff =
    typeof date === 'string' ? parseFlexibleDate(date)?.getTime() : date.getTime();
  if (cutoff == null || Number.isNaN(cutoff)) {
    return sortCallsChronologically(calls);
  }
  return sortCallsChronologically(calls).filter((c) => callTimestamp(c) >= cutoff);
}

/**
 * Trailing streak of consecutive unanswered distinct calendar dates
 * after the last answered call in the sequence.
 *
 * - An answered call resets the unanswered sequence.
 * - Multiple unanswered on the same calendar date count as 1.
 * - Returns the length of the current trailing unanswered streak
 *   (at the END of the post-stage sequence).
 */
export function consecutiveUnansweredDistinctDates(calls: CallRecord[]): number {
  const sorted = sortCallsChronologically(calls);
  let streak = 0;
  let lastUnansweredKey: string | null = null;

  for (const call of sorted) {
    const answered = call.answered || call.callOutcome === 'answered';
    if (answered) {
      streak = 0;
      lastUnansweredKey = null;
      continue;
    }
    const key = calendarDateKey(call.callAt || call.callDate || null);
    if (!key) continue;
    if (key !== lastUnansweredKey) {
      streak += 1;
      lastUnansweredKey = key;
    }
  }
  return streak;
}

/** Distinct calendar dates with at least one answered call. */
export function answeredDistinctDates(calls: CallRecord[]): string[] {
  const keys = new Set<string>();
  for (const call of calls) {
    const answered = call.answered || call.callOutcome === 'answered';
    if (!answered) continue;
    const key = calendarDateKey(call.callAt || call.callDate || null);
    if (key) keys.add(key);
  }
  return [...keys].sort();
}

/** Longest answered-call duration in seconds (0 if none answered). */
export function longestAnsweredDuration(calls: CallRecord[]): number {
  let max = 0;
  for (const call of calls) {
    const answered = call.answered || call.callOutcome === 'answered';
    if (!answered) continue;
    const dur = Number(call.durationSeconds) || 0;
    if (dur > max) max = dur;
  }
  return max;
}

export function hasAnsweredCall(calls: CallRecord[]): boolean {
  return calls.some((c) => c.answered || c.callOutcome === 'answered');
}

export function isCallDataMissing(
  calls: CallRecord[] | null | undefined,
): boolean {
  return calls == null || calls.length === 0;
}
