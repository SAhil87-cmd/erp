/**
 * Verified completed site-visit counting for intent / Gone Dark rules.
 *
 * Only Site Visit Done and Revisit Done count as completed visits.
 * Site Visit Scheduled is never treated as a completed visit.
 * revisitCount fields are ignored unless backed by those stage records.
 */

import { parseFlexibleDate } from '../dates';
import type { CanonicalStage, StageHistoryEntry } from '../types';

export const COMPLETED_VISIT_STAGES: CanonicalStage[] = [
  'Site Visit Done',
  'Revisit Done',
];

export interface CompletedVisitSummary {
  /** Number of verified completed site visits (1 = SV Done, 2+ = Revisit Done path). */
  count: number;
  /** Timestamp of the latest completed visit used as Gone Dark cutoff. */
  latestVisitAt: string | null;
  /** Evidence stages that contributed to the count. */
  stages: CanonicalStage[];
}

function laterIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  const ta = parseFlexibleDate(a)?.getTime() ?? 0;
  const tb = parseFlexibleDate(b)?.getTime() ?? 0;
  return tb >= ta ? b : a;
}

/**
 * Count verified completed site visits from stage history + current stage.
 *
 * Rules:
 * - Site Visit Done → at least 1 completed visit.
 * - Revisit Done → at least 2 completed visits (site visit + revisit).
 * - History entries for those stages refine the latest visit timestamp.
 */
export function summarizeCompletedSiteVisits(input: {
  currentStage: CanonicalStage;
  stageEnteredAt: string | null;
  stageHistory?: StageHistoryEntry[] | null;
}): CompletedVisitSummary {
  const history = input.stageHistory ?? [];
  const svEntry = history.find((h) => h.stage === 'Site Visit Done');
  const revisitEntry = history.find((h) => h.stage === 'Revisit Done');

  const stages: CanonicalStage[] = [];
  let count = 0;
  let latestVisitAt: string | null = null;

  const hasSv =
    input.currentStage === 'Site Visit Done' ||
    input.currentStage === 'Revisit Done' ||
    Boolean(svEntry);
  const hasRevisit =
    input.currentStage === 'Revisit Done' || Boolean(revisitEntry);

  if (hasSv) {
    stages.push('Site Visit Done');
    count = 1;
    latestVisitAt = laterIso(
      svEntry?.stageEntryDate ?? null,
      input.currentStage === 'Site Visit Done' ? input.stageEnteredAt : null,
    );
  }

  if (hasRevisit) {
    if (!stages.includes('Revisit Done')) stages.push('Revisit Done');
    // Revisit Done means a second (or later) completed visit occurred.
    count = Math.max(count, 2);
    latestVisitAt = laterIso(
      latestVisitAt,
      laterIso(
        revisitEntry?.stageEntryDate ?? null,
        input.currentStage === 'Revisit Done' ? input.stageEnteredAt : null,
      ),
    );
  }

  // If current stage is a completed visit but we still lack a timestamp, use stage entry.
  if (
    count > 0 &&
    !latestVisitAt &&
    COMPLETED_VISIT_STAGES.includes(input.currentStage)
  ) {
    latestVisitAt = input.stageEnteredAt;
  }

  return { count, latestVisitAt, stages };
}
