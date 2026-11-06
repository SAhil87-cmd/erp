/**
 * Central classification engine — evaluates all rules and picks primary category.
 */

import {
  DEFAULT_CLASSIFICATION_CONFIG,
  OPS_EXCLUSION_CATEGORIES,
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
} from '../types';

export interface ClassifyLeadInput {
  customerId: string;
  salesProcessId: string;
  currentStage: CanonicalStage;
  stageEnteredAt: string | null;
  calls: CallRecord[] | null | undefined;
  config?: ClassificationConfig;
}

const OPS_PRIORITY: IntelligenceCategory[] = [
  'GONE_DARK',
  'NOT_PICKING_UP',
  'MISMARKED_NI',
  'STUCK',
];

const OPPORTUNITY_PRIORITY: IntelligenceCategory[] = [
  'VERY_HIGH_INTENT',
  'HIGH_INTENT',
];

const RECOMMENDED_ACTIONS: Record<IntelligenceCategory, string> = {
  GONE_DARK:
    'Immediate recovery outreach — customer went silent after a late-stage milestone. Assign senior executive for multi-channel contact within 24h.',
  NOT_PICKING_UP:
    'Change contact strategy — try alternate numbers/times, WhatsApp, or CP mediation. Do not keep dialing the same pattern.',
  MISMARKED_NI:
    'Manual review required — Not Interested marking looks inconsistent with call evidence. Re-qualify before closing the lead.',
  STUCK:
    'Unblock the deal — stage has answered engagement but no progression. Manager review of objections, pricing, and next commitment.',
  VERY_HIGH_INTENT:
    'Prioritize for booking — post-revisit engagement is strong. Push for token/booking conversation this week.',
  HIGH_INTENT:
    'Accelerate decision — post site-visit engagement is healthy. Schedule revisit or close commercial gaps.',
  NONE: 'Continue standard follow-up cadence.',
};

function isOpsFlag(cat: IntelligenceCategory): boolean {
  return (OPS_EXCLUSION_CATEGORIES as readonly string[]).includes(cat);
}

export function classifyLead(input: ClassifyLeadInput): ClassificationResult {
  const config = input.config ?? DEFAULT_CLASSIFICATION_CONFIG;
  const ruleInput: RuleInput = {
    currentStage: input.currentStage,
    stageEnteredAt: input.stageEnteredAt,
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

  // Opportunity flags — apply exclusions
  const opsActive = underlyingFlags.some(isOpsFlag);
  const terminal = TERMINAL_EXCLUSION_STAGES.includes(input.currentStage);

  let vhiFlagged = veryHighIntent.flagged;
  let hiFlagged = highIntent.flagged;

  if (opsActive || terminal) {
    vhiFlagged = false;
    hiFlagged = false;
  }

  // Also exclude HI/VHI when Sales Closed / NI / Spam / DND even if somehow flagged
  if (vhiFlagged) underlyingFlags.push('VERY_HIGH_INTENT');
  if (hiFlagged) underlyingFlags.push('HIGH_INTENT');

  // Collect insufficient call data
  const allResults: RuleEvaluationResult[] = [
    goneDark,
    notPickingUp,
    mismarkedNi,
    stuck,
    veryHighIntent,
    highIntent,
  ];
  const missingFields = new Set<string>();
  let anyInsufficient = false;
  for (const r of allResults) {
    if (r.insufficientCallData) {
      anyInsufficient = true;
      for (const f of r.missingFields ?? []) missingFields.add(f);
    }
  }

  // Primary category: prefer ops alerts, then opportunities
  let primaryCategory: IntelligenceCategory = 'NONE';
  for (const cat of OPS_PRIORITY) {
    if (underlyingFlags.includes(cat)) {
      primaryCategory = cat;
      break;
    }
  }
  if (primaryCategory === 'NONE') {
    for (const cat of OPPORTUNITY_PRIORITY) {
      if (underlyingFlags.includes(cat)) {
        primaryCategory = cat;
        break;
      }
    }
  }

  const callDataStatus: CallDataStatus =
    anyInsufficient && underlyingFlags.length === 0 && primaryCategory === 'NONE'
      ? 'INSUFFICIENT_CALL_DATA'
      : anyInsufficient &&
          !input.calls?.length &&
          // Rules that needed calls couldn't run
          (['Site Visit Scheduled', 'Site Visit Done', 'Revisit Done', 'Interested', 'Cold', 'Followup', 'Cold Followup', 'Not Interested'] as CanonicalStage[]).includes(
            input.currentStage,
          )
        ? 'INSUFFICIENT_CALL_DATA'
        : 'OK';

  // More precise: if any applicable rule returned insufficient and we have no flags
  const applicableInsufficient =
    (goneDark.insufficientCallData &&
      config.goneDark.qualifyingStages.includes(input.currentStage)) ||
    (notPickingUp.insufficientCallData &&
      config.notPickingUp.qualifyingStages.includes(input.currentStage)) ||
    (mismarkedNi.insufficientCallData &&
      input.currentStage === 'Not Interested') ||
    (stuck.insufficientCallData &&
      config.stuck.qualifyingStages.includes(input.currentStage)) ||
    (veryHighIntent.insufficientCallData &&
      config.veryHighIntent.qualifyingStages.includes(input.currentStage)) ||
    (highIntent.insufficientCallData &&
      config.highIntent.qualifyingStages.includes(input.currentStage));

  const finalCallDataStatus: CallDataStatus =
    applicableInsufficient && underlyingFlags.length === 0
      ? 'INSUFFICIENT_CALL_DATA'
      : callDataStatus === 'INSUFFICIENT_CALL_DATA' && underlyingFlags.length === 0
        ? 'INSUFFICIENT_CALL_DATA'
        : 'OK';

  return {
    customerId: input.customerId,
    salesProcessId: input.salesProcessId,
    currentStage: input.currentStage,
    primaryCategory,
    underlyingFlags,
    callDataStatus: finalCallDataStatus,
    missingFields: [...missingFields],
    recommendedAction: RECOMMENDED_ACTIONS[primaryCategory],
    evidence,
    reasons,
    ruleResults,
  };
}

/** Classify every process in a list against a shared call pool. */
export function classifyAllProcesses(
  processes: Array<{
    customerId: string;
    salesProcessId: string;
    currentStage: CanonicalStage;
    stageEnteredAt: string | null;
  }>,
  calls: CallRecord[],
  config?: ClassificationConfig,
): ClassificationResult[] {
  // Index once — never filter the full call list per process (O(P×C) hang on large sheets).
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
      calls: effective,
      config,
    });
  });
}
