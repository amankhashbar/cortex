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
    activities: function () { renderActivities(); },
    journal: function () { renderJournal(); },
    compete: function () { renderCompete(); },
  };
  function currentRoute() { return (location.hash.replace(/^#\//, "") || "home").split("?")[0]; }
  function route() {
    var r = currentRoute();
    if (!ROUTES[r]) r = "home";
    NR.dom.all("[data-route]").forEach(function (a) { a.classList.toggle("active", a.getAttribute("data-route") === r); });
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
      '<div style="font-size:13px;color:var(--ink-2);">Sessions stay on this device. Create an account to sync across devices and join Compete.</div></div>' +
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

  // ---- Pillar stub (kept for empty Trends) ---------------------------------
  function stubHTML(title, accent, body, ic) {
    return '<div class="cx-card glass pillar-stub">' +
      '<div class="badge">' + title + '</div>' +
      '<div style="font-size:42px;margin-bottom:14px;">' + ic + "</div>" +
      '<h1 class="cx-h2" style="margin-bottom:14px;">' + title + "</h1>" +
      '<p style="font-size:16px;color:var(--ink-2);max-width:50ch;margin:0 auto 8px;">' + body + "</p></div>";
  }

  function pageHead(title, sub) {
    return '<div class="dash-section-head"><h1 class="greeting">' + esc(title) + "</h1>" +
      (sub ? '<span class="cx-label">' + esc(sub) + "</span>" : "") + "</div>";
  }

  // =====================================================================
  // ACTIVITIES — an honest catalog of cognitive drills + physiological
  // aids. No efficacy claims; each is labelled by what it is and isn't.
  // Pure front-end (no table): browse, open the matching test, or log the
  // intent to your Journal. Color-coded: teal = cognition, blue = physiology.
  // =====================================================================
  var ACTIVITIES = [
    { id: "pvt-warmup", cat: "cognition", name: "Reaction warm-up (PVT)", dur: "3 min",
      what: "A short psychomotor vigilance drill — tap the moment the target appears.",
      honest: "Measures simple reaction speed and lapses. It does not train intelligence; it’s a sensitive readout of alertness.",
      action: { label: "Open the test", href: "app.html" } },
    { id: "stroop-set", cat: "cognition", name: "Interference set (Stroop)", dur: "4 min",
      what: "Name the ink colour, not the word. Practises holding a rule against a habit.",
      honest: "Exercises cognitive control / inhibition. Gains are mostly task-specific — treat it as a probe, not a brain workout.",
      action: { label: "Open the test", href: "app.html" } },
    { id: "nback", cat: "cognition", name: "Working-memory load (2-back)", dur: "5 min",
      what: "Track whether the current item matches the one two steps back.",
      honest: "Loads working memory. Evidence that n-back transfers to general ‘IQ’ is weak and contested — we don’t claim it.",
      action: { label: "Open the test", href: "app.html" } },
    { id: "breath", cat: "physiology", name: "Paced breathing", dur: "5 min",
      what: "Slow breathing around six breaths a minute to settle arousal before a test.",
      honest: "May lower physiological arousal short-term (visible in PPG/EDA). Not a treatment for anything; effects are transient.",
      action: { label: "Log to Journal", journal: "Paced breathing — 5 min before a session." } },
    { id: "light-walk", cat: "physiology", name: "Movement break", dur: "10 min",
      what: "A brief walk to shift state between long focus blocks.",
      honest: "General wellbeing aid. Any readiness effect is indirect and varies by person — we log it, we don’t score it.",
      action: { label: "Log to Journal", journal: "Movement break — 10 min walk." } },
    { id: "hydrate", cat: "physiology", name: "Hydration + reset", dur: "2 min",
      what: "Water and a screen break before re-measuring.",
      honest: "Basic upkeep, not a performance hack. Included because dehydration can degrade signal quality and focus.",
      action: { label: "Log to Journal", journal: "Hydration + reset." } },
  ];

  function renderActivities() {
    var card = function (a) {
      var phys = a.cat === "physiology";
      var tagCls = phys ? "cat-blue" : "cat-teal";
      var tagTxt = phys ? "Physiology" : "Cognition";
      var act = a.action.href
        ? '<a class="cx-btn cx-btn-ghost cx-btn-sm" href="' + a.action.href + '">' + esc(a.action.label) + "</a>"
        : '<button class="cx-btn cx-btn-ghost cx-btn-sm" data-journal="' + esc(a.action.journal) + '">' + esc(a.action.label) + "</button>";
      return '<div class="cx-card glass act-card">' +
        '<div class="act-top"><span class="cat-chip ' + tagCls + '">' + tagTxt + "</span>" +
        '<span class="act-dur">' + esc(a.dur) + "</span></div>" +
        '<h3 class="act-name">' + esc(a.name) + "</h3>" +
        '<p class="act-what">' + esc(a.what) + "</p>" +
        '<p class="act-honest"><span class="act-honest-k">Honest take</span> ' + esc(a.honest) + "</p>" +
        '<div class="act-foot">' + act + "</div></div>";
    };
    view.innerHTML =
      pageHead("Activities", "Drills & aids · honestly framed") +
      '<p style="font-size:15px;color:var(--ink-2);max-width:62ch;margin:-6px 0 22px;">Ways to warm up or shift state before a reading. We label what each one actually does — and what it doesn’t. None of these are treatments or guaranteed boosts.</p>' +
      '<div class="act-grid">' + ACTIVITIES.map(card).join("") + "</div>";

    NR.dom.all("[data-journal]", view).forEach(function (btn) {
      btn.addEventListener("click", async function () {
        var text = btn.getAttribute("data-journal");
        try {
          await NR.store.addJournalEntry({ text: text, tags: ["activity"] });
          btn.textContent = "Logged ✓";
          btn.disabled = true;
        } catch (_) { btn.textContent = "Couldn’t log"; }
      });
    });
  }

  // =====================================================================
  // JOURNAL — private notes & tags, optionally tied to your latest score.
  // Full CRUD against whichever store is active (Supabase signed-in / local
  // IndexedDB guest). Composer up top, newest entries below.
  // =====================================================================
  var jState = { entries: [], editingId: null };

  async function renderJournal() {
    try { jState.entries = await NR.store.getJournalEntries(); } catch (_) { jState.entries = []; }
    var latest = state.sessions.length ? state.sessions[state.sessions.length - 1] : null;
    var latestScore = latest ? latest.readiness : null;

    var editing = jState.editingId ? jState.entries.find(function (e) { return e.id === jState.editingId; }) : null;
    var composer =
      '<form class="cx-card glass jr-composer" id="jr-form">' +
        '<textarea id="jr-text" class="jr-text" rows="3" placeholder="How did that session feel? Sleep, caffeine, stress, context…" required>' + esc(editing ? editing.text : "") + "</textarea>" +
        '<div class="jr-row">' +
          '<input id="jr-tags" class="jr-tags" type="text" placeholder="tags, comma separated" value="' + esc(editing && editing.tags ? editing.tags.join(", ") : "") + '" />' +
          (latestScore != null && !editing ?
            '<label class="jr-link"><input type="checkbox" id="jr-link" /> Tag with latest score (' + fmt(latestScore) + ")</label>" : "") +
          '<div class="jr-actions">' +
            (editing ? '<button type="button" class="cx-btn cx-btn-ghost cx-btn-sm" id="jr-cancel">Cancel</button>' : "") +
            '<button type="submit" class="cx-btn cx-btn-primary cx-btn-sm">' + (editing ? "Save changes" : "Add entry") + "</button>" +
          "</div>" +
        "</div>" +
      "</form>";

    var list = jState.entries.length
      ? jState.entries.map(journalCard).join("")
      : '<div class="cx-card glass" style="padding:28px;text-align:center;color:var(--ink-2);">No entries yet. Give your numbers some context — what you log here is private to your account.</div>';

    view.innerHTML =
      pageHead("Journal", state.signedIn ? "Private · synced to your account" : "Private · this device only") +
      composer +
      '<div class="dash-section-head" style="margin-top:26px;"><h2 class="cx-h3">Entries</h2><span class="cx-label">' + jState.entries.length + " total</span></div>" +
      '<div class="jr-list">' + list + "</div>";

    bindJournal(latestScore);
  }

  function journalCard(e) {
    var when = new Date(e.timestamp).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
    var tags = (e.tags || []).map(function (t) { return '<span class="jr-tag">' + esc(t) + "</span>"; }).join("");
    var scoreChip = (typeof e.score === "number" && isFinite(e.score))
      ? '<span class="jr-score">Cortex ' + Math.round(e.score) + "</span>" : "";
    return '<div class="cx-card glass jr-entry" data-id="' + esc(e.id) + '">' +
      '<div class="jr-entry-top"><span class="jr-when">' + esc(when) + "</span>" + scoreChip +
        '<span class="jr-entry-acts"><button class="jr-ic" data-edit="' + esc(e.id) + '" title="Edit" aria-label="Edit">✎</button>' +
        '<button class="jr-ic" data-del="' + esc(e.id) + '" title="Delete" aria-label="Delete">🗑</button></span></div>' +
      '<div class="jr-body">' + esc(e.text).replace(/\n/g, "<br>") + "</div>" +
      (tags ? '<div class="jr-tags-row">' + tags + "</div>" : "") + "</div>";
  }

  function bindJournal(latestScore) {
    var form = document.getElementById("jr-form");
    if (form) form.addEventListener("submit", async function (ev) {
      ev.preventDefault();
      var text = (document.getElementById("jr-text").value || "").trim();
      if (!text) return;
      var tags = (document.getElementById("jr-tags").value || "").split(",").map(function (t) { return t.trim(); }).filter(Boolean);
      var linkEl = document.getElementById("jr-link");
      try {
        if (jState.editingId) {
          await NR.store.updateJournalEntry(jState.editingId, { text: text, tags: tags });
          jState.editingId = null;
        } else {
          var entry = { text: text, tags: tags };
          if (linkEl && linkEl.checked && latestScore != null) entry.score = latestScore;
          await NR.store.addJournalEntry(entry);
        }
        renderJournal();
      } catch (_) { alert("Couldn’t save the entry."); }
    });
    var cancel = document.getElementById("jr-cancel");
    if (cancel) cancel.addEventListener("click", function () { jState.editingId = null; renderJournal(); });

    NR.dom.all("[data-edit]", view).forEach(function (b) {
      b.addEventListener("click", function () { jState.editingId = b.getAttribute("data-edit"); renderJournal(); window.scrollTo(0, 0); });
    });
    NR.dom.all("[data-del]", view).forEach(function (b) {
      b.addEventListener("click", async function () {
        if (!confirm("Delete this journal entry?")) return;
        try { await NR.store.deleteJournalEntry(b.getAttribute("data-del")); renderJournal(); } catch (_) {}
      });
    });
  }

  // =====================================================================
  // COMPETE — opt-in monthly leaderboard. Multi-user, so it needs an
  // account; guests get a sign-in gate. Only confidence-qualified sessions
  // count. Joining publishes your display name + best score + improvement
  // for the month to other signed-in users — made explicit before opt-in.
  // =====================================================================
  var CONF_QUALIFY = 50;   // min dataConfidence for a session to count

  function currentPeriod() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }
  function periodLabel(p) {
    var parts = p.split("-");
    return new Date(Number(parts[0]), Number(parts[1]) - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
  }

  // Best confidence-qualified score this period + improvement vs the user's
  // prior baseline (mean of qualifying sessions from before this month).
  function myStanding(period) {
    var startOfMonth = new Date(Number(period.split("-")[0]), Number(period.split("-")[1]) - 1, 1).getTime();
    var qualifies = function (s) {
      var c = s.scores && s.scores.dataConfidence;
      return isFinite(s.readiness) && isFinite(c) && c >= CONF_QUALIFY;
    };
    var thisMonth = state.sessions.filter(function (s) { return qualifies(s) && s.timestamp >= startOfMonth; });
    var prior = state.sessions.filter(function (s) { return qualifies(s) && s.timestamp < startOfMonth; });
    if (!thisMonth.length) return { qualified: false, best: null, improvement: null, count: 0 };
    var best = Math.max.apply(null, thisMonth.map(function (s) { return s.readiness; }));
    var improvement = null;
    if (prior.length) {
      var mean = prior.reduce(function (a, s) { return a + s.readiness; }, 0) / prior.length;
      improvement = Math.round(best - mean);
    }
    return { qualified: true, best: Math.round(best), improvement: improvement, count: thisMonth.length };
  }

  async function renderCompete() {
    var period = currentPeriod();
    // Guests can't compete — leaderboards are inherently multi-user/server-side.
    if (!state.signedIn || typeof NR.store.getLeaderboard !== "function") {
      view.innerHTML = pageHead("Compete", periodLabel(period)) +
        '<div class="cx-card glass cmp-gate">' +
        '<div class="badge">Account required</div>' +
        '<h2 class="cx-h3" style="margin-bottom:10px;">Leaderboards live in the cloud</h2>' +
        '<p style="color:var(--ink-2);max-width:54ch;margin:0 auto 18px;">Competing means comparing across people, so it needs an account. Your sessions stay private — only what you explicitly publish (a name + score) is ever shared.</p>' +
        '<a class="cx-btn cx-btn-primary" href="account.html">Create an account or sign in</a></div>';
      return;
    }

    var standing = myStanding(period);
    var mine = null, board = null, setupPending = false;
    try {
      mine = await NR.store.getMyLeaderboardEntry(period);
      board = await NR.store.getLeaderboard(period);
    } catch (_) { setupPending = true; }

    if (setupPending) {
      view.innerHTML = pageHead("Compete", periodLabel(period)) +
        '<div class="cx-card glass cmp-gate"><div class="badge">Coming online</div>' +
        '<h2 class="cx-h3" style="margin-bottom:10px;">Leaderboard isn’t set up yet</h2>' +
        '<p style="color:var(--ink-2);max-width:54ch;margin:0 auto;">The competition table hasn’t been provisioned on the backend yet. Once it’s live, you’ll be able to opt in here.</p></div>';
      return;
    }

    var qualifyNote = '<p class="cmp-rule">Only sessions with data-confidence ≥ ' + CONF_QUALIFY +
      ' count, so a noisy reading can’t top the board.</p>';

    if (!mine) {
      // Not opted in — show the explicit consent card.
      var preview = standing.qualified
        ? '<div class="cmp-standing"><div><span class="cmp-k">Your best this month</span><span class="cmp-v">' + standing.best + "</span></div>" +
          '<div><span class="cmp-k">Improvement</span><span class="cmp-v">' + (standing.improvement == null ? "—" : (standing.improvement >= 0 ? "+" : "") + standing.improvement) + "</span></div>" +
          '<div><span class="cmp-k">Qualified sessions</span><span class="cmp-v">' + standing.count + "</span></div></div>"
        : '<p class="cmp-rule" style="color:var(--amber-text);">You don’t have a confidence-qualified session this month yet — run a clean test to get on the board.</p>';

      view.innerHTML = pageHead("Compete", periodLabel(period)) +
        '<div class="cx-card glass cmp-optin">' +
          '<div class="badge">Opt-in · off by default</div>' +
          '<h2 class="cx-h3" style="margin-bottom:8px;">Join the leaderboard?</h2>' +
          '<p style="color:var(--ink-2);max-width:60ch;">Joining publishes <strong>only this</strong> to other signed-in users for ' + esc(periodLabel(period)) + ':</p>' +
          '<ul class="cmp-shares"><li>Your display name (<strong>' + esc(state.signedIn && NR.auth ? NR.auth.displayName(state.user) : "You") + '</strong>)</li>' +
          '<li>Your best confidence-qualified Cortex Score this month</li><li>Your improvement vs your earlier baseline</li></ul>' +
          '<p style="color:var(--ink-2);max-width:60ch;font-size:13px;">Your individual sessions, notes, and physiology are never shared. You can leave anytime, which deletes your row.</p>' +
          preview + qualifyNote +
          '<div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;">' +
          (standing.qualified ? '<button class="cx-btn cx-btn-primary" id="cmp-join">Publish &amp; join</button>' : '<a class="cx-btn cx-btn-primary" href="app.html">Run a qualifying test</a>') +
          "</div></div>";

      var join = document.getElementById("cmp-join");
      if (join) join.addEventListener("click", async function () {
        join.disabled = true; join.textContent = "Joining…";
        try {
          await NR.store.upsertLeaderboardEntry({ period: period, bestScore: standing.best, improvement: standing.improvement });
          renderCompete();
        } catch (_) { join.disabled = false; join.textContent = "Couldn’t join — try again"; }
      });
      return;
    }

    // Opted in — render the board.
    var by = (location.hash.split("?")[1] || "").indexOf("by=improvement") >= 0 ? "improvement" : "score";
    board.sort(function (a, b) {
      if (by === "improvement") return (b.improvement == null ? -1e9 : b.improvement) - (a.improvement == null ? -1e9 : a.improvement);
      return (b.bestScore == null ? -1 : b.bestScore) - (a.bestScore == null ? -1 : a.bestScore);
    });
    var myRank = board.findIndex(function (r) { return r.isMe; }) + 1;

    var rows = board.map(function (r, i) {
      return '<div class="cmp-row' + (r.isMe ? " me" : "") + '">' +
        '<span class="cmp-rank">' + (i + 1) + "</span>" +
        '<span class="cmp-name">' + esc(r.displayName) + (r.isMe ? ' <span class="cmp-you">you</span>' : "") + "</span>" +
        '<span class="cmp-score">' + (r.bestScore == null ? "—" : r.bestScore) + "</span>" +
        '<span class="cmp-imp">' + (r.improvement == null ? "—" : (r.improvement >= 0 ? "+" : "") + r.improvement) + "</span></div>";
    }).join("");

    var freshBest = standing.qualified && (mine.best_score == null || standing.best > mine.best_score);

    view.innerHTML = pageHead("Compete", periodLabel(period)) +
      '<div class="cx-card glass" style="padding:18px 20px;margin-bottom:18px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;">' +
        '<div><div class="cx-label">Your rank</div><div style="font-family:var(--font-mono);font-weight:600;font-size:30px;">' + (myRank || "—") + '<span style="font-size:14px;color:var(--muted);"> / ' + board.length + "</span></div></div>" +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
          (freshBest ? '<button class="cx-btn cx-btn-ghost cx-btn-sm" id="cmp-update">Update my best (' + standing.best + ")</button>" : "") +
          '<button class="cx-btn cx-btn-ghost cx-btn-sm" id="cmp-leave">Leave</button>' +
        "</div></div>" +
      '<div class="cmp-toggle"><a href="#/compete" class="' + (by === "score" ? "on" : "") + '">By score</a>' +
        '<a href="#/compete?by=improvement" class="' + (by === "improvement" ? "on" : "") + '">By improvement</a></div>' +
      '<div class="cx-card glass cmp-board"><div class="cmp-row cmp-headrow"><span class="cmp-rank">#</span><span class="cmp-name">Player</span><span class="cmp-score">Score</span><span class="cmp-imp">Δ</span></div>' +
        rows + "</div>" + qualifyNote;

    var upd = document.getElementById("cmp-update");
    if (upd) upd.addEventListener("click", async function () {
      upd.disabled = true;
      try { await NR.store.upsertLeaderboardEntry({ period: period, bestScore: standing.best, improvement: standing.improvement }); renderCompete(); }
      catch (_) { upd.disabled = false; }
    });
    var leave = document.getElementById("cmp-leave");
    if (leave) leave.addEventListener("click", async function () {
      if (!confirm("Leave the leaderboard? This deletes your published row.")) return;
      try { await NR.store.leaveLeaderboard(period); renderCompete(); } catch (_) {}
    });
  }

  boot();
})();
