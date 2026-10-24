/* art.js: the artifact panel. Tabs, a sandboxed preview, code view with copy and download,
   version buttons, a draggable divider, and a card in the chat log for each artifact.
   link.js passes the artifact_* messages in; this file sends close/show requests back. */
/* global anime */
import { $, view, reduce, hooks, clamp } from './core.js';
import { send } from './link.js';

const BASE = 'http://localhost:8000';
document.head.append(Object.assign(document.createElement('link'),
  { rel: 'stylesheet', href: new URL('../art.css', import.meta.url).href }));

/* ---------- build the panel ---------- */
const el = document.createElement('div');
el.id = 'art'; el.hidden = true;
el.innerHTML = `
  <div id="artDiv" title="Drag to resize"></div>
  <div id="artTabs"></div>
  <div id="artBar">
    <span class="grp"><button id="artPrev" title="Older version">&lsaquo;</button><span id="artVer"></span><button id="artNext" title="Newer version">&rsaquo;</button></span>
    <span class="grp" id="artViews"><button data-v="preview">Preview</button><button data-v="code">Code</button></span>
    <span class="sp"></span>
    <button id="artCopy">Copy</button><button id="artDl">Download</button><button id="artFull">Expand</button>
  </div>
  <div id="artBody">
    <pre id="artCode"></pre>
    <div id="artMap"></div>
    <div id="artMsg"></div>
  </div>`;
document.body.append(el);
const frames = new Map();   // "tabId:version" -> iframe, kept alive so switching tabs never reloads
const MAX_FRAMES = 4;
let frame = null;           // the iframe on screen
const codeEl = $('artCode'), mapEl = $('artMap'), msgEl = $('artMsg'), tabsEl = $('artTabs');

/* ---------- state ---------- */
const tabs = [];   // {id, kind, title, lang, versions, ver, cache, view, building, buf, error, errs}
let cur = null;
const carded = new Set();
const BOOT = Date.now();  // the backend replays the open artifact right after page load: that gets no new chat card
let colw = 380;  // width of the chat column
try { colw = clamp(+localStorage.getItem('artColw') || 380, 280, 560); } catch (_) {}
const byId = id => tabs.find(t => t.id === id);
const tab = () => byId(cur);
const curText = t => t.building ? t.buf : (t.cache[t.ver] || '');
const focus = t => { if (t && t.ver) send({ type: 'artifact_focus', id: t.id, v: t.ver }); };

/* ---------- remember which tabs are open, so a refresh or restart brings them back ---------- */
const TABS_KEY = 'artOpen';
let restored = false;  // nothing is saved until the restore has finished, so a half-loaded panel can't overwrite the list
function readSaved() {
  try {
    const j = JSON.parse(localStorage.getItem(TABS_KEY) || 'null');
    return j && Array.isArray(j.ids) ? j : null;
  } catch (_) { return null; }
}
const saved = readSaved();
function saveTabs() {
  if (!restored) return;
  try { localStorage.setItem(TABS_KEY, JSON.stringify({ ids: tabs.map(t => t.id), cur })); } catch (_) {}
}

/* ---------- sandboxed preview: no network, no storage, errors reported to the panel ---------- */
const CSP = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; media-src data:">';
const BRIDGE = '<script>(function(){function r(m){try{parent.postMessage({artErr:String(m).slice(0,300)},"*")}catch(e){}}'
  + 'addEventListener("DOMContentLoaded",function(){try{parent.postMessage({artReady:1},"*")}catch(e){}});'
  + 'addEventListener("error",function(e){r(e.message+(e.lineno?" (line "+e.lineno+")":""))});'
  + 'addEventListener("unhandledrejection",function(e){r("Promise: "+(e.reason&&e.reason.message||e.reason))});'
  + 'var ce=console.error;console.error=function(){r([].join.call(arguments," "));ce.apply(console,arguments)};})();<\/script>';
