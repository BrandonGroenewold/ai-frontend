/* ui.js: everything you click or type into: the hub (listen toggle), push-to-talk key button,
   hands-free button, the conversation panel and the chat box. */
import { $, cv, resizeView } from './core.js';
import { LIVE } from './data.js';
import { getState, setState } from './state.js';
import { pushLog, QUIET } from './instruments.js';
import { count as picCount, busy as picBusy, notify, openBig } from './pictures.js';

const BASE = 'http://localhost:8000';

/* ---------- captions above the controls + conversation panel ---------- */
const chatLog = $('chatLog');
let curJv = null;  // the Jarvis message currently being streamed into
const nearBottom = () => chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 40;
function addMsg(role, text) {
  const d = document.createElement('div'); d.className = 'msg ' + role;
  const who = document.createElement('div'); who.className = 'who'; who.textContent = role === 'you' ? 'YOU' : 'JARVIS';
  const body = document.createElement('div'); body.className = 'body'; body.textContent = text;
  d.append(who, body);
  const stick = nearBottom();
  chatLog.appendChild(d);
  while (chatLog.children.length > 60) chatLog.firstChild.remove();
  if (stick) chatLog.scrollTop = chatLog.scrollHeight;
  return body;
}
function appendMsg(body, text) {
  const stick = nearBottom();
  body.textContent += text;
  if (stick) chatLog.scrollTop = chatLog.scrollHeight;
}
$('chatHead').addEventListener('click', () => {
  const m = $('chatPanel').classList.toggle('min');
  $('chatMin').textContent = m ? 'show' : 'hide';
  resizeView();
});

export function clearCaptions() { $('youTxt').textContent = ''; $('jvTxt').textContent = ''; }
let lastYou = null;  // the newest YOU bubble, so pictures can be added to it
export function youSaid(text) {
  const shown = text || (picCount() > 1 ? '[' + picCount() + ' pictures]' : '[picture]');  // a picture-only message has no words
  $('youTxt').textContent = '\u201C' + shown + '\u201D'; $('jvTxt').textContent = '';
  addMsg('you', text); curJv = null;
  lastYou = chatLog.lastElementChild;
}

/* thumbnails of the pictures a message used go into its YOU bubble; clicking one opens it larger */
export function showUsed(used) {
  if (!used.length || !lastYou) return;
  const row = document.createElement('div'); row.className = 'pics';
  used.forEach((p, i) => {
    const im = document.createElement('img');
    im.src = p.url; im.dataset.id = p.id;
    im.dataset.name = used.length > 1 ? 'Picture ' + (i + 1) + ' of ' + used.length : 'Picture';
    im.alt = im.dataset.name; im.title = 'Click to enlarge';
    im.addEventListener('click', () => openBig(p.url));
    row.appendChild(im);
  });
  const stick = nearBottom();
  lastYou.insertBefore(row, lastYou.querySelector('.body'));
  if (stick) chatLog.scrollTop = chatLog.scrollHeight;
}

