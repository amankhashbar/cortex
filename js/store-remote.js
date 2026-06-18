/* =============================================================
   NeuroReadiness — store-remote.js
   A Supabase-backed implementation of the NR.store API, used when a
   user is signed in. One account = one person, so "profiles" collapses
   to a single profile that IS the account. Sessions live in the
   `sessions` table (RLS: each user sees only their own rows).

   The full session record is stored in a `data` jsonb column; a few
   columns (timestamp, readiness) are duplicated for ordering. The shape
   returned to the app matches the local IndexedDB store exactly, so
   app.js / history.js don't know or care which backend is active.

   Requires the SQL in SUPABASE_SETUP.sql to have been run on the project.
   ============================================================= */
(function () {
  "use strict";
  const NR = (window.NR = window.NR || {});

  const uid = () =>
    (self.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);

  NR.makeRemoteStore = function (user) {
    const sb = NR.supabase;
    const userId = user.id;
    const profile = {
      id: userId,
      name: (NR.auth && NR.auth.displayName(user)) || "You",
      email: user.email || "",
      createdAt: Date.parse(user.created_at) || Date.now(),
      settings: {},
    };

    // Turn a DB row back into the record shape the app expects.
    const rowToRecord = (row) => {
      const rec = Object.assign({}, row.data || {});
      rec.id = row.id;
      if (row.timestamp != null) rec.timestamp = Number(row.timestamp);
      rec.profileId = userId;
      return rec;
    };

    return {
      remote: true,

      async init() { return true; },

      // Identity (single profile = the account) ---------------------------
      getActiveProfileId() { return userId; },
      setActiveProfileId() { /* single profile; nothing to switch */ },
      async getProfiles() { return [profile]; },
      async getActiveProfile() { return profile; },
      async addProfile() { return profile; },     // multi-person disabled when signed in
      async updateProfile() { return profile; },
      async deleteProfile() { /* no-op: can't delete the account from here */ },

      // Sessions -----------------------------------------------------------
      async addSession(record) {
        const rec = Object.assign({}, record);
        rec.id = rec.id || uid();
        rec.timestamp = rec.timestamp || Date.now();
        rec.profileId = userId;
        rec.tags = rec.tags || [];
        rec.notes = rec.notes || "";
        const row = {
          id: rec.id,
          user_id: userId,
          timestamp: rec.timestamp,
          readiness: typeof rec.readiness === "number" ? Math.round(rec.readiness) : null,
          data: rec,
        };
        const { error } = await sb.from("sessions").insert(row);
        if (error) throw error;
        return rec;
      },

      async getSession(id) {
        const { data, error } = await sb.from("sessions").select("*").eq("id", id).maybeSingle();
        if (error) throw error;
        return data ? rowToRecord(data) : null;
      },

      async updateSession(id, patch) {
        const { data: cur, error: e1 } = await sb.from("sessions").select("*").eq("id", id).maybeSingle();
        if (e1) throw e1;
        if (!cur) return null;
        const next = Object.assign({}, rowToRecord(cur), patch, { id });
        const upd = { data: next };
        if (patch.timestamp != null) upd.timestamp = patch.timestamp;
        if (typeof next.readiness === "number") upd.readiness = Math.round(next.readiness);
        const { error: e2 } = await sb.from("sessions").update(upd).eq("id", id);
        if (e2) throw e2;
        return next;
      },

      async deleteSession(id) {
        const { error } = await sb.from("sessions").delete().eq("id", id);
        if (error) throw error;
      },

      async getSessions(_profileId, opts = {}) {
        let q = sb.from("sessions").select("*").eq("user_id", userId).order("timestamp", { ascending: true });
        const { data, error } = await q;
        if (error) throw error;
        let list = (data || []).map(rowToRecord);
        if (opts.sinceDays) {
          const cutoff = Date.now() - opts.sinceDays * 864e5;
          list = list.filter((s) => s.timestamp >= cutoff);
        }
        if (opts.limit) list = list.slice(-opts.limit);
        return list;
      },

      // Journal ------------------------------------------------------------
      // RLS scopes journal_entries to the owner, same as sessions.
      async addJournalEntry(entry) {
        const e = {
          id: entry.id || uid(),
          profileId: userId,
          timestamp: entry.timestamp || Date.now(),
          text: entry.text || "",
          tags: entry.tags || [],
          sessionId: entry.sessionId || null,
          score: typeof entry.score === "number" ? entry.score : null,
        };
        const { error } = await sb.from("journal_entries").insert({
          id: e.id, user_id: userId, timestamp: e.timestamp, data: e,
        });
        if (error) throw error;
        return e;
      },
      async getJournalEntries() {
        const { data, error } = await sb.from("journal_entries")
          .select("*").eq("user_id", userId).order("timestamp", { ascending: false });
        if (error) throw error;
        return (data || []).map(function (row) {
          const e = Object.assign({}, row.data || {});
          e.id = row.id; e.profileId = userId;
          if (row.timestamp != null) e.timestamp = Number(row.timestamp);
          return e;
        });
      },
      async updateJournalEntry(id, patch) {
        const { data: cur, error: e1 } = await sb.from("journal_entries").select("*").eq("id", id).maybeSingle();
        if (e1) throw e1;
        if (!cur) return null;
        const next = Object.assign({}, cur.data || {}, patch, { id, profileId: userId });
        const upd = { data: next };
        if (patch.timestamp != null) upd.timestamp = patch.timestamp;
        const { error: e2 } = await sb.from("journal_entries").update(upd).eq("id", id);
        if (e2) throw e2;
        return next;
      },
      async deleteJournalEntry(id) {
        const { error } = await sb.from("journal_entries").delete().eq("id", id);
        if (error) throw error;
      },

      // Compete / leaderboard ---------------------------------------------
      // Opt-in: a row in `leaderboard` IS the opt-in. RLS lets every signed-in
      // user SELECT all rows (that's the leaderboard) but write only their own.
      // We never publish automatically — only when the user opts in.
      async getLeaderboard(period) {
        let q = sb.from("leaderboard").select("*");
        if (period) q = q.eq("period", period);
        const { data, error } = await q;
        if (error) throw error;
        return (data || []).map(function (r) {
          return {
            userId: r.user_id,
            displayName: r.display_name || "Anonymous",
            bestScore: typeof r.best_score === "number" ? r.best_score : null,
            improvement: typeof r.improvement === "number" ? r.improvement : null,
            period: r.period,
            isMe: r.user_id === userId,
          };
        });
      },
      async getMyLeaderboardEntry(period) {
        const { data, error } = await sb.from("leaderboard")
          .select("*").eq("user_id", userId).eq("period", period).maybeSingle();
        if (error) throw error;
        return data || null;
      },
      async upsertLeaderboardEntry(entry) {
        const row = {
          user_id: userId,
          period: entry.period,
          display_name: entry.displayName || profile.name || "Anonymous",
          best_score: typeof entry.bestScore === "number" ? Math.round(entry.bestScore) : null,
          improvement: typeof entry.improvement === "number" ? Math.round(entry.improvement) : null,
          updated_at: new Date().toISOString(),
        };
        const { error } = await sb.from("leaderboard").upsert(row, { onConflict: "user_id,period" });
        if (error) throw error;
        return row;
      },
      async leaveLeaderboard(period) {
        let q = sb.from("leaderboard").delete().eq("user_id", userId);
        if (period) q = q.eq("period", period);
        const { error } = await q;
        if (error) throw error;
      },

      // Stats / baseline (identical to local store) -----------------------
      baselineStats(values) {
        const v = values.filter((x) => typeof x === "number" && isFinite(x));
        if (!v.length) return { mean: NaN, sd: NaN, n: 0 };
        const mean = v.reduce((a, b) => a + b, 0) / v.length;
        const sd = v.length > 1
          ? Math.sqrt(v.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (v.length - 1))
          : 0;
        return { mean, sd, n: v.length };
      },
      async rollingBaseline(profileId, accessor, days = 14) {
        const list = await this.getSessions(profileId, { sinceDays: days });
        return this.baselineStats(list.map(accessor));
      },

      // Export / import ----------------------------------------------------
      async exportData() {
        const sessions = await this.getSessions();
        return { app: "neuroreadiness", version: 1, exportedAt: new Date().toISOString(), profiles: [profile], sessions };
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
      async importData(data) {
        if (!data || data.app !== "neuroreadiness") throw new Error("Not a NeuroReadiness backup file.");
        const rows = (data.sessions || []).filter((s) => s && s.id).map((s) => ({
          id: s.id,
          user_id: userId,
          timestamp: s.timestamp || Date.now(),
          readiness: typeof s.readiness === "number" ? Math.round(s.readiness) : null,
          data: Object.assign({}, s, { profileId: userId }),
        }));
        if (rows.length) {
          const { error } = await sb.from("sessions").upsert(rows);
          if (error) throw error;
        }
        return { profiles: 1, sessions: rows.length };
      },
      async clearAll() {
        const { error } = await sb.from("sessions").delete().eq("user_id", userId);
        if (error) throw error;
      },
    };
  };

  console.log("[NR] store-remote loaded");
})();
