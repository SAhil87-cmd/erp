import { readFileSync } from 'fs';
import { createRequire } from 'module';

// Lightweight: reuse analyze linkage + note sync meta
const meta = JSON.parse(readFileSync('data/crm/sync_meta.json', 'utf8'));
const calls = JSON.parse(readFileSync('data/crm/calls.json', 'utf8'));
const rows = JSON.parse(readFileSync('data/crm/raw_rows.json', 'utf8'));
const callIds = new Set(calls.map((c) => c.customerId).filter(Boolean));
const rowIds = [...new Set(rows.map((r) => r.customerId).filter(Boolean))];
const unmatched = rowIds.filter((id) => !callIds.has(id));

console.log(
  JSON.stringify(
    {
      syncStatus: meta.status,
      callCount: meta.callCount,
      rowCount: meta.rowCount,
      unmatchedCustomers: unmatched.length,
      note:
        unmatched.length === 0
          ? 'All CRM rows now link to at least one call — refresh the dashboard to clear the old 879 banner.'
          : 'Some customers still lack matched calls',
    },
    null,
    2,
  ),
);
