/* state.js: the idle / listening / thinking / speaking state machine.
   setState() updates the labels and tweens the hub's "mood" values with anime.js. */
/* global anime */
import { $, cv, mood, reduce, hooks } from './core.js';

let state = 'idle', brain = 'local';
export const getState = () => state;

export const PRE = {
  idle:      { energy: .15, amp: 1,   pull: 1,   spin: 1,   scan: 0, speak: 0, listen: 0, think: 0 },
  listening: { energy: .8,  amp: 1.8, pull: 1,   spin: 1,   scan: 0, speak: 0, listen: 1, think: 0 },
  thinking:  { energy: .5,  amp: .7,  pull: .93, spin: 4,   scan: 1, speak: 0, listen: 0, think: 1 },
  speaking:  { energy: .7,  amp: 1.5, pull: 1,   spin: 1.5, scan: 0, speak: 1, listen: 0, think: 0 }
};
const LBL = { idle: 'Standing by', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking' };

export function setState(s, b = 'local') {
  state = s; brain = b;
  cv.setAttribute('aria-pressed', String(s === 'listening'));
  $('stateLbl').textContent = LBL[s];
  $('brainLbl').textContent = b === 'claude' ? 'Escalated to Claude · remote' : 'Local model · on-device';
  anime.remove(mood);
  anime(Object.assign({ targets: mood, duration: 1000, easing: 'easeInOutSine',
    update: reduce ? () => hooks.draw(0, 0) : undefined }, PRE[s], { k: b === 'claude' ? 1 : 0 }));
}