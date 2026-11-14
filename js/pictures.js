/* pictures.js: attach pictures (button, paste, drag and drop), shrink them in the browser,
   upload them to the backend, and show the waiting pictures above the input box. */
import { $ } from './core.js';
import { LIVE } from './data.js';
import { pushLog } from './instruments.js';

const BASE = 'http://localhost:8000';  // same address as ui.js
const MAX_PICS = 3;     // keep equal to pic_max in hardware.py
const MAX_PX = 1920;    // keep equal to PIC_MAX_PX in config.py
const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const JSON_HEAD = { 'Content-Type': 'application/json' };
const FULL = MAX_PICS + ' pictures is the max. Remove one to add another.';

/* A small message above the chat box. Also written to the ticker log. */
let toast = null, toastTimer = 0;
export function notify(msg) {
  if (!toast) { toast = document.createElement('div'); toast.id = 'toast'; toast.setAttribute('role', 'status'); $('chat').appendChild(toast); }
  toast.textContent = msg; toast.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('on'), 4000);
  pushLog('Picture', msg);
}

const strip = $('picStrip');
const held = [];   // pictures the backend is holding for the next message: { id, url }
let uploading = 0;

export const count = () => held.length;
export const busy = () => uploading > 0;

/* Shrink so the long side is at most MAX_PX. PNGs stay PNG (text stays sharp) unless they are huge. */
async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_PX / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);  // transparent areas become white
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const png = file.type === 'image/png';
  let blob = await new Promise(r => c.toBlob(r, png ? 'image/png' : 'image/jpeg', 0.9));
  if (png && blob && blob.size > 3000000) blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
  return blob;
}

const toDataUrl = blob => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob);
});

