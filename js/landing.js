/* NeuroReadiness landing — interactions
   Visibility-critical reveals use a scroll-position check (not
   IntersectionObserver) with a hard fallback, so content is never
   left invisible if observers/raf are throttled. Respects reduced-motion.
*/
(function () {
  "use strict";
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- sticky nav shadow ---- */
  var nav = document.querySelector(".nav");
  function onNav() {
    if (window.scrollY > 8) nav.classList.add("scrolled");
    else nav.classList.remove("scrolled");
  }

  /* ---- mobile menu ---- */
  var burger = document.querySelector(".nav-burger");
  var links = document.querySelector(".nav-links");
  if (burger) {
    burger.addEventListener("click", function () {
      var open = links.classList.toggle("open");
      burger.setAttribute("aria-expanded", open ? "true" : "false");
      links.style.display = open ? "flex" : "";
    });
    links.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        if (window.innerWidth <= 920) { links.classList.remove("open"); links.style.display = ""; burger.setAttribute("aria-expanded", "false"); }
      });
    });
  }

  /* ---- scroll-driven enhancement engine (fail-visible) ----
     Everything is visible by default in CSS. These only ADD animation when
     an element scrolls into view; if they never fire, content still shows. */
  var pending = [];
  function register(el, fire) { pending.push({ el: el, fire: fire }); }

  function isInView(el) {
    var r = el.getBoundingClientRect();
    var vh = window.innerHeight || document.documentElement.clientHeight;
    return r.top < vh * 0.9 && r.bottom > 0;
  }

  var ticking = false;
  function check() {
    ticking = false;
    onNav();
    if (!pending.length) return;
    var still = [];
    for (var i = 0; i < pending.length; i++) {
      var p = pending[i];
      if (isInView(p.el)) { try { p.fire(p.el); } catch (e) {} }
      else still.push(p);
    }
    pending = still;
  }
  // setTimeout throttle (NOT rAF — rAF can be throttled in background frames)
  function requestCheck() {
    if (ticking) return;
    ticking = true;
    setTimeout(check, 16);
  }
  window.addEventListener("scroll", requestCheck, { passive: true });
  window.addEventListener("resize", requestCheck, { passive: true });

  /* ---- draw-in paths (visible by default; animate when scrolled in) ---- */
  function drawPath(p) {
    if (reduceMotion) return; // already visible
    try {
      var len = p.getTotalLength();
      var dur = parseInt(p.getAttribute("data-dur") || "1100", 10);
      var delay = parseInt(p.getAttribute("data-delay") || "0", 10);
      p.style.transition = "none";
      p.style.strokeDasharray = len;
      p.style.strokeDashoffset = len;
      p.getBoundingClientRect(); // reflow
      p.style.transition = "stroke-dashoffset " + dur + "ms cubic-bezier(.33,.1,.25,1) " + delay + "ms";
      setTimeout(function () { p.style.strokeDashoffset = 0; }, 20);
    } catch (e) {}
  }
  document.querySelectorAll("[data-draw]").forEach(function (p) { register(p, drawPath); });

  /* ---- chart dots fade-in (visible by default) ---- */
  document.querySelectorAll("[data-dots]").forEach(function (g) {
    register(g, function (group) {
      if (reduceMotion) return;
      group.querySelectorAll(".dot").forEach(function (d, i) {
        d.style.transition = "none";
        d.style.opacity = "0";
        d.getBoundingClientRect();
        d.style.transition = "opacity .3s ease " + (450 + i * 70) + "ms";
        setTimeout(function () { d.style.opacity = "1"; }, 20);
      });
    });
  });

  /* ---- count-up (final value is already in the HTML as fallback) ---- */
  function countUp(el) {
    var to = parseInt(el.getAttribute("data-count"), 10);
    if (reduceMotion || isNaN(to)) { return; }
    var dur = 1100, start = Date.now();
    function tick() {
      var t = Math.min(1, (Date.now() - start) / dur);
      var eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(to * eased);
      if (t < 1) setTimeout(tick, 32);
    }
    tick();
  }
  document.querySelectorAll("[data-count]").forEach(function (el) { register(el, countUp); });

  /* ---- signal-quality clean/motion demo ---- */
  var demo = document.querySelector(".signal-demo");
  if (demo) {
    var fill = demo.querySelector(".signal-bar-fill");
    var num = demo.querySelector(".sr-num");
    var verdict = demo.querySelector(".signal-verdict .sv-txt");
    var svIco = demo.querySelector(".signal-verdict .sv-ico");
    var btns = demo.querySelectorAll(".seg button");
    var states = {
      clean: { v: 92, w: "92%", verdict: "Trusted reading — signal quality is high.", uncertain: false },
      motion: { v: 38, w: "38%", verdict: "Interpret cautiously — motion is corrupting the signal.", uncertain: true }
    };
    function animateNum(el, from, to, dur) {
      if (reduceMotion) { el.textContent = to; return; }
      var start = Date.now();
      function tick() {
        var t = Math.min(1, (Date.now() - start) / dur);
        var eased = 1 - Math.pow(1 - t, 3);
        el.textContent = Math.round(from + (to - from) * eased);
        if (t < 1) setTimeout(tick, 32);
      }
      tick();
    }
    function setState(key) {
      var s = states[key];
      fill.style.width = s.w;
      demo.classList.toggle("is-uncertain", s.uncertain);
      animateNum(num, parseInt(num.textContent, 10) || 0, s.v, 600);
      verdict.textContent = s.verdict;
      svIco.innerHTML = s.uncertain
        ? '<path d="M8 1.5 1 14h14L8 1.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 6v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="12" r=".7" fill="currentColor"/>'
        : '<path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
      btns.forEach(function (b) {
        var on = b.getAttribute("data-state") === key;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }
    btns.forEach(function (b) {
      b.addEventListener("click", function () { setState(b.getAttribute("data-state")); });
    });
  }

  /* ---- trends metric tabs ---- */
  var trendTabs = document.querySelectorAll(".trend-tab");
  var trendSeries = document.querySelectorAll("[data-series]");
  trendTabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      var key = tab.getAttribute("data-metric");
      trendTabs.forEach(function (t) { t.classList.toggle("on", t === tab); t.setAttribute("aria-selected", t === tab ? "true" : "false"); });
      trendSeries.forEach(function (g) {
        var show = g.getAttribute("data-series") === key;
        g.style.display = show ? "" : "none";
        if (show) {
          // (re)draw the now-visible series if it's in view
          // (drawPath already resets dasharray/offset before animating)
          var path = g.querySelector("[data-draw]");
          if (path && isInView(g)) { drawPath(path); }
        }
      });
    });
  });

  /* ---- kick off ---- */
  onNav();
  check();
  setTimeout(check, 120);
  window.addEventListener("load", function () { setTimeout(check, 60); });
})();