function wrap(html) {
  const add = CSP + BRIDGE;
  if (/<head(\s[^>]*)?>/i.test(html)) return html.replace(/<head(\s[^>]*)?>/i, m => m + add);
  if (/<html(\s[^>]*)?>/i.test(html)) return html.replace(/<html(\s[^>]*)?>/i, m => m + '<head>' + add + '</head>');
  return '<!doctype html><html><head>' + add + '</head><body>' + html + '</body></html>';
}
addEventListener('message', e => {
  if (!e.data) return;
  const f = [...frames.values()].find(x => x.contentWindow === e.source);
  if (!f) return;
  if (e.data.artReady) { f.dataset.ready = '1'; return; }
  if (typeof e.data.artErr !== 'string') return;
  const [id, ver] = f.dataset.key.split(':'), t = byId(id);  // the page that reported, not whichever tab is open
  if (!t || t.building || t.ver !== +ver) return;
  if (!t.errs.includes(e.data.artErr)) {
    t.errs.push(e.data.artErr);
    send({ type: 'artifact_runtime_error', id: t.id, v: t.ver, error: e.data.artErr,
           early: Date.now() - (+f.dataset.t || 0) < 4000 });
  }
  if (t.errs.length > 5) t.errs.shift();
  if (t.id === cur) render();
});

/* One iframe per artifact version, kept alive while its tab is open (newest MAX_FRAMES only).
   Switching tabs just shows another iframe: no reload, no white flash, and the app keeps its state.
   A new iframe stays hidden until its page has loaded. If the page never reports in, it loads again (twice at most). */
let mountTimer = 0;
function dropFrame(key) {
  const f = frames.get(key);
  if (f) { f.remove(); frames.delete(key); }
  if (f && frame === f) frame = null;
}
function useFrame(key, getHtml, tries = 0) {
  clearTimeout(mountTimer);
  const have = frames.get(key);
  if (have && have.isConnected) { frames.delete(key); frames.set(key, have); frame = have; return; }
  if (have) dropFrame(key);
  const f = document.createElement('iframe');
  f.title = 'Artifact preview'; f.setAttribute('sandbox', 'allow-scripts');
  f.dataset.key = key; f.dataset.t = String(Date.now());
  f.style.opacity = '0'; f.style.visibility = 'hidden';
  $('artBody').prepend(f);
  frames.set(key, f); frame = f;
  while (frames.size > MAX_FRAMES) {
    const oldest = frames.keys().next().value;
    if (oldest === key) break;
    dropFrame(oldest);
  }
  const reveal = () => requestAnimationFrame(() => requestAnimationFrame(() => { f.style.opacity = '1'; }));
  setTimeout(() => {
    if (!f.isConnected) return;
    f.addEventListener('load', reveal, { once: true });
    f.srcdoc = getHtml();
  }, 30);
  setTimeout(() => { if (f.isConnected) f.style.opacity = '1'; }, 1500);  // never stay invisible
  mountTimer = setTimeout(() => {
    if (!f.isConnected || f.dataset.ready || tries >= 2) return;
    console.warn('artifact preview did not load, retrying');
    dropFrame(key);
    useFrame(key, getHtml, tries + 1);
  }, 800);
}

/* ---------- drawing ---------- */
function renderTabs() {
  tabsEl.textContent = '';
  for (const t of tabs) {
    const d = document.createElement('div');
    d.className = 'tab' + (t.id === cur ? ' on' : '') + (t.building ? ' busy' : '');
    const s = document.createElement('span'); s.textContent = t.title;
    const x = document.createElement('b'); x.textContent = '\u00d7'; x.title = 'Close';
    x.addEventListener('click', e => { e.stopPropagation(); closeTab(t.id, true); });
    d.append(s, x);
    d.addEventListener('click', () => { cur = t.id; render(); focus(t); });
    tabsEl.append(d);
  }
  saveTabs();
}

function setMsg(cls, text) { msgEl.className = cls; msgEl.textContent = text; }

