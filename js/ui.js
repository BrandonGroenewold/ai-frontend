/* ui.js: everything you click or type into: the hub (listen toggle), push-to-talk key button,
   hands-free button, the conversation panel and the chat box. */
import { $, cv } from './core.js';
import { LIVE } from './data.js';
import { getState, setState } from './state.js';
import { pushLog } from './instruments.js';

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
});

export function clearCaptions() { $('youTxt').textContent = ''; $('jvTxt').textContent = ''; }
export function youSaid(text) {
  $('youTxt').textContent = '\u201C' + text + '\u201D'; $('jvTxt').textContent = '';
  addMsg('you', text); curJv = null;
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

/* ---------- chat box ---------- */
const chatIn = $('chatIn');
let sending = false;
chatIn.addEventListener('keydown', async e => {
  if (e.key !== 'Enter' || sending) return;
  const text = chatIn.value.trim();
  if (!text) return;
  if (!LIVE.on) { pushLog('Chat', 'backend not connected'); return; }
  sending = true; chatIn.value = ''; chatIn.disabled = true;
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