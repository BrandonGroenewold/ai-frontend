/* core.js: shared helpers, canvas and view size, palette, and the animated state objects.
   DPR, cx, cy and U are live bindings: other modules import them and always see the
   current value. Only resizeView() below changes them. */

export const $ = id => document.getElementById(id);
export const cv = $('c');
export const ctx = cv.getContext('2d');
export const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export let DPR = 1, cx = 0, cy = 0, U = 0;
const base = { cx: 0, cy: 0, U: 0 };
/* where the hub sits while the artifact panel is open: an offset as a fraction of the canvas, plus a scale.
   art.js tweens this. 0, 0, 1 is the normal centered hub. */
export const view = { x: 0, y: 0, s: 1 };
export function resizeView() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(innerWidth * DPR); cv.height = Math.round(innerHeight * DPR);
  base.cx = cv.width / 2; base.cy = cv.height * .455;
  base.U = Math.min(innerWidth * .28, innerHeight * .275) * DPR;
  hubView(false);
}
/* hubView(true) moves cx, cy, U to the hub's placement; hubView(false) puts them back for everything else */
export function hubView(on) {
  cx = base.cx + (on ? view.x * cv.width : 0);
  cy = base.cy + (on ? view.y * cv.height : 0);
  U = base.U * (on ? view.s : 1);
}

/* main.js fills this in so state.js can redraw without importing the scene (reduced-motion mode) */
export const hooks = { draw: () => {} };

/* ---------- animated state (anime.js tweens these) ---------- */
export const S    = { rotY: 0, segRot: 0, hexRot: 0, phase: 0 };
export const mood = { energy: .15, amp: 1, pull: 1, spin: 1, scan: 0, speak: 0, listen: 0, think: 0, k: 0 };
export const boot = { sphere: 0, seg: 0, shell: 0, hud: 0 };

/* ---------- palette: teal <-> amber (k = 0 local, 1 Claude) ---------- */
export const P = {
  main:  [[80,222,205],[255,176,84]],  light: [[207,255,247],[255,236,206]],
  white: [[240,255,252],[255,246,232]], seg0:  [[28,96,150],[150,76,18]],
  seg1:  [[84,182,208],[244,180,78]],   hex:   [[70,200,190],[220,152,66]],
  bg:    [[6,58,52],[74,42,6]],         glow:  [[20,120,110],[140,84,14]],
  sf0:   [[38,120,112],[150,96,30]],    sf1:   [[2,18,20],[22,13,2]],
  line:  [[90,225,210],[255,190,100]]
};
export const rgb = p => [lerp(p[0][0], p[1][0], mood.k), lerp(p[0][1], p[1][1], mood.k), lerp(p[0][2], p[1][2], mood.k)];
export const col = (p, a) => { const c = rgb(p); return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`; };
export const FONT = 'Bahnschrift, "Segoe UI", system-ui, sans-serif';