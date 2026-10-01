// =========================================================
// NEXI ONE — authentification unifiée
// Un seul formulaire identifiant + mot de passe : le rôle (élève ou
// superviseur) est déterminé côté serveur (login_unified) et n'est
// jamais affiché ni demandé à l'utilisateur avant connexion.
// =========================================================
const NexiAuth = {
  KEY: "nexi_session",

  getSession() {
    try { return JSON.parse(localStorage.getItem(this.KEY)); } catch { return null; }
  },
  setSession(s) { localStorage.setItem(this.KEY, JSON.stringify(s)); },
  clearSession() { localStorage.removeItem(this.KEY); },

  /** Connexion unique : retourne { ok, role } ou { ok:false, message } */
  async login(identifiant, password) {
    const sb = getSupabase();
    const { data, error } = await sb.rpc("login_unified", { p_identifiant: identifiant, p_password: password });
    if (error || !data || !data.length) return { ok: false, message: "Identifiant ou mot de passe incorrect." };
    const row = data[0];
    this.setSession({
      role: row.role, id: row.id, token: row.token, identifiant: row.identifiant,
      nom_complet: row.nom_complet, classe: row.classe, ecole_id: row.ecole_id, avatar_url: row.avatar_url
    });
    return { ok: true, role: row.role };
  },

  async loginAdmin(identifiant, password) {
    const sb = getSupabase();
    const { data, error } = await sb.rpc("login_admin", { p_identifiant: identifiant, p_password: password });
    if (error || !data) return { ok: false, message: "Accès administrateur refusé." };
    this.setSession({ role: "admin", identifiant, token: data });
    return { ok: true };
  },

  logout() {
    this.clearSession();
    window.location.href = "index.html";
  },

  /** Redirige vers l'accueil si aucune session valide du rôle attendu */
  requireRole(role) {
    const s = this.getSession();
    if (!s || s.role !== role) {
      window.location.href = "index.html";
      return null;
    }
    return s;
  },

  /** Redirige automatiquement vers le bon panel selon le rôle en session */
  redirectToOwnPanel() {
    const s = this.getSession();
    if (!s) return false;
    if (s.role === "eleve") window.location.href = "eleve.html";
    else if (s.role === "superviseur") window.location.href = "superviseur.html";
    else return false;
    return true;
  }
};

// ---------- Déclencheur admin secret : 5 tapotements rapides sur le logo ----------
function armSecretAdminTrigger(el) {
  let taps = 0, timer = null;
  el.addEventListener("click", () => {
    taps++;
    clearTimeout(timer);
    timer = setTimeout(() => { taps = 0; }, 2000);
    if (taps >= 5) {
      taps = 0;
      window.location.href = "admin.html#login";
    }
  });
}