/* ---------- route map: Leaflet (vendored in js/vendor), tiles come through the backend proxy ---------- */
const maps = new Map();  // "id:version" -> {wrap, map, refit}: one Leaflet map per artifact version, kept alive
const MAX_MAPS = 4;
let leafLoad = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!leafLoad) leafLoad = new Promise((ok, no) => {
    document.head.append(Object.assign(document.createElement('link'),
      { rel: 'stylesheet', href: new URL('./vendor/leaflet.css', import.meta.url).href }));
    document.head.append(Object.assign(document.createElement('style'),
      { textContent: '.osm-dark{filter:invert(1) hue-rotate(180deg) brightness(.85) contrast(.9)}.leaflet-container{background:#04181a}' }));  // dark tiles; delete to get normal colors
    const s = Object.assign(document.createElement('script'), { src: new URL('./vendor/leaflet.js', import.meta.url).href });
    s.onload = () => ok(window.L);
    s.onerror = () => { leafLoad = null; no(new Error('leaflet failed to load')); };
    document.head.append(s);
  });
  return leafLoad;
}
function mapInfo(d) {
  const f = document.createDocumentFragment();
  const h = document.createElement('h3');
  h.textContent = `${(d.from && d.from.name) || '?'} \u2192 ${(d.to && d.to.name) || '?'}`;
  const sub = document.createElement('div'); sub.className = 'dim';
  sub.textContent = `${((d.distance_m || 0) / 1609.34).toFixed(1)} mi \u00b7 ${Math.round((d.duration_s || 0) / 60)} min`
    + (d.approx ? ' \u00b7 straight-line estimate' : '');
  const ol = document.createElement('ol');
  for (const s of d.steps || []) { const li = document.createElement('li'); li.textContent = s; ol.append(li); }
  f.append(h, sub, ol);
  return f;
}
function renderMap(text, key) {
  for (const x of maps.values()) x.wrap.hidden = true;
  const have = maps.get(key);
  if (have) {  // already built: just show it
    have.wrap.hidden = false;
    if (have.map) { have.map.invalidateSize(); if (have.refit) { have.refit(); have.refit = null; } }
    return;
  }
  const wrap = document.createElement('div'), entry = { wrap, map: null, refit: null };
  maps.set(key, entry); mapEl.append(wrap);
  while (maps.size > MAX_MAPS) {
    const [k, old] = maps.entries().next().value;
    if (k === key) break;
    if (old.map) old.map.remove();
    old.wrap.remove(); maps.delete(k);
  }
  let d;
  try { d = JSON.parse(text); } catch (_) { wrap.textContent = 'Bad route data.'; return; }
  const box = document.createElement('div');
  box.style.cssText = 'height:clamp(240px,55vh,520px);border-radius:8px;overflow:hidden;margin-bottom:10px;isolation:isolate';
  const warn = document.createElement('div'); warn.className = 'dim';
  wrap.append(box, mapInfo(d), warn);
  loadLeaflet().then(L => {
    if (!wrap.isConnected) return;  // its tab was closed while it loaded
    const m = entry.map = L.map(box);
    m.attributionControl.setPrefix(false);
    L.tileLayer(`${BASE}/network/tiles/{z}/{x}/{y}.png`, { maxZoom: 19, className: 'osm-dark',
      attribution: '\u00a9 OpenStreetMap contributors' })
      .on('tileerror', () => { warn.textContent = 'Some map tiles could not load (offline, or not cached yet).'; })
      .addTo(m);
    const pts = (d.route || []).filter(p => Array.isArray(p) && p.length === 2);
    const line = pts.length > 1
      ? L.polyline(pts, { color: '#50decd', weight: 4, opacity: .9, dashArray: d.approx ? '8 8' : undefined }).addTo(m) : null;
    for (const [p, label, fill] of [[d.from, 'Start', '#eafffb'], [d.to, 'End', '#50decd']]) {
      if (!p || !isFinite(p.lat) || !isFinite(p.lon)) continue;
      const tip = document.createElement('span'); tip.textContent = `${label}: ${p.name}`;  // text, not HTML
      L.circleMarker([p.lat, p.lon], { radius: 7, color: '#04181a', weight: 2, fillColor: fill, fillOpacity: 1 })
        .bindTooltip(tip).addTo(m);
    }
    const fit = () => {
      if (line) m.fitBounds(line.getBounds(), { padding: [24, 24] });
      else if (d.to) m.setView([d.to.lat, d.to.lon], 12);
    };
    fit();
    if (wrap.hidden) entry.refit = fit;  // built while another tab was showing: fit again when it appears
    setTimeout(() => m.invalidateSize(), 60);
  }).catch(() => { wrap.textContent = ''; wrap.append(mapInfo(d)); });
}