/* Jarvis has dropped these pictures: dim them and say so */
export function dimPics(ids) {
  for (const id of ids) {
    chatLog.querySelectorAll('img[data-id="' + id + '"]').forEach(im => {
      im.classList.add('gone');
      im.title = im.dataset.name + ': Jarvis can no longer see this picture. Attach it again to ask more.';
    });
  }
}
/* ---------- pictures Jarvis draws: one JARVIS bubble holds the status line and the thumbnails ---------- */
let imgBubble = null;  // the bubble for the drawing in progress
function ensureImgBubble() {
  if (imgBubble) return imgBubble;
  const d = document.createElement('div'); d.className = 'msg jarvis';
  const who = document.createElement('div'); who.className = 'who'; who.textContent = 'JARVIS';
  const pics = document.createElement('div'); pics.className = 'drawn';
  const status = document.createElement('div'); status.className = 'body'; status.hidden = true;
  d.append(who, pics, status);
  const stick = nearBottom();
  chatLog.appendChild(d);
  while (chatLog.children.length > 60) chatLog.firstChild.remove();
  if (stick) chatLog.scrollTop = chatLog.scrollHeight;
  curJv = null;
  imgBubble = { d, pics, status };
  return imgBubble;
}
export function showImageStatus(text) {
  if (text) {
    const b = ensureImgBubble();
    b.status.hidden = false; b.status.textContent = text;
    if (nearBottom()) chatLog.scrollTop = chatLog.scrollHeight;
    return;
  }
  if (!imgBubble) return;  // drawing is over: drop the status line, and the whole bubble if nothing was drawn
  imgBubble.status.remove();
  if (!imgBubble.pics.children.length) imgBubble.d.remove();
  imgBubble = null;
}
const drawn = new Map();  // picture name -> { im, keep, setKept }, so words can update the buttons
export function addImage(name) {
  const b = ensureImgBubble();
  const src = BASE + '/image/' + encodeURIComponent(name);
  const cell = document.createElement('div'); cell.className = 'drawn1';
  const im = document.createElement('img');
  im.src = src; im.alt = 'Picture Jarvis drew'; im.title = 'Click to enlarge';
  im.addEventListener('click', () => openBig(src));
  const stick = nearBottom();
  im.addEventListener('load', () => { if (stick) chatLog.scrollTop = chatLog.scrollHeight; });
  const keep = document.createElement('button');
  keep.type = 'button'; keep.className = 'keepBtn'; keep.textContent = 'Keep';
  let isKept = false;
  const setKept = on => {  // also called when you keep or un-keep by voice or typing
    isKept = on;
    keep.textContent = on ? 'Kept \u2713' : 'Keep';
    keep.classList.toggle('kept', on);
    keep.title = on ? 'Kept. Click to undo.' : 'Keep this picture';
  };
  setKept(false);
  drawn.set(name, { im, keep, setKept });
  keep.addEventListener('click', async () => {
    keep.disabled = true;
    const want = !isKept;  // clicking a kept picture un-keeps it
    try {
      const r = await fetch(BASE + (want ? '/image/keep' : '/image/unkeep'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name })
      });
      const d = await r.json();
      if (d.ok) setKept(want);
      else notify("Couldn't " + (want ? 'keep' : 'un-keep') + ' that picture.');
    } catch (err) {
      pushLog('Image', 'keep request failed');
    }
    keep.disabled = false;
  });
  cell.append(im, keep); b.pics.appendChild(cell);
}

export function setImageKept(name, on) { const d = drawn.get(name); if (d) d.setKept(on); }
export function imagesGone(names) {  // these files were deleted: dim them and stop the Keep button
  for (const name of names) {
    const d = drawn.get(name);
    if (!d) continue;
    d.im.classList.add('gone'); d.im.title = 'This picture was deleted';
    d.keep.disabled = true; d.keep.textContent = 'Deleted';
  }
}
export function jarvisSaid(text) { $('jvTxt').textContent = text; curJv = addMsg('jarvis', text); }
export function jarvisReply(text, append) {
  const el = $('jvTxt');
  el.textContent = append ? el.textContent + text : text;
  if (!append || !curJv) curJv = addMsg('jarvis', text);
  else appendMsg(curJv, text);
}

/* Where a web answer came from. Text only (never HTML), never spoken. */
export function showSources(items) {
  if (!Array.isArray(items) || !items.length) return;
  const d = document.createElement('div'); d.className = 'msg sources';
  const who = document.createElement('div'); who.className = 'who'; who.textContent = 'SOURCES';
  const body = document.createElement('div'); body.className = 'body';
  body.textContent = items.map(s => s.n + '. ' + s.title + ' (' + s.domain + ')').join('\n');
  body.style.whiteSpace = 'pre-line'; body.style.opacity = '0.7'; body.style.fontSize = '0.85em';
  d.append(who, body);
  const stick = nearBottom();
  chatLog.appendChild(d);
  while (chatLog.children.length > 60) chatLog.firstChild.remove();
  if (stick) chatLog.scrollTop = chatLog.scrollHeight;
  curJv = null;
}

/* ---------- click the hub / press Enter or Space on it: toggle listening ---------- */
function toggleListen() {
  if (LIVE.on) fetch(BASE + '/listen', { method: 'POST' }).catch(() => pushLog('Mic', 'request failed'));
  else { clearCaptions(); setState(getState() === 'listening' ? 'idle' : 'listening'); }  // no backend: just preview the animation
}
cv.addEventListener('click', toggleListen);
cv.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleListen(); }
});

