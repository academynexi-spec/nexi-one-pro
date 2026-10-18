// =========================================================
// SÉCURITÉ DES COMPTES — un compte = un appareil à la fois.
//  • Chaque appareil reçoit à sa première visite un identifiant secret (aléatoire, jamais affiché) ;
//    il est joint à CHAQUE requête (dans l'en-tête standard X-Client-Info, déjà autorisé par le serveur)
//    et vérifié côté base de données.
//  • Si le serveur répond « compte déjà utilisé », un message clair s'affiche (écran de connexion comme application).
// =========================================================
window.NEXI_CONTACT = { whatsapp: "243970300731", email: "Academynexi@gmail.com" };   // contact NEXI ACADEMY (peut être surchargé par NEXI_CONFIG.CONTACT_ABONNEMENT)

window.NexiSecurite = (function () {
  let dernier = 0;
  function idAppareil() {
    try {
      let id = localStorage.getItem("nexi_device_id");
      if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
        id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
          : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16); });
        localStorage.setItem("nexi_device_id", id);
      }
      return id;
    } catch (e) { return null; }
  }
  function contact() {
    const cfg = (window.NEXI_CONFIG && window.NEXI_CONFIG.CONTACT_ABONNEMENT) || {};
    return Object.assign({}, window.NEXI_CONTACT, cfg);
  }
  function fermer() { const o = document.getElementById("nexi-secu-overlay"); if (o) o.remove(); }
  // opts.deconnecter : appareil déjà connecté qui doit être déconnecté localement (jamais pour une tentative de connexion)
  function compteUtilise(opts) {
    dernier = Date.now();
    if (document.getElementById("nexi-secu-overlay") || !document.body) return;
    const c = contact();
    const wa = String(c.whatsapp || "").replace(/\D/g, "");
    let ident = "";
    try { const s = window.NexiAuth && NexiAuth.getSession && NexiAuth.getSession(); ident = s && s.identifiant ? ` (identifiant : ${s.identifiant})` : ""; } catch (e) {}
    const msg = `Bonjour NEXI ACADEMY, mon compte${ident} affiche « Compte déjà utilisé ». Pouvez-vous vérifier que personne d'autre ne l'utilise ?`;
    const bouton = (href, txt, plein) => `<a href="${href}" target="_blank" rel="noopener" style="display:inline-block;margin:4px;padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:600;border:1px solid #4F8CFF;${plein ? "background:#4F8CFF;color:#06102A;" : "color:#E8EEFF;"}">${txt}</a>`;
    const liens = [];
    if (wa) liens.push(bouton(`https://wa.me/${wa}?text=${encodeURIComponent(msg)}`, "💬 WhatsApp NEXI ACADEMY", true));
    if (/^[^\s@<>"']+@[^\s@<>"']+$/.test(String(c.email || ""))) liens.push(bouton(`mailto:${c.email}?subject=${encodeURIComponent("Compte déjà utilisé")}&body=${encodeURIComponent(msg)}`, "✉️ E-mail", false));
    const o = document.createElement("div");
    o.id = "nexi-secu-overlay";
    o.setAttribute("role", "alertdialog"); o.setAttribute("aria-modal", "true"); o.setAttribute("aria-labelledby", "nexi-secu-titre");
    o.style.cssText = "position:fixed;inset:0;z-index:100000;background:rgba(4,8,18,.86);display:flex;align-items:center;justify-content:center;padding:16px;";
    o.innerHTML = `
      <div style="max-width:460px;width:100%;background:#0E1730;border:1px solid #26366B;border-radius:18px;padding:26px 22px;color:#E8EEFF;text-align:center;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.55);max-height:92vh;overflow:auto;">
        <div style="font-size:2.4rem;" aria-hidden="true">🔐</div>
        <h2 id="nexi-secu-titre" style="margin:8px 0 8px;font-size:1.35rem;">Compte déjà utilisé</h2>
        <p style="margin:0 0 14px;color:#B9C6EA;">Ce compte est actuellement ouvert sur un autre appareil. Pour protéger ton compte, il ne peut être utilisé que sur <b style="color:#E8EEFF;">un seul appareil à la fois</b>.</p>
        <div style="text-align:left;background:#0A1226;border:1px solid #1E2A47;border-radius:12px;padding:12px 14px;margin:0 0 14px;">
          <p style="margin:0 0 10px;"><b>C'est ton autre téléphone ?</b><br><span style="color:#B9C6EA;">Déconnecte-toi dessus (ou ferme l'application), attends une à trois minutes, puis réessaie ici.</span></p>
          <p style="margin:0;"><b>Tu n'as prêté tes identifiants à personne ?</b><br><span style="color:#B9C6EA;">Quelqu'un utilise peut-être ton compte. Écris-nous : nous vérifions et sécurisons ton accès.</span></p>
        </div>
        <div>${liens.join("")}</div>
        <button type="button" id="nexi-secu-ok" style="margin-top:10px;padding:10px 22px;border-radius:10px;border:1px solid #3A4E93;background:transparent;color:#E8EEFF;font:inherit;cursor:pointer;">Compris</button>
      </div>`;
    document.body.appendChild(o);
    const ok = document.getElementById("nexi-secu-ok");
    ok.addEventListener("click", () => {
      fermer();
      if (opts && opts.deconnecter) { try { window.NexiAuth && NexiAuth.logout(); } catch (e) {} }
    });
    ok.focus();
  }
  return { idAppareil, compteUtilise, recent: () => Date.now() - dernier < 8000 };
})();

