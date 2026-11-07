/**
 * Central classification engine — evaluates all rules and picks primary category.
 *
 * Official priority:
 * 1. Terminal exclusions (Sales Closed / DND / Spam / genuine NI)
 * 2. Gone Dark
 * 3. Very High Intent
 * 4. High Intent
 * 5. Other classifications (Not Picking Up, Mismarked NI, Stuck)
 */

import {
  DEFAULT_CLASSIFICATION_CONFIG,
  INTENT_OVERRIDE_CATEGORIES,
  TERMINAL_EXCLUSION_STAGES,
  type ClassificationConfig,
} from './config';
import {
  evaluateGoneDark,
  evaluateHighIntent,
  evaluateMismarkedNi,
  evaluateNotPickingUp,
  evaluateStuck,
  evaluateVeryHighIntent,
  type RuleInput,
} from './rules';
import type {
  CallDataStatus,
  CallRecord,
  CanonicalStage,
  ClassificationResult,
  IntelligenceCategory,
  RuleEvaluationResult,
  StageHistoryEntry,
} from '../types';

export interface ClassifyLeadInput {
  customerId: string;
  salesProcessId: string;
  currentStage: CanonicalStage;
  stageEnteredAt: string | null;
  stageHistory?: StageHistoryEntry[] | null;
  calls: CallRecord[] | null | undefined;
  config?: ClassificationConfig;
}

/** Official primary-category order (exclusive — one primary only). */
const PRIMARY_PRIORITY: IntelligenceCategory[] = [
  'GONE_DARK',
  'VERY_HIGH_INTENT',
  'HIGH_INTENT',
  'NOT_PICKING_UP',
  'MISMARKED_NI',
  'STUCK',
];

const RECOMMENDED_ACTIONS: Record<IntelligenceCategory, string> = {
  GONE_DARK:
    'Immediate recovery outreach — customer went silent after a completed site visit. Assign senior executive for multi-channel contact within 24h.',
  NOT_PICKING_UP:
    'Change contact strategy — try alternate numbers/times, WhatsApp, or CP mediation. Do not keep dialing the same pattern.',
  MISMARKED_NI:
    'Manual review required — Not Interested marking looks inconsistent with call evidence. Re-qualify before closing the lead.',
  STUCK:
    'Unblock the deal — stage has answered engagement but no progression. Manager review of objections, pricing, and next commitment.',
  VERY_HIGH_INTENT:
    'Prioritize for booking — two or more completed site visits. Push for token/booking conversation this week.',
  HIGH_INTENT:
    'Accelerate decision — at least one completed site visit. Schedule revisit or close commercial gaps.',
  NONE: 'Continue standard follow-up cadence.',
};