function renderMapText(text) {
  mapEl.textContent = '';
  let d;
  try { d = JSON.parse(text); } catch (_) { mapEl.textContent = 'Bad route data.'; return; }
  const h = document.createElement('h3');
  h.textContent = `${(d.from && d.from.name) || '?'} \u2192 ${(d.to && d.to.name) || '?'}`;
  const sub = document.createElement('div'); sub.className = 'dim';
  sub.textContent = `${((d.distance_m || 0) / 1609.34).toFixed(1)} mi \u00b7 ${Math.round((d.duration_s || 0) / 60)} min`;
  const ol = document.createElement('ol');
  for (const s of d.steps || []) { const li = document.createElement('li'); li.textContent = s; ol.append(li); }
  const note = document.createElement('div'); note.className = 'dim'; note.textContent = 'The map could not load, so this is the text version.';
  mapEl.append(h, sub, ol, note);
}

function render() {
  renderTabs();
  const t = tab();
  if (!t) return;
  const vs = t.versions, i = vs.indexOf(t.ver), text = curText(t);
  $('artPrev').disabled = t.building || i <= 0;
  $('artNext').disabled = t.building || i < 0 || i >= vs.length - 1;
  $('artVer').textContent = t.building ? 'building' : (vs.length ? `v${t.ver} of ${vs[vs.length - 1]}` : '');
  $('artCopy').disabled = $('artDl').disabled = !text;

  // what to show: the streaming code while building, otherwise the chosen view
  const mode = t.kind === 'map' && !t.building && text ? 'map'
    : (!t.building && t.kind === 'html' && t.view === 'preview' && text) ? 'frame' : 'code';
  $('artViews').hidden = t.kind !== 'html';
  [...$('artViews').children].forEach(b => b.classList.toggle('on', b.dataset.v === (mode === 'frame' ? 'preview' : 'code')));
  if (mode === 'frame') useFrame(t.id + ':' + t.ver, () => wrap(text));
  for (const x of frames.values()) {
    const on = mode === 'frame' && x === frame;
    x.style.visibility = on ? 'visible' : 'hidden';
    x.style.pointerEvents = on ? 'auto' : 'none';
  }
  codeEl.style.display = mode === 'code' ? 'block' : 'none';
  mapEl.style.display = mode === 'map' ? 'block' : 'none';
  if (mode === 'code') {
    codeEl.textContent = text;
    if (t.building) codeEl.scrollTop = codeEl.scrollHeight;
  } else renderMap(text, t.id + ':' + t.ver);

  if (t.building) setMsg('busy', `Building\u2026 ${t.buf.length} characters`);
  else if (t.error) setMsg('err', t.error);
  else if (t.errs.length) setMsg('err', 'Error in the app: ' + t.errs[t.errs.length - 1]);
  else setMsg('', '');
}

/* ---------- layout: chat left, artifact right, hub shrinks to an orb ---------- */
const ORB_Y = 215;  // css px from the top
let hubOn = false;
function orbTarget() {
  const baseU = Math.min(innerWidth * .28, innerHeight * .275);
  const R = Math.min(92, colw * .25);
  return { x: (36 + colw / 2 - innerWidth / 2) / innerWidth,
           y: (ORB_Y - innerHeight * .455) / innerHeight,
           s: R / (1.1 * baseU) };
}
function moveHub(on, instant) {
  const to = on ? orbTarget() : { x: 0, y: 0, s: 1 };
  if (instant || reduce) { anime.remove(view); Object.assign(view, to); if (reduce) hooks.draw(0, 0); }
  else if (on !== hubOn) {
    anime.remove(view);
    anime({ targets: view, x: to.x, y: to.y, s: to.s, duration: 900, easing: 'easeInOutCubic' });
  }
  hubOn = on;
}
function layout(instant) {
  const open = tabs.length > 0, wide = innerWidth >= 1000;
  el.hidden = !open;
  el.classList.toggle('overlay', open && !wide);
  document.body.classList.toggle('work', open && wide);
  if (!open) { document.body.classList.remove('full'); $('artFull').textContent = 'Expand'; }
  document.documentElement.style.setProperty('--colw', colw + 'px');
  moveHub(open && wide, instant);
}
addEventListener('resize', () => { if (tabs.length) layout(true); });

