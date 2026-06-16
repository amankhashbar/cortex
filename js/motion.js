/* =============================================================
   NeuroReadiness — motion.js
   Motion artifact detection from the MPU6050 accelerometer.
   Consumes "sample" events; emits "motion" with a boolean flag and
   the current jerk magnitude. The PPG processor uses this to penalise
   signal quality, and the recorder logs the fraction of clean time.
   ============================================================= */
(function () {
  "use strict";
  const NR = window.NR;
  const M = NR.math;
  const SR = NR.config.SAMPLE_RATE_HZ;

  class MotionDetector {
    constructor() {
      this.win = new M.RingBuffer(SR); // ~1 s of acceleration magnitude
      this.flag = false;
      this.cleanSamples = 0;
      this.totalSamples = 0;
      this.THRESH = 0.08; // std of |a| (in g) above which we call it motion
    }

    reset() {
      this.win = new M.RingBuffer(SR);
      this.flag = false;
      this.cleanSamples = 0;
      this.totalSamples = 0;
    }

    onSample(s) {
      // Magnitude minus 1 g gravity → deviation from "still".
      const mag = Math.sqrt(s.ax * s.ax + s.ay * s.ay + s.az * s.az);
      this.win.push(Math.abs(mag - 1));
      const variability = M.std(this.win.toArray());
      const wasFlag = this.flag;
      this.flag = variability > this.THRESH;

      this.totalSamples++;
      if (!this.flag) this.cleanSamples++;

      if (this.flag !== wasFlag) {
        NR.bus.emit("motion", { flag: this.flag, variability });
      }
    }

    cleanFraction() {
      return this.totalSamples ? this.cleanSamples / this.totalSamples : 1;
    }

    snapshot() {
      return { flag: this.flag, cleanFraction: this.cleanFraction() };
    }
  }

  NR.MotionDetector = MotionDetector;
  console.log("[NR] motion loaded");
})();
