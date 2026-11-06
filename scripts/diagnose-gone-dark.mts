import { readFileSync } from 'fs';
import { buildRelationalModel } from '../src/lib/crm/normalize';
import { classifyAllProcesses } from '../src/lib/crm/classification/engine';
import { normalizeStage } from '../src/lib/crm/normalize';
import {
  callsAfter,
  consecutiveUnansweredDistinctDates,
} from '../src/lib/crm/classification/helpers';
import type { CallRecord } from '../src/lib/crm/types';

const rows = JSON.parse(readFileSync('data/crm/raw_rows.json', 'utf8'));
const calls = JSON.parse(readFileSync('data/crm/calls.json', 'utf8')) as CallRecord[];

const stageMap: Record<string, number> = {};
for (const r of rows as Array<{ status?: string }>) {
  const key = `${r.status} => ${normalizeStage(r.status)}`;
  stageMap[key] = (stageMap[key] || 0) + 1;
}
console.log('stage map', stageMap);

const model = buildRelationalModel(rows);
const gdStages = new Set(['Site Visit Scheduled', 'Site Visit Done', 'Revisit Done']);
const procs = model.processes.filter((p) => gdStages.has(p.currentStage));
console.log('qualifying processes', procs.length);

const byCustomer = new Map<string, CallRecord[]>();
for (const c of calls) {
  const list = byCustomer.get(c.customerId) || [];
  list.push(c);
  byCustomer.set(c.customerId, list);
}

let wouldFlagIfAllCalls = 0;
let wouldFlagWithEntry = 0;
const samples: unknown[] = [];

for (const p of procs) {
  const custCalls = byCustomer.get(p.customerId) || [];
  const streakAll = consecutiveUnansweredDistinctDates(custCalls);
  const post = callsAfter(custCalls, p.stageEnteredAt);
  const streakPost = consecutiveUnansweredDistinctDates(post);
  if (streakAll >= 2) wouldFlagIfAllCalls++;
  if (streakPost >= 2) wouldFlagWithEntry++;
  if (samples.length < 5) {
    samples.push({
      customerId: p.customerId,
      stage: p.currentStage,
      stageEnteredAt: p.stageEnteredAt,
      callCount: custCalls.length,
      unanswered: custCalls.filter((c) => !c.answered).length,
      answered: custCalls.filter((c) => c.answered).length,
      streakAll,
      streakPost,
      postCount: post.length,
    });
  }
}

console.log({ wouldFlagIfAllCalls, wouldFlagWithEntry, samples });

const cls = classifyAllProcesses(
  procs.map((p) => ({
    customerId: p.customerId,
    salesProcessId: p.salesProcessId,
    currentStage: p.currentStage,
    stageEnteredAt: p.stageEnteredAt,
  })),
  calls,
);
console.log(
  'engine GONE_DARK',
  cls.filter((c) => c.underlyingFlags.includes('GONE_DARK')).length,
);