// Charge le SDK Supabase (CDN) et expose un client unique partagé.
window.getSupabase = (function () {
  let client = null;
  return function () {
    if (!client) {
      if (!window.supabase) {
        console.error("Le SDK Supabase (CDN) n'est pas chargé. Vérifiez la balise <script> dans le HTML.");
        return null;
      }
      const dev = window.NexiSecurite.idAppareil();
      client = window.supabase.createClient(
        window.NEXI_CONFIG.SUPABASE_URL,
        window.NEXI_CONFIG.SUPABASE_ANON_KEY,
        dev ? { global: { headers: { "X-Client-Info": "supabase-js-web nexi-dev/" + dev } } } : undefined
      );
      // Détecte la réponse « compte déjà utilisé » de la base, quelle que soit la page qui a fait l'appel.
      const rpcBrut = client.rpc.bind(client);
      client.rpc = function (nom, ...reste) {
        const b = rpcBrut(nom, ...reste);
        const t = b.then.bind(b);
        b.then = (ok, ko) => t((res) => {
          try {
            if (res && res.error && /compte déjà utilisé/i.test(res.error.message || "")) {
              window.NexiSecurite.compteUtilise({ deconnecter: !/^login_/.test(String(nom)) });
            }
          } catch (e) { /* ne jamais casser un appel */ }
          return ok ? ok(res) : res;
        }, ko);
        return b;
      };
    }
    return client;
  };
})();

// =========================================================
// PROGRAMMES (écoles spéciales) — complète la liste des classes avec celles des programmes particuliers.
// Sans effet (et sans erreur) tant que le patch SQL « programmes » n'est pas appliqué.
//  - admin : toutes les classes (nationales + programmes), libellées « 6ème · Programme bilingue » ;
//  - superviseur d'une école spéciale : uniquement les classes de son programme (opts.restreindre) ;
//  - superviseur / élève d'une école nationale : liste inchangée.
// =========================================================
window.NexiProgrammes = (function () {
  let programmes = [];
  async function charger(opts) {
    opts = opts || {};
    try {
      const sb = window.getSupabase && window.getSupabase();
      if (!sb || !window.NEXI_CONFIG || !window.NEXI_CONFIG.CLASSES) return false;
      const [c, p] = await Promise.all([
        sb.from("classes_ref").select("code,libelle,ordre,programme_id").order("ordre"),
        sb.from("programmes").select("id,nom,code,langue").order("nom")
      ]);
      if (c.error || p.error || !c.data || !p.data) return false;                       // patch SQL absent : rien ne change
      programmes = p.data;
      const CL = window.NEXI_CONFIG.CLASSES;
      for (let i = CL.length - 1; i >= 0; i--) if (CL[i].programme_id) CL.splice(i, 1);   // recharge propre
      const deja = new Set(CL.map(x => x.code));
      c.data.filter(r => r.programme_id && !deja.has(r.code)).forEach(r =>
        CL.push({ code: r.code, libelle: `${r.libelle} · ${nom(r.programme_id) || "programme"}`, programme_id: r.programme_id }));
      if (opts.ecoleId && opts.restreindre) {
        const { data: pid, error } = await sb.rpc("rpc_ecole_programme", { p_ecole_id: opts.ecoleId });
        if (!error) {                                                             // pid null = école nationale : classes nationales seulement
          const miennes = CL.filter(x => (x.programme_id || null) === (pid || null));
          if (miennes.length) CL.splice(0, CL.length, ...miennes);
        }
      }
      return true;
    } catch (e) { return false; }
  }
  function nom(id) { const p = programmes.find(x => x.id === id); return p ? p.nom : null; }
  return { charger, nom, liste: () => programmes };
})();
