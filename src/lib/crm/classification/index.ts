export {
  DEFAULT_CLASSIFICATION_CONFIG,
  TERMINAL_EXCLUSION_STAGES,
  OPS_EXCLUSION_CATEGORIES,
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
  evaluateGoneDark,
  evaluateNotPickingUp,
  evaluateMismarkedNi,
  evaluateStuck,
  evaluateVeryHighIntent,
  evaluateHighIntent,
  type RuleInput,
} from './rules';

export { classifyLead, classifyAllProcesses, type ClassifyLeadInput } from './engine';
