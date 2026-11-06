import { readFileSync, writeFileSync } from 'fs';
import { repairDerivedStageEntryDates } from '../src/lib/crm/runo';
import { buildRelationalModel } from '../src/lib/crm/normalize';
import { classifyAllProcesses } from '../src/lib/crm/classification/engine';
import type { CallRecord, RawSheetRow } from '../src/lib/crm/types';

const rows = JSON.parse(readFileSync('data/crm/raw_rows.json', 'utf8')) as RawSheetRow[];
const calls = JSON.parse(readFileSync('data/crm/calls.json', 'utf8')) as CallRecord[];

const { rows: next, repaired } = repairDerivedStageEntryDates(rows, calls);
writeFileSync('data/crm/raw_rows.json', JSON.stringify(next, null, 2));
console.log('repaired', repaired);

const model = buildRelationalModel(next);
const gdStages = new Set(['Site Visit Scheduled', 'Site Visit Done', 'Revisit Done']);
const procs = model.processes.filter((p) => gdStages.has(p.currentStage));
const cls = classifyAllProcesses(
  procs.map((p) => ({
    customerId: p.customerId,
    salesProcessId: p.salesProcessId,
    currentStage: p.currentStage,
    stageEnteredAt: p.stageEnteredAt,
  })),
  calls,
);
const goneDark = cls.filter((c) => c.underlyingFlags.includes('GONE_DARK')).length;
console.log({
  qualifying: procs.length,
  goneDark,
  sample: cls
    .filter((c) => c.underlyingFlags.includes('GONE_DARK'))
    .slice(0, 3)
    .map((c) => ({
      id: c.customerId,
      stage: c.currentStage,
      reason: c.reasons.GONE_DARK,
    })),
});
