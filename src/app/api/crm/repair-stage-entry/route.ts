import { NextResponse } from 'next/server';
import { repairDerivedStageEntryDates } from '@/lib/crm/runo';
import {
  loadCalls,
  loadRawRows,
  loadSnapshot,
  saveRawRows,
  loadSyncMeta,
  saveSyncMeta,
} from '@/lib/crm/store';

export const runtime = 'nodejs';

/**
 * One-shot repair: derived call-export rows used latest call as stage entry,
 * which zeroed Gone Dark. Snap stage entry to earliest call per customer.
 */
export async function POST() {
  try {
    const [rows, calls] = await Promise.all([loadRawRows(), loadCalls()]);
    const { rows: next, repaired } = repairDerivedStageEntryDates(rows, calls);
    if (repaired > 0) {
      await saveRawRows(next, 'google_sheets');
      const meta = await loadSyncMeta();
      meta.message = `Repaired stage-entry dates on ${repaired} derived rows (earliest call). Reclassified Gone Dark / Stuck / Intent.`;
      await saveSyncMeta(meta);
    }
    const snapshot = await loadSnapshot();
    const goneDark = snapshot.classifications.filter(
      (c) =>
        c.primaryCategory === 'GONE_DARK' ||
        c.underlyingFlags.includes('GONE_DARK'),
    ).length;

    // Do not return full snapshot (too large); client should refresh.
    return NextResponse.json({
      ok: true,
      repaired,
      goneDark,
      message: `Repaired ${repaired} rows. Gone Dark count: ${goneDark}. Refresh the dashboard.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Repair failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