/* ---------- push-to-talk key ---------- */
const keyBtn = $('keyBtn');
const prettyKey = k => k === 'media_play_pause' ? 'Play/Pause'
  : k.length <= 3 ? k.toUpperCase() : k.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
export const showKey = k => { keyBtn.textContent = 'Key: ' + prettyKey(k); };
export function loadHotkey() { fetch(BASE + '/hotkey').then(r => r.json()).then(d => showKey(d.key)).catch(() => {}); }
keyBtn.addEventListener('click', () => {
  if (!LIVE.on) return;
  keyBtn.textContent = 'Press a key...';
  fetch(BASE + '/hotkey/learn', { method: 'POST' }).catch(() => pushLog('Key', 'request failed'));
});

/* ---------- hands-free ("Hey Jarvis") ---------- */
const handsBtn = $('handsBtn');
handsBtn.addEventListener('click', () => {
  if (!LIVE.on) return;
  fetch(BASE + '/handsfree', { method: 'POST' })
    .then(r => r.json())
    .then(d => { handsBtn.textContent = 'Hands-free: ' + (d.on ? 'on' : 'off'); handsBtn.classList.toggle('on', d.on); })
    .catch(() => pushLog('Hands-free', 'request failed'));
});

/* ---------- quiet mode (Jarvis stops speaking; everything else works) ---------- */
const quietBtn = document.createElement('button');
quietBtn.id = 'quietBtn';
quietBtn.className = handsBtn.className;  // same look as the Hands-free button
handsBtn.after(quietBtn);
export function showQuiet(on) {
  QUIET.on = !!on;
  quietBtn.textContent = 'Voice: ' + (on ? 'muted' : 'on');
  quietBtn.classList.toggle('on', !!on);
}
export function loadQuiet() { fetch(BASE + '/quiet').then(r => r.json()).then(d => showQuiet(d.on)).catch(() => {}); }
showQuiet(false);
quietBtn.addEventListener('click', () => {
  if (!LIVE.on) return;
  fetch(BASE + '/quiet', { method: 'POST' })
    .then(r => r.json())
    .then(d => showQuiet(d.on))
    .catch(() => pushLog('Quiet', 'request failed'));
});

/* ---------- chat box ---------- */
const chatIn = $('chatIn');
let sending = false;
function fitChat() {  // grows with the text (CSS caps the height) and moves the + to the corner once the text wraps
  const box = $('chat'), cs = getComputedStyle(chatIn);
  const oneLine = parseFloat(cs.lineHeight) + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  chatIn.style.height = 'auto';
  if (!chatIn.value) box.classList.remove('tall');
  else if (chatIn.scrollHeight > oneLine + 2) box.classList.add('tall');
  chatIn.style.height = 'auto';
  chatIn.style.height = chatIn.scrollHeight + 'px';
}
chatIn.addEventListener('input', fitChat);

/* the captions above the box slide up by however much the box has grown, so it never covers them */
const chatBox = $('chat'), picStrip = $('picStrip');
let restH = 0;
new ResizeObserver(() => {
  const h = chatBox.offsetHeight;
  if (!chatBox.classList.contains('tall') && !picStrip.children.length && !chatIn.value) restH = h;  // the resting size
  document.documentElement.style.setProperty('--grow', Math.max(0, h - (restH || h)) + 'px');
}).observe(chatBox);
chatIn.addEventListener('keydown', async e => {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;  // Shift+Enter adds a new line
  e.preventDefault();
  if (sending) return;
  const text = chatIn.value.trim();
  if (!text && !picCount()) return;  // a picture alone is fine: Jarvis describes it
  if (picBusy()) { notify('Picture is still uploading. Try again in a moment.'); return; }
  if (!LIVE.on) { notify("Jarvis isn't connected. Start the backend and try again."); return; }
  sending = true; chatIn.value = ''; fitChat(); chatIn.disabled = true;
  try {
    const r = await fetch(BASE + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    if (!r.ok) pushLog('Chat', 'error ' + r.status);
  } catch (err) {
    pushLog('Chat', 'request failed');
  }
  sending = false; chatIn.disabled = false; chatIn.focus();
});