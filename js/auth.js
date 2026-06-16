/* =============================================================
   NeuroReadiness — auth.js
   Thin wrapper around Supabase Auth. Requires the Supabase SDK and
   js/config.js to have loaded first. Creates one shared client so the
   session (stored in localStorage) is the same across the landing,
   account page, and the app — sign in anywhere, signed in everywhere.
   ============================================================= */
(function () {
  "use strict";
  const NR = (window.NR = window.NR || {});

  const cfg = NR.supabaseConfig || {};
  const sdk = window.supabase; // UMD global from the CDN script
  if (!sdk || !cfg.url || !cfg.key) {
    console.warn("[NR] Supabase SDK or config missing — auth disabled.");
    NR.auth = { enabled: false };
    return;
  }

  const client = sdk.createClient(cfg.url, cfg.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  NR.supabase = client;

  // Friendly display name: explicit name → else the part before "@".
  function displayName(user) {
    if (!user) return "";
    const n = user.user_metadata && user.user_metadata.name;
    if (n && n.trim()) return n.trim();
    return (user.email || "").split("@")[0] || "You";
  }

  NR.auth = {
    enabled: true,
    client,
    displayName,

    async getSession() {
      const { data } = await client.auth.getSession();
      return data ? data.session : null;
    },
    async getUser() {
      const { data } = await client.auth.getSession();
      return data && data.session ? data.session.user : null;
    },

    // Returns { user, session, needsConfirmation }.
    async signUp(email, password, name) {
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          data: { name: name || "" },
          emailRedirectTo: location.origin + location.pathname,
        },
      });
      if (error) throw error;
      return {
        user: data.user,
        session: data.session,
        needsConfirmation: !data.session, // no session ⇒ email confirmation is on
      };
    },

    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data;
    },

    async signOut() {
      await client.auth.signOut();
    },

    onChange(cb) {
      return client.auth.onAuthStateChange((_event, session) => cb(session));
    },
  };

  console.log("[NR] auth loaded");
})();
