/* hub.js: the centre of the screen: background glow, geodesic sphere, honeycomb rings,
   segment ring, ripples and the dense particle shell. drawHub(t) draws it all, back to front. */
import { cv, ctx, TAU, clamp, lerp, DPR, cx, cy, U, S, mood, boot, P, rgb, col } from './core.js';

let frameMic = 0, frameEnv = 0;  // fake mic/voice levels that drive the ring while listening/speaking

/* ---------- geodesic sphere ---------- */
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
function icosphere(level) {
  const t = (1 + Math.sqrt(5)) / 2;
  const V = [[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]].map(norm);
  let F = [[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
           [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
  for (let l = 0; l < level; l++) {
    const cache = new Map();
    const mid = (a, b) => {
      const k = a < b ? a + '_' + b : b + '_' + a;
      if (cache.has(k)) return cache.get(k);
      V.push(norm([(V[a][0]+V[b][0])/2, (V[a][1]+V[b][1])/2, (V[a][2]+V[b][2])/2]));
      cache.set(k, V.length - 1); return V.length - 1;
    };
    const nf = [];
    for (const [a, b, c] of F) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    F = nf;
  }
  const seen = new Set(), E = [];
  for (const f of F) for (let i = 0; i < 3; i++) {
    const a = f[i], b = f[(i + 1) % 3], k = a < b ? a * 5000 + b : b * 5000 + a;
    if (!seen.has(k)) { seen.add(k); E.push([a, b]); }
  }
  return { V, E };
}
const GEO = icosphere(3);
const PX = new Float32Array(GEO.V.length), PY = new Float32Array(GEO.V.length), PZ = new Float32Array(GEO.V.length);
const EB = [[], [], [], [], [], []];

function drawSphere(t, a) {
  if (a <= .002) return;
  const sR = .345 * U * (.75 + .25 * a);
  ctx.save(); ctx.globalAlpha = a;
  const g = ctx.createRadialGradient(cx - sR * .25, cy - sR * .25, sR * .1, cx, cy, sR);
  g.addColorStop(0, col(P.sf0, .42)); g.addColorStop(1, col(P.sf1, .9));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, sR, 0, TAU); ctx.fill();

  const ry = S.rotY * Math.PI / 180, cyw = Math.cos(ry), syw = Math.sin(ry);
  const tilt = .38, ct = Math.cos(tilt), st = Math.sin(tilt);
  const disp = .07 * Math.max(0, mood.energy - .1) + .03 * mood.speak * frameEnv;
  const V = GEO.V;
  for (let i = 0; i < V.length; i++) {
    const v = V[i];
    const d = 1 + disp * Math.sin(v[0] * 5 + v[1] * 4 + t * 3.2) * Math.cos(v[2] * 4 - t * 2.1);
    const x = v[0] * d, y = v[1] * d, z = v[2] * d;
    const x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw;
    const y2 = y * ct - z1 * st, z2 = y * st + z1 * ct;
    const k = 1 / (1 - z2 * .16);
    PX[i] = cx + x1 * sR * k; PY[i] = cy + y2 * sR * k; PZ[i] = z2;
  }
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, sR, 0, TAU); ctx.clip();
  for (let b = 0; b < 6; b++) EB[b].length = 0;
  const E = GEO.E, th = mood.think;
  for (let i = 0; i < E.length; i++) {
    const p = E[i][0], q = E[i][1];
    const za = (PZ[p] + PZ[q]) * .25 + .5;
    let val = .10 + .85 * za * za;
    if (th > .01) {
      const w = Math.sin((PY[p] + PY[q]) / sR * 1.6 - t * 5);
      if (w > 0) val += .55 * th * w * w * (.4 + .6 * za);
    }
    EB[Math.min(5, Math.floor(val * 6))].push(i);
  }
  ctx.lineWidth = DPR;
  for (let b = 0; b < 6; b++) {
    if (!EB[b].length) continue;
    ctx.strokeStyle = col(P.light, ((b + .5) / 6) * .9);
    ctx.beginPath();
    for (const i of EB[b]) { const p = E[i][0], q = E[i][1]; ctx.moveTo(PX[p], PY[p]); ctx.lineTo(PX[q], PY[q]); }
    ctx.stroke();
  }
  ctx.fillStyle = col(P.light, .65);
  for (let i = 0; i < V.length; i++) if (PZ[i] > .15) ctx.fillRect(PX[i] - DPR * .6, PY[i] - DPR * .6, DPR * 1.2, DPR * 1.2);
  ctx.restore();

  ctx.shadowColor = col(P.main, .8); ctx.shadowBlur = 12 * DPR;
  ctx.strokeStyle = col(P.white, .95); ctx.lineWidth = 2.2 * DPR;
  ctx.beginPath(); ctx.arc(cx, cy, sR, 0, TAU); ctx.stroke();
  ctx.restore();
}

/* ---------- honeycomb rings ---------- */
function hexRing(r, n, rot, alpha, t, offset) {
  const step = TAU / n, s = (r * step) / 1.75;
  ctx.lineWidth = DPR;
  for (let i = 0; i < n; i++) {
    const a = rot + (i + offset) * step - Math.PI / 2;
    const sh = .5 + .5 * Math.sin(i * .7 + t * 1.1 + r * .02);
    const hx = cx + Math.cos(a) * r, hy = cy + Math.sin(a) * r;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const b = a + k * TAU / 6, px = hx + Math.cos(b) * s, py = hy + Math.sin(b) * s;
      k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
    if (sh > .82) { ctx.fillStyle = col(P.hex, alpha * .35); ctx.fill(); }
    ctx.strokeStyle = col(P.hex, alpha * (.35 + .65 * sh)); ctx.stroke();
  }
}
function drawHex(t, a) {
  if (a <= .002) return;
  const rot = S.hexRot * Math.PI / 180;
  hexRing(.415 * U, 46, rot, .30 * a, t, 0);
  hexRing(.480 * U, 54, -rot, .26 * a, t, .5);
  hexRing(.835 * U, 110, -rot, .22 * a, t, 0);
  hexRing(.870 * U, 118, rot, .18 * a, t, .5);
}

/* ---------- blue segment ring ---------- */
function drawSegments(t, a) {
  if (a <= .002) return;
  const N = 72, T = 4, step = TAU / N, gap = step * .14, e = mood.energy;
  const base = .57 * U, th = .048 * U, tg = .008 * U, rot = S.segRot * Math.PI / 180, grow = .9 + .1 * a;
  const c0 = rgb(P.seg0), c1 = rgb(P.seg1), scanA = t * 2.2;
  for (let i = 0; i < N; i++) {
    const a0 = rot + i * step, phi = a0 + step / 2;
    const prof = .5 + .5 * Math.cos(phi + Math.PI / 2);
    const n1 = Math.sin(phi * 5 + t * .8), n2 = Math.sin(phi * 9 - t * 1.3 + 1.7), n3 = Math.sin(i * 2.7 + t * 8);
    let lvl = .22 + .5 * prof + .16 * (n1 * .6 + n2 * .4) + e * .18 * n3;
    lvl += mood.speak * frameEnv * .3 * (.5 + .5 * Math.sin(i * .5 - t * 9));
    lvl += mood.listen * frameMic * .3 * (.5 + .5 * Math.sin(i * .9 + t * 6));
    if (mood.scan > .01) {
      const d = Math.abs(((phi - scanA + Math.PI) % TAU + TAU) % TAU - Math.PI);
      lvl += mood.scan * .75 * Math.exp(-d * d / .12);
    }
    lvl = clamp(lvl, .05, 1);
    for (let k = 0; k < T; k++) {
      const fa = clamp(lvl * T - k, 0, 1), q = k / (T - 1);
      const r0 = (base + k * (th + tg)) * grow, r1 = r0 + th * grow;
      ctx.fillStyle = `rgba(${lerp(c0[0], c1[0], q) | 0},${lerp(c0[1], c1[1], q) | 0},${lerp(c0[2], c1[2], q) | 0},${(.10 + .62 * fa) * a})`;
      ctx.beginPath();
      ctx.arc(cx, cy, r1, a0 + gap / 2, a0 + step - gap / 2);
      ctx.arc(cx, cy, r0, a0 + step - gap / 2, a0 + gap / 2, true);
      ctx.closePath(); ctx.fill();
    }
  }
  ctx.strokeStyle = col(P.hex, .2 * a); ctx.lineWidth = DPR;
  [.565, .81].forEach(r => { ctx.beginPath(); ctx.arc(cx, cy, r * U * grow, 0, TAU); ctx.stroke(); });
}

function drawRipples(t) {
  if (mood.speak < .02) return;
  for (let i = 0; i < 3; i++) {
    const p = (t * .45 + i / 3) % 1, r = (.35 + p * .62) * U;
    ctx.strokeStyle = col(P.main, (1 - p) * .5 * mood.speak * boot.sphere);
    ctx.lineWidth = DPR * (2.2 - p * 1.6);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
  }
}

/* ---------- particle shell ---------- */
const BINS = 720;
const DENS = 4;  // dot density (about 18.4k dots)
const LAYERS = [
  { R: .90, base: 1100, spread: .010, size: 1.0, alpha: .55, line: .16,
    harm: [[2,.022,.3,1],[3,.016,1.9,-1],[5,.011,4.1,2],[8,.006,2.2,-3]] },
  { R: .95, base: 1500, spread: .014, size: 1.0, alpha: .60, line: .20,
    harm: [[2,.028,2.1,-1],[3,.022,.7,1],[4,.016,5.2,-2],[7,.009,3.3,3]] },
  { R: 1.0, base: 2000, spread: .020, size: 1.2, alpha: .50, line: .28,
    harm: [[2,.035,4.0,1],[3,.026,3.1,-1],[5,.018,.4,1],[6,.010,1.2,-2]] }
];
LAYERS.forEach(L => { L.wob = new Float32Array(BINS); });

export function buildShell() {
  for (const L of LAYERS) {
    const per = Math.round(L.base * DENS / 3);
    L.bk = [];
    for (let b = 0; b < 3; b++) {
      const bin = new Uint16Array(per), sx = new Float32Array(per), co = new Float32Array(per), off = new Float32Array(per);
      for (let i = 0; i < per; i++) {
        const th = Math.random() * TAU;
        const g = Math.random() + Math.random() + Math.random() - 1.5;
        bin[i] = Math.floor(th / TAU * BINS) % BINS;
        sx[i] = Math.sin(th); co[i] = Math.cos(th);
        off[i] = g * L.spread * (1 + 1.8 * Math.pow(Math.abs(Math.sin(th)), 3));
      }
      L.bk.push({ n: per, bin, sx, co, off });
    }
  }
}

function drawShell(t, a) {
  if (a <= .002) return;
  const sc = (.86 + .14 * a) * mood.pull;
  const ampNow = mood.amp * (1 + .5 * mood.listen * frameMic);
  for (const L of LAYERS) {
    for (let j = 0; j < BINS; j++) {
      const th = j / BINS * TAU; let sum = 0;
      for (const h of L.harm) sum += h[1] * Math.sin(h[0] * th + h[2] + h[3] * S.phase);
      L.wob[j] = sum * ampNow;
    }
    ctx.strokeStyle = col(P.line, L.line * a); ctx.lineWidth = DPR * 1.2;
    ctx.beginPath();
    for (let j = 0; j <= BINS; j += 4) {
      const jj = j % BINS, th = jj / BINS * TAU, r = (L.R + L.wob[jj]) * U * sc;
      const x = cx + Math.sin(th) * r, y = cy - Math.cos(th) * r;
      j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath(); ctx.stroke();

    ctx.globalCompositeOperation = 'lighter';
    const s = DPR * L.size, wob = L.wob, R = L.R;
    for (let b = 0; b < 3; b++) {
      const B = L.bk[b];
      ctx.fillStyle = col(P.main, [.3, .55, .85][b] * L.alpha * a);
      for (let i = 0; i < B.n; i++) {
        const r = (R + wob[B.bin[i]] + B.off[i]) * U * sc;
        ctx.fillRect(cx + B.sx[i] * r, cy - B.co[i] * r, s, s);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

/* ---------- the whole hub, back to front ---------- */
function drawBackground() {
  const w = cv.width, h = cv.height;
  ctx.fillStyle = '#01080a'; ctx.fillRect(0, 0, w, h);
  const g = ctx.createRadialGradient(w * .3, h * .78, 0, w * .3, h * .78, Math.max(w, h) * .75);
  g.addColorStop(0, col(P.bg, .6)); g.addColorStop(1, col(P.bg, 0));
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const c = ctx.createRadialGradient(cx, cy, 0, cx, cy, U * 1.3);
  c.addColorStop(0, col(P.glow, .12)); c.addColorStop(1, col(P.glow, 0));
  ctx.fillStyle = c; ctx.fillRect(0, 0, w, h);
}
export function drawHub(t) {
  frameMic = clamp((Math.abs(Math.sin(t * 6.3)) * .6 + Math.abs(Math.sin(t * 2.1 + 1)) * .4) * (.6 + .4 * Math.random()), 0, 1);
  frameEnv = Math.abs(Math.sin(t * 7.4) * Math.sin(t * 2.6 + .5)) * (.7 + .3 * Math.random());
  drawBackground();
  drawHex(t, boot.seg);
  drawSegments(t, boot.seg);
  drawShell(t, boot.shell);
  drawRipples(t);
  drawSphere(t, boot.sphere);
}