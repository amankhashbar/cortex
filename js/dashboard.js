/* =============================================================
   Cortex — dashboard.js
   The post-sign-in home base. Hash-routed hub shell:
     #/home · #/trends · #/activities · #/journal · #/compete
   Auth-gated: signed in → Supabase (store-remote); guest → local
   IndexedDB; neither → bounced to account.html. Pillars beyond Home
   ship as labelled placeholders this pass. Hand-rolled SVG only.
   ============================================================= */
(function () {
  "use strict";
  var NR = window.NR;
  var view = document.getElementById("view");

  // Consumer-facing metric layer on top of scores.js (internal names unchanged).
  var METRICS = [
    { key: "focus",      name: "Focus",      better: "high",    get: function (s) { return s.scores && s.scores.alertness; } },
    { key: "control",    name: "Control",    better: "high",    get: function (s) { return s.scores && s.scores.cognitiveControl; } },
    { key: "memory",     name: "Memory",     better: "high",    get: function (s) { return s.scores && s.scores.workingMemory; } },
    { key: "load",       name: "Load",       better: "low",     get: function (s) { return s.scores && s.scores.physiologicalLoad; } },
    { key: "arousal",    name: "Arousal",    better: "context", get: function (s) { return s.scores && s.scores.electrodermalArousal; } },
    { key: "confidence", name: "Confidence", better: "high",    get: function (s) { return s.scores && s.scores.dataConfidence; } },
  ];
  var BASELINE_DAYS = 14;
  var state = { sessions: [], signedIn: false, guest: false, user: null };

  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); };
  var num = function (x) { return typeof x === "number" && isFinite(x) ? x : null; };
  var fmt = function (x) { return num(x) == null ? "—" : String(Math.round(x)); };

  // ---- Boot: decide backend, gate, render ----------------------------------
  async function boot() {
    if (NR.auth && NR.auth.enabled) {
      var session = await NR.auth.getSession();
      if (session) {
        state.signedIn = true;
        state.user = session.user;
        NR.store = NR.makeRemoteStore(session.user);
        try { localStorage.removeItem("nr.guest"); } catch (_) {}
      }
    }
    if (!state.signedIn) {
      try { state.guest = localStorage.getItem("nr.guest") === "1"; } catch (_) { state.guest = false; }
      if (!state.guest) { location.replace("account.html"); return; }
    }
    await NR.store.init();
    try { state.sessions = await NR.store.getSessions(); } catch (_) { state.sessions = []; }
    renderAcct();
    window.addEventListener("hashchange", route);
    route();
  }

  // ---- Account chip --------------------------------------------------------
  function renderAcct() {
    var name = state.signedIn && NR.auth ? NR.auth.displayName(state.user) : "Guest";
    document.getElementById("acct-name").textContent = name;
    document.getElementById("acct-avatar").textContent = (name[0] || "Y").toUpperCase();
    var head = document.getElementById("acct-head");
    var sub = document.getElementById("acct-sub");
    var signin = document.getElementById("acct-signin");
    var signout = document.getElementById("acct-signout");
    if (state.signedIn) {
      head.textContent = "Signed in";
      sub.textContent = (state.user && state.user.email) || name;
      signout.classList.remove("cx-hidden");
    } else {
      head.textContent = "Guest mode";
      sub.textContent = "Saved on this device only.";
      signin.classList.remove("cx-hidden");
    }
    var chip = document.getElementById("acct-chip");
    var menu = document.getElementById("acct-menu");
    chip.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = menu.classList.toggle("cx-hidden");
      chip.setAttribute("aria-expanded", open ? "false" : "true");
    });
    document.addEventListener("click", function () { menu.classList.add("cx-hidden"); });
    signout.addEventListener("click", async function () {
      try { await NR.auth.signOut(); } catch (_) {}
      try { localStorage.removeItem("nr.guest"); } catch (_) {}
      location.href = "index.html";
    });
  }

  // ---- Router --------------------------------------------------------------
  var ROUTES = {
    home: renderHome,
    trends: function () { renderTrends(); },
    activities: function () { stub("Activities", "violet", "Suggested ways to improve — cognitive drills and physiological aids, each honestly framed. Coming in the next build.", "🧠"); },
    journal: function () { stub("Journal", "violet", "Log and tag your sessions with notes, and share entries with people you follow. Coming in the next build.", "📓"); },
    compete: function () { stub("Compete", "violet", "Opt-in leaderboards and monthly competitions, ranked on score and improvement — only confidence-qualified sessions count. Coming in the next build.", "🏆"); },
  };
  function currentRoute() { return (location.hash.replace(/^#\//, "") || "home").split("?")[0]; }
  function route() {
    var r = currentRoute();
    if (!ROUTES[r]) r = "home";
    NR.dom.all("#dash-nav a").forEach(function (a) { a.classList.toggle("active", a.getAttribute("data-route") === r); });
    window.scrollTo(0, 0);
    ROUTES[r]();
  }

  // ---- SVG helpers ---------------------------------------------------------
  function ringSVG(value, low) {
    var pct = isFinite(value) ? Math.max(0, Math.min(100, value)) / 100 : 0;
    var off = 326.7 * (1 - pct);
    var stroke = low ? "var(--amber)" : "var(--teal)";
    var glow = low ? "rgba(245,158,11,0.45)" : "rgba(45,212,191,0.5)";
    return '<svg viewBox="0 0 120 120" style="width:100%;height:100%;transform:rotate(-90deg);">' +
      '<circle cx="60" cy="60" r="52" fill="none" stroke="rgba(0,0,0,0.07)" stroke-width="10"/>' +
      '<circle cx="60" cy="60" r="52" fill="none" stroke="' + stroke + '" stroke-width="10" stroke-linecap="round" ' +
      'stroke-dasharray="326.7" stroke-dashoffset="' + off.toFixed(1) + '" style="filter:drop-shadow(0 0 8px ' + glow + ');transition:stroke-dashoffset 1.1s cubic-bezier(.16,1,.3,1);"/>' +
      '</svg>';
  }

  // Sparkline of a metric over time with a faint baseline band.
  function sparkSVG(points, baseline, better) {
    var W = 240, H = 40;
    if (!points.length) return '<svg class="mc-spark" viewBox="0 0 ' + W + ' ' + H + '"></svg>';
    var vals = points.map(function (p) { return p.v; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (baseline.n) { lo = Math.min(lo, baseline.mean - baseline.sd); hi = Math.max(hi, baseline.mean + baseline.sd); }
    if (lo === hi) { lo -= 1; hi += 1; }
    var pad = (hi - lo) * 0.15; lo -= pad; hi += pad;
    var X = function (i) { return points.length > 1 ? (i / (points.length - 1)) * (W - 6) + 3 : W / 2; };
    var Y = function (v) { return 4 + (1 - (v - lo) / (hi - lo)) * (H - 8); };
    var band = "";
    if (baseline.n >= 2) {
      var yt = Y(baseline.mean + baseline.sd), yb = Y(baseline.mean - baseline.sd);
      band = '<rect x="0" y="' + yt.toFixed(1) + '" width="' + W + '" height="' + Math.max(0, yb - yt).toFixed(1) + '" fill="rgba(45,212,191,0.10)"/>';
    }
    var d = "";
    points.forEach(function (p, i) { d += (i === 0 ? "M" : "L") + X(i).toFixed(1) + " " + Y(p.v).toFixed(1) + " "; });
    var last = points[points.length - 1];
    var color = "var(--teal)";
    if (baseline.n && better !== "context") {
      var good = better === "high" ? last.v >= baseline.mean : last.v <= baseline.mean;
      color = good ? "var(--up)" : "var(--down)";
    }
    return '<svg class="mc-spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' + band +
      '<path d="' + d.trim() + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + X(points.length - 1).toFixed(1) + '" cy="' + Y(last.v).toFixed(1) + '" r="2.6" fill="' + color + '"/></svg>';
  }

  function deltaHTML(value, baseline, better) {
    if (!isFinite(value) || baseline.n < 2) return '<span class="trend-flat mc-delta">baseline building</span>';
    var d = Math.round(value - baseline.mean);
    if (better === "context") return '<span class="trend-flat mc-delta">' + (d >= 0 ? "+" : "") + d + " vs normal</span>";
    var good = better === "high" ? d >= 0 : d <= 0;
    var arrow = d === 0 ? "→" : (d > 0 ? "▲" : "▼");
    var cls = d === 0 ? "trend-flat" : (good ? "trend-up" : "trend-down");
    var label = d === 0 ? "on baseline" : (good ? "above" : "below");
    return '<span class="' + cls + ' mc-delta">' + arrow + " " + (d > 0 ? "+" : "") + d + " " + label + "</span>";
  }

  function baselineFor(accessor) {
    var recent = state.sessions.filter(function (s) { return s.timestamp >= Date.now() - BASELINE_DAYS * 864e5; });
    return NR.store.baselineStats(recent.map(accessor));
  }

  // ---- Home ----------------------------------------------------------------
  async function renderHome() {
    state.sessions = await NR.store.getSessions();
    if (!state.sessions.length) return renderEmpty();

    var latest = state.sessions[state.sessions.length - 1];
    var score = latest.readiness;
    var conf = latest.scores && latest.scores.dataConfidence;
    var lowConf = isFinite(conf) && conf < 40;
    var bScore = baselineFor(function (s) { return s.readiness; });
    var confChip = '<span class="conf-chip' + (lowConf ? " low" : "") + '"><span class="dot"></span><i class="ic">' + (lowConf ? "?" : "✓") + '</i>' +
      "Confidence " + fmt(conf) + (lowConf ? " · low" : "") + "</span>";

    var cards = METRICS.map(function (m) {
      var pts = state.sessions.map(function (s) { return { t: s.timestamp, v: m.get(s) }; })
        .filter(function (p) { return num(p.v) != null; }).slice(-12);
      var base = baselineFor(m.get);
      var cur = m.get(latest);
      return '<div class="cx-card glass metric-card">' +
        '<div class="mc-top"><span class="mc-name">' + m.name + '</span><span class="mc-val">' + fmt(cur) + "</span></div>" +
        deltaHTML(cur, base, m.better) +
        sparkSVG(pts, base, m.better) + "</div>";
    }).join("");

    var hour = new Date().getHours();
    var greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    var nm = state.signedIn && NR.auth ? NR.auth.displayName(state.user) : "";

    view.innerHTML =
      '<div class="dash-section-head"><h1 class="greeting">' + greet + (nm ? ", " + esc(nm) : "") + "</h1></div>" +
      '<div class="cx-card glass" style="padding:28px;margin-bottom:24px;display:grid;grid-template-columns:160px 1fr;gap:28px;align-items:center;">' +
        '<div style="position:relative;width:160px;height:160px;">' + ringSVG(score, lowConf) +
          '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">' +
          '<span style="font-family:var(--font-mono);font-weight:600;font-size:46px;line-height:1;color:var(--ink);">' + fmt(score) + "</span>" +
          '<span style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.1em;color:var(--muted);margin-top:3px;">/ 100</span></div></div>' +
        "<div>" +
          '<div class="cx-label" style="margin-bottom:6px;">Cortex Score · today</div>' +
          '<div style="font-family:var(--font-display);font-weight:600;font-size:22px;margin-bottom:8px;">How ready your mind is right now</div>' +
          '<div style="margin-bottom:14px;">' + scoreWhy(score, bScore) + "</div>" +
          confChip +
          '<div style="margin-top:18px;"><a class="cx-btn cx-btn-primary" href="app.html">Run a test</a></div>' +
        "</div>" +
      "</div>" +
      '<div class="dash-section-head"><h2 class="cx-h3">Your metrics</h2><span class="cx-label">vs your ' + BASELINE_DAYS + "-day baseline</span></div>" +
      '<div class="metric-grid">' + cards + "</div>" +
      (state.guest ? guestNudge() : "");
  }

  function scoreWhy(score, base) {
    if (!isFinite(score)) return '<span style="color:var(--ink-2);">Run your first test to set today’s number.</span>';
    if (base.n < 2) return '<span style="color:var(--ink-2);">Building your baseline — a few more sessions and the trend sharpens up.</span>';
    var d = Math.round(score - base.mean);
    var good = d >= 0;
    var arrow = d === 0 ? "→" : good ? "▲" : "▼";
    var cls = d === 0 ? "trend-flat" : good ? "trend-up" : "trend-down";
    return '<span class="' + cls + '">' + arrow + " " + (d > 0 ? "+" : "") + d + '</span> <span style="color:var(--ink-2);">vs your ' + BASELINE_DAYS + "-day normal (" + Math.round(base.mean) + ")</span>";
  }

  function guestNudge() {
    return '<div class="cx-card glass" style="margin-top:24px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;">' +
      '<div><div style="font-family:var(--font-display);font-weight:600;font-size:16px;">You’re in guest mode</div>' +
      '<div style="font-size:13px;color:var(--ink-2);">Sessions stay on this device. Create an account to sync across devices and unlock Journal &amp; Compete.</div></div>' +
      '<a class="cx-btn cx-btn-ghost" href="account.html">Sign in to sync</a></div>';
  }

  function renderEmpty() {
    var ghost = METRICS.map(function (m) {
      return '<div class="cx-card glass metric-card ghost">' +
        '<div class="mc-top"><span class="mc-name">' + m.name + '</span><span class="mc-val">—</span></div>' +
        '<span class="trend-flat mc-delta">No data yet</span>' +
        '<svg class="mc-spark" viewBox="0 0 240 40"><line x1="0" y1="20" x2="240" y2="20" stroke="rgba(0,0,0,0.10)" stroke-width="2" stroke-dasharray="4 5"/></svg></div>';
    }).join("");

    var prompts = [
      { ic: "▶", t: "Run your first test", s: "Five minutes, three tasks, one honest score.", href: "app.html" },
      { ic: "🧠", t: "Try a mental activity", s: "Warm up with a quick cognitive drill.", href: "#/activities" },
      { ic: "🏆", t: "Explore leaderboards", s: "See how readiness ranks — and find friends.", href: "#/compete" },
      { ic: "📓", t: "Start a journal entry", s: "Give your first number some context.", href: "#/journal" },
    ].map(function (p) {
      return '<a class="cx-card glass prompt-card" href="' + p.href + '"><div class="pc-ic">' + p.ic + '</div>' +
        '<div class="pc-title">' + p.t + '</div><div class="pc-sub">' + p.s + "</div></a>";
    }).join("");

    view.innerHTML =
      '<div class="dash-section-head"><h1 class="greeting">Welcome to Cortex</h1></div>' +
      '<div class="cx-card glass" style="padding:28px;margin-bottom:14px;display:grid;grid-template-columns:160px 1fr;gap:28px;align-items:center;">' +
        '<div style="position:relative;width:160px;height:160px;opacity:0.5;">' + ringSVG(0, false) +
          '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">' +
          '<span style="font-family:var(--font-mono);font-weight:600;font-size:40px;color:var(--muted);">--</span>' +
          '<span style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.1em;color:var(--muted);margin-top:3px;">/ 100</span></div></div>' +
        '<div><div class="cx-label" style="margin-bottom:6px;">Cortex Score</div>' +
        '<div style="font-family:var(--font-display);font-weight:600;font-size:22px;margin-bottom:8px;">No reading yet</div>' +
        '<div style="font-size:14px;color:var(--ink-2);max-width:46ch;">Your headline readiness and the six metric trends below fill in as you test. Here’s what you’re about to build.</div></div>' +
      "</div>" +
      '<div class="metric-grid" style="margin-bottom:28px;">' + ghost + "</div>" +
      '<div class="dash-section-head"><h2 class="cx-h3">Make your first move</h2></div>' +
      '<div class="prompt-grid">' + prompts + "</div>" +
      (state.guest ? guestNudge() : "");
  }

  // ---- Trends (reuses history.js chartSVG; lightweight this pass) -----------
  function renderTrends() {
    if (!state.sessions.length) {
      view.innerHTML = stubHTML("Trends", "teal", "Your full history lives here — per-metric charts against your baseline, a session log, and time-of-day insights. Run a test to start the picture.", "📈") +
        '<div style="text-align:center;margin-top:8px;"><a class="cx-btn cx-btn-primary" href="app.html">Run a test</a></div>';
      return;
    }
    var metric = { key: "readiness", label: "Cortex Score", better: "high", accessor: function (s) { return s.readiness; } };
    var points = state.sessions.map(function (s) { return { t: s.timestamp, v: s.readiness }; }).filter(function (p) { return num(p.v) != null; });
    var baseline = baselineFor(function (s) { return s.readiness; });
    var chart = (NR.history && NR.history.chartSVG) ? NR.history.chartSVG(points, metric, baseline) : "";
    var log = state.sessions.slice().reverse().slice(0, 12).map(function (s) {
      var conf = s.scores && s.scores.dataConfidence;
      var low = isFinite(conf) && conf < 40;
      return '<div class="cx-card glass" style="padding:14px 16px;display:flex;align-items:center;gap:14px;">' +
        '<span style="font-family:var(--font-mono);font-weight:600;font-size:22px;width:44px;">' + fmt(s.readiness) + "</span>" +
        '<div style="flex:1;"><div style="font-size:13px;color:var(--ink-2);">' + new Date(s.timestamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) + " · " + esc(s.mode || "—") + "</div></div>" +
        '<span class="conf-chip' + (low ? " low" : "") + '"><span class="dot"></span><i class="ic">' + (low ? "?" : "✓") + "</i>" + fmt(conf) + "</span></div>";
    }).join("");
    view.innerHTML =
      '<div class="dash-section-head"><h1 class="greeting">Trends</h1><span class="cx-label">Cortex Score · vs your ' + BASELINE_DAYS + "-day baseline</span></div>" +
      '<div class="cx-card glass" style="padding:18px;margin-bottom:24px;">' + chart + "</div>" +
      '<div class="dash-section-head"><h2 class="cx-h3">Recent sessions</h2></div>' +
      '<div style="display:flex;flex-direction:column;gap:10px;">' + log + "</div>";
  }

  // ---- Pillar stub ---------------------------------------------------------
  function stubHTML(title, accent, body, ic) {
    return '<div class="cx-card glass pillar-stub">' +
      '<div class="badge">' + title + '</div>' +
      '<div style="font-size:42px;margin-bottom:14px;">' + ic + "</div>" +
      '<h1 class="cx-h2" style="margin-bottom:14px;">' + title + "</h1>" +
      '<p style="font-size:16px;color:var(--ink-2);max-width:50ch;margin:0 auto 8px;">' + body + "</p></div>";
  }
  function stub(title, accent, body, ic) { view.innerHTML = stubHTML(title, accent, body, ic); }

  boot();
})();