const dv = $('artDiv');
dv.addEventListener('pointerdown', e => { dv.setPointerCapture(e.pointerId); e.preventDefault(); });
dv.addEventListener('pointermove', e => {
  if (!dv.hasPointerCapture(e.pointerId)) return;
  colw = clamp(e.clientX - 36 - 14, 280, Math.min(560, innerWidth * .45));
  document.documentElement.style.setProperty('--colw', colw + 'px');
  moveHub(true, true);
});
dv.addEventListener('pointerup', () => { try { localStorage.setItem('artColw', String(Math.round(colw))); } catch (_) {} });

/* ---------- tabs and versions ---------- */
function addTab(m) {
  const t = { id: m.id, kind: m.kind, title: m.title || 'Untitled', lang: m.lang || null, versions: [], ver: 0,
              cache: {}, view: m.kind === 'html' ? 'preview' : 'code', building: false, buf: '', error: null, errs: [] };
  tabs.push(t);
  return t;
}
function closeTab(id, notify) {
  const i = tabs.findIndex(t => t.id === id);
  if (i < 0) return;
  tabs.splice(i, 1);
  if (notify) send({ type: 'artifact_close', id });
  if (cur === id) cur = tabs.length ? tabs[Math.min(i, tabs.length - 1)].id : null;
  focus(byId(cur));
  for (const k of [...frames.keys()]) if (k.startsWith(id + ':')) dropFrame(k);
  for (const [k, x] of [...maps]) if (k.startsWith(id + ':')) { if (x.map) x.map.remove(); x.wrap.remove(); maps.delete(k); }
  if (!tabs.length) clearTimeout(mountTimer);
  layout(); render();
}
async function showVersion(t, v) {
  if (t.building) return;
  if (t.cache[v] === undefined) {
    try {
      const r = await fetch(`${BASE}/artifacts/${t.id}/v/${v}`);
      if (!r.ok) throw new Error('bad status');
      t.cache[v] = (await r.json()).content;
    } catch (_) { t.error = 'Could not load that version.'; render(); return; }
  }
  t.ver = v; t.error = null; t.errs = []; focus(t);
  if (t.kind === 'map') {  // a map is named after the route it shows
    try {
      const d = JSON.parse(t.cache[v]);
      if (d.from && d.to) t.title = `${d.from.name} to ${d.to.name}`;
    } catch (_) {}
  }
  render();
}
function step(d) {
  const t = tab(); if (!t) return;
  const v = t.versions[t.versions.indexOf(t.ver) + d];
  if (v !== undefined) showVersion(t, v);
}
$('artPrev').onclick = () => step(-1);
$('artNext').onclick = () => step(1);
$('artViews').addEventListener('click', e => {
  const b = e.target.closest('button'), t = tab();
  if (b && t) { t.view = b.dataset.v; render(); }
});

/* ---------- copy, download, expand ---------- */
$('artCopy').onclick = async () => {
  const t = tab(); if (!t) return;
  const text = curText(t);
  try { await navigator.clipboard.writeText(text); }
  catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  $('artCopy').textContent = 'Copied';
  setTimeout(() => { $('artCopy').textContent = 'Copy'; }, 1200);
};
const EXT = { python: 'py', javascript: 'js', typescript: 'ts', html: 'html', css: 'css', json: 'json', sql: 'sql',
              bash: 'sh', powershell: 'ps1', java: 'java', c: 'c', cpp: 'cpp', csharp: 'cs', go: 'go', rust: 'rs' };
function fileName(t) {
  const base = t.title.replace(/[^\w.\- ]+/g, '').trim().replace(/\s+/g, '-') || 'artifact';
  if (/\.\w{1,5}$/.test(base)) return base;
  return base + '.' + (t.kind === 'html' ? 'html' : t.kind === 'map' ? 'json' : (EXT[t.lang] || 'txt'));
}
$('artDl').onclick = () => {
  const t = tab(); if (!t) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([curText(t)], { type: 'text/plain' }));
  a.download = fileName(t);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('artFull').onclick = () => {
  const full = document.body.classList.toggle('full');
  $('artFull').textContent = full ? 'Collapse' : 'Expand';
};

