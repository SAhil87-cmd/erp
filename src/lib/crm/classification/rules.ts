/**
 * Independent pure classification rule evaluators.
 */

import type { ClassificationConfig } from './config';
import { DEFAULT_CLASSIFICATION_CONFIG } from './config';
import {
  answeredDistinctDates,
  callsAfter,
  consecutiveUnansweredDistinctDates,
  hasAnsweredCall,
  isCallDataMissing,
  longestAnsweredDuration,
} from './helpers';
import type {
  CallRecord,
  CanonicalStage,
  RuleEvaluationResult,
} from '../types';

export interface RuleInput {
  currentStage: CanonicalStage;
  stageEnteredAt: string | null;
  calls: CallRecord[] | null | undefined;
  config?: ClassificationConfig;
}

function cfg(input: RuleInput): ClassificationConfig {
  return input.config ?? DEFAULT_CLASSIFICATION_CONFIG;
}

function insufficient(
  missingFields: string[],
  reason: string,
): RuleEvaluationResult {
  return {
    flagged: false,
    reason,
    evidence: {},
    insufficientCallData: true,
    missingFields,
  };
}

function stuckReason(stage: CanonicalStage): string {
  switch (stage) {
    case 'Interested':
    case 'Cold':
    case 'Followup':
    case 'Cold Followup':
      return 'No Progress';
    case 'Site Visit Scheduled':
      return 'Site Visit Pending';
    case 'Site Visit Done':
      return 'Decision Pending';
    case 'Revisit Done':
      return 'Booking Pending';
    default:
      return 'No Progress';
  }
}

/**
 * GONE DARK: Site Visit Scheduled | Site Visit Done | Revisit Done;
 * >=2 consecutive unanswered distinct dates AFTER stage entry; answered resets.
 */
export function evaluateGoneDark(input: RuleInput): RuleEvaluationResult {
  const config = cfg(input);
  const { qualifyingStages, minUnansweredDates } = config.goneDark;

  if (!qualifyingStages.includes(input.currentStage)) {
    return {
      flagged: false,
      reason: `Stage ${input.currentStage} is not a Gone Dark qualifying stage`,
      evidence: { currentStage: input.currentStage, qualifyingStages },
    };
  }

  if (isCallDataMissing(input.calls)) {
    return insufficient(
      ['calls'],
      'Gone Dark requires call history after stage entry; no call records available',
    );
  }

  const post = callsAfter(input.calls!, input.stageEnteredAt);
  const streak = consecutiveUnansweredDistinctDates(post);
  const flagged = streak >= minUnansweredDates;

  return {
    flagged,
    reason: flagged
      ? `${streak} consecutive unanswered distinct dates after ${input.currentStage} (threshold ${minUnansweredDates})`
      : `Only ${streak} consecutive unanswered distinct dates (need ${minUnansweredDates})`,
    evidence: {
      currentStage: input.currentStage,
      stageEnteredAt: input.stageEnteredAt,
      consecutiveUnansweredDates: streak,
      minUnansweredDates,
      postStageCallCount: post.length,
    },
  };
}

/**
 * NOT PICKING UP: Interested | Cold | Followup | Cold Followup;
 * >=3 consecutive unanswered distinct dates; same-day multiples count once; answered resets.
 * Note: status "Not Picking" is NOT the same as this classification.
 */
export function evaluateNotPickingUp(input: RuleInput): RuleEvaluationResult {
  const config = cfg(input);
  const { qualifyingStages, minUnansweredDates } = config.notPickingUp;

  if (!qualifyingStages.includes(input.currentStage)) {
    return {
      flagged: false,
      reason: `Stage ${input.currentStage} is not a Not Picking Up qualifying stage`,
      evidence: { currentStage: input.currentStage, qualifyingStages },
    };
  }

  if (isCallDataMissing(input.calls)) {
    return insufficient(
      ['calls'],
      'Not Picking Up requires call history; no call records available',
    );
  }

  const post = callsAfter(input.calls!, input.stageEnteredAt);
  const streak = consecutiveUnansweredDistinctDates(post);
  const flagged = streak >= minUnansweredDates;

  return {
    flagged,
    reason: flagged
      ? `${streak} consecutive unanswered distinct dates in ${input.currentStage} (threshold ${minUnansweredDates})`
      : `Only ${streak} consecutive unanswered distinct dates (need ${minUnansweredDates})`,
    evidence: {
      currentStage: input.currentStage,
      stageEnteredAt: input.stageEnteredAt,
      consecutiveUnansweredDates: streak,
      minUnansweredDates,
      postStageCallCount: post.length,
      note: 'Status "Not Picking" is a CRM status, not this classification',
    },
  };
}

/**
 * MISMARKED NI: stage Not Interested;
 * flag if never answered OR longest answered duration <= 20 seconds (20 qualifies, 21 does not).
 * If NO call records at all → insufficient. If HAVE records and none answered → flag.
 */
