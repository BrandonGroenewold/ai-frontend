/* link.js: the live WebSocket link to the backend. Each message type updates the shared data
   (data.js), the state machine, the ticker or the conversation, then the render loop shows it. */
import { $ } from './core.js';
import { LIVE, M, PERF, WX, GIT, EV } from './data.js';
import { PRE, setState } from './state.js';
import { pushLog, notice } from './instruments.js';
import { renderGit } from './readouts.js';
import { clearCaptions, youSaid, jarvisSaid, jarvisReply, showKey, loadHotkey } from './ui.js';
import { onArtifact } from './art.js';

const WS_URL = new URLSearchParams(location.search).get('ws') || 'ws://localhost:8000/ws/hud';
let ws, retryTimer;
export function send(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }

function onMsg(m) {
  switch (m.type) {
    case 'state':
      if (!PRE[m.value]) break;
      if (m.value === 'listening' && !m.followup) clearCaptions();
      setState(m.value, m.brain === 'claude' ? 'claude' : 'local');
      break;
    case 'transcript':
      if (m.role === 'you') youSaid(m.text); else jarvisSaid(m.text);
      break;
    case 'reply':
      jarvisReply(m.text, m.append);
      break;
    case 'model':
      PERF.model = m.value || ''; if (m.name) PERF.name = m.name;
      break;
    case 'perf':
      if (typeof m.ttft === 'number') PERF.ttft = m.ttft;
      if (typeof m.tps === 'number') PERF.tps = m.tps;
      break;
    case 'weather':
      $('wxLine').textContent = m.line || '';
      $('wxWind').textContent = m.wind || '';
      WX.items = m.ticker || [];
      WX.alerts = m.alerts || [];
      for (const a of WX.alerts) if (!WX.alertKeys.has(a[0] + '|' + a[1])) notice(a);  // new alert: show it right away
      WX.alertKeys = new Set(WX.alerts.map(a => a[0] + '|' + a[1]));
      break;
    case 'git':
      GIT.splice(0, GIT.length, ...(m.repos || []));
      renderGit();
      break;
case 'hotkey': showKey(m.value); break;
    case 'artifact_open': case 'artifact_chunk': case 'artifact_done':
    case 'artifact_error': case 'artifact_close':
      onArtifact(m); break;
    case 'calendar':
      EV.splice(0, EV.length, ...(m.events || []).filter(e => !e.allDay));
      break;
    case 'log': pushLog(m.label || 'Event', m.detail || ''); break;
    case 'metrics':
      for (const k of ['vram', 'vramMax', 'ram', 'ramMax', 'cpu', 'temp', 'ctx']) if (typeof m[k] === 'number') M[k] = m[k];
      if (typeof m.ctxMax === 'number') PERF.ctxMax = m.ctxMax;
      break;
  }
}

export function connect() {
  try { ws = new WebSocket(WS_URL); } catch (e) { return; }
  ws.onopen = () => { LIVE.on = true; setState('idle'); pushLog('Link', 'backend connected'); loadHotkey(); };
  ws.onmessage = e => { try { onMsg(JSON.parse(e.data)); } catch (_) {} };
  ws.onclose = () => { LIVE.on = false; clearTimeout(retryTimer); retryTimer = setTimeout(connect, 3000); };
  ws.onerror = () => ws.close();
}