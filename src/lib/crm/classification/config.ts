/**
 * Configurable classification thresholds and stage alias normalization.
 */

import { normalizeStage } from '../normalize';
import type { CanonicalStage } from '../types';

export interface ClassificationConfig {
  goneDark: {
    minUnansweredDates: number;
    qualifyingStages: CanonicalStage[];
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
    minAnsweredDates: number;
    qualifyingStages: CanonicalStage[];
  };
  highIntent: {
    minAnsweredDates: number;
    qualifyingStages: CanonicalStage[];
  };
}

export const DEFAULT_CLASSIFICATION_CONFIG: ClassificationConfig = {
  goneDark: {
    minUnansweredDates: 2,
    qualifyingStages: [
      'Site Visit Scheduled',
      'Site Visit Done',
      'Revisit Done',
    ],
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
    minAnsweredDates: 2,
    qualifyingStages: ['Revisit Done'],
  },
  highIntent: {
    minAnsweredDates: 2,
    qualifyingStages: ['Site Visit Done'],
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

/** Ops alert categories that exclude HIGH / VERY HIGH INTENT. */
export const OPS_EXCLUSION_CATEGORIES = [
  'GONE_DARK',
  'NOT_PICKING_UP',
  'MISMARKED_NI',
  'STUCK',
] as const;