export function evaluateMismarkedNi(input: RuleInput): RuleEvaluationResult {
  const config = cfg(input);
  const maxDur = config.mismarkedNi.maxAnsweredDurationSecInclusive;

  if (input.currentStage !== 'Not Interested') {
    return {
      flagged: false,
      reason: 'Mismarked NI only applies when current stage is Not Interested',
      evidence: { currentStage: input.currentStage },
    };
  }

  if (isCallDataMissing(input.calls)) {
    return insufficient(
      ['calls'],
      'Mismarked NI requires call records to verify answer duration; none available',
    );
  }

  const calls = input.calls!;
  const answered = hasAnsweredCall(calls);
  const longest = longestAnsweredDuration(calls);

  if (!answered) {
    return {
      flagged: true,
      reason: 'Marked Not Interested but never answered a call',
      evidence: {
        currentStage: input.currentStage,
        answeredCallCount: 0,
        longestAnsweredDurationSec: 0,
        neverAnswered: true,
      },
    };
  }

  const flagged = longest <= maxDur;
  return {
    flagged,
    reason: flagged
      ? `Longest answered call was ${longest}s (≤ ${maxDur}s) — likely mismarked NI`
      : `Longest answered call was ${longest}s (> ${maxDur}s) — NI appears genuine`,
    evidence: {
      currentStage: input.currentStage,
      longestAnsweredDurationSec: longest,
      maxAnsweredDurationSecInclusive: maxDur,
      answeredCallCount: calls.filter(
        (c) => c.answered || c.callOutcome === 'answered',
      ).length,
    },
  };
}

/**
 * STUCK: >=3 answered distinct dates AFTER current stage entered;
 * stage-specific reasons.
 */
export function evaluateStuck(input: RuleInput): RuleEvaluationResult {
  const config = cfg(input);
  const { qualifyingStages, minAnsweredDates } = config.stuck;

  if (!qualifyingStages.includes(input.currentStage)) {
    return {
      flagged: false,
      reason: `Stage ${input.currentStage} is not evaluated for Stuck`,
      evidence: { currentStage: input.currentStage },
    };
  }

  if (isCallDataMissing(input.calls)) {
    return insufficient(
      ['calls'],
      'Stuck requires answered call history after stage entry; no call records available',
    );
  }

  const post = callsAfter(input.calls!, input.stageEnteredAt);
  const answeredDates = answeredDistinctDates(post);
  const flagged = answeredDates.length >= minAnsweredDates;
  const reasonLabel = stuckReason(input.currentStage);

  return {
    flagged,
    reason: flagged
      ? `Stuck — ${reasonLabel}: ${answeredDates.length} answered distinct dates in ${input.currentStage}`
      : `Only ${answeredDates.length} answered distinct dates (need ${minAnsweredDates})`,
    evidence: {
      currentStage: input.currentStage,
      stageEnteredAt: input.stageEnteredAt,
      answeredDistinctDates: answeredDates,
      answeredDistinctDateCount: answeredDates.length,
      minAnsweredDates,
      stuckReason: reasonLabel,
    },
  };
}

/**
 * VERY HIGH INTENT: Revisit Done + >=2 answered distinct dates after revisit.
 */
export function evaluateVeryHighIntent(input: RuleInput): RuleEvaluationResult {
  const config = cfg(input);
  const { qualifyingStages, minAnsweredDates } = config.veryHighIntent;

  if (!qualifyingStages.includes(input.currentStage)) {
    return {
      flagged: false,
      reason: 'Very High Intent requires stage Revisit Done',
      evidence: { currentStage: input.currentStage },
    };
  }

  if (isCallDataMissing(input.calls)) {
    return insufficient(
      ['calls'],
      'Very High Intent requires call history after Revisit Done; none available',
    );
  }

  const post = callsAfter(input.calls!, input.stageEnteredAt);
  const answeredDates = answeredDistinctDates(post);
  const flagged = answeredDates.length >= minAnsweredDates;

  return {
    flagged,
    reason: flagged
      ? `Revisit Done with ${answeredDates.length} answered distinct dates — Very High Intent`
      : `Only ${answeredDates.length} answered distinct dates after Revisit Done (need ${minAnsweredDates})`,
    evidence: {
      currentStage: input.currentStage,
      stageEnteredAt: input.stageEnteredAt,
      answeredDistinctDates: answeredDates,
      answeredDistinctDateCount: answeredDates.length,
      minAnsweredDates,
    },
  };
}

/**
 * HIGH INTENT: Site Visit Done + >=2 answered distinct dates after SV Done.
 */
export function evaluateHighIntent(input: RuleInput): RuleEvaluationResult {
  const config = cfg(input);
  const { qualifyingStages, minAnsweredDates } = config.highIntent;

  if (!qualifyingStages.includes(input.currentStage)) {
    return {
      flagged: false,
      reason: 'High Intent requires stage Site Visit Done',
      evidence: { currentStage: input.currentStage },
    };
  }

  if (isCallDataMissing(input.calls)) {
    return insufficient(
      ['calls'],
      'High Intent requires call history after Site Visit Done; none available',
    );
  }

  const post = callsAfter(input.calls!, input.stageEnteredAt);
  const answeredDates = answeredDistinctDates(post);
  const flagged = answeredDates.length >= minAnsweredDates;

  return {
    flagged,
    reason: flagged
      ? `Site Visit Done with ${answeredDates.length} answered distinct dates — High Intent`
      : `Only ${answeredDates.length} answered distinct dates after Site Visit Done (need ${minAnsweredDates})`,
    evidence: {
      currentStage: input.currentStage,
      stageEnteredAt: input.stageEnteredAt,
      answeredDistinctDates: answeredDates,
      answeredDistinctDateCount: answeredDates.length,
      minAnsweredDates,
    },
  };
}
