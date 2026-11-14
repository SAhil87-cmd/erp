/**
 * Configurable classification thresholds and stage alias normalization.
 */

import { normalizeStage } from '../normalize';
import type { CanonicalStage } from '../types';

export interface ClassificationConfig {
  goneDark: {
    minUnansweredDates: number;
    /** Gone Dark only after a verified completed site visit (not scheduled). */
    requireCompletedSiteVisit: boolean;
  };
  notPickingUp: {
    minUnansweredDates: number;
    qualifyingStages: CanonicalStage[];
  };
  mismarkedNi: {
    maxAnsweredDurationSecInclusive: number;
  };
  stuck: {
    minAnsweredDates: number;
    qualifyingStages: CanonicalStage[];
  };
  veryHighIntent: {
    /** Minimum verified completed site visits (Revisit Done path = 2). */
    minCompletedVisits: number;
  };
  highIntent: {
    /** Minimum verified completed site visits (Site Visit Done = 1). */
    minCompletedVisits: number;
  };
}

export const DEFAULT_CLASSIFICATION_CONFIG: ClassificationConfig = {
  goneDark: {
    minUnansweredDates: 2,
    requireCompletedSiteVisit: true,
  },
  notPickingUp: {
    minUnansweredDates: 3,
    qualifyingStages: ['Interested', 'Cold', 'Followup', 'Cold Followup'],
  },
  mismarkedNi: {
    maxAnsweredDurationSecInclusive: 20,
  },
  stuck: {
    minAnsweredDates: 3,
    qualifyingStages: [
      'Interested',
      'Cold',
      'Followup',
      'Cold Followup',
      'Site Visit Scheduled',
      'Site Visit Done',
      'Revisit Done',
    ],
  },
  veryHighIntent: {
    minCompletedVisits: 2,
  },
  highIntent: {
    minCompletedVisits: 1,
  },
};

/** Re-export stage normalization for classification consumers. */
export { normalizeStage };

/** Terminal / exclusion stages that block opportunity classifications. */
export const TERMINAL_EXCLUSION_STAGES: CanonicalStage[] = [
  'Sales Closed',
  'Not Interested',
  'Spam',
  'DND',
];

/**
 * Executive CRM stage wins: do not push these into Intent / Stuck (or, for NI,
 * Gone Dark). The salesperson's status is the source of truth.
 */
export const EXEC_OWNED_FOLLOW_STAGES: CanonicalStage[] = [
  'Cold Followup',
  'Cold',
  'Followup',
];

/**
 * Categories that suppress High / Very High Intent from simultaneous counting.
 * Official order: Gone Dark overrides intent; other ops do not.
 */
export const INTENT_OVERRIDE_CATEGORIES = ['GONE_DARK'] as const;

/** Remark / notes text that means the exec closed the lead as Not Interested. */
export function remarkIndicatesNotInterested(
  remark: string | null | undefined,
): boolean {
  if (!remark) return false;
  const t = remark.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (/\bnot[\s-]*interested\b/.test(t)) return true;
  if (/\bnot[\s-]*intrested\b/.test(t)) return true; // common misspelling
  // Short note that is just "NI" / "N.I."
  if (/^n\.?\s*i\.?$/.test(t)) return true;
  return false;
}
