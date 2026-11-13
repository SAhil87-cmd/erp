import { gunzipSync } from 'zlib';

const url = process.argv[2] || 'http://localhost:3000/api/crm/sync';
const started = Date.now();
console.log('POST', url);

const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  body: JSON.stringify({
    mode: 'published',
    force: true,
    includeSnapshot: true,
    pack: 'overview',
    stream: false,
  }),
});

const buf = Buffer.from(await res.arrayBuffer());
const sec = ((Date.now() - started) / 1000).toFixed(1);
console.log('status', res.status, 'bytes', buf.length, 'sec', sec);

const text = buf.toString('utf8');
if (text.trim().startsWith('<!')) {
  console.log('HTML_FAIL', text.slice(0, 200));
  process.exit(1);
}

const j = JSON.parse(text);
console.log({
  ok: j.ok,
  pack: j.pack,
  enc: j.snapshotEncoding,
  snapLen: j.snapshot?.length,
  err: j.error,
  snapErr: j.snapshotError,
  callCount: j.syncMeta?.callCount ?? j.result?.callCount,
});

if (!j.ok) process.exit(1);

if (j.snapshot && j.snapshotEncoding === 'gzip-base64') {
  const raw = gunzipSync(Buffer.from(j.snapshot, 'base64')).toString('utf8');
  const w = JSON.parse(raw);
  console.log({
    leads: w.leads?.length,
    callTotal: w.callTotal,
    omCust: w.overviewMetrics?.totalCustomers,
    omProc: w.overviewMetrics?.totalProcesses,
    dayKeys: Object.keys(w.processIdsByInteractionDay || {}).length,
    activityDate: w.activityDate,
    mb: +(raw.length / 1e6).toFixed(2),
  });
}
