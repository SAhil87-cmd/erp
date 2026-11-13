#!/usr/bin/env node
/**
 * Probe live NDJSON sync: print chunk growth, then decode overview pack.
 */
import { gunzipSync } from 'zlib';

const url = process.argv[2] || 'https://erp-gyau.vercel.app/api/crm/sync';
const started = Date.now();

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
  const text = await res.text();
  console.log('no-body', text.slice(0, 300));
  process.exit(1);
}

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = '';
let bytes = 0;
let lastLog = 0;
const lines = [];

try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    const now = Date.now();
    if (now - lastLog > 4000) {
      console.log(`t=${((now - started) / 1000).toFixed(0)}s bytes=${bytes}`);
      lastLog = now;
    }
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      lines.push(trimmed);
      try {
        const row = JSON.parse(trimmed);
        if (row.phase && row.phase !== 'working') {
          console.log(
            'phase',
            row.phase,
            row.bootstrap ? 'bootstrap' : '',
            row.light ? 'light' : '',
            row.error || '',
          );
        }
      } catch {
        // ignore
      }
    }
  }
} catch (err) {
  console.log('stream_reset', err instanceof Error ? err.message : err);
}
const trailing = buffer.trim();
if (trailing) lines.push(trailing);

console.log('done lines=', lines.length, 'bytes=', bytes, 'sec=', ((Date.now() - started) / 1000).toFixed(1));
const last = [...lines].reverse().find((l) => {
  try {
    const j = JSON.parse(l);
    return j.phase === 'done' || j.snapshot || j.ok === false;
  } catch {
    return false;
  }
});
if (!last) {
  console.log('NO_DONE sample', lines.slice(0, 3));
  process.exit(1);
}
const j = JSON.parse(last);
console.log({
  ok: j.ok,
  phase: j.phase,
  pack: j.pack,
  snapLen: j.snapshot?.length,
  err: j.error,
  snapErr: j.snapshotError,
});
if (j.snapshot && j.snapshotEncoding === 'gzip-base64') {
  const raw = gunzipSync(Buffer.from(j.snapshot, 'base64')).toString('utf8');
  const w = JSON.parse(raw);
  console.log({
    leads: w.leads?.length,
    callTotal: w.callTotal,
    omCust: w.overviewMetrics?.totalCustomers,
    omProc: w.overviewMetrics?.totalProcesses,
    dayKeys: Object.keys(w.processIdsByInteractionDay || {}).length,
    mb: +(raw.length / 1e6).toFixed(2),
  });
}