/* ---------- artifact cards in the conversation ---------- */
function addCard(t, v) {
  const k = t.id + ':' + v;
  if (carded.has(k)) return;
  carded.add(k);
  const row = document.createElement('div'); row.className = 'msg artcard';
  const who = document.createElement('div'); who.className = 'who'; who.textContent = 'ARTIFACT';
  const b = document.createElement('button'); b.className = 'card';
  const n = document.createElement('span'); n.textContent = t.title;
  const s = document.createElement('small'); s.textContent = `${t.kind} \u00b7 v${v}`;
  b.append(n, s);
  b.addEventListener('click', () => {
    const x = byId(t.id);
    if (!x) { send({ type: 'artifact_show', id: t.id, v }); return; }
    cur = x.id; layout(); showVersion(x, v);
  });
  row.append(who, b);
  const log = $('chatLog');
  const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.append(row);
  if (stick) log.scrollTop = log.scrollHeight;
}

/* ---------- messages from the backend (called by link.js) ---------- */
export function onArtifact(m) {
  const t = byId(m.id);
  switch (m.type) {
    case 'artifact_open': {
      const x = t || addTab(m);
      Object.assign(x, { building: true, buf: '', error: null, title: m.title || x.title });
      cur = x.id; layout(); render();
      break;
    }
    case 'artifact_chunk':
      if (!t) break;
      t.buf += m.text;
      if (t.id === cur && t.building) {
        codeEl.textContent = t.buf; codeEl.scrollTop = codeEl.scrollHeight;
        msgEl.textContent = `Building\u2026 ${t.buf.length} characters`;
      }
      break;
    case 'artifact_done': {
      const x = t || addTab(m);
      Object.assign(x, { kind: m.kind, title: m.title, lang: m.lang || null, versions: m.versions || [m.version],
                         ver: m.version, building: false, buf: '', error: null, errs: [] });
      x.cache[m.version] = m.content;
      cur = x.id; layout(); render();
      if (Date.now() - BOOT > 4000) addCard(x, m.version);
      break;
    }
    case 'artifact_error':
      if (!t) break;
      t.building = false; t.buf = ''; t.error = m.message || 'Build failed.';
      render();
      break;
    case 'artifact_close':
      closeTab(m.id, false);
      break;
  }
}

/* ---------- bring back the tabs that were open ---------- */
async function loadSaved(id) {
  const mr = await fetch(`${BASE}/artifacts/${id}`);
  if (mr.status === 404 || mr.status === 400) return null;  // deleted from disk: skip it
  if (!mr.ok) throw new Error('backend not ready');
  const meta = await mr.json();
  const vs = (meta.versions || []).map(x => x.v);
  if (!vs.length) return null;
  const v = vs[vs.length - 1];
  const cr = await fetch(`${BASE}/artifacts/${id}/v/${v}`);
  if (!cr.ok) throw new Error('backend not ready');
  return { meta, vs, v, content: (await cr.json()).content };
}
async function restoreTabs(tries = 0) {
  const ids = saved ? saved.ids.filter(x => typeof x === 'string') : [];
  let failed = false;
  for (const id of ids) {
    if (byId(id)) continue;  // the backend already sent this one
    try {
      const r = await loadSaved(id);
      if (!r || byId(id)) continue;
      const t = addTab({ id, kind: r.meta.kind, title: r.meta.title, lang: r.meta.lang });
      Object.assign(t, { versions: r.vs, ver: r.v });
      t.cache[r.v] = r.content;
      carded.add(id + ':' + r.v);  // no chat card for a restored tab
    } catch (_) { failed = true; }
  }
  if (failed && tries < 4) { setTimeout(() => restoreTabs(tries + 1), 2000); return; }  // backend still starting
  const at = x => { const i = ids.indexOf(x.id); return i < 0 ? 1e9 : i; };
  tabs.sort((a, b) => at(a) - at(b));  // same order as before
  if (!cur || !byId(cur)) cur = saved && byId(saved.cur) ? saved.cur : (tabs.length ? tabs[tabs.length - 1].id : null);
  restored = true;
  if (tabs.length) { layout(); render(); try { focus(tab()); } catch (_) {} }
}
restoreTabs();