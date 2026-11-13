/**
 * Core CRM domain types for the Yashodhan Group Sales Intelligence Dashboard.
 */

import type { SheetColumnKey } from './columns';

// ─── Raw sheet ───────────────────────────────────────────────────────────────

/** One interaction row as mapped from the Google Sheet / CSV / XLSX. */
export type RawSheetRow = Partial<Record<SheetColumnKey, string>> & {
  /** Original 0-based sheet/CSV row index (excluding header). */
  _rowIndex?: number;
  /** Data-quality flags attached during normalize/import. */
  _flags?: string[];
  /** Parse / mapping errors — row is retained, never silently discarded. */
  _errors?: string[];
};

// ─── Call outcomes ───────────────────────────────────────────────────────────

export type CallOutcome = 'answered' | 'unanswered';

export interface CallRecord {
  callRecordId: string;
  customerId: string;
  /** ISO timestamp or parseable date+time in Asia/Kolkata. */
  callAt: string;
  callDate?: string;
  callTime?: string;
  callOutcome: CallOutcome;
  answered: boolean;
  durationSeconds: number;
  callExecutive?: string;
  salesProcessId?: string;
  salesProcessName?: string;
}

// ─── Stages / status ─────────────────────────────────────────────────────────

export type CanonicalStage =
  | 'Interested'
  | 'Cold'
  | 'Followup'
  | 'Cold Followup'
  | 'Not Picking'
  | 'Site Visit Scheduled'
  | 'Site Visit Done'
  | 'Revisit Done'
  | 'Not Interested'
  | 'Sales Closed'
  | 'Spam'
  | 'DND'
  | 'Unknown';

// ─── Relational model ────────────────────────────────────────────────────────

export interface Interaction {
  interactionId: string;
  customerId: string;
  salesProcessId: string;
  interactionDate: string | null;
  statusRaw: string;
  status: CanonicalStage;
  assignedTo?: string;
  assignedBy?: string;
  notes?: string;
  source?: string;
  processName?: string;
  projectName?: string;
  projectLocation?: string;
  expectedBudget?: string;
  preferredLocation?: string;
  nextFollowUp?: string;
  nextFollowUpDate?: string | null;
  revisitDate?: string | null;
  followUpCount?: number;
  revisitCount?: number;
  followupOwner?: string;
  priority?: string;
  reason?: string;
  issue?: string;
  coldFollowUp?: string;
  raw: RawSheetRow;
}

export interface StageHistoryEntry {
  customerId: string;
  salesProcessId: string;
  stage: CanonicalStage;
  stageRaw: string;
  /** Earliest interaction date where this status appears for customer+process. */
  stageEntryDate: string | null;
}

export interface SalesProcess {
  salesProcessId: string;
  customerId: string;
  processName: string;
  currentStage: CanonicalStage;
  currentStageRaw: string;
  stageEnteredAt: string | null;
  projectName?: string;
  assignedTo?: string;
  source?: string;
  interactionIds: string[];
  stageHistory: StageHistoryEntry[];
  /** Latest interaction calendar day (YYYY-MM-DD) when interactions[] is truncated. */
  lastInteractionDate?: string | null;
  /** Latest call calendar day (YYYY-MM-DD) when calls[] is truncated. */
  lastCallDate?: string | null;
  /** Latest sheet Notes / remark for this person (from CRM tab). */
  remark?: string;
}

export interface FollowUpActivity {
  customerId: string;
  salesProcessId: string;
  nextFollowUpDate: string | null;
  revisitDate: string | null;
  followupOwner?: string;
  assignedTo?: string;
  currentStage: CanonicalStage;
}

export interface ExecutiveAssignment {
  executiveName: string;
  customerIds: string[];
  processIds: string[];
}

export interface Project {
  projectName: string;
  customerIds: string[];
  processIds: string[];
}

export interface Customer {
  customerId: string;
  name?: string;
  mobileNum?: string;
  email?: string;
  companyName?: string;
  city?: string;
  state?: string;
  country?: string;
  pincode?: string;
  alternateContact?: string;
  kdmPhone?: string;
  firmName?: string;
  /** True when customer was matched by phone only (no Customer Id). */
  matchedByPhone?: boolean;
  /** True when row could not be safely grouped to a customer. */
  unmatched?: boolean;
  dataQualityFlags: string[];
  salesProcessIds: string[];
  interactionIds: string[];
  callRecordIds: string[];
}

// ─── Classification ──────────────────────────────────────────────────────────

export type IntelligenceCategory =
  | 'GONE_DARK'
  | 'NOT_PICKING_UP'
  | 'MISMARKED_NI'
  | 'STUCK'
  | 'VERY_HIGH_INTENT'
  | 'HIGH_INTENT'
  | 'NONE';

export type CallDataStatus = 'OK' | 'INSUFFICIENT_CALL_DATA';

export type BookingOpportunityTier =
  | 'HOT'
  | 'WARM'
  | 'COOL'
  | 'COLD'
  | 'EXCLUDED';

export interface ClassificationEvidence {
  [key: string]: unknown;
}

export interface RuleEvaluationResult {
  flagged: boolean;
  reason: string;
  evidence: ClassificationEvidence;
  insufficientCallData?: boolean;
  missingFields?: string[];
}

