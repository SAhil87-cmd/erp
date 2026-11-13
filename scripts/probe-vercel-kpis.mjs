/** Probe live Vercel sync for classified KPIs (Gone Dark / Intent / etc.). */

const url = process.argv[2] || 'https://erp-gyau.vercel.app/api/crm/sync';
const started = Date.now();
console.log('POST', url);

const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/x-ndjson, application/json',
  },
  body: JSON.stringify({
    mode: 'published',
    force: true,
    includeSnapshot: true,
    pack: 'overview',
    stream: true,
  }),
});

console.log('status', res.status, res.headers.get('content-type'));
if (!res.body) {
  console.log('no body');
  process.exit(1);
}

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = '';
let lastDone = null;
let bytes = 0;

try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      try {
        const row = JSON.parse(trimmed);
        if (row.phase && row.phase !== 'working') {
          console.log(
            `${((Date.now() - started) / 1000).toFixed(1)}s`,
            row.phase,
            row.stageOnly ? 'stageOnly' : '',
            row.bootstrap ? 'boot' : '',
            'snap',
            Boolean(row.snapshot),
          );
        }
        if (row.phase === 'done' && row.snapshot) lastDone = row;
      } catch {
        // ignore
      }
    }
  }
} catch (err) {
  console.log('stream_reset', err instanceof Error ? err.message : err);
}

console.log('bytes', bytes, 'sec', ((Date.now() - started) / 1000).toFixed(1));
if (!lastDone?.snapshot) {
  console.log('NO_DONE');
  process.exit(1);
}

const w = lastDone.snapshot;
const om = w.overviewMetrics || {};
const byCat = om.byCategory || {};
const recovery = w.recoveryMetrics || {};
const execs = [...(w.executivePerformance || [])]
  .sort((a, b) => (b.rankingScore || 0) - (a.rankingScore || 0))
  .slice(0, 3);

console.log(
  JSON.stringify(
    {
      stageOnly: lastDone.stageOnly ?? null,
      customers: om.totalCustomers,
      calls: w.callTotal ?? om.totalCalls,
      closed: om.salesClosed,
      conv: om.conversionRate,
      goneDark: byCat.GONE_DARK ?? recovery.goneDark ?? 0,
      mismarked: byCat.MISMARKED_NI ?? recovery.mismarkedNi ?? 0,
      highIntent: byCat.HIGH_INTENT ?? 0,
      veryHighIntent: byCat.VERY_HIGH_INTENT ?? 0,
      leads: w.leads?.length ?? 0,
      topExecs: execs.map((e) => ({
        name: e.executiveName,
        score: e.rankingScore,
        goneDark: e.goneDarkCount,
        mismarked: e.mismarkedNiCount,
        intent: e.intentCount,
      })),
    },
    null,
    2,
  ),
);
