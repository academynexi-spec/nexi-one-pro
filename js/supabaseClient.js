// Charge le SDK Supabase (CDN) et expose un client unique partagé.
window.getSupabase = (function () {
  let client = null;
  return function () {
    if (!client) {
      if (!window.supabase) {
        console.error("Le SDK Supabase (CDN) n'est pas chargé. Vérifiez la balise <script> dans le HTML.");
        return null;
      }
      client = window.supabase.createClient(
        window.NEXI_CONFIG.SUPABASE_URL,
        window.NEXI_CONFIG.SUPABASE_ANON_KEY
      );
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
