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
 * Categories that suppress High / Very High Intent from simultaneous counting.
 * Official order: Gone Dark overrides intent; other ops do not.
 */
export const INTENT_OVERRIDE_CATEGORIES = ['GONE_DARK'] as const;
