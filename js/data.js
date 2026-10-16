/* data.js: live data from the backend. link.js writes it; the instruments and readouts read it.
   These are plain objects/arrays that get mutated in place, so every module sees the same copy. */

export const LIVE = { on: false };                       // true while the WebSocket is connected
export const M = { vram: 0, vramMax: 12, ram: 0, ramMax: 32, cpu: 0, temp: 0, ctx: 0 };
export const PERF = { model: '', name: '', ttft: null, tps: null, ctxMax: 8 };
export const WX = { items: [], alerts: [], alertKeys: new Set(), wi: 0 };
export const GIT = [];                                   // repo status rows
export const EV = [];                                    // calendar events: { n, t, end, allDay }