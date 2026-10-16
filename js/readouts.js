/* readouts.js: the DOM instruments (gauges, LLM line, git rows, clock). Shows "--" until the backend is connected. */
import { $, clamp, mood, rgb, P } from './core.js';
import { LIVE, M, PERF, GIT } from './data.js';

const segs = {};
document.querySelectorAll('.seg').forEach(s => {
  const n = +s.dataset.n, els = [];
  for (let i = 0; i < n; i++) els.push(s.appendChild(document.createElement('i')));
  segs[s.id] = els;
});
const setSeg = (id, f) => { const els = segs[id], k = Math.round(clamp(f, 0, 1) * els.length); els.forEach((e, i) => e.classList.toggle('on', i < k)); };
const gauge = (valId, segId, text, frac) => {
  $(valId).textContent = LIVE.on ? text : '--';
  setSeg(segId, LIVE.on ? frac : 0);
};

export function renderGit() {
  const els = { backend: $('vGitBack'), frontend: $('vGitFront') };
  for (const r of GIT) {
    const el = els[r.name];
    if (!el) continue;
    if (r.error) { el.textContent = r.error; continue; }
    const br = r.branch.length > 14 ? r.branch.slice(0, 13) + '…' : r.branch;
    const arrows = (r.ahead ? ' ↑' + r.ahead : '') + (r.behind ? ' ↓' + r.behind : '');
    el.textContent = `${br}${arrows} · ${r.changed ? r.changed + ' changed' : 'clean'}`;
  }
}

const MS = { unloaded: 'UNLOADED', loading: 'LOADING', loaded: 'READY', generating: 'ACTIVE' };
let lastDom = 0, lastK = -1;
export function updateDom(now) {
  if (Math.abs(mood.k - lastK) > .003) {  // keep the CSS colour in step with the teal <-> amber blend
    lastK = mood.k; const c = rgb(P.main);
    document.documentElement.style.setProperty('--rgb', `${c[0] | 0},${c[1] | 0},${c[2] | 0}`);
  }
  if (now - lastDom < 250) return;
  lastDom = now;
  gauge('vVram', 'sVram', `${M.vram.toFixed(1)}/${Math.round(M.vramMax)} GB`, M.vram / M.vramMax);
  gauge('vRam',  'sRam',  `${M.ram.toFixed(1)}/${Math.round(M.ramMax)} GB`,   M.ram / M.ramMax);
  gauge('vCpu',  'sCpu',  `${Math.round(M.cpu)}%`,                            M.cpu / 100);
  gauge('vCtx',  'sCtx',  `${M.ctx.toFixed(1)}k/${PERF.ctxMax}k`,             M.ctx / PERF.ctxMax);
  gauge('vTemp', 'sTemp', `${Math.round(M.temp)}°C`,                          (M.temp - 30) / 60);
  $('vLlm').textContent = LIVE.on && PERF.model ? (MS[PERF.model] || PERF.model.toUpperCase()) + (PERF.name ? ' · ' + PERF.name : '') : '--';
  $('vTtft').textContent = LIVE.on && PERF.ttft != null ? PERF.ttft.toFixed(2) + ' s' : '--';
  $('vTps').textContent = LIVE.on && PERF.tps != null ? Math.round(PERF.tps) + ' tok/s' : '--';
  const d = new Date();
  $('clock').textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  $('date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}