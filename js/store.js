/* =============================================================
   NeuroReadiness — store.js
   Local persistence for profiles, sessions, baselines, and history.

   Everything goes through NR.store; no other module touches IndexedDB.
   Data model:
     profiles  { id, name, createdAt, settings }
     sessions  { id, profileId, timestamp, mode, readiness,
                 scores{...}, taskMetrics{pvt,stroop,nback},
                 ppgSummary{...}, motionClean, tags[], notes }

   IndexedDB is unreliable on file://, so serve the app from an HTTP origin
   such as GitHub Pages for reliable persistence. Raw 50 Hz streams are not
   stored; downloadable session exports provide the detailed signal record.
   ============================================================= */
(function () {
  "use strict";
  const NR = window.NR;

  const DB_NAME = "neuroreadiness";
  const DB_VERSION = 1;
  const ACTIVE_KEY = "nr.activeProfile";

  let _db = null;
  let _ready = null;

  // Safe localStorage (file:// or privacy modes can throw) ------------------
  const _mem = {};
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return _mem[k] ?? null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { _mem[k] = v; } },
  };

  const uid = () =>
    (self.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);

  function mkProfile(name) {
    return { id: uid(), name: name || "You", createdAt: Date.now(), settings: {} };
  }

  // --- Low-level IndexedDB plumbing ----------------------------------------
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("profiles")) {
          db.createObjectStore("profiles", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("sessions")) {
          const ss = db.createObjectStore("sessions", { keyPath: "id" });
          ss.createIndex("profileId", "profileId", { unique: false });
          ss.createIndex("timestamp", "timestamp", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  const store = (name, mode = "readonly") =>
    _db.transaction(name, mode).objectStore(name);

  const reqP = (r) =>
    new Promise((res, rej) => {
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });

  // Raw (no ready-guard) accessors used internally.
  const _allProfiles = () => reqP(store("profiles").getAll());
  const _allSessionsFor = (pid) =>
    reqP(store("sessions").index("profileId").getAll(pid));

  // --- One-time init: open DB, guarantee a default profile -----------------
  function ready() {
    if (!_ready) {
      _ready = (async () => {
        _db = await openDB();
        const profs = await _allProfiles();
        let active = LS.get(ACTIVE_KEY);
        if (profs.length === 0) {
          const p = mkProfile("You");
          await reqP(store("profiles", "readwrite").put(p));
          active = p.id;
          LS.set(ACTIVE_KEY, active);
        } else if (!active || !profs.some((p) => p.id === active)) {
          active = profs[0].id;
          LS.set(ACTIVE_KEY, active);
        }
      })();
    }
    return _ready;
  }

  // --- Public API ----------------------------------------------------------
  NR.store = {
    init: ready,

    // Active profile (id lives in localStorage; sync getters are fine).
    getActiveProfileId() { return LS.get(ACTIVE_KEY); },
    setActiveProfileId(id) { LS.set(ACTIVE_KEY, id); },

    async getProfiles() { await ready(); return _allProfiles(); },

    async getActiveProfile() {
      await ready();
      const id = LS.get(ACTIVE_KEY);
      const all = await _allProfiles();
      return all.find((p) => p.id === id) || all[0] || null;
    },

    async addProfile(name) {
      await ready();
      const p = mkProfile(name);
      await reqP(store("profiles", "readwrite").put(p));
      return p;
    },

    async updateProfile(id, patch) {
      await ready();
      const cur = await reqP(store("profiles").get(id));
      if (!cur) return null;
      const next = { ...cur, ...patch, id };
      await reqP(store("profiles", "readwrite").put(next));
      return next;
    },

    async deleteProfile(id) {
      await ready();
      const sess = await _allSessionsFor(id);
      const txw = _db.transaction(["profiles", "sessions"], "readwrite");
      txw.objectStore("profiles").delete(id);
      sess.forEach((s) => txw.objectStore("sessions").delete(s.id));
      await new Promise((res, rej) => { txw.oncomplete = res; txw.onerror = () => rej(txw.error); });
      // Reassign active profile if we deleted it.
      if (LS.get(ACTIVE_KEY) === id) {
        const rest = await _allProfiles();
        if (rest.length) LS.set(ACTIVE_KEY, rest[0].id);
        else { const p = mkProfile("You"); await reqP(store("profiles", "readwrite").put(p)); LS.set(ACTIVE_KEY, p.id); }
      }
    },

    // Sessions -----------------------------------------------------------
    async addSession(record) {
      await ready();
      const rec = {
        id: record.id || uid(),
        timestamp: record.timestamp || Date.now(),
        profileId: record.profileId || LS.get(ACTIVE_KEY),
        tags: record.tags || [],
        notes: record.notes || "",
        ...record,
      };
      rec.id = rec.id || uid();
      await reqP(store("sessions", "readwrite").put(rec));
      return rec;
    },

    async getSession(id) { await ready(); return reqP(store("sessions").get(id)); },

    async updateSession(id, patch) {
      await ready();
      const cur = await reqP(store("sessions").get(id));
      if (!cur) return null;
      const next = { ...cur, ...patch, id };
      await reqP(store("sessions", "readwrite").put(next));
      return next;
    },

    async deleteSession(id) {
      await ready();
      await reqP(store("sessions", "readwrite").delete(id));
    },

    // Sessions for a profile (default: active), oldest → newest.
    async getSessions(profileId, opts = {}) {
      await ready();
      const pid = profileId || LS.get(ACTIVE_KEY);
      let list = await _allSessionsFor(pid);
      list.sort((a, b) => a.timestamp - b.timestamp);
      if (opts.sinceDays) {
        const cutoff = Date.now() - opts.sinceDays * 864e5;
        list = list.filter((s) => s.timestamp >= cutoff);
      }
      if (opts.limit) list = list.slice(-opts.limit);
      return list;
    },

    // Stats / baseline ----------------------------------------------------
    // {mean, sd, n} over a numeric array (ignoring non-finite values).
    baselineStats(values) {
      const v = values.filter((x) => typeof x === "number" && isFinite(x));
      if (!v.length) return { mean: NaN, sd: NaN, n: 0 };
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      const sd = v.length > 1
        ? Math.sqrt(v.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (v.length - 1))
        : 0;
      return { mean, sd, n: v.length };
    },

    // Rolling personal baseline for one accessor over the trailing window.
    async rollingBaseline(profileId, accessor, days = 14) {
      const list = await this.getSessions(profileId, { sinceDays: days });
      return this.baselineStats(list.map(accessor));
    },

    // Export / import -----------------------------------------------------
    async exportData() {
      await ready();
      const profiles = await _allProfiles();
      const sessions = [];
      for (const p of profiles) sessions.push(...(await _allSessionsFor(p.id)));
      return { app: "neuroreadiness", version: 1, exportedAt: new Date().toISOString(), profiles, sessions };
    },

    async downloadExport() {
      const data = await this.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `neuroreadiness_backup_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },

    // Merge by id (incoming overwrites same id). Returns counts.
    async importData(data) {
      await ready();
      if (!data || data.app !== "neuroreadiness") throw new Error("Not a NeuroReadiness backup file.");
      const txw = _db.transaction(["profiles", "sessions"], "readwrite");
      (data.profiles || []).forEach((p) => p && p.id && txw.objectStore("profiles").put(p));
      (data.sessions || []).forEach((s) => s && s.id && txw.objectStore("sessions").put(s));
      await new Promise((res, rej) => { txw.oncomplete = res; txw.onerror = () => rej(txw.error); });
      return { profiles: (data.profiles || []).length, sessions: (data.sessions || []).length };
    },

    async clearAll() {
      await ready();
      const txw = _db.transaction(["profiles", "sessions"], "readwrite");
      txw.objectStore("profiles").clear();
      txw.objectStore("sessions").clear();
      await new Promise((res, rej) => { txw.oncomplete = res; txw.onerror = () => rej(txw.error); });
      const p = mkProfile("You");
      await reqP(store("profiles", "readwrite").put(p));
      LS.set(ACTIVE_KEY, p.id);
    },
  };

  console.log("[NR] store loaded");
})();
