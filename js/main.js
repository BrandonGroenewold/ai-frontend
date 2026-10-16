/* main.js: entry point. Wires the scene together, runs the intro animation and the frame loop. */
/* global anime */
import { TAU, reduce, S, mood, boot, hooks, resizeView, hubView } from './core.js';
import { drawHub, buildShell } from './hub.js';
import { drawHud } from './instruments.js';
import { updateDom } from './readouts.js';
import './ui.js';
import { connect } from './link.js';

function draw(t, dt) {
  hubView(true);   // the hub moves aside while an artifact is open
  drawHub(t);
  hubView(false);
  drawHud(dt, boot.hud);
}
hooks.draw = draw;

function resize() {
  resizeView();
  if (reduce) draw(0, 0);
}
addEventListener('resize', resize);
resize(); buildShell(); connect();

if (reduce) {
  // reduced motion: one static frame, no intro or loops
  boot.sphere = boot.seg = boot.shell = boot.hud = 1;
  document.querySelectorAll('.p, #ctl').forEach(e => e.style.opacity = 1);
  updateDom(1e6); draw(0, 0);
} else {
  /* ---------- anime.js: intro + endless loops ---------- */
  anime({ targets: boot, sphere: 1, duration: 1400, easing: 'easeOutCubic' });
  anime({ targets: boot, seg: 1, duration: 1800, delay: 500, easing: 'easeOutCubic' });
  anime({ targets: boot, shell: 1, duration: 2400, delay: 900, easing: 'easeOutExpo' });
  anime({ targets: boot, hud: 1, duration: 1800, delay: 1700, easing: 'easeOutCubic' });
  anime({ targets: ['#tl', '#tr', '#bl', '#br', '#ctl'], opacity: [0, 1], duration: 1200, delay: anime.stagger(120, { start: 1800 }), easing: 'easeOutCubic' });

  const loop = (prop, to, ms) => anime({ targets: S, [prop]: to, duration: ms, easing: 'linear', loop: true });
  loop('segRot', -360, 140000); loop('hexRot', 360, 180000); loop('phase', TAU, 16000);

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    S.rotY = (S.rotY + dt * 12 * mood.spin) % 360;
    updateDom(now); draw(now / 1000, dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}