export interface ClassificationResult {
  customerId: string;
  salesProcessId: string;
  currentStage: CanonicalStage;
  primaryCategory: IntelligenceCategory;
  underlyingFlags: IntelligenceCategory[];
  callDataStatus: CallDataStatus;
  missingFields: string[];
  recommendedAction: string;
  evidence: Record<string, ClassificationEvidence>;
  reasons: Record<string, string>;
  /** Rule-level results for explainability. */
  ruleResults: Partial<
    Record<
      Exclude<IntelligenceCategory, 'NONE'>,
      RuleEvaluationResult
    >
  >;
}

export interface ManualReview {
  reviewId: string;
  customerId: string;
  salesProcessId?: string;
  reviewer: string;
  note: string;
  createdAt: string;
  disposition?: string;
}

export interface ClassificationOverride {
  overrideId: string;
  customerId: string;
  salesProcessId?: string;
  overrideCategory: IntelligenceCategory;
  reason: string;
  createdBy: string;
  createdAt: string;
  /** Original engine classification is preserved separately — never deleted. */
  originalCategory?: IntelligenceCategory;
}

// ─── Snapshot / filters / health ─────────────────────────────────────────────

export interface SyncMeta {
  lastSyncAt: string | null;
  lastImportAt: string | null;
  source: 'google_sheets' | 'csv' | 'xlsx' | 'manual' | 'unknown';
  status: 'ok' | 'pending_credentials' | 'error' | 'idle';
  message?: string;
  rowCount?: number;
  callCount?: number;
  /** Newest call / interaction timestamp found in the synced source data. */
  latestDataAt?: string | null;
}

export interface DataHealthIssue {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  rowIndex?: number;
  customerId?: string;
  field?: string;
}

export interface DataHealthReport {
  totalRows: number;
  validCustomers: number;
  unmatchedRows: number;
  duplicateCustomerIds: string[];
  duplicatePhones: string[];
  missingCustomerIds: number;
  missingPhones: number;
  issues: DataHealthIssue[];
}

export interface GlobalFilters {
  /** Inclusive start calendar date YYYY-MM-DD (Asia/Kolkata). */
  dateFrom?: string | null;
  /** Inclusive end calendar date YYYY-MM-DD (Asia/Kolkata). */
  dateTo?: string | null;
  /** Filter by assigned executive (exact or case-insensitive). */
  executives?: string[];
  /** Filter by project name. */
  projects?: string[];
  /** Filter by canonical stage(s). */
  stages?: CanonicalStage[];
  /** Filter by primary intelligence category. */
  categories?: IntelligenceCategory[];
  /** Filter by process name. */
  processNames?: string[];
  /** Free-text search across name / phone / customerId / company. */
  search?: string;
  /**
   * Date field semantics for dateFrom/dateTo:
   * - interaction: filter by latest interaction date
   * - stageEntry: filter by current stage entry date
   * - followUp: filter by next follow-up date
   * - call: filter by any call in range (requires calls attached)
   */
  dateField?: 'interaction' | 'stageEntry' | 'followUp' | 'call';
}

export interface CrmSnapshot {
  customers: Customer[];
  processes: SalesProcess[];
  interactions: Interaction[];
  calls: CallRecord[];
  projects: Project[];
  executives: ExecutiveAssignment[];
  followUps: FollowUpActivity[];
  classifications: ClassificationResult[];
  reviews: ManualReview[];
  overrides: ClassificationOverride[];
  dataHealth: DataHealthReport;
  syncMeta: SyncMeta;
  builtAt: string;
  /**
   * Full call count when `calls` is truncated for API payload size.
   * Prefer this (or syncMeta.callCount) over calls.length for KPIs.
   */
  callTotal?: number;
  callsTruncated?: boolean;
  /** Full interaction count when `interactions` is truncated for payload size. */
  interactionTotal?: number;
  interactionsTruncated?: boolean;
  /** Pre-aggregated from the full interaction set before truncation. */
  interactionSeries?: {
    daily: Array<{ name: string; value: number }>;
    monthly: Array<{ name: string; value: number }>;
  };
  /** Asia/Kolkata calendar day used for today* aggregates (falls back to latest sheet day). */
  activityDate?: string;
  /** True when activityDate is not calendar-today because the sheet has no today rows yet. */
  activityDateIsFallback?: boolean;
  /** Full call count for activityDate (not limited by calls[] preview). */
  todayCallCount?: number;
  /** Full interaction count for activityDate. */
  todayInteractionCount?: number;
  /** Caller / executive call totals for activityDate from the full call store. */
  todayCallsByExecutive?: Array<{ executiveName: string; callCount: number }>;
  /** All-time call totals by caller from the full call store. */
  callsByExecutive?: Array<{ executiveName: string; callCount: number }>;
  /** Recent daily call totals by executive (Asia/Kolkata), newest last. */
  callsByDayByExecutive?: Array<{
    date: string;
    total: number;
    byExecutive: Array<{ executiveName: string; callCount: number }>;
  }>;
  /**
   * processIds that had an interaction on each calendar day (last ~30 days).
   * Used for date filters when interactions[] is truncated for payload size.
   */
  processIdsByInteractionDay?: Record<string, string[]>;
  /**
   * processIds (or customer-scoped fallback ids) that had a call on each day.
   * Used for Call date filters when calls[] is truncated.
   */
  processIdsByCallDay?: Record<string, string[]>;
  /** Boot pack without lead rows — use precomputed overview* fields for KPIs. */
  pack?: 'overview' | 'full';
  /** Precomputed when pack=overview (lead rows omitted for payload size). */
  overviewMetrics?: import('./analytics').OverviewMetrics;
  recoveryMetrics?: import('./analytics').RecoveryMetrics;
  executivePerformance?: import('./analytics').ExecutivePerformance[];
}
