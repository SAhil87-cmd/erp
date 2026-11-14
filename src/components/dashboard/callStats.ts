/**
 * Call history summaries for drawer / Site Visit Scheduled views.
 */

import { calendarDateKey } from '@/lib/crm/dates';
import type { CallRecord } from '@/lib/crm/types';

export interface CallHistoryStats {
  totalCalls: number;
  answeredCalls: number;
  distinctDays: number;
  totalTalkSeconds: number;
  totalTalkMinutes: number;
  dates: string[];
}

export function summarizeCallHistory(calls: CallRecord[]): CallHistoryStats {
  const daySet = new Set<string>();
  let answeredCalls = 0;
  let totalTalkSeconds = 0;

  for (const call of calls) {
    const day = calendarDateKey(call.callAt || call.callDate || null);
    if (day) daySet.add(day);
    const answered = call.answered || call.callOutcome === 'answered';
    if (answered) {
      answeredCalls += 1;
      totalTalkSeconds += Math.max(0, Number(call.durationSeconds) || 0);
    }
  }

  const dates = [...daySet].sort((a, b) => b.localeCompare(a));
  return {
    totalCalls: calls.length,
    answeredCalls,
    distinctDays: dates.length,
    totalTalkSeconds,
    totalTalkMinutes: Math.round((totalTalkSeconds / 60) * 10) / 10,
    dates,
  };
}

export function formatTalkDuration(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m <= 0) return `${s}s`;
  if (s === 0) return `${m} min`;
  return `${m} min ${s}s`;
}
