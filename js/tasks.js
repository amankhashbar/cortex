/* =============================================================
   NeuroReadiness — tasks.js
   The three cognitive tasks. Each one:
     • renders into a stage element
     • logs timestamped events via NR.bus.emit("task:event", …) so the
       recorder can align reaction times with the PPG stream
     • resolves a Promise with a metrics object when complete

   Tasks:
     PVT    — Psychomotor Vigilance Test → alertness / sustained attention
     Stroop — colour–word interference   → cognitive control / inhibition
     NBack  — 2-back letters             → working memory
   ============================================================= */
(function () {
  "use strict";
  const NR = window.NR;
  const M = NR.math;
  const C = NR.config;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const now = () => performance.now();

  // Inverse normal CDF (Acklam approximation) for d-prime.
  function normInv(p) {
    if (p <= 0) p = 1e-6;
    if (p >= 1) p = 1 - 1e-6;
    const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
    const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
    const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
    const plow = 0.02425, phigh = 1 - plow;
    let q, r;
    if (p < plow) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
    } else if (p <= phigh) {
      q = p - 0.5; r = q*q;
      return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
    } else {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
    }
  }

  function logEvent(type, payload) {
    NR.bus.emit("task:event", { type, t: Math.round(now()), ...payload });
  }

  // --- Shared instruction/countdown screen ---------------------------------
  function instructions(stage, { title, body, beginLabel = "Begin" }) {
    return new Promise((resolve) => {
      stage.innerHTML = `
        <div class="task-instructions">
          <h3>${title}</h3>
          <div class="task-body">${body}</div>
          <button class="btn btn-primary" id="begin-btn">${beginLabel}</button>
        </div>`;
      NR.dom.el("#begin-btn", stage).addEventListener("click", async () => {
        await countdown(stage);
        resolve();
      });
    });
  }

  async function countdown(stage) {
    for (const n of ["3", "2", "1"]) {
      stage.innerHTML = `<div class="countdown">${n}</div>`;
      await sleep(650);
    }
    stage.innerHTML = "";
  }

  /* ============================ PVT ============================ */
  class PVT {
    constructor(stage) { this.stage = stage; this.name = "pvt"; }

    async run() {
      await instructions(this.stage, {
        title: "Reaction time",
        body: `<p>Stare at the box. When the timer appears and starts counting,
               press <kbd>Space</kbd> (or tap) as fast as you can.</p>
               <p class="muted">Don't anticipate — guessing early is recorded as a false start.
               ${C.PVT_TRIALS} trials, about two minutes.</p>`,
      });
      logEvent("pvt:start");

      const rts = [];
      let falseStarts = 0;

      for (let i = 0; i < C.PVT_TRIALS; i++) {
        const result = await this._trial(i + 1);
        if (result.falseStart) falseStarts++;
        else rts.push(result.rt);
        await sleep(450);
      }

      logEvent("pvt:end");
      return this._metrics(rts, falseStarts);
    }

    _trial(idx) {
      const stage = this.stage;
      return new Promise((resolve) => {
        const isi = C.PVT_MIN_ISI_MS + Math.random() * (C.PVT_MAX_ISI_MS - C.PVT_MIN_ISI_MS);
        stage.innerHTML = `
          <div class="pvt-arena" tabindex="0">
            <div class="pvt-counter waiting" id="pvt-counter">·</div>
            <div class="task-counter">Trial ${idx} / ${C.PVT_TRIALS}</div>
          </div>`;
        const arena = NR.dom.el(".pvt-arena", stage);
        const counter = NR.dom.el("#pvt-counter", stage);
        arena.focus();

        let stimT = null, raf = null, armed = false, done = false, maxTimer = null;
        let waitTimer = setTimeout(() => {
          armed = true;
          stimT = now();
          counter.classList.remove("waiting");
          counter.classList.add("active");
          logEvent("pvt:stimulus", { trial: idx });
          const draw = () => {
            if (done) return;
            counter.textContent = Math.round(now() - stimT);
            raf = requestAnimationFrame(draw);
          };
          draw();
          // Safety: if no response comes, end the trial as a long lapse so the
          // session can't stall.
          maxTimer = setTimeout(() => {
            if (done) return;
            done = true;
            cancelAnimationFrame(raf);
            cleanup();
            counter.textContent = "no response";
            counter.classList.add("lapse");
            logEvent("pvt:response", { trial: idx, rt: 3000, lapse: true, noResponse: true });
            setTimeout(() => resolve({ rt: 3000 }), 450);
          }, 3000);
        }, isi);

        const respond = () => {
          if (done) return;
          if (!armed) {
            // Pressed before the stimulus → false start.
            done = true;
            clearTimeout(waitTimer);
            cleanup();
            counter.textContent = "too soon";
            counter.classList.add("error");
            logEvent("pvt:response", { trial: idx, falseStart: true });
            setTimeout(() => resolve({ falseStart: true }), 500);
            return;
          }
          done = true;
          const rt = now() - stimT;
          cancelAnimationFrame(raf);
          cleanup();
          counter.textContent = `${Math.round(rt)} ms`;
          counter.classList.toggle("lapse", rt > C.PVT_LAPSE_MS);
          logEvent("pvt:response", { trial: idx, rt: Math.round(rt), lapse: rt > C.PVT_LAPSE_MS });
          setTimeout(() => resolve({ rt }), 500);
        };

        const onKey = (e) => { if (e.code === "Space") { e.preventDefault(); respond(); } };
        const onClick = () => respond();
        const cleanup = () => {
          if (maxTimer) clearTimeout(maxTimer);
          window.removeEventListener("keydown", onKey);
          arena.removeEventListener("click", onClick);
        };
        window.addEventListener("keydown", onKey);
        arena.addEventListener("click", onClick);
      });
    }

    _metrics(rts, falseStarts) {
      const lapses = rts.filter((r) => r > C.PVT_LAPSE_MS).length;
      const valid = rts.filter((r) => r <= 3000);
      const meanRT = M.mean(valid);
      // Mean of the slowest 10% — a classic PVT fatigue indicator.
      const sorted = [...valid].sort((a, b) => a - b);
      const slowCount = Math.max(1, Math.round(sorted.length * 0.1));
      const slowest10 = M.mean(sorted.slice(-slowCount));
      return {
        task: "pvt",
        trials: rts.length,
        meanRT,
        medianRT: M.median(valid),
        rtSD: M.std(valid),
        rtCV: meanRT ? M.std(valid) / meanRT : 0,
        lapses,
        falseStarts,
        slowest10pct: slowest10,
      };
    }
  }

  /* =========================== Stroop =========================== */
  const STROOP_COLORS = [
    { name: "RED", hex: "#e5484d" },
    { name: "GREEN", hex: "#46a758" },
    { name: "BLUE", hex: "#3b82f6" },
    { name: "YELLOW", hex: "#f5a524" },
  ];

  class Stroop {
    constructor(stage) { this.stage = stage; this.name = "stroop"; }

    async run() {
      await instructions(this.stage, {
        title: "Colour & word",
        body: `<p>A word will appear in a colour. Respond with the <strong>ink colour</strong>,
               not the word itself. Use the buttons or keys
               <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd>.</p>
               <p class="muted">${C.STROOP_TRIALS} trials. Be quick but accurate.</p>`,
      });
      logEvent("stroop:start");

      const trials = this._buildTrials();
      const records = [];
      for (let i = 0; i < trials.length; i++) {
        records.push(await this._trial(trials[i], i + 1));
        await sleep(350);
      }
      logEvent("stroop:end");
      return this._metrics(records);
    }

    _buildTrials() {
      const trials = [];
      const half = Math.floor(C.STROOP_TRIALS / 2);
      for (let i = 0; i < C.STROOP_TRIALS; i++) {
        const congruent = i < half;
        const wordIdx = Math.floor(Math.random() * 4);
        let inkIdx = wordIdx;
        if (!congruent) {
          do { inkIdx = Math.floor(Math.random() * 4); } while (inkIdx === wordIdx);
        }
        trials.push({ congruent, word: STROOP_COLORS[wordIdx], ink: STROOP_COLORS[inkIdx] });
      }
      // Shuffle.
      for (let i = trials.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [trials[i], trials[j]] = [trials[j], trials[i]];
      }
      return trials;
    }

    _trial(trial, idx) {
      const stage = this.stage;
      return new Promise((resolve) => {
        const buttons = STROOP_COLORS
          .map((c, i) => `<button class="stroop-btn" data-i="${i}"><span class="key">${i + 1}</span>${c.name}</button>`)
          .join("");
        stage.innerHTML = `
          <div class="stroop-arena">
            <div class="stroop-word" style="color:${trial.ink.hex}">${trial.word.name}</div>
            <div class="stroop-options">${buttons}</div>
            <div class="task-counter">Trial ${idx} / ${C.STROOP_TRIALS}</div>
          </div>`;
        const startT = now();
        logEvent("stroop:stimulus", { trial: idx, congruent: trial.congruent });
        let done = false;
        const deadline = setTimeout(() => {
          if (done) return;
          done = true;
          cleanup();
          logEvent("stroop:response", { trial: idx, rt: 4000, correct: false, congruent: trial.congruent, timeout: true });
          setTimeout(() => resolve({ rt: 4000, correct: false, congruent: trial.congruent }), 250);
        }, 4000);

        const answer = (chosenIdx) => {
          if (done) return;
          done = true;
          const rt = now() - startT;
          const correct = STROOP_COLORS[chosenIdx].name === trial.ink.name;
          cleanup();
          logEvent("stroop:response", { trial: idx, rt: Math.round(rt), correct, congruent: trial.congruent });
          const btn = NR.dom.el(`.stroop-btn[data-i="${chosenIdx}"]`, stage);
          if (btn) btn.classList.add(correct ? "correct" : "wrong");
          setTimeout(() => resolve({ rt, correct, congruent: trial.congruent }), 300);
        };

        const onKey = (e) => {
          const n = parseInt(e.key, 10);
          if (n >= 1 && n <= 4) answer(n - 1);
        };
        const onClick = (e) => {
          const b = e.target.closest(".stroop-btn");
          if (b) answer(parseInt(b.dataset.i, 10));
        };
        const cleanup = () => {
          clearTimeout(deadline);
          window.removeEventListener("keydown", onKey);
          stage.removeEventListener("click", onClick);
        };
        window.addEventListener("keydown", onKey);
        stage.addEventListener("click", onClick);
      });
    }

    _metrics(records) {
      const con = records.filter((r) => r.congruent && r.correct).map((r) => r.rt);
      const inc = records.filter((r) => !r.congruent && r.correct).map((r) => r.rt);
      const accuracy = records.filter((r) => r.correct).length / records.length;
      const meanCon = M.mean(con), meanInc = M.mean(inc);
      return {
        task: "stroop",
        trials: records.length,
        meanRT_congruent: meanCon,
        meanRT_incongruent: meanInc,
        interference: meanInc - meanCon, // the Stroop effect (ms)
        accuracy,
      };
    }
  }

  /* ============================ 2-back ============================ */
  const NBACK_LETTERS = ["C", "H", "K", "L", "Q", "R", "T", "W"];

  class NBack {
    constructor(stage) { this.stage = stage; this.name = "nback"; }

    async run() {
      await instructions(this.stage, {
        title: `${C.NBACK_N}-back memory`,
        body: `<p>Letters appear one at a time. Press <kbd>Space</kbd> (or tap Match)
               whenever the current letter is the <strong>same as the one ${C.NBACK_N} letters ago</strong>.</p>
               <p class="muted">Do nothing when it isn't a match. ${C.NBACK_TRIALS} letters.</p>`,
      });
      logEvent("nback:start");

      const seq = this._buildSequence();
      const records = [];
      for (let i = 0; i < seq.length; i++) {
        records.push(await this._trial(seq, i));
      }
      logEvent("nback:end");
      return this._metrics(records);
    }

    _buildSequence() {
      const n = C.NBACK_N;
      const seq = [];
      for (let i = 0; i < C.NBACK_TRIALS; i++) {
        let letter;
        if (i >= n && Math.random() < C.NBACK_TARGET_RATE) {
          letter = seq[i - n]; // forced match
        } else {
          do { letter = NBACK_LETTERS[Math.floor(Math.random() * NBACK_LETTERS.length)]; }
          while (i >= n && letter === seq[i - n]); // avoid accidental match
        }
        seq.push(letter);
      }
      return seq;
    }

    _trial(seq, i) {
      const stage = this.stage;
      const n = C.NBACK_N;
      const isTarget = i >= n && seq[i] === seq[i - n];
      return new Promise((resolve) => {
        stage.innerHTML = `
          <div class="nback-arena">
            <div class="nback-letter">${seq[i]}</div>
            <button class="btn btn-ghost nback-match">Match <span class="key">Space</span></button>
            <div class="task-counter">${i + 1} / ${seq.length}</div>
          </div>`;
        const startT = now();
        logEvent("nback:stimulus", { idx: i, isTarget });
        let responded = false, rt = null;

        const respond = () => {
          if (responded) return;
          responded = true;
          rt = now() - startT;
          NR.dom.el(".nback-letter", stage).classList.add("pressed");
          logEvent("nback:response", { idx: i, rt: Math.round(rt) });
        };
        const onKey = (e) => { if (e.code === "Space") { e.preventDefault(); respond(); } };
        const onClick = (e) => { if (e.target.closest(".nback-match")) respond(); };
        window.addEventListener("keydown", onKey);
        stage.addEventListener("click", onClick);

        // Stimulus on screen 2 s, then 0.5 s blank.
        setTimeout(() => {
          window.removeEventListener("keydown", onKey);
          stage.removeEventListener("click", onClick);
          resolve({ idx: i, isTarget, responded, rt, scored: i >= n });
        }, 2000);
      });
    }

    _metrics(records) {
      const scored = records.filter((r) => r.scored);
      let hits = 0, misses = 0, fa = 0, cr = 0;
      const hitRTs = [];
      scored.forEach((r) => {
        if (r.isTarget && r.responded) { hits++; if (r.rt) hitRTs.push(r.rt); }
        else if (r.isTarget && !r.responded) misses++;
        else if (!r.isTarget && r.responded) fa++;
        else cr++;
      });
      const targets = hits + misses, nonTargets = fa + cr;
      // Loglinear correction avoids infinite d-prime at ceiling/floor.
      const hitRate = (hits + 0.5) / (targets + 1);
      const faRate = (fa + 0.5) / (nonTargets + 1);
      const dPrime = normInv(hitRate) - normInv(faRate);
      const accuracy = (hits + cr) / (scored.length || 1);
      return {
        task: "nback",
        trials: scored.length,
        hits, misses, falseAlarms: fa, correctRejections: cr,
        accuracy,
        dPrime,
        meanRT: M.mean(hitRTs),
      };
    }
  }

  NR.tasks = { PVT, Stroop, NBack };
  console.log("[NR] tasks loaded");
})();
