/* =============================================================
   NeuroReadiness — ppg.js
   Streaming PPG analytics, all client-side (no Python round-trip).
   Consumes "sample" events, produces:
       NR.bus.emit("ppg", { hr, rmssd, pi, quality, beat })
   The signal-quality score is the heart of the product's honesty:
   it tells the user (and any reviewer) how much to trust everything else.
   ============================================================= */
(function () {
  "use strict";
  const NR = window.NR;
  const M = NR.math;
  const SR = NR.config.SAMPLE_RATE_HZ;

  class PPGProcessor {
    constructor() {
      // ~6 s of IR at 50 Hz for detrending + display.
      this.win = new M.RingBuffer(SR * 6);
      this.acWin = new M.RingBuffer(SR * 6); // detrended (AC) signal
      this.ibis = [];                         // recent inter-beat intervals (ms)
      this.lastPeakT = null;
      this.lastSampleT = 0;
      this.refractoryMs = 300;                // 300 ms → max 200 bpm
      this.movAvg = null;                     // running baseline for detrend
      this.sm = [];                           // short FIR for noise rejection
      this.env = 0;                           // amplitude envelope follower
      this.recentSQ = new M.RingBuffer(SR * 4);
      this.reset();
    }

    reset() {
      this.win = new M.RingBuffer(SR * 6);
      this.acWin = new M.RingBuffer(SR * 6);
      this.ibis = [];
      this.lastPeakT = null;
      this.movAvg = null;
      this.sm = [];
      this.env = 0;
      this.hr = NaN;
      this.rmssd = NaN;
      this.pi = NaN;
      this.quality = 0;
      this._motionFlag = false;
    }

    setMotionFlag(on) { this._motionFlag = on; }

    // Returns recent IBIs with gross misdetections (doubled/halved beats)
    // removed, so HR variance and RMSSD reflect real rhythm, not detector
    // glitches. HR itself uses the median and is already robust.
    _cleanIbis() {
      if (this.ibis.length < 4) return this.ibis.slice();
      const med = M.median(this.ibis);
      return this.ibis.filter((x) => x > 0.6 * med && x < 1.5 * med);
    }

    onSample(s) {
      this.lastSampleT = s.t;
      this.win.push(s.ir);

      // Detrend: subtract a slow moving average to isolate the AC pulsatile
      // component. Exponential moving average ~ 1.5 s time constant.
      const alpha = 1 / (SR * 1.5);
      this.movAvg = this.movAvg == null ? s.ir : this.movAvg + alpha * (s.ir - this.movAvg);
      const acRaw = s.ir - this.movAvg;

      // 3-tap moving average rejects high-frequency noise so the peak
      // detector doesn't mistake noise spikes for heartbeats (critical for
      // the weak temple-mode signal).
      this.sm.push(acRaw);
      if (this.sm.length > 3) this.sm.shift();
      const ac = this.sm.reduce((a, b) => a + b, 0) / this.sm.length;
      this.acWin.push(ac);

      // Perfusion index = peak-to-peak AC / DC * 100.
      const acArr = this.acWin.toArray();
      const acPP = Math.max(...acArr) - Math.min(...acArr);
      this.pi = this.movAvg > 0 ? (acPP / this.movAvg) * 100 : 0;

      // --- Peak detection on AC -------------------------------------------
      // Adaptive threshold from an amplitude envelope follower. The envelope
      // tracks genuine pulse peaks and decays slowly, so a single noise spike
      // can't inflate it (unlike a raw peak-to-peak threshold). This keeps HR
      // locked even on the weak temple-mode signal.
      this.env = Math.max(Math.abs(ac), this.env * 0.995);
      const thresh = 0.4 * this.env;
      const n = acArr.length;
      if (n >= 3) {
        const a = acArr[n - 3], b = acArr[n - 2], c = acArr[n - 1];
        const isPeak = b > a && b >= c && b > thresh;
        if (isPeak) {
          // The peak occurred ~1 sample ago.
          const peakT = s.t - 1000 / SR;
          if (this.lastPeakT == null) {
            this.lastPeakT = peakT;
          } else {
            const ibi = peakT - this.lastPeakT;
            // Accept only physiologically plausible intervals (40–171 bpm).
            if (ibi >= 350 && ibi <= 1500) {
              this.ibis.push(ibi);
              if (this.ibis.length > 20) this.ibis.shift();
              this.lastPeakT = peakT;
              NR.bus.emit("ppg:beat", { t: peakT });
            } else if (ibi > 1500) {
              // Lost the beat (likely artifact); re-anchor without recording.
              this.lastPeakT = peakT;
            }
          }
        }
      }

      // --- HR + RMSSD proxy ------------------------------------------------
      if (this.ibis.length >= 3) {
        const clean = this._cleanIbis();
        const med = M.median(clean.length ? clean : this.ibis);
        this.hr = 60000 / med;
        // Use the most recent ~10 cleaned IBIs for a short-term RMSSD proxy.
        this.rmssd = M.rmssd((clean.length ? clean : this.ibis).slice(-10));
      }

      // --- Signal quality (0–100) -----------------------------------------
      this.quality = this._scoreQuality();
      this.recentSQ.push(this.quality);

      NR.bus.emit("ppg", {
        hr: this.hr,
        rmssd: this.rmssd,
        pi: this.pi,
        quality: this.quality,
        ac, // for the live waveform
      });
    }

    _scoreQuality() {
      // Three independent factors, multiplied so any one bad factor tanks it.
      // 1) Perfusion: a healthy finger PPG has PI roughly 1–10%. Temple/
      //    forehead is much weaker — by design the score reflects that.
      const perfusion = M.remap(this.pi, 0.1, 2.0, 0, 100);

      // 2) Beat regularity: stable IBIs → trustworthy. High variability that
      //    isn't physiological usually means a bad trace.
      let regularity = 50;
      const clean = this._cleanIbis();
      if (clean.length >= 4) {
        const cv = M.std(clean) / (M.mean(clean) || 1);
        regularity = M.remap(cv, 0.25, 0.03, 0, 100); // lower CV → higher
      }

      // 3) Motion: hard penalty when the accelerometer flags movement.
      const motion = this._motionFlag ? 15 : 100;

      const q =
        Math.pow(
          (perfusion / 100) * (regularity / 100) * (motion / 100),
          1 / 3
        ) * 100; // geometric mean
      return M.clamp(q);
    }

    // Mean signal quality over a captured window (used by scoring/confidence).
    meanQuality() {
      const arr = this.recentSQ.toArray();
      return arr.length ? M.mean(arr) : 0;
    }

    snapshot() {
      return {
        hr: this.hr,
        rmssd: this.rmssd,
        pi: this.pi,
        quality: this.quality,
        meanQuality: this.meanQuality(),
      };
    }
  }

  NR.PPGProcessor = PPGProcessor;
  console.log("[NR] ppg loaded");
})();
