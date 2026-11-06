import { createRequire } from 'module';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Use vitest/tsx-free approach: spawn via dynamic import of compiled path won't work.
// Instead parse JSON store directly.
import { readFileSync } from 'fs';

const calls = JSON.parse(readFileSync('data/crm/calls.json', 'utf8'));
const rows = JSON.parse(readFileSync('data/crm/raw_rows.json', 'utf8'));

const callIds = new Set(calls.map((c) => c.customerId).filter(Boolean));
const rowIds = new Set(rows.map((r) => r.customerId).filter(Boolean));

let rowsWithCalls = 0;
let rowsWithoutCalls = 0;
const missing = [];
for (const id of rowIds) {
  if (callIds.has(id)) rowsWithCalls++;
  else {
    rowsWithoutCalls++;
    if (missing.length < 8) missing.push(id);
  }
}

const unknownCalls = calls.filter((c) => String(c.customerId).startsWith('UNKNOWN')).length;
const phoneRows = [...rowIds].filter((id) => String(id).startsWith('PHONE:')).length;
const emptyCustCalls = calls.filter((c) => !c.customerId || String(c.customerId).startsWith('UNKNOWN')).length;

console.log(
  JSON.stringify(
    {
      calls: calls.length,
      uniqueCallCustomerIds: callIds.size,
      uniqueRowCustomerIds: rowIds.size,
      rowsWithCalls,
      rowsWithoutCalls,
      unknownCalls,
      emptyCustCalls,
      phoneRows,
      sampleMissing: missing,
      sampleCallIds: [...callIds].slice(0, 5),
      sampleRowIds: [...rowIds].slice(0, 5),
    },
    null,
    2,
  ),
);