export function classifyLead(input: ClassifyLeadInput): ClassificationResult {
  const config = input.config ?? DEFAULT_CLASSIFICATION_CONFIG;
  const ruleInput: RuleInput = {
    currentStage: input.currentStage,
    stageEnteredAt: input.stageEnteredAt,
    stageHistory: input.stageHistory,
    calls: input.calls,
    config,
  };

  const goneDark = evaluateGoneDark(ruleInput);
  const notPickingUp = evaluateNotPickingUp(ruleInput);
  const mismarkedNi = evaluateMismarkedNi(ruleInput);
  const stuck = evaluateStuck(ruleInput);
  const veryHighIntent = evaluateVeryHighIntent(ruleInput);
  const highIntent = evaluateHighIntent(ruleInput);

  const ruleResults: ClassificationResult['ruleResults'] = {
    GONE_DARK: goneDark,
    NOT_PICKING_UP: notPickingUp,
    MISMARKED_NI: mismarkedNi,
    STUCK: stuck,
    VERY_HIGH_INTENT: veryHighIntent,
    HIGH_INTENT: highIntent,
  };

  const evidence: ClassificationResult['evidence'] = {
    GONE_DARK: goneDark.evidence,
    NOT_PICKING_UP: notPickingUp.evidence,
    MISMARKED_NI: mismarkedNi.evidence,
    STUCK: stuck.evidence,
    VERY_HIGH_INTENT: veryHighIntent.evidence,
    HIGH_INTENT: highIntent.evidence,
  };

  const reasons: ClassificationResult['reasons'] = {
    GONE_DARK: goneDark.reason,
    NOT_PICKING_UP: notPickingUp.reason,
    MISMARKED_NI: mismarkedNi.reason,
    STUCK: stuck.reason,
    VERY_HIGH_INTENT: veryHighIntent.reason,
    HIGH_INTENT: highIntent.reason,
  };

  const underlyingFlags: IntelligenceCategory[] = [];
  if (goneDark.flagged) underlyingFlags.push('GONE_DARK');
  if (notPickingUp.flagged) underlyingFlags.push('NOT_PICKING_UP');
  if (mismarkedNi.flagged) underlyingFlags.push('MISMARKED_NI');
  if (stuck.flagged) underlyingFlags.push('STUCK');

  const terminal = TERMINAL_EXCLUSION_STAGES.includes(input.currentStage);
  const goneDarkActive = goneDark.flagged;

  // Intent flags: full ruleResults always retained above for audit.
  // Do not count HI/VHI alongside Gone Dark or terminal exclusions.
  let vhiFlagged = veryHighIntent.flagged && !terminal && !goneDarkActive;
  let hiFlagged = highIntent.flagged && !terminal && !goneDarkActive;

  // Very High Intent supersedes High Intent when both would apply.
  if (vhiFlagged) {
    hiFlagged = false;
  }

  if (vhiFlagged) underlyingFlags.push('VERY_HIGH_INTENT');
  if (hiFlagged) underlyingFlags.push('HIGH_INTENT');

  void INTENT_OVERRIDE_CATEGORIES;

  const allResults: RuleEvaluationResult[] = [
    goneDark,
    notPickingUp,
    mismarkedNi,
    stuck,
    veryHighIntent,
    highIntent,
  ];
  const missingFields = new Set<string>();
  for (const r of allResults) {
    if (r.insufficientCallData) {
      for (const f of r.missingFields ?? []) missingFields.add(f);
    }
  }

  let primaryCategory: IntelligenceCategory = 'NONE';
  for (const cat of PRIMARY_PRIORITY) {
    if (underlyingFlags.includes(cat)) {
      primaryCategory = cat;
      break;
    }
  }

  const completedVisitCount = Number(goneDark.evidence.completedVisitCount ?? 0);
  const applicableInsufficient =
    (goneDark.insufficientCallData && completedVisitCount >= 1) ||
    (notPickingUp.insufficientCallData &&
      config.notPickingUp.qualifyingStages.includes(input.currentStage)) ||
    (mismarkedNi.insufficientCallData &&
      input.currentStage === 'Not Interested') ||
    (stuck.insufficientCallData &&
      config.stuck.qualifyingStages.includes(input.currentStage));

  const finalCallDataStatus: CallDataStatus =
    Boolean(applicableInsufficient) && underlyingFlags.length === 0
      ? 'INSUFFICIENT_CALL_DATA'
      : 'OK';

  // On Vercel, drop bulky per-rule evidence from the cached snapshot so API
  // responses stay small enough to finish before the platform kills the request.
  const compact = Boolean(process.env.VERCEL);

  return {
    customerId: input.customerId,
    salesProcessId: input.salesProcessId,
    currentStage: input.currentStage,
    primaryCategory,
    underlyingFlags,
    callDataStatus: finalCallDataStatus,
    missingFields: [...missingFields],
    recommendedAction: RECOMMENDED_ACTIONS[primaryCategory],
    evidence: compact ? {} : evidence,
    reasons: compact
      ? {
          [primaryCategory]:
            reasons[primaryCategory] || RECOMMENDED_ACTIONS[primaryCategory],
        }
      : reasons,
    ruleResults: compact ? {} : ruleResults,
  };
}

/** Classify every process in a list against a shared call pool. */
export function classifyAllProcesses(
  processes: Array<{
    customerId: string;
    salesProcessId: string;
    currentStage: CanonicalStage;
    stageEnteredAt: string | null;
    stageHistory?: StageHistoryEntry[] | null;
  }>,
  calls: CallRecord[],
  config?: ClassificationConfig,
): ClassificationResult[] {
  const byCustomer = new Map<string, CallRecord[]>();
  for (const call of calls) {
    const key = call.customerId || '';
    const list = byCustomer.get(key);
    if (list) list.push(call);
    else byCustomer.set(key, [call]);
  }

  return processes.map((p) => {
    const customerCalls = byCustomer.get(p.customerId) ?? [];
    const scoped = customerCalls.filter(
      (c) =>
        c.salesProcessId === p.salesProcessId ||
        (!c.salesProcessId && !c.salesProcessName),
    );
    const effective = scoped.length > 0 ? scoped : customerCalls;

    return classifyLead({
      customerId: p.customerId,
      salesProcessId: p.salesProcessId,
      currentStage: p.currentStage,
      stageEnteredAt: p.stageEnteredAt,
      stageHistory: p.stageHistory,
      calls: effective,
      config,
    });
  });
}
