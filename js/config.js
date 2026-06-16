/* =============================================================
   NeuroReadiness — config.js
   Public Supabase config. These two values are PUBLISHABLE by design
   (the publishable/anon key is meant to ship in client code) — data is
   protected by Row-Level Security, not by hiding this key.
   NEVER put the service_role/secret key here.
   ============================================================= */
(function () {
  "use strict";
  const NR = (window.NR = window.NR || {});
  NR.config = NR.config || {};
  NR.supabaseConfig = {
    url: "https://fdnaedbxnkkuthlljeuu.supabase.co",
    // Supabase "publishable" key (sb_publishable_…). Safe to commit.
    key: "sb_publishable_SGIhhB1xm_locknA15kFpg_kq1OrbzV",
  };
})();