export async function addFiles(files) {
  for (const f of files) {
    if (!TYPES.includes(f.type)) { notify("That file type can't be read. Use a PNG, JPG, WebP or GIF."); continue; }
    if (held.length + uploading >= MAX_PICS) { notify(FULL); break; }
    if (!LIVE.on) { notify("Jarvis isn't connected. Start the backend and try again."); break; }
    uploading++;
    try {
      const blob = await shrink(f);
      const r = await fetch(BASE + '/picture', { method: 'POST', headers: JSON_HEAD, body: JSON.stringify({ data: await toDataUrl(blob) }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { notify(d.detail || 'The upload failed. Try again.'); continue; }
      held.push({ id: d.id, url: URL.createObjectURL(blob) });
      render();
    } catch (err) {
      notify("That picture couldn't be read.");
    } finally {
      uploading--;
    }
  }
}

function render() {
  strip.textContent = '';
  for (const p of held) {
    const cell = document.createElement('div'); cell.className = 'pic';
    const im = document.createElement('img'); im.src = p.url; im.alt = 'attached picture'; im.title = 'Click to enlarge';
    im.addEventListener('click', () => openBig(p.url));
    const x = document.createElement('span'); x.className = 'x'; x.textContent = '\u00D7'; x.title = 'Remove';
    x.setAttribute('role', 'button');
    x.addEventListener('click', () => removePic(p.id));
    cell.append(im, x); strip.appendChild(cell);
  }
}

function removePic(id) {
  const i = held.findIndex(p => p.id === id);
  if (i < 0) return;
  const [p] = held.splice(i, 1);
  render();
  fetch(BASE + '/picture/remove', { method: 'POST', headers: JSON_HEAD, body: JSON.stringify({ id }) })
    .catch(() => pushLog('Picture', 'remove request failed'));
  setTimeout(() => URL.revokeObjectURL(p.url), 0);
}

/* The backend picked these up with a message: they leave the strip. Returns their addresses for the chat bubble. */
export function takeUsed(ids) {
  const used = [];
  for (const id of ids) {
    const i = held.findIndex(p => p.id === id);
    if (i >= 0) used.push(held.splice(i, 1)[0]);  // { id, url }
  }
  render();
  return used;
}

/* The backend forgets waiting pictures whenever the page connects, so the strip must too. */
export function resetPics() { held.length = 0; render(); }

/* ---------- click a picture to see it larger ---------- */
let box = null, big = null;
let zoom = 1, panX = 0, panY = 0;
function paintBig() {
  big.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')';
  big.style.cursor = zoom > 1 ? 'grab' : 'zoom-in';
}
function zoomAt(k, cx, cy) {  // zoom to k, keeping the point under (cx, cy) (relative to the centre) where it is
  k = Math.min(8, Math.max(1, k));
  panX = cx - (cx - panX) * (k / zoom); panY = cy - (cy - panY) * (k / zoom);
  zoom = k;
  if (zoom === 1) { panX = 0; panY = 0; }
  paintBig();
}
export function openBig(url) {
  if (!box) {
    box = document.createElement('div'); box.id = 'picBox';
    big = document.createElement('img'); big.draggable = false;
    const x = document.createElement('span'); x.id = 'picClose'; x.textContent = '\u00D7'; x.title = 'Close (Esc)';
    x.setAttribute('role', 'button');
    x.addEventListener('click', () => box.classList.remove('on'));
    box.append(big, x);
    document.body.appendChild(box);
    box.addEventListener('click', e => { if (e.target === box) box.classList.remove('on'); });  // only the dark area closes it
    const centre = e => { const r = box.getBoundingClientRect(); return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2]; };
    box.addEventListener('wheel', e => {
      e.preventDefault();  // zoom the picture, never the page behind it (this also catches Ctrl+wheel)
      const [cx, cy] = centre(e);
      zoomAt(zoom * Math.exp(-e.deltaY * 0.002), cx, cy);
    }, { passive: false });
    let drag = null;
    big.addEventListener('pointerdown', e => {
      drag = { sx: e.clientX, sy: e.clientY, x: e.clientX - panX, y: e.clientY - panY, moved: false };
      big.setPointerCapture(e.pointerId);
    });
    big.addEventListener('pointermove', e => {
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return;  // still just a click
      drag.moved = true;
      if (zoom > 1) { panX = e.clientX - drag.x; panY = e.clientY - drag.y; big.style.cursor = 'grabbing'; paintBig(); }
    });
    big.addEventListener('pointerup', e => {
      const d = drag; drag = null;
      if (d && !d.moved) { const [cx, cy] = centre(e); zoomAt(zoom > 1 ? 1 : 2.5, cx, cy); }  // a click toggles the zoom
      else paintBig();
    });
    big.addEventListener('pointercancel', () => { drag = null; paintBig(); });
  }
  zoom = 1; panX = 0; panY = 0;
  big.src = url; paintBig();
  box.classList.add('on');
}
addEventListener('keydown', e => { if (e.key === 'Escape' && box) box.classList.remove('on'); });

/* ---------- way 1: the + button ---------- */
$('picBtn').addEventListener('click', () => $('picFile').click());
$('picFile').addEventListener('change', e => { const files = [...e.target.files]; e.target.value = ''; addFiles(files); });

/* ---------- way 2: Ctrl+V or right-click Paste ---------- */
addEventListener('paste', e => {
  const files = [...(e.clipboardData ? e.clipboardData.items : [])]
    .filter(i => i.kind === 'file' && i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean);
  if (!files.length) return;  // plain text still pastes into the box as usual
  e.preventDefault();
  addFiles(files);
});

/* ---------- way 3: drag and drop anywhere on the page ---------- */
const hint = document.createElement('div'); hint.id = 'dropHint'; hint.textContent = 'Drop a picture to attach it';
document.body.appendChild(hint);
let depth = 0;
const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
addEventListener('dragenter', e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); depth++;
  hint.textContent = held.length + uploading >= MAX_PICS ? FULL : 'Drop a picture to attach it';
  hint.classList.add('on');
});
addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
addEventListener('dragleave', e => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) hint.classList.remove('on'); });
addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); depth = 0; hint.classList.remove('on');
  addFiles([...e.dataTransfer.files]);
});