/**
 * Canonical Google Sheets column key map (A–AI) with flexible header aliases.
 * Matching is done on normalized header names (lowercase, collapsed whitespace/punctuation).
 */

export const SHEET_COLUMNS = [
  'interactionDate',
  'customerId',
  'name',
  'mobileNum',
  'email',
  'companyName',
  'street',
  'city',
  'state',
  'country',
  'pincode',
  'alternateContact',
  'kdmPhone',
  'priority',
  'assignedTo',
  'assignedBy',
  'notes',
  'processName',
  'source',
  'cpName',
  'status',
  'coldFollowUp',
  'reason',
  'projectLocation',
  'expectedBudget',
  'preferredLocation',
  'issue',
  'nextFollowUp',
  'followUpCount',
  'firmName',
  'nextFollowUpDate',
  'revisitCount',
  'followupOwner',
  'revisitDate',
  'projectName',
] as const;

export type SheetColumnKey = (typeof SHEET_COLUMNS)[number];

/** Letter index A=0 … AI=34 */
export const COLUMN_LETTERS: Record<SheetColumnKey, string> = {
  interactionDate: 'A',
  customerId: 'B',
  name: 'C',
  mobileNum: 'D',
  email: 'E',
  companyName: 'F',
  street: 'G',
  city: 'H',
  state: 'I',
  country: 'J',
  pincode: 'K',
  alternateContact: 'L',
  kdmPhone: 'M',
  priority: 'N',
  assignedTo: 'O',
  assignedBy: 'P',
  notes: 'Q',
  processName: 'R',
  source: 'S',
  cpName: 'T',
  status: 'U',
  coldFollowUp: 'V',
  reason: 'W',
  projectLocation: 'X',
  expectedBudget: 'Y',
  preferredLocation: 'Z',
  issue: 'AA',
  nextFollowUp: 'AB',
  followUpCount: 'AC',
  firmName: 'AD',
  nextFollowUpDate: 'AE',
  revisitCount: 'AF',
  followupOwner: 'AG',
  revisitDate: 'AH',
  projectName: 'AI',
};

/**
 * Canonical display headers (exact intent from the sheet).
 * Used when exporting / documenting the 35-column structure.
 */
export const CANONICAL_HEADERS: Record<SheetColumnKey, string> = {
  interactionDate: 'Interaction Date',
  customerId: 'Customer Id',
  name: 'Name',
  mobileNum: 'Mobile Num',
  email: 'Email',
  companyName: 'Company Name',
  street: 'Street',
  city: 'City',
  state: 'State',
  country: 'Country',
  pincode: 'Pincode',
  alternateContact: 'Alternate contact',
  kdmPhone: 'KDM Phone',
  priority: 'Priority',
  assignedTo: 'Assigned To',
  assignedBy: 'Assigned By',
  notes: 'Notes',
  processName: 'Process Name',
  source: 'Source',
  cpName: 'CP Name',
  status: 'Status',
  coldFollowUp: 'Cold Follow-up',
  reason: 'Reason',
  projectLocation: 'Project Location',
  expectedBudget: 'Expected Budget',
  preferredLocation: 'Preferred Location',
  issue: 'Issue',
  nextFollowUp: 'Next Follow-up',
  followUpCount: 'Follow Up Count',
  firmName: 'Firm Name',
  nextFollowUpDate: 'Next Follow-up Date',
  revisitCount: 'Revisit Count',
  followupOwner: 'Followup Owner',
  revisitDate: 'Revisit Date',
  projectName: 'Project Name',
};

/** Aliases (normalized) → canonical key. Includes canonical names themselves. */
const ALIAS_GROUPS: Record<SheetColumnKey, string[]> = {
  interactionDate: [
    'interaction date',
    'interactiondate',
    'date',
    'interaction dt',
    'call date',
  ],
  customerId: [
    'customer id',
    'customerid',
    'cust id',
    'custid',
    'customer',
    'id',
  ],
  name: ['name', 'customer name', 'client name', 'full name'],
  mobileNum: [
    'mobile num',
    'mobile number',
    'mobile',
    'phone',
    'phone number',
    'contact number',
    'primary phone',
  ],
  email: ['email', 'email id', 'email address'],
  companyName: ['company name', 'company', 'organisation', 'organization'],
  street: ['street', 'address', 'address line', 'address1'],
  city: ['city'],
  state: ['state'],
  country: ['country'],
  pincode: ['pincode', 'pin code', 'zip', 'zipcode', 'postal code'],
  alternateContact: [
    'alternate contact',
    'alt contact',
    'alternate phone',
    'secondary phone',
  ],
  kdmPhone: ['kdm phone', 'kdm', 'decision maker phone'],
  priority: ['priority'],
  assignedTo: ['assigned to', 'assignedto', 'executive', 'owner', 'sales executive'],
  assignedBy: ['assigned by', 'assignedby'],
  notes: ['notes', 'note', 'remarks', 'comment', 'comments'],
  processName: [
    'process name',
    'process',
    'sales process',
    'sales process name',
  ],
  source: ['source', 'lead source'],
  cpName: ['cp name', 'channel partner', 'cp'],
  status: ['status', 'stage', 'lead status', 'current status'],
  coldFollowUp: [
    'cold follow-up',
    'cold followup',
    'cold follow up',
    'cold fu',
  ],
  reason: ['reason', 'ni reason', 'status reason'],
  projectLocation: ['project location', 'project loc'],
  expectedBudget: ['expected budget', 'budget', 'budget range'],
  preferredLocation: ['preferred location', 'pref location'],
  issue: ['issue', 'objection', 'blocker'],
  nextFollowUp: [
    'next follow-up',
    'next followup',
    'next follow up',
    'next fu',
  ],
  followUpCount: [
    'follow up count',
    'followup count',
    'follow-up count',
    'fu count',
  ],
  firmName: ['firm name', 'firm'],
  nextFollowUpDate: [
    'next follow-up date',
    'next followup date',
    'next follow up date',
    'next fu date',
    'follow up date',
  ],
  revisitCount: ['revisit count', 'revisits'],
  followupOwner: [
    'followup owner',
    'follow-up owner',
    'follow up owner',
    'fu owner',
  ],
  revisitDate: ['revisit date', 'revisit dt'],
  projectName: ['project name', 'project', 'project nm'],
};

function normalizeHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[_/\\|]+/g, ' ')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const NORMALIZED_ALIAS_MAP: Map<string, SheetColumnKey> = (() => {
  const map = new Map<string, SheetColumnKey>();
  for (const key of SHEET_COLUMNS) {
    for (const alias of ALIAS_GROUPS[key]) {
      map.set(normalizeHeader(alias), key);
    }
    map.set(normalizeHeader(CANONICAL_HEADERS[key]), key);
  }
  return map;
})();

/** Resolve a sheet header string to a canonical column key, or null if unknown. */
export function resolveColumnKey(header: string): SheetColumnKey | null {
  if (!header || !header.trim()) return null;
  return NORMALIZED_ALIAS_MAP.get(normalizeHeader(header)) ?? null;
}

/** Build header-index → column-key map from a row of header cells. */
export function buildHeaderMap(
  headers: string[],
): Map<number, SheetColumnKey> {
  const map = new Map<number, SheetColumnKey>();
  const seen = new Set<SheetColumnKey>();
  headers.forEach((h, i) => {
    const key = resolveColumnKey(h);
    if (key && !seen.has(key)) {
      map.set(i, key);
      seen.add(key);
    }
  });
  return map;
}

export { normalizeHeader };
