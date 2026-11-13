import { gunzipSync } from 'zlib';

function rate(c, p) {
  return p ? c / p : 0;
}
function score(r, calls) {
  return (
    (r.closedCount || 0) * 10 +
    (r.conversionRate || 0) * 1000 -
    rate(r.mismarkedNiCount || 0, r.processCount || 0) * 200 -
    rate(r.goneDarkCount || 0, r.processCount || 0) * 200 +
    ((r.highIntentCount || 0) + (r.veryHighIntentCount || 0)) * 2 +
    Math.log10((calls || 0) + 1) * 5
  );
}

const started = Date.now();
const res = await fetch('http://127.0.0.1:3000/api/crm/sync', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    mode: 'published',
    force: true,
    includeSnapshot: true,
    pack: 'overview',
    stream: false,
  }),
});
const text = await res.text();
const sec = ((Date.now() - started) / 1000).toFixed(1);
if (!res.ok || text.trim().startsWith('<!')) {
  console.log(JSON.stringify({ ok: false, status: res.status, sec, head: text.slice(0, 120) }, null, 2));
  process.exit(1);
}
const j = JSON.parse(text);
if (!j.ok || !j.snapshot) {
  console.log(JSON.stringify({ ok: false, error: j.error, snapErr: j.snapshotError, sec }, null, 2));
  process.exit(1);
}
const w = JSON.parse(gunzipSync(Buffer.from(j.snapshot, 'base64')).toString('utf8'));
const today = new Map(
  (w.todayCallsByExecutive || []).map((r) => [r.executiveName.toLowerCase(), r.callCount]),
);
const total = new Map(
  (w.callsByExecutive || []).map((r) => [r.executiveName.toLowerCase(), r.callCount]),
);
const rows = (w.executivePerformance || [])
  .map((r) => {
    const k = r.executiveName.toLowerCase();
    const callsToday = today.get(k) || 0;
    const callsTotal = total.get(k) || 0;
    const calls = callsToday > 0 ? callsToday : callsTotal;
    return { ...r, calls, rankingScore: score(r, calls) };
  })
  .sort((a, b) => b.rankingScore - a.rankingScore);
const remarks = (w.leads || []).filter((r) => r[14] && String(r[14]).trim()).length;

console.log(
  JSON.stringify(
    {
      ok: true,
      sec: +sec,
      customers: w.overviewMetrics?.totalCustomers,
      calls: w.callTotal,
      leads: w.leads?.length,
      remarks,
      activityDate: w.activityDate,
      dayKeys: Object.keys(w.processIdsByInteractionDay || {}).length,
      top3: rows.slice(0, 3).map((r, i) => ({
        rank: i + 1,
        name: r.executiveName,
        score: +r.rankingScore.toFixed(1),
        conv: +((r.conversionRate || 0) * 100).toFixed(1),
        closed: r.closedCount,
      })),
      shubhamRank: rows.findIndex((r) => /shubham/i.test(r.executiveName)) + 1,
    },
    null,
    2,
  ),
);
