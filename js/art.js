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
    <iframe id="artFrame" sandbox="allow-scripts" title="Artifact preview"></iframe>
    <pre id="artCode"></pre>
    <div id="artMap"></div>
    <div id="artMsg"></div>
  </div>`;
document.body.append(el);
let frame = $('artFrame');
const codeEl = $('artCode'), mapEl = $('artMap'), msgEl = $('artMsg'), tabsEl = $('artTabs');

/* ---------- state ---------- */
const tabs = [];   // {id, kind, title, lang, versions, ver, cache, view, building, buf, error, errs}
let cur = null;
const carded = new Set();
let colw = 380;  // width of the chat column
try { colw = clamp(+localStorage.getItem('artColw') || 380, 280, 560); } catch (_) {}
const byId = id => tabs.find(t => t.id === id);
const tab = () => byId(cur);
const curText = t => t.building ? t.buf : (t.cache[t.ver] || '');

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
  if (e.source !== frame.contentWindow || !e.data) return;
  if (e.data.artReady) { frame.dataset.ready = '1'; return; }
  if (typeof e.data.artErr !== 'string') return;
  const t = tab(); if (!t) return;
  if (!t.errs.includes(e.data.artErr)) t.errs.push(e.data.artErr);
  if (t.errs.length > 5) t.errs.shift();
  render();
});

/* a fresh iframe each time the preview changes, loaded once layout has settled.
   If the page never reports in, load it again (twice at most). */
let mountTimer = 0;
function mountFrame(key, html, tries = 0) {
  clearTimeout(mountTimer);
  const old = frame, f = document.createElement('iframe');
  f.title = 'Artifact preview'; f.setAttribute('sandbox', 'allow-scripts');
  f.dataset.key = key;
  f.style.opacity = '0';  // invisible until its page has loaded; the old preview shows meanwhile
  f.style.visibility = old.style.visibility;
  f.style.pointerEvents = old.style.pointerEvents;
  if (!old.dataset.key) old.style.visibility = 'hidden';  // nothing loaded yet: no empty white frame
  old.after(f); frame = f;
  const reveal = () => {
    if (frame !== f) return;
    f.style.opacity = '1';
    setTimeout(() => el.querySelectorAll('#artBody iframe').forEach(x => { if (x !== f) x.remove(); }), 200);
  };
  setTimeout(() => {
    if (frame !== f) return;
    f.addEventListener('load', reveal, { once: true });
    f.srcdoc = html;
  }, 30);
  setTimeout(reveal, 1500);  // never stay invisible
  mountTimer = setTimeout(() => {
    if (frame !== f || f.dataset.ready || tries >= 2) return;
    console.warn('artifact preview did not load, retrying');
    mountFrame(key, html, tries + 1);
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
    d.addEventListener('click', () => { cur = t.id; render(); });
    tabsEl.append(d);
  }
}

function setMsg(cls, text) { msgEl.className = cls; msgEl.textContent = text; }

function renderMap(text) {
  mapEl.textContent = '';
  let d;
  try { d = JSON.parse(text); } catch (_) { mapEl.textContent = 'Bad route data.'; return; }
  const h = document.createElement('h3');
  h.textContent = `${(d.from && d.from.name) || '?'} \u2192 ${(d.to && d.to.name) || '?'}`;
  const sub = document.createElement('div'); sub.className = 'dim';
  sub.textContent = `${((d.distance_m || 0) / 1609.34).toFixed(1)} mi \u00b7 ${Math.round((d.duration_s || 0) / 60)} min`;
  const ol = document.createElement('ol');
  for (const s of d.steps || []) { const li = document.createElement('li'); li.textContent = s; ol.append(li); }
  const note = document.createElement('div'); note.className = 'dim'; note.textContent = 'Map tiles arrive in a later step.';
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
  const mode = t.kind === 'map' && !t.building ? 'map'
    : (!t.building && t.kind === 'html' && t.view === 'preview') ? 'frame' : 'code';
  $('artViews').hidden = t.kind !== 'html';
  [...$('artViews').children].forEach(b => b.classList.toggle('on', b.dataset.v === (mode === 'frame' ? 'preview' : 'code')));
  for (const x of el.querySelectorAll('#artBody iframe')) {
    x.style.visibility = mode === 'frame' ? 'visible' : 'hidden';
    x.style.pointerEvents = mode === 'frame' ? 'auto' : 'none';
  }
  codeEl.style.display = mode === 'code' ? 'block' : 'none';
  mapEl.style.display = mode === 'map' ? 'block' : 'none';
  if (mode === 'frame') {
    const key = t.id + ':' + t.ver;  // same key = keep the running app (e.g. after flipping to Code and back)
    if (frame.dataset.key !== key) mountFrame(key, wrap(text));
  } else if (mode === 'code') {
    codeEl.textContent = text;
    if (t.building) codeEl.scrollTop = codeEl.scrollHeight;
  } else renderMap(text);

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
  if (!tabs.length) { clearTimeout(mountTimer); frame.srcdoc = ''; delete frame.dataset.key; delete frame.dataset.ready; }
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
  t.ver = v; t.error = null; t.errs = [];
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
      cur = x.id; layout(); render(); addCard(x, m.version);
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