/* instruments.js: the canvas edge instruments: corner brackets, the time tape with calendar
   events (top) and the scrolling activity ticker (bottom). drawHud(dt, a) draws all of them. */
import { cv, ctx, TAU, clamp, DPR, cx, P, col, FONT } from './core.js';
import { EV, WX, GIT, PERF, M, LIVE } from './data.js';

/* ---------- top: time tape with event flags and duration bars ---------- */
const fmtMin = m => m < 60 ? m + 'm' : Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '');
const hhmm = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });

function drawTimeTape(a) {
  const w = Math.min(innerWidth * .5, Math.max(240, innerWidth - 560)) * DPR;
  const narrow = w / DPR < 420, y = (innerWidth < 700 ? 100 : 58) * DPR, span = narrow ? 240 : 360, ppm = w / span;
  const now = Date.now(), d = new Date(now);
  const mn = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / 60000;
  const g = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
  g.addColorStop(0, col(P.main, 0)); g.addColorStop(.5, col(P.main, .55 * a)); g.addColorStop(1, col(P.main, 0));
  ctx.strokeStyle = g; ctx.lineWidth = DPR;
  ctx.beginPath(); ctx.moveTo(cx - w / 2, y); ctx.lineTo(cx + w / 2, y); ctx.stroke();
  ctx.font = `${11 * DPR}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let m = Math.floor((mn - span / 2) / 15) * 15; m <= mn + span / 2; m += 15) {
    const x = cx + (m - mn) * ppm, f = 1 - Math.abs(x - cx) / (w / 2);
    if (f <= 0) continue;
    const major = m % 60 === 0, al = Math.pow(f, .7) * a;
    ctx.strokeStyle = col(P.main, al * (major ? .9 : .5)); ctx.lineWidth = DPR;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + (major ? 12 : 6) * DPR); ctx.stroke();
    if (major && (!narrow || m % 120 === 0)) {
      const h = (((m / 60) % 24) + 24) % 24;
      ctx.fillStyle = col(P.main, al * .8); ctx.fillText((h % 12 || 12) + (h < 12 ? ' AM' : ' PM'), x, y + 25 * DPR);
    }
  }
  const evs = EV.slice().sort((p, q) => p.t - q.t);
  const laneEnd = [];
  for (const e of evs) {  // overlapping events go on separate lanes
    let l = laneEnd.findIndex(end => end <= e.t);
    if (l < 0) l = laneEnd.length;
    laneEnd[l] = e.end > e.t ? e.end : e.t;
    e.lane = Math.min(l, 2);
  }
  const rowRight = [-1e9, -1e9];  // right edge of the last label placed on each of the 2 label rows
  const curs = [];                // events happening right now
  let next = null;
  const bar = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
  bar.addColorStop(0, col(P.main, 0)); bar.addColorStop(.5, col(P.main, .85 * a)); bar.addColorStop(1, col(P.main, 0));
  for (const e of evs) {
    const off = (e.t - now) / 60000, x = cx + off * ppm, f = 1 - Math.abs(x - cx) / (w / 2);
    if (off > 0 && (!next || e.t < next.t)) next = e;
        if (off <= 0 && e.end > now) curs.push(e);
    if (e.end > e.t) {  // duration bar: a block on the tape from start to end
      const x0 = Math.max(x, cx - w / 2), x1 = Math.min(cx + (e.end - now) / 60000 * ppm, cx + w / 2);
      if (x1 > x0) {
        ctx.globalAlpha = e.end < now ? .45 : 1;
        ctx.strokeStyle = bar; ctx.lineWidth = 3 * DPR;
        const by = y + (e.lane || 0) * 5 * DPR;
        ctx.beginPath(); ctx.moveTo(x0, by); ctx.lineTo(x1, by); ctx.stroke();
        ctx.globalAlpha = 1; ctx.lineWidth = DPR;
      }
    }
    if (f <= 0) continue;
    const al = Math.pow(f, .7) * a * (off < 0 ? .45 : 1);
    ctx.strokeStyle = col(P.main, al); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 14 * DPR); ctx.stroke();
    ctx.fillStyle = col(P.main, al); ctx.beginPath(); ctx.arc(x, y - 16 * DPR, 2.5 * DPR, 0, TAU); ctx.fill();
    const label = e.n.length > 18 ? e.n.slice(0, 17) + '…' : e.n;
    const wd = ctx.measureText(label).width, r = rowRight.findIndex(rr => rr + 10 * DPR <= x - wd / 2);
    if (r >= 0) { ctx.fillText(label, x, y - (28 + 14 * r) * DPR); rowRight[r] = x + wd / 2; }
  }
  ctx.fillStyle = col(P.white, a);
  ctx.beginPath(); ctx.moveTo(cx, y + 2 * DPR); ctx.lineTo(cx - 5 * DPR, y - 7 * DPR); ctx.lineTo(cx + 5 * DPR, y - 7 * DPR); ctx.closePath(); ctx.fill();
  const lines = [];
  curs.sort((p, q) => p.end - q.end);
  for (const c of curs.slice(0, 2)) {
    lines.push([`${curs.length > 1 ? '! ' : ''}Now: ${c.n} · ${fmtMin(Math.max(1, Math.round((c.end - now) / 60000)))} left`, curs.length > 1]);
  }
  if (next) {
    const m = Math.max(0, Math.round((next.t - now) / 60000));
    const len = next.end > next.t ? ` · until ${hhmm(next.end)} (${fmtMin(Math.round((next.end - next.t) / 60000))})` : '';
    lines.push([`${next.n} in ${fmtMin(m)}${len}`, false]);
    const clash = evs.find(o => o !== next && o.t < next.end && next.t < o.end);
    if (clash) lines.push([`! Overlaps ${clash.n}, ${hhmm(clash.t)} to ${hhmm(clash.end)}`, true]);
  }
  let ly = y + 46 * DPR;
  for (const [txt, warn] of lines.slice(0, 3)) {  // at most 3 lines so it stays clear of the hub
    ctx.fillStyle = warn ? col(P.white, .95 * a) : col(P.main, .8 * a);
    ctx.fillText(txt, cx, ly);
    ly += 15 * DPR;
  }
}

/* ---------- bottom: scrolling activity ticker ---------- */
const tk = { items: [], queue: [], recent: [], rot: 0, idleSince: 0 };
const REPLAY_MS = 20000;  // quiet time before an old notice or status line drifts by again

// live status lines that fill quiet moments (each returns null when it has nothing to say)
const STATUS = [
  () => PERF.model ? ['Model', (PERF.name || 'LLM') + ' ' + PERF.model] : null,
  () => LIVE.on ? ['Context', `${M.ctx.toFixed(1)}k of ${Math.round(PERF.ctxMax)}k tokens`] : null,
  () => PERF.tps != null ? ['Speed', `${Math.round(PERF.tps)} tok/s, first token ${PERF.ttft != null ? PERF.ttft.toFixed(1) + ' s' : '--'}`] : null,
  () => WX.items.length ? WX.items[WX.wi++ % WX.items.length] : null,
  () => { const n = EV.filter(e => e.t > Date.now()).sort((a, b) => a.t - b.t)[0]; return n ? ['Next', `${n.n} in ${Math.max(0, Math.round((n.t - Date.now()) / 60000))}m`] : null; },
  () => GIT.some(r => !r.error) ? ['Git', GIT.filter(r => !r.error).map(r => `${r.name} ${r.branch}, ${r.changed ? r.changed + ' changed' : 'clean'}`).join(' · ')] : null
];

/* Add an event to the ticker; normal events are also remembered so they can drift by again later. */
export const pushLog = (a, b) => {
  const rec = [a, b, new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })];
  tk.queue.push(rec);
  if (!/error|failed|not reachable/i.test(a + ' ' + b)) {
    tk.recent = tk.recent.filter(r => r[0] !== a);  // keep only the latest of each kind
    tk.recent.push(rec);
    if (tk.recent.length > 6) tk.recent.shift();
  }
};
/* Show a ready-made [label, detail] notice right away (used for new weather alerts). */
export const notice = rec => tk.queue.push(rec);

function drawTicker(dt, a) {
  const W = cv.width, y = cv.height - 16 * DPR, gap = 46 * DPR, speed = 52 * DPR;
  ctx.font = `${12 * DPR}px ${FONT}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  // when the lane has been empty a while, replay an old notice or show a live status line
  const nowMs = performance.now();
  if (tk.items.length || tk.queue.length) tk.idleSince = 0;
  else if (!tk.idleSince) tk.idleSince = nowMs;
  else if (nowMs - tk.idleSince > REPLAY_MS) {
    tk.alertTurn = !tk.alertTurn;  // while a weather alert is active, it gets every other slot
    if (WX.alerts.length && tk.alertTurn) tk.queue.push(WX.alerts[tk.ai = ((tk.ai || 0) + 1) % WX.alerts.length]);
    const pool = tk.recent.length + STATUS.length;
    for (let tries = 0; tries < pool && !tk.queue.length; tries++) {
      const i = tk.rot++ % pool;
      if (i < tk.recent.length) tk.queue.push(tk.recent[i]);
      else { const s = STATUS[i - tk.recent.length](); if (s) tk.queue.push(s); }
    }
    tk.idleSince = 0;
  }
  for (let n = 0; n < 40; n++) {
    const last = tk.items[tk.items.length - 1];
    if (last && last.x + last.w + gap > W + 40 * DPR) break;
    if (!tk.queue.length) break;  // only real events, no filler
    const src = tk.queue.shift();
    const it = { tm: (src[2] || new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })) + '  ', a: src[0] + '  ', b: src[1] };
    it.w1 = ctx.measureText(it.tm).width; it.w2 = ctx.measureText(it.a).width;
    it.w = it.w1 + it.w2 + ctx.measureText(it.b).width;
    it.x = Math.max(last ? last.x + last.w + gap : 0, W + 10 * DPR);  // always enter from the right edge
    tk.items.push(it);
  }
  for (const it of tk.items) it.x -= speed * dt;
  while (tk.items.length && tk.items[0].x + tk.items[0].w < 0) tk.items.shift();
  for (const it of tk.items) {
    const f = clamp(Math.min(it.x + it.w, W - it.x) / (W * .14), 0, 1) * a;
    if (f <= .01) continue;
    ctx.fillStyle = col(P.main, .5 * f); ctx.fillText(it.tm, it.x, y);
    ctx.fillStyle = col(P.white, .95 * f); ctx.fillText(it.a, it.x + it.w1, y);
    ctx.fillStyle = col(P.main, .8 * f); ctx.fillText(it.b, it.x + it.w1 + it.w2, y);
    ctx.fillStyle = col(P.main, .5 * f);
    ctx.fillRect(it.x - gap / 2 - 2 * DPR, y - 2 * DPR, 4 * DPR, 4 * DPR);
  }
}

/* ---------- everything on the canvas that isn't the hub ---------- */
export function drawHud(dt, a) {
  if (a <= .002) return;
  // corner brackets
  const b = 18 * DPR, m = 14 * DPR, W = cv.width, H = cv.height;
  ctx.strokeStyle = col(P.main, .35 * a); ctx.lineWidth = 1.5 * DPR;
  [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]].forEach(([x, y, sx, sy]) => {
    ctx.beginPath(); ctx.moveTo(x + sx * b, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * b); ctx.stroke();
  });
  drawTimeTape(a);
  drawTicker(dt, a);
}