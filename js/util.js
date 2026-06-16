/* =============================================================
   NeuroReadiness — util.js
   Shared namespace, small math/DSP helpers, and an event bus.
   No build step: this is a classic script. Everything hangs off
   the global `NR` object so files can load via plain <script> tags
   (works by double-clicking app.html in Chrome).
   ============================================================= */
(function () {
  "use strict";

  // Global namespace ---------------------------------------------------------
  const NR = (window.NR = window.NR || {});

  NR.config = {
    SAMPLE_RATE_HZ: 50, // simulated and firmware streaming rate
    BASELINE_SECONDS: 60, // resting PPG capture before tasks
    PVT_TRIALS: 20, // psychomotor vigilance trials
    PVT_MIN_ISI_MS: 2000, // random wait window between PVT stimuli
    PVT_MAX_ISI_MS: 8000,
    PVT_LAPSE_MS: 500, // reaction time above this counts as a lapse
    STROOP_TRIALS: 24, // half congruent, half incongruent
    NBACK_N: 2,
    NBACK_TRIALS: 25,
    NBACK_TARGET_RATE: 0.3, // fraction of trials that are 2-back matches
    SERIAL_BAUD: 115200, // must match the ESP32 firmware
  };

  // Tiny event bus -----------------------------------------------------------
  // Used so the sensor layer, analytics, and UI stay decoupled. The day the
  // real ESP32 is plugged in, only the sensor source changes — every listener
  // downstream keeps working unchanged.
  NR.bus = (function () {
    const listeners = {};
    return {
      on(event, fn) {
        (listeners[event] = listeners[event] || []).push(fn);
        return () => this.off(event, fn);
      },
      off(event, fn) {
        if (!listeners[event]) return;
        listeners[event] = listeners[event].filter((f) => f !== fn);
      },
      emit(event, payload) {
        (listeners[event] || []).forEach((fn) => {
          try {
            fn(payload);
          } catch (e) {
            console.error(`[bus] listener for "${event}" threw`, e);
          }
        });
      },
    };
  })();

  // Math / DSP helpers -------------------------------------------------------
  const M = (NR.math = {});

  M.clamp = (x, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));

  M.mean = (arr) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  M.std = (arr) => {
    if (arr.length < 2) return 0;
    const m = M.mean(arr);
    const v = arr.reduce((a, b) => a + (b - m) * (b - m), 0) / (arr.length - 1);
    return Math.sqrt(v);
  };

  M.median = (arr) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };

  // Root mean square of successive differences — the standard short-term
  // HRV metric. On PPG (not ECG) it is strictly speaking PRV, so we label it
  // "RMSSD proxy" everywhere in the UI.
  M.rmssd = (intervalsMs) => {
    if (intervalsMs.length < 2) return 0;
    let sum = 0;
    for (let i = 1; i < intervalsMs.length; i++) {
      const d = intervalsMs[i] - intervalsMs[i - 1];
      sum += d * d;
    }
    return Math.sqrt(sum / (intervalsMs.length - 1));
  };

  // Linear remap with clamping. Handy for turning raw metrics into 0–100.
  M.remap = (x, inLo, inHi, outLo, outHi) => {
    if (inHi === inLo) return outLo;
    const t = (x - inLo) / (inHi - inLo);
    return M.clamp(outLo + t * (outHi - outLo), Math.min(outLo, outHi), Math.max(outLo, outHi));
  };

  // Gaussian noise (Box–Muller). Used by the mock sensor.
  M.randn = () => {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  // Simple ring buffer for streaming samples ---------------------------------
  M.RingBuffer = class {
    constructor(size) {
      this.size = size;
      this.buf = new Float64Array(size);
      this.idx = 0;
      this.count = 0;
    }
    push(v) {
      this.buf[this.idx] = v;
      this.idx = (this.idx + 1) % this.size;
      this.count = Math.min(this.count + 1, this.size);
    }
    // Returns values oldest→newest as a plain Array.
    toArray() {
      const out = new Array(this.count);
      const start = this.count < this.size ? 0 : this.idx;
      for (let i = 0; i < this.count; i++) {
        out[i] = this.buf[(start + i) % this.size];
      }
      return out;
    }
    last() {
      return this.count ? this.buf[(this.idx - 1 + this.size) % this.size] : 0;
    }
  };

  // DOM helpers --------------------------------------------------------------
  NR.dom = {
    el: (sel, root = document) => root.querySelector(sel),
    all: (sel, root = document) => Array.from(root.querySelectorAll(sel)),
    show: (node) => node && node.classList.remove("hidden"),
    hide: (node) => node && node.classList.add("hidden"),
  };

  NR.fmt = {
    ms: (x) => (x == null || isNaN(x) ? "—" : `${Math.round(x)} ms`),
    bpm: (x) => (x == null || isNaN(x) ? "—" : `${Math.round(x)}`),
    pct: (x) => (x == null || isNaN(x) ? "—" : `${Math.round(x)}%`),
    score: (x) => (x == null || isNaN(x) ? "—" : `${Math.round(x)}`),
  };

  console.log("[NR] util loaded");
})();
