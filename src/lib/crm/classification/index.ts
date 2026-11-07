export {
  DEFAULT_CLASSIFICATION_CONFIG,
  TERMINAL_EXCLUSION_STAGES,
  INTENT_OVERRIDE_CATEGORIES,
  normalizeStage,
  type ClassificationConfig,
} from './config';

export {
  sortCallsChronologically,
  callsAfter,
  consecutiveUnansweredDistinctDates,
  answeredDistinctDates,
  longestAnsweredDuration,
  hasAnsweredCall,
  isCallDataMissing,
} from './helpers';

export {
  summarizeCompletedSiteVisits,
  COMPLETED_VISIT_STAGES,
  type CompletedVisitSummary,
} from './visits';

export {
  evaluateGoneDark,
  evaluateNotPickingUp,
  evaluateMismarkedNi,
  evaluateStuck,
  evaluateVeryHighIntent,
  evaluateHighIntent,
  type RuleInput,
} from './rules';

export { classifyLead, classifyAllProcesses, type ClassifyLeadInput } from './engine';
