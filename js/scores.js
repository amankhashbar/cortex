/* =============================================================
   NeuroReadiness — scores.js
   Turns raw metrics into six 0–100 readouts:
       alertness, cognitiveControl, workingMemory,
       physiologicalLoad, electrodermalArousal, dataConfidence

   IMPORTANT: every formula here is a transparent heuristic, not a
   validated clinical instrument. The cutoffs are documented inline so
   a reviewer can see exactly how each number is produced — and the
   confidence score exists precisely so nobody over-reads the rest.
   ============================================================= */
(function () {
  "use strict";
  const NR = window.NR;
  const M = NR.math;

  function alertness(pvt) {
    if (!pvt || !pvt.trials) return { value: NaN, why: "no PVT data" };
    // Fast, consistent responses with no lapses → high alertness.
    // Mapping: 220 ms → 100, 500 ms → 0 (typical alert vs. drowsy band).
    const rtScore = M.remap(pvt.meanRT, 220, 500, 100, 0);
    const lapsePenalty = pvt.lapses * 8;       // each lapse is costly
    const fsPenalty = pvt.falseStarts * 5;     // impulsive errors
    const cvPenalty = M.remap(pvt.rtCV, 0.1, 0.4, 0, 25); // instability
    const value = M.clamp(rtScore - lapsePenalty - fsPenalty - cvPenalty);
    return {
      value,
      why: `mean RT ${Math.round(pvt.meanRT)} ms, ${pvt.lapses} lapse(s), ` +
           `${pvt.falseStarts} false start(s)`,
    };
  }

  function cognitiveControl(stroop) {
    if (!stroop || !stroop.trials) return { value: NaN, why: "no Stroop data" };
    // Smaller interference + high accuracy → stronger inhibitory control.
    // Mapping: 0 ms interference → 100, 200 ms → 0.
    const interfScore = M.remap(stroop.interference, 0, 200, 100, 0);
    const value = M.clamp(interfScore * stroop.accuracy);
    return {
      value,
      why: `interference ${Math.round(stroop.interference)} ms, ` +
           `accuracy ${Math.round(stroop.accuracy * 100)}%`,
    };
  }

  function workingMemory(nback) {
    if (!nback || !nback.trials) return { value: NaN, why: "no 2-back data" };
    // Use d-prime (sensitivity) as the backbone, blended with raw accuracy.
    // d' of 0 → chance, d' of ~3 → near-ceiling discrimination.
    const dScore = M.remap(nback.dPrime, 0, 3, 0, 100);
    const accScore = M.remap(nback.accuracy, 0.5, 1.0, 0, 100);
    const value = M.clamp(0.6 * dScore + 0.4 * accScore);
    return {
      value,
      why: `d′ ${nback.dPrime.toFixed(2)}, accuracy ${Math.round(nback.accuracy * 100)}%, ` +
           `${nback.falseAlarms} false alarm(s)`,
    };
  }

  function physiologicalLoad(baseline, task) {
    // Higher = more load. Driven by HR elevation + HRV (RMSSD) suppression
    // relative to the resting baseline. This is a coarse autonomic proxy.
    if (!baseline || isNaN(baseline.hr) || !task || isNaN(task.hr)) {
      return { value: NaN, why: "insufficient PPG for load estimate" };
    }
    const hrDelta = task.hr - baseline.hr;
    const loadHR = M.remap(hrDelta, 0, 25, 0, 100); // +25 bpm → full
    let loadHRV = 0;
    if (baseline.rmssd > 0 && !isNaN(task.rmssd)) {
      const drop = (baseline.rmssd - task.rmssd) / baseline.rmssd;
      loadHRV = M.remap(drop, 0, 0.6, 0, 100); // 60% RMSSD drop → full
    }
    const value = M.clamp(0.5 * loadHR + 0.5 * loadHRV);
    return {
      value,
      why: `HR ${Math.round(baseline.hr)}→${Math.round(task.hr)} bpm, ` +
           `RMSSD proxy ${Math.round(baseline.rmssd)}→${Math.round(task.rmssd)} ms`,
    };
  }

  function electrodermalArousal(baseline, task) {
    if (!task || !task.present || !isFinite(task.arousal)) {
      return { value: NaN, why: "GSR not present" };
    }
    const taskArousal = task.arousal;
    const delta = baseline && isFinite(baseline.arousal) ? taskArousal - baseline.arousal : NaN;
    const deltaPart = isFinite(delta) ? M.remap(delta, -5, 25, -10, 25) : 0;
    const value = M.clamp(taskArousal + deltaPart);
    return {
      value,
      why: isFinite(delta)
        ? `task arousal ${Math.round(taskArousal)}, ${delta >= 0 ? "+" : ""}${Math.round(delta)} vs baseline`
        : `task arousal ${Math.round(taskArousal)}; no baseline GSR`,
    };
  }

  // ----- Cognition–physiology fusion ----------------------------------------
  // The cognitive scores measure behaviour; physiology (load, arousal) measures
  // the autonomic state behind it. Run side by side they answer different
  // questions. fusedReadiness brings them together WITHOUT letting physiology
  // quietly rewrite the headline:
  //   • value — the cognitive composite, nudged by a small, confidence-scaled,
  //             hard-capped physiological term (low signal confidence → ~no nudge).
  //   • state — a fatigue-vs-stress-vs-strain label (the thing a phone-only test
  //             can't produce), from cognition level × physiology.
  //   • why   — plain-language account of how physiology moved (or didn't move)
  //             the read. No black-box adjustments.
  // `norm`, when supplied, is the person's own rolling stats for load/arousal
  // ({load:{mean,sd,n}, arousal:{mean,sd,n}}), so physiology is read as deviation
  // from THEIR normal rather than an absolute. Without it, the load/arousal
  // scores are already session-baseline-relative, so we fall back to those.
  const MAX_PHYSIO_NUDGE = 8; // points; physiology can never swing the headline more

  // → roughly -1..+1 ("how far above/below your normal"), or null if unknown.
  function deviation(value, norm) {
    if (!isFinite(value)) return null;
    if (norm && isFinite(norm.mean) && norm.n >= 3) {
      const sd = isFinite(norm.sd) && norm.sd > 3 ? norm.sd : 12; // floor avoids early hypersensitivity
      return M.clamp((value - norm.mean) / (2 * sd), -1, 1);
    }
    return M.clamp((value - 50) / 50, -1, 1); // no personal norm yet: centre on 50
  }

  function fusedReadiness(scores, norm) {
    const cog = NR.scores.composite(scores);
    if (!isFinite(cog)) {
      return { value: NaN, state: "unknown", label: "No reading", why: "no cognitive data yet", trust: NaN, adjustment: 0 };
    }
    const conf = scores && scores.dataConfidence && scores.dataConfidence.value;
    const trust = isFinite(conf) ? conf : NaN;
    // Confidence gate: physiology earns influence only as the signal becomes
    // trustworthy. Below ~40 confidence it contributes essentially nothing.
    const w = isFinite(trust) ? M.clamp((trust - 40) / 45, 0, 1) : 0;

    const loadDev = deviation(scores.physiologicalLoad && scores.physiologicalLoad.value, norm && norm.load);
    const arDev = deviation(scores.electrodermalArousal && scores.electrodermalArousal.value, norm && norm.arousal);
    const havePhysio = loadDev !== null || arDev !== null;

    // Nudge: elevated load/arousal vs your normal means the cognitive number is
    // being held up at autonomic cost, so sustainable readiness is a little
    // lower. We only ever dampen for strain (never inflate), keep it small, and
    // scale the whole thing by confidence.
    const strain = Math.max(loadDev || 0, arDev || 0);
    const adjustment = havePhysio ? -Math.round(MAX_PHYSIO_NUDGE * Math.max(0, strain) * w) : 0;
    const value = M.clamp(cog + adjustment);

    const cogLow = cog < 55;
    const arousedHigh = (arDev !== null && arDev >= 0.4) || (loadDev !== null && loadDev >= 0.4);
    const arousedLow = arDev !== null && arDev <= -0.1 && (loadDev === null || loadDev < 0.2);

    let state, label, why;
    if (!havePhysio) {
      state = "behaviour-only"; label = "Behaviour only";
      why = "Cognitive scores only — no usable physiology this session, so this is a behavioural read.";
    } else if (cogLow && arousedHigh) {
      state = "stress"; label = "Over-aroused";
      why = "Performance is down while arousal/load sit above your normal — a pattern that fits stress or over-arousal more than plain fatigue. Not diagnostic.";
    } else if (cogLow && arousedLow) {
      state = "fatigue"; label = "Under-recovered";
      why = "Performance is down without elevated arousal — consistent with fatigue or under-recovery. Worth tracking against sleep and workload.";
    } else if (!cogLow && arousedHigh) {
      state = "strain"; label = "Performing under strain";
      why = "Scores held up, but arousal/load are above your normal — you're performing at a higher autonomic cost, which may not be sustainable.";
    } else {
      state = "clear"; label = "Clear";
      why = "Cognitive scores and physiology are both near your normal — a clean, well-aligned read.";
    }
    if (adjustment !== 0) why += ` Headline nudged ${adjustment} for elevated physiological strain (confidence-scaled).`;
    else if (havePhysio && w < 0.15 && isFinite(trust)) why += " Signal confidence is low, so physiology is context only and didn't move the number.";

    return { value, state, label, why, trust, adjustment };
  }

  // Back-compat surface for the results UI: a {present, text, state, label}
  // bundle derived from the fused read. `present` is false only when there is
  // no usable physiology to contextualise the cognitive scores.
  function arousalContext(fused) {
    if (!fused || fused.state === "behaviour-only" || fused.state === "unknown") {
      return { present: false, text: "", state: fused ? fused.state : "unknown", label: fused ? fused.label : "" };
    }
    return { present: true, text: fused.why, state: fused.state, label: fused.label };
  }

  // The keystone score. If this is low, treat everything else as indicative
  // only. Built from mean signal quality, motion-clean fraction, and how much
  // of the protocol actually completed.
  function dataConfidence({ meanQuality, cleanFraction, taskCompletion, mode }) {
    const sq = meanQuality;                       // 0–100, from ppg.js
    const motion = cleanFraction * 100;           // 0–100
    const completion = taskCompletion * 100;      // 0–100
    let value = M.clamp(0.55 * sq + 0.25 * motion + 0.20 * completion);
    // Temple/forehead PPG is an unvalidated, superficial-perfusion mode —
    // it is intrinsically noisier, so confidence is capped to keep the
    // claim honest no matter how clean the trace happens to look.
    const notes = [];
    if (mode === "temple") {
      value = Math.min(value, 65);
      notes.push("temple mode is experimental — superficial perfusion only, not cerebral blood flow");
    }
    if (sq < 40) notes.push("low perfusion / weak PPG");
    if (motion < 70) notes.push("motion detected during capture");
    if (completion < 100) notes.push("protocol partially completed");
    return {
      value,
      why: `signal ${Math.round(sq)}, motion-clean ${Math.round(motion)}%, ` +
           `completion ${Math.round(completion)}%`,
      notes,
    };
  }

  NR.scores = {
    // A single transparent "readiness" headline for trend tracking. It's a
    // weighted blend of the three cognitive scores (alertness weighted most,
    // since PVT is the most state-sensitive and practice-resistant). Returns
    // NaN if no cognitive scores are available. Physiological load and data
    // confidence are deliberately kept OUT of this number and shown alongside
    // it instead — load is context, confidence is a gate, neither is "readiness".
    composite(s) {
      if (!s) return NaN;
      const parts = [
        { v: s.alertness && s.alertness.value, w: 0.4 },
        { v: s.cognitiveControl && s.cognitiveControl.value, w: 0.3 },
        { v: s.workingMemory && s.workingMemory.value, w: 0.3 },
      ].filter((p) => typeof p.v === "number" && isFinite(p.v));
      if (!parts.length) return NaN;
      const wsum = parts.reduce((a, p) => a + p.w, 0);
      return Math.round(parts.reduce((a, p) => a + p.v * p.w, 0) / wsum);
    },

    // The consumer-facing headline. Same transparent blend as composite()
    // (Focus 0.4 · Control 0.3 · Memory 0.3 — Load & Confidence stay OUT of
    // it), but returns {value, why, trust} so the UI can present it honestly.
    // `trust` mirrors data confidence: a low reading does NOT change the value
    // — it tells you how much to believe it (surfaced as the amber chip). This
    // keeps the number comparable across sessions while honoring the gate.
    cortexScore(s) {
      const value = this.composite(s);
      if (!isFinite(value)) return { value: NaN, why: "no cognitive data yet", trust: NaN };
      const conf = s && s.dataConfidence && s.dataConfidence.value;
      const trust = isFinite(conf) ? conf : NaN;
      const lowTrust = isFinite(trust) && trust < 40;
      return {
        value,
        why: "Focus, Control and Memory, weighted 0.4 / 0.3 / 0.3" +
          (lowTrust ? " — low signal confidence, read as indicative only" : ""),
        trust,
      };
    },

    // The fusion seam. Consumes the already-computed scores plus the person's
    // optional rolling norm and returns {value, state, label, why, trust}.
    fusedReadiness,

    compute({ pvt, stroop, nback, baselinePPG, taskPPG, baselineGSR, taskGSR, quality, cleanFraction, taskCompletion, mode, norm }) {
      const scores = {
        alertness: alertness(pvt),
        cognitiveControl: cognitiveControl(stroop),
        workingMemory: workingMemory(nback),
        physiologicalLoad: physiologicalLoad(baselinePPG, taskPPG),
        electrodermalArousal: electrodermalArousal(baselineGSR, taskGSR),
        dataConfidence: dataConfidence({
          meanQuality: quality,
          cleanFraction,
          taskCompletion,
          mode,
        }),
      };
      scores.fusedReadiness = fusedReadiness(scores, norm || null);
      scores.arousalContext = arousalContext(scores.fusedReadiness);
      return scores;
    },
  };
  console.log("[NR] scores loaded");
})();
