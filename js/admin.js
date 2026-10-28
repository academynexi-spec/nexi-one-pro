// =========================================================
// PANEL ADMIN
// =========================================================
const sb = getSupabase();
let session = NexiAuth.getSession();
const root = document.getElementById("view-root");

function escapeHtml(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function esc(s) { return escapeHtml(s); }

if (!session || session.role !== "admin") {
  document.getElementById("admin-login-screen").style.display = "flex";
  document.getElementById("admin-login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const res = await NexiAuth.loginAdmin(document.getElementById("a-id").value.trim(), document.getElementById("a-pw").value);
    if (!res.ok) { const err = document.getElementById("admin-login-error"); err.textContent = res.message; err.style.display = "block"; return; }
    location.reload();
  });
} else {
  document.getElementById("admin-app").style.display = "block";
  document.getElementById("btn-logout").addEventListener("click", () => NexiAuth.logout());
  document.querySelectorAll(".admin-tabs button").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".admin-tabs button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      render(btn.dataset.view);
    });
  });
}

function tok() { return session.token; }

// Traite un import en masse par lots parallèles (au lieu d'un appel séquentiel
// par ligne) — accélère nettement les imports de plusieurs centaines de lignes
// sans saturer l'API Supabase (lots de 6 requêtes concurrentes).
async function runBatched(items, worker, batchSize = 6) {
  let ok = 0, fail = 0;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(item => worker(item).then(() => true).catch(() => false)));
    results.forEach(success => success ? ok++ : fail++);
  }
  return { ok, fail };
}
function openModal(html) {
  const bd = document.createElement("div"); bd.className = "modal-backdrop";
  bd.innerHTML = `<div class="modal">${html}</div>`;
  document.body.appendChild(bd);
  bd.addEventListener("click", (e) => { if (e.target === bd) bd.remove(); });
  return bd;
}

async function render(view) {
  root.innerHTML = `<div class="empty-state"><h4>Chargement…</h4></div>`;
  if (view === "eleves") return renderEleves();
  if (view === "notifs") return renderNotifs();
  if (view === "stockage") return renderStockage();
  if (view === "tournois") return renderTournois();
  if (view === "programmes") return renderProgrammes();
  if (view === "abonnements") return renderAbonnements();
  if (view === "classes") return renderClasses();
  if (view === "defis") return renderDefis();
  if (view === "affinites") return renderAffinites();
  if (view === "cartes") return renderCartes();
  if (view === "etablissements") return renderEtablissements();
  if (view === "classements") return renderClassements();
  if (view === "diagnostic") return renderDiagnostic();
  if (view === "reglages") return renderReglages();
}

// =========================================================
// ENFANTS — liste paginée + recherche + filtre classe (grande échelle)
// =========================================================
const elevesState = { page: 0, pageSize: 25, search: "", classe: "", valide: null };

async function renderEleves() {
  const { page, pageSize, search, classe, valide } = elevesState;
  const [{ data: eleves, error }, { data: total }] = await Promise.all([
    sb.rpc("admin_list_eleves", { p_token: tok(), p_search: search || null, p_classe: classe || null, p_valide: valide, p_limit: pageSize, p_offset: page * pageSize }),
    sb.rpc("admin_count_eleves", { p_token: tok(), p_search: search || null, p_classe: classe || null, p_valide: valide })
  ]);
  if (error) { root.innerHTML = `<div class="empty-state"><h4>Erreur d'accès</h4><p>${esc(error.message)}</p></div>`; return; }
  const { data: ecoles } = await sb.rpc("admin_list_ecoles", { p_token: tok() });
  const ecoleName = (id) => (ecoles || []).find(e => e.id === id)?.nom || "Domicile";
  const { data: pendingCount } = await sb.rpc("admin_count_eleves", { p_token: tok(), p_valide: false });
  const aboMap = {};   // états d'abonnement calculés (dates) ; vide si le patch SQL « abonnements » n'est pas appliqué
  try { const { data: st } = await sb.rpc("admin_abonnements_etat", { p_token: tok(), p_ids: (eleves || []).map(x => x.id) }); (st || []).forEach(x => { aboMap[x.id] = x; }); } catch (err) { /* ignoré */ }
  const totalPages = Math.max(1, Math.ceil((total || 0) / pageSize));

  root.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:10px;">
      <h2 style="margin:0;">Enfants (${total || 0})</h2>
      <button class="btn" id="btn-add-eleve">+ Ajouter</button>
    </div>
    ${pendingCount ? `<div class="card" style="border-color:var(--gold); margin-bottom:16px; cursor:pointer;" id="btn-see-pending"><b>${pendingCount} suggestion(s) en attente de validation</b> — cliquer pour filtrer</div>` : ""}
    <div class="filters-row">
      <input id="f-search" placeholder="Rechercher (nom ou identifiant)" value="${esc(search)}">
      <select id="f-classe"><option value="">Toutes les classes</option>${window.NEXI_CONFIG.CLASSES.map(c => `<option value="${c.code}" ${classe === c.code ? "selected" : ""}>${c.libelle}</option>`).join("")}</select>
      <button class="btn secondary" id="f-apply">Filtrer</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Statut</th><th>Nom</th><th>Identifiant</th><th>Classe</th><th>École</th><th>Abonnement</th><th></th></tr></thead>
      <tbody>
        ${(eleves || []).map(e => `
          <tr>
            <td>${!e.valide ? `<span class="badge pending">En attente</span>` : e.actif ? `<span class="badge on">Actif</span>` : `<span class="badge off">Suspendu</span>`}</td>
            <td>${esc(e.nom_complet)}</td><td>${esc(e.identifiant)}</td><td>${esc(e.classe || "—")}</td><td>${esc(ecoleName(e.ecole_id))}</td>
            <td>${badgeAbo(e, aboMap)}</td>
            <td style="white-space:nowrap;">
              ${!e.valide ? `<button class="btn secondary" data-valider="${e.id}" style="padding:6px 12px;">Valider</button>` : ""}
              <button class="btn secondary" data-edit="${e.id}" style="padding:6px 12px;">Éditer</button>
            </td>
          </tr>`).join("") || `<tr><td colspan="7">Aucun résultat.</td></tr>`}
      </tbody>
    </table></div>
    <div class="pager">
      <button class="btn ghost" id="p-prev" ${page === 0 ? "disabled" : ""}>‹ Précédent</button>
      Page ${page + 1} / ${totalPages}
      <button class="btn ghost" id="p-next" ${page >= totalPages - 1 ? "disabled" : ""}>Suivant ›</button>
    </div>
  `;

  document.getElementById("f-apply").addEventListener("click", () => {
    elevesState.search = document.getElementById("f-search").value.trim();
    elevesState.classe = document.getElementById("f-classe").value;
    elevesState.page = 0; renderEleves();
  });
  document.getElementById("f-search").addEventListener("keydown", (e) => { if (e.key === "Enter") document.getElementById("f-apply").click(); });
  const pending = document.getElementById("btn-see-pending");
  if (pending) pending.addEventListener("click", () => { elevesState.valide = false; elevesState.page = 0; renderEleves(); });
  document.getElementById("p-prev").addEventListener("click", () => { elevesState.page--; renderEleves(); });
  document.getElementById("p-next").addEventListener("click", () => { elevesState.page++; renderEleves(); });

  document.getElementById("btn-add-eleve").addEventListener("click", () => openEleveModal(null, ecoles));
  root.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => openEleveModal(eleves.find(x => x.id === b.dataset.edit), ecoles)));
  root.querySelectorAll("[data-valider]").forEach(b => b.addEventListener("click", async () => {
    await sb.rpc("admin_valider_eleve", { p_token: tok(), p_eleve_id: b.dataset.valider });
    NexiGamify.toast("Élève validé.", "success"); renderEleves();
  }));
}

function openEleveModal(e, ecoles) {
  const modal = openModal(`
    <h3>${e ? "Éditer" : "Ajouter"} un enfant</h3>
    <div class="field"><label>Nom complet</label><input id="m-nom" value="${e ? esc(e.nom_complet) : ""}"></div>
    <div class="field"><label>Identifiant (pseudo public)</label><input id="m-id" value="${e ? esc(e.identifiant) : ""}"></div>
    <div class="field"><label>Mot de passe ${e ? "(laisser vide pour ne pas changer)" : ""}</label><input id="m-pw" type="text"></div>
    <div class="field"><label>Sexe</label><select id="m-sexe"><option value="M" ${e?.sexe === "M" ? "selected" : ""}>M</option><option value="F" ${e?.sexe === "F" ? "selected" : ""}>F</option></select></div>
    <div class="field"><label>Classe</label><select id="m-classe">${window.NEXI_CONFIG.CLASSES.map(c => `<option value="${c.code}" ${e?.classe === c.code ? "selected" : ""}>${c.libelle}</option>`).join("")}</select></div>
    <div class="field"><label>École (vide = domicile)</label><select id="m-ecole"><option value="">— Domicile —</option>${(ecoles || []).map(sc => `<option value="${sc.id}" ${e?.ecole_id === sc.id ? "selected" : ""}>${esc(sc.nom)}</option>`).join("")}</select></div>
    <div class="field"><label><input type="checkbox" id="m-actif" ${!e || e.actif ? "checked" : ""}> Compte actif</label></div>
    <div class="field"><label><input type="checkbox" id="m-abo" ${!e || e.abonnement_actif ? "checked" : ""}> Abonnement actif</label></div>
    <div id="m-abo-dates">
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <div class="field" style="flex:1; min-width:140px;"><label>Début d'abonnement</label><input type="date" id="m-abo-debut"></div>
        <div class="field" style="flex:1; min-width:140px;"><label>Fin d'abonnement</label><input type="date" id="m-abo-fin"></div>
      </div>
      <p style="font-size:.82rem; margin:-4px 0 12px;">Laisser vide = sans limite de date. L'état (actif, expiré, à venir) est calculé automatiquement ; la date de fin est incluse.</p>
    </div>
    <button class="btn block" id="m-save">Enregistrer</button>
    ${e ? `<button class="btn secondary block" id="m-liberer" type="button" style="margin-top:8px;">Libérer la session (déconnecter l'élève)</button>
    <p style="font-size:.8rem; margin:6px 0 0;">À utiliser si l'élève a perdu ou changé de téléphone : son compte est libéré immédiatement et il devra se reconnecter.</p>` : ""}
  `);
  // École spéciale : seules les classes de son programme sont proposées (et inversement pour une école nationale).
  const filtrerClasses = () => {
    const sel = modal.querySelector("#m-classe"), sc = (ecoles || []).find(x => x.id === modal.querySelector("#m-ecole").value), prog = (sc && sc.programme_id) || null;
    const courant = sel.value || (e && e.classe) || "";
    sel.innerHTML = window.NEXI_CONFIG.CLASSES.filter(c => (c.programme_id || null) === prog).map(c => `<option value="${c.code}" ${courant === c.code ? "selected" : ""}>${c.libelle}</option>`).join("");
  };
  modal.querySelector("#m-ecole").addEventListener("change", filtrerClasses);
  filtrerClasses();
  // Dates d'abonnement : chargées à l'ouverture (la liste ne les contient pas). Champs masqués si le patch SQL n'est pas appliqué.
  (async () => {
    const d = modal.querySelector("#m-abo-debut"), f = modal.querySelector("#m-abo-fin");
    const lib = modal.querySelector("#m-liberer");
    if (lib) lib.addEventListener("click", async () => {
      if (!confirm(`Libérer le compte de ${e.nom_complet} ?\nIl sera déconnecté de son appareil et devra se reconnecter.`)) return;
      const { error } = await sb.rpc("admin_liberer_session", { p_token: tok(), p_eleve_id: e.id });
      NexiGamify.toast(error ? "Erreur : " + error.message : "Compte libéré : l'élève devra se reconnecter.", error ? "error" : "success");
    });
    if (e) d.disabled = f.disabled = true;
    const { data, error } = await sb.rpc("admin_abonnements_etat", { p_token: tok(), p_ids: e ? [e.id] : [] });
    if (error || (e && !(data && data[0]))) { modal._aboOff = true; modal.querySelector("#m-abo-dates").style.display = "none"; return; }
    if (e) { modal._aboInit = { debut: data[0].debut || null, fin: data[0].fin || null }; d.value = data[0].debut || ""; f.value = data[0].fin || ""; d.disabled = f.disabled = false; }
  })();
  modal.querySelector("#m-save").addEventListener("click", async () => {
    const { data: saved, error } = await sb.rpc("admin_upsert_eleve", {
      p_token: tok(), p_id: e ? e.id : null,
      p_nom_complet: modal.querySelector("#m-nom").value, p_identifiant: modal.querySelector("#m-id").value,
      p_password: modal.querySelector("#m-pw").value, p_sexe: modal.querySelector("#m-sexe").value,
      p_classe: modal.querySelector("#m-classe").value, p_ecole_id: modal.querySelector("#m-ecole").value || null,
      p_actif: modal.querySelector("#m-actif").checked, p_abonnement_actif: modal.querySelector("#m-abo").checked
    });
    if (error) { NexiGamify.toast("Erreur : " + error.message, "error"); return; }
    const avis = await enregistrerDatesAbo(modal, e, saved);
    modal.remove(); NexiGamify.toast(avis || "Enregistré.", avis ? "error" : "success"); renderEleves();
  });
}

// =========================================================
// DÉFIS
// =========================================================
async function renderDefis() {
  const { data: defis, error } = await sb.rpc("admin_list_defis", { p_token: tok() });
  if (error) { root.innerHTML = `<div class="empty-state"><h4>Erreur</h4><p>${esc(error.message)}</p></div>`; return; }
  root.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
      <h2 style="margin:0;">Défis</h2><button class="btn" id="btn-add-defi">+ Nouveau défi</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Titre</th><th>Classe</th><th>Statut</th><th></th></tr></thead>
      <tbody>${(defis || []).map(d => `
        <tr><td>${esc(d.titre)}</td><td>${esc(d.classe)}</td>
          <td>${d.publie ? `<span class="badge on">Publié</span>` : `<span class="badge off">Brouillon</span>`}</td>
          <td style="white-space:nowrap;">
            <button class="btn secondary" data-manage="${d.id}" style="padding:6px 12px;">Questions</button>
            <button class="btn secondary" data-edit="${d.id}" style="padding:6px 12px;">Éditer</button>
            <button class="btn ghost" data-del="${d.id}" style="padding:6px 12px; color:var(--coral);">Suppr.</button>
          </td></tr>`).join("") || `<tr><td colspan="4">Aucun défi.</td></tr>`}
      </tbody>
    </table></div>
  `;
  document.getElementById("btn-add-defi").addEventListener("click", () => openDefiModal(null));
  root.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => openDefiModal(defis.find(x => x.id === b.dataset.edit))));
  root.querySelectorAll("[data-manage]").forEach(b => b.addEventListener("click", () => renderQuestions(defis.find(x => x.id === b.dataset.manage))));
  root.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
    if (!confirm("Supprimer ce défi et ses questions ?")) return;
    await sb.rpc("admin_delete_defi", { p_token: tok(), p_id: b.dataset.del }); renderDefis();
  }));
}

function openDefiModal(d) {
  const modal = openModal(`
    <h3>${d ? "Éditer" : "Nouveau"} défi</h3>
    <div class="field"><label>Titre</label><input id="m-titre" value="${d ? esc(d.titre) : ""}"></div>
    <div class="field"><label>Classe</label><select id="m-classe">${window.NEXI_CONFIG.CLASSES.map(c => `<option value="${c.code}" ${d?.classe === c.code ? "selected" : ""}>${c.libelle}</option>`).join("")}</select></div>
    <div class="field"><label><input type="checkbox" id="m-publie" ${d?.publie ? "checked" : ""}> Publié (visible par les élèves)</label></div>
    <button class="btn block" id="m-save">Enregistrer</button>
  `);
  modal.querySelector("#m-save").addEventListener("click", async () => {
    const { error } = await sb.rpc("admin_upsert_defi", {
      p_token: tok(), p_id: d ? d.id : null, p_titre: modal.querySelector("#m-titre").value,
      p_classe: modal.querySelector("#m-classe").value, p_publie: modal.querySelector("#m-publie").checked, p_auto_publish_at: null
    });
    if (error) { NexiGamify.toast("Erreur : " + error.message, "error"); return; }
    modal.remove(); NexiGamify.toast("Défi enregistré.", "success"); renderDefis();
  });
}

async function renderQuestions(defi) {
  const { data: questions } = await sb.rpc("admin_list_questions", { p_token: tok(), p_defi_id: defi.id });
  root.innerHTML = `
    <button class="btn ghost" id="btn-back">← Retour aux défis</button>
    <h2>${esc(defi.titre)} — Questions</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Énoncé</th><th>Catégorie</th><th>Bonnes rép.</th><th>Temps</th><th></th></tr></thead>
      <tbody>${(questions || []).map(q => `
        <tr><td>${q.ordre}</td><td>${esc(q.enonce)}</td><td>${esc(q.categorie_nom)}</td>
          <td>${(q.bonnes_reponses || []).map(i => i + 1).join(",")}</td><td>${q.temps_secondes}s</td>
          <td><button class="btn ghost" data-del="${q.id}" style="color:var(--coral); padding:4px 10px;">Suppr.</button></td></tr>`).join("") || `<tr><td colspan="6">Aucune question.</td></tr>`}
      </tbody>
    </table></div>

    <h3 style="margin-top:26px;">Ajouter une question</h3>
    <form id="form-q" class="card">
      <div class="field"><label>Énoncé</label><input id="q-enonce" required></div>
      <div class="field"><label>Options (séparées par ;)</label><input id="q-options" placeholder="Paris;Londres;Berlin;Madrid" required></div>
      <div class="field"><label>Index(es) bonne(s) réponse (1-based, séparés par ,)</label><input id="q-bonnes" placeholder="1" required></div>
      <div class="field"><label>Catégorie</label><input id="q-cat" placeholder="math" required></div>
      <div class="field"><label>Temps (secondes)</label><input id="q-temps" type="number" value="30" required></div>
      <div class="field"><label>Explication (corrigé détaillé)</label><textarea id="q-expl"></textarea></div>
      <button class="btn block" type="submit">Ajouter</button>
    </form>

    <h3 style="margin-top:26px;">Import en masse</h3>
    <p style="font-size:.82rem;">1 ligne par question, champs séparés par « : » — <code>Énoncé:opt1;opt2;opt3;opt4:1:catégorie:30:Explication</code></p>
    <form id="form-import" class="card">
      <textarea id="import-text" placeholder="Combien font 2+2 ?:3;4;5;6:2:math:20:Deux plus deux égale quatre."></textarea>
      <button class="btn secondary block" type="submit" style="margin-top:10px;">Importer</button>
    </form>
  `;
  document.getElementById("btn-back").addEventListener("click", () => renderDefis());
  root.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => { await sb.rpc("admin_delete_question", { p_token: tok(), p_id: b.dataset.del }); renderQuestions(defi); }));

  document.getElementById("form-q").addEventListener("submit", async (e) => {
    e.preventDefault();
    const opts = document.getElementById("q-options").value.split(";").map(s => s.trim()).filter(Boolean);
    const bonnes = document.getElementById("q-bonnes").value.split(",").map(s => parseInt(s.trim(), 10) - 1);
    const { error } = await sb.rpc("admin_upsert_question", {
      p_token: tok(), p_id: null, p_defi_id: defi.id, p_categorie_nom: document.getElementById("q-cat").value.trim(),
      p_ordre: (questions?.length || 0) + 1, p_enonce: document.getElementById("q-enonce").value,
      p_options: JSON.stringify(opts), p_bonnes: bonnes, p_explication: document.getElementById("q-expl").value,
      p_temps: parseInt(document.getElementById("q-temps").value, 10)
    });
    if (error) { NexiGamify.toast("Erreur : " + error.message, "error"); return; }
    NexiGamify.toast("Question ajoutée.", "success"); renderQuestions(defi);
  });

  document.getElementById("form-import").addEventListener("submit", async (e) => {
    e.preventDefault();
    const lines = document.getElementById("import-text").value.split("\n").map(l => l.trim()).filter(Boolean);
    let ordreBase = (questions?.length || 0) + 1;
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = `Import de ${lines.length} ligne(s)…`;
    const { ok, fail } = await runBatched(lines, async (line) => {
      const parts = line.split(":");
      if (parts.length < 4) throw new Error("ligne invalide");
      const [enonce, optsStr, bonnesStr, cat, tempsStr, expl] = parts;
      const opts = optsStr.split(";").map(s => s.trim()).filter(Boolean);
      const bonnes = bonnesStr.split(",").map(s => parseInt(s.trim(), 10) - 1);
      const ordre = ordreBase++;
      const { error } = await sb.rpc("admin_upsert_question", {
        p_token: tok(), p_id: null, p_defi_id: defi.id, p_categorie_nom: cat.trim(), p_ordre: ordre,
        p_enonce: enonce.trim(), p_options: JSON.stringify(opts), p_bonnes: bonnes,
        p_explication: expl ? expl.trim() : null, p_temps: tempsStr ? parseInt(tempsStr, 10) : 30
      });
      if (error) throw error;
    });
    btn.disabled = false; btn.textContent = "Importer";
    NexiGamify.toast(`${ok} question(s) importée(s), ${fail} échec(s).`, fail ? "error" : "success");
    renderQuestions(defi);
  });
}

// =========================================================
// AFFINITÉS
// =========================================================
async function renderAffinites() {
  const { data: qs } = await sb.rpc("admin_list_affinites", { p_token: tok() });
  root.innerHTML = `
    <h2>Affinités (RIASEC)</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Texte</th><th>Dimension</th><th>Actif</th><th></th></tr></thead>
      <tbody>${(qs || []).map(q => `
        <tr><td>${esc(q.texte)}</td><td>${q.dimension}</td>
          <td>${q.actif ? `<span class="badge on">Oui</span>` : `<span class="badge off">Non</span>`}</td>
          <td><button class="btn ghost" data-del="${q.id}" style="color:var(--coral);">Suppr.</button></td></tr>`).join("") || `<tr><td colspan="4">Aucune question.</td></tr>`}
      </tbody>
    </table></div>

    <h3 style="margin-top:26px;">Ajouter une question</h3>
    <form id="form-a" class="card">
      <div class="field"><label>Texte</label><input id="a-texte" required placeholder="J'aime réparer des objets mécaniques"></div>
      <div class="field"><label>Dimension RIASEC</label>
        <select id="a-dim"><option value="R">R — Réaliste</option><option value="I">I — Investigateur</option><option value="A">A — Artistique</option><option value="S">S — Social</option><option value="E">E — Entreprenant</option><option value="C">C — Conventionnel</option></select>
      </div>
      <button class="btn block" type="submit">Ajouter</button>
    </form>

    <h3 style="margin-top:26px;">Import en masse</h3>
    <p style="font-size:.82rem;">1 ligne par question : <code>Texte:Dimension</code></p>
    <form id="form-a-import" class="card">
      <textarea id="a-import-text" placeholder="J'aime réparer des objets mécaniques:R"></textarea>
      <button class="btn secondary block" type="submit" style="margin-top:10px;">Importer</button>
    </form>
  `;
  root.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => { await sb.rpc("admin_delete_affinite_question", { p_token: tok(), p_id: b.dataset.del }); renderAffinites(); }));
  document.getElementById("form-a").addEventListener("submit", async (e) => {
    e.preventDefault();
    await sb.rpc("admin_upsert_affinite_question", { p_token: tok(), p_id: null, p_texte: document.getElementById("a-texte").value, p_dimension: document.getElementById("a-dim").value, p_actif: true });
    NexiGamify.toast("Ajoutée.", "success"); renderAffinites();
  });
  document.getElementById("form-a-import").addEventListener("submit", async (e) => {
    e.preventDefault();
    const lines = document.getElementById("a-import-text").value.split("\n").map(l => l.trim()).filter(Boolean);
    const { ok, fail } = await runBatched(lines, async (line) => {
      const [texte, dim] = line.split(":");
      if (!texte || !dim) throw new Error("ligne invalide");
      const { error } = await sb.rpc("admin_upsert_affinite_question", { p_token: tok(), p_id: null, p_texte: texte.trim(), p_dimension: dim.trim().toUpperCase(), p_actif: true });
      if (error) throw error;
    });
    NexiGamify.toast(`${ok} question(s) importée(s)${fail ? `, ${fail} échec(s)` : ""}.`, fail ? "error" : "success");
    renderAffinites();
  });
}

// =========================================================
// CARTES DE RÉVISION — ancien écran (conservé comme filet de sécurité)
// =========================================================
async function renderCartesLegacy() {
  const { data: cartes } = await sb.rpc("admin_list_cartes", { p_token: tok() });
  root.innerHTML = `
    <h2>Cartes de révision</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Recto</th><th>Classe</th><th>Catégorie</th><th>Visible</th><th></th></tr></thead>
      <tbody>${(cartes || []).map(c => `
        <tr><td>${esc(c.recto)}</td><td>${esc(c.classe)}</td><td>${esc(c.categorie_nom || "")}</td>
          <td><button class="btn secondary" data-toggle="${c.id}" style="padding:4px 10px;">${c.masque ? "Masquée" : "Visible"}</button></td>
          <td><button class="btn ghost" data-del="${c.id}" style="color:var(--coral);">Suppr.</button></td></tr>`).join("") || `<tr><td colspan="5">Aucune carte.</td></tr>`}
      </tbody>
    </table></div>

    <h3 style="margin-top:26px;">Ajouter une carte</h3>
    <form id="form-c" class="card">
      <div class="field"><label>Recto (question)</label><input id="c-recto" required></div>
      <div class="field"><label>Verso — réponse</label><input id="c-reponse" required></div>
      <div class="field"><label>Verso — explication détaillée</label><textarea id="c-expl"></textarea></div>
      <div class="field"><label>Classe</label><select id="c-classe">${window.NEXI_CONFIG.CLASSES.map(cl => `<option value="${cl.code}">${cl.libelle}</option>`).join("")}</select></div>
      <div class="field"><label>Catégorie</label><input id="c-cat" placeholder="math" required></div>
      <button class="btn block" type="submit">Ajouter</button>
    </form>

    <h3 style="margin-top:26px;">Import en masse</h3>
    <p style="font-size:.82rem;">1 ligne par carte : <code>Recto:Réponse:Explication:Classe:Catégorie</code></p>
    <form id="form-c-import" class="card">
      <textarea id="c-import-text" placeholder="Capitale de la RDC ?:Kinshasa:Kinshasa est la capitale depuis 1966.:7EB:svt"></textarea>
      <button class="btn secondary block" type="submit" style="margin-top:10px;">Importer</button>
    </form>
  `;
  root.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => { await sb.rpc("admin_delete_carte", { p_token: tok(), p_id: b.dataset.del }); renderCartes(); }));
  root.querySelectorAll("[data-toggle]").forEach(b => b.addEventListener("click", async () => {
    const carte = cartes.find(c => c.id === b.dataset.toggle);
    await sb.rpc("admin_upsert_carte", { p_token: tok(), p_id: carte.id, p_classe: carte.classe, p_categorie_nom: carte.categorie_nom || "général", p_recto: carte.recto, p_verso_reponse: carte.verso_reponse, p_verso_explication: carte.verso_explication, p_masque: !carte.masque });
    renderCartes();
  }));
  document.getElementById("form-c").addEventListener("submit", async (e) => {
    e.preventDefault();
    await sb.rpc("admin_upsert_carte", { p_token: tok(), p_id: null, p_classe: document.getElementById("c-classe").value, p_categorie_nom: document.getElementById("c-cat").value.trim(), p_recto: document.getElementById("c-recto").value, p_verso_reponse: document.getElementById("c-reponse").value, p_verso_explication: document.getElementById("c-expl").value, p_masque: false });
    NexiGamify.toast("Carte ajoutée.", "success"); renderCartes();
  });
  document.getElementById("form-c-import").addEventListener("submit", async (e) => {
    e.preventDefault();
    const lines = document.getElementById("c-import-text").value.split("\n").map(l => l.trim()).filter(Boolean);
    // La classe est un champ LIBRE dans l'import en masse (contrairement au
    // formulaire simple qui utilise un menu déroulant) : une faute de frappe
    // ici ("4 SC" au lieu de "4SC") crée des cartes invisibles pour toujours,
    // sans aucune erreur — on le détecte donc explicitement avant d'importer.
    const codesValides = new Set(window.NEXI_CONFIG.CLASSES.map(c => c.code));
    const classesInconnues = new Set();
    const { ok, fail } = await runBatched(lines, async (line) => {
      const [recto, reponse, expl, classe, cat] = line.split(":");
      if (!recto || !reponse) throw new Error("ligne invalide");
      const classeTrim = (classe || "").trim();
      if (!codesValides.has(classeTrim)) { classesInconnues.add(classeTrim || "(vide)"); throw new Error("classe inconnue : " + classeTrim); }
      const { error } = await sb.rpc("admin_upsert_carte", { p_token: tok(), p_id: null, p_classe: classeTrim, p_categorie_nom: (cat || "général").trim(), p_recto: recto.trim(), p_verso_reponse: reponse.trim(), p_verso_explication: expl ? expl.trim() : null, p_masque: false });
      if (error) throw error;
    });
    if (classesInconnues.size) {
      NexiGamify.toast(`${ok} importée(s), ${fail} rejetée(s) — classe(s) non reconnue(s) : ${[...classesInconnues].join(", ")}`, "error");
    } else {
      NexiGamify.toast(`${ok} carte(s) importée(s)${fail ? `, ${fail} échec(s)` : ""}.`, fail ? "error" : "success");
    }
    renderCartes();
  });
}

// =========================================================
// CARTES DE RÉVISION PAR COURS (v2) + IMPORT EN MASSE
// Bascule automatiquement sur l'ancien écran (renderCartesLegacy) tant que
// le patch SQL « cours et import » n'est pas appliqué : déploiement sans risque.
// =========================================================
function isMissingFn(error) {
  const m = (error?.message || "").toLowerCase();
  return error?.code === "PGRST202" || m.includes("could not find the function") || m.includes("schema cache");
}

function adminAuthFail(error) {
  if (!/non autorisé/i.test(error?.message || "")) return false;
  NexiGamify.toast("Session admin expirée — reconnexion nécessaire.", "error");
  setTimeout(() => NexiAuth.logout(), 1500);
  return true;
}

const NexiImport = (function () {
  function detectDelim(t) {
    const l = t.split(/\r?\n/).find(x => x.trim()) || ""; const c = { "\t": 0, ";": 0, ",": 0 }; let q = false;
    for (const ch of l) { if (ch === '"') q = !q; else if (!q && ch in c) c[ch]++; }
    return Object.keys(c).sort((a, b) => c[b] - c[a])[0];
  }
  function parseTable(t, d) {
    const rows = []; let r = [], f = "", q = false, ln = 1, start = 1; t = t.replace(/^\uFEFF/, "");
    const push = () => { r.push(f); f = ""; };
    const end = () => { push(); if (r.some(x => x.trim() !== "")) rows.push({ ligne: start, c: r }); r = []; };
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (q) { if (ch === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else { if (ch === "\n") ln++; f += ch; } }
      else if (ch === '"' && f === "") q = true;
      else if (ch === d) push();
      else if (ch === "\r") { }
      else if (ch === "\n") { end(); ln++; start = ln; }
      else f += ch;
    }
    if (f !== "" || r.length) end();
    return rows;
  }
  const COLS = { classe: ["classe", "class"], cours: ["cours", "intitule", "matiere", "course"], recto: ["recto", "question"], verso: ["verso", "reponse", "answer"], explication: ["explication", "contenu", "explanation"] };
  const norm = s => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, "");
  function toRecords(rows) {
    if (!rows.length) return [];
    const h = rows[0].c.map(norm);
    const find = k => h.findIndex(x => COLS[k].some(a => x === a || x.includes(a)));
    const isHead = ["classe", "cours", "recto"].some(k => find(k) >= 0);
    let idx = { classe: 0, cours: 1, recto: 2, verso: 3, explication: 4 };
    if (isHead) { idx = {}; for (const k in COLS) { const i = find(k); if (i >= 0) idx[k] = i; } }
    return rows.slice(isHead ? 1 : 0).map(r => { const o = { ligne: r.ligne }; for (const k in idx) o[k] = (r.c[idx[k]] || "").trim(); return o; });
  }
  function chunk(a, n) { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }
  return { detectDelim, parseTable, toRecords, chunk };
})();

const cartesState = { classe: "", cours: "", search: "", page: 0, pageSize: 50 };
let coursCache = [];
let impRecords = [], impLot = null, impDernier = null;

async function renderCartes() {
  const { data: cours, error } = await sb.rpc("admin_list_cours", { p_token: tok() });
  if (error) {
    if (isMissingFn(error)) return renderCartesLegacy();
    if (adminAuthFail(error)) return;
    root.innerHTML = `<div class="empty-state"><h4>Erreur</h4><p>${esc(error.message || "")}</p></div>`; return;
  }
  coursCache = cours || [];
  const reels = coursCache.filter(c => c.id);
  const f = cartesState;
  const { data: cartes, error: e2 } = await sb.rpc("admin_list_cartes_v2", {
    p_token: tok(), p_classe: f.classe || null,
    p_cours_id: (f.cours && f.cours !== "__none") ? f.cours : null, p_sans_cours: f.cours === "__none",
    p_search: f.search || null, p_limit: f.pageSize, p_offset: f.page * f.pageSize
  });
  if (e2) { if (adminAuthFail(e2)) return; root.innerHTML = `<div class="empty-state"><h4>Erreur</h4><p>${esc(e2.message || "")}</p></div>`; return; }
  if (!(cartes && cartes.length) && f.page > 0) { f.page = 0; return renderCartes(); }
  const total = cartes && cartes.length ? Number(cartes[0].total) : 0;
  const pages = Math.max(1, Math.ceil(total / f.pageSize));
  const optCours = (selected, withNone) => `${withNone ? `<option value="">${withNone}</option>` : ""}${reels.map(c => `<option value="${c.id}" ${selected === c.id ? "selected" : ""}>${esc((c.icone || "") + " " + c.nom)}</option>`).join("")}`;

  root.innerHTML = `
    <h2>Cartes de révision</h2>

    <h3>Cours</h3>
    <p style="font-size:.82rem;">Les élèves voient ces cours quand ils ouvrent « Cartes de révision » (seuls ceux qui contiennent des cartes pour leur classe).</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Cours</th><th>Cartes</th><th>Visible</th><th></th></tr></thead>
      <tbody>${coursCache.map(c => `
        <tr><td>${esc((c.icone || "") + " " + c.nom)}</td><td>${c.nb_cartes}</td>
        <td>${c.id ? (c.actif ? "Oui" : "Masqué") : "—"}</td>
        <td>${c.id ? `<button class="btn secondary" data-cours-edit="${c.id}" style="padding:4px 10px;">Éditer</button>
          <button class="btn ghost" data-cours-del="${c.id}" style="color:var(--coral);">Suppr.</button>` : `<span style="font-size:.8rem;">affichées dans « Autres »</span>`}</td></tr>`).join("")}
      </tbody>
    </table></div>
    <button class="btn secondary" id="btn-new-cours" style="margin-top:10px;">+ Nouveau cours</button>

    <h3 style="margin-top:26px;">Cartes (${total})</h3>
    <div class="card" style="display:flex;gap:8px;flex-wrap:wrap;">
      <select id="f-classe"><option value="">Toutes les classes</option>${window.NEXI_CONFIG.CLASSES.map(cl => `<option value="${cl.code}" ${f.classe === cl.code ? "selected" : ""}>${cl.libelle}</option>`).join("")}</select>
      <select id="f-cours">${optCours(f.cours, "Tous les cours")}<option value="__none" ${f.cours === "__none" ? "selected" : ""}>Sans cours</option></select>
      <input id="f-search" placeholder="Rechercher…" value="${esc(f.search)}">
      <button class="btn secondary" id="f-go">Filtrer</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th><input type="checkbox" id="chk-all"></th><th>Recto</th><th>Classe</th><th>Cours</th><th>Visible</th><th></th></tr></thead>
      <tbody>${(cartes || []).map(c => `
        <tr><td><input type="checkbox" class="chk" value="${c.id}"></td><td>${esc(c.recto)}</td><td>${esc(c.classe)}</td><td>${esc(c.cours_nom || "—")}</td>
          <td><button class="btn secondary" data-toggle="${c.id}" style="padding:4px 10px;">${c.masque ? "Masquée" : "Visible"}</button></td>
          <td style="white-space:nowrap;"><button class="btn secondary" data-cedit="${c.id}" style="padding:4px 10px;">Éditer</button>
            <button class="btn ghost" data-del="${c.id}" style="color:var(--coral);">Suppr.</button></td></tr>`).join("") || `<tr><td colspan="6">Aucune carte.</td></tr>`}
      </tbody>
    </table></div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px;">
      <button class="btn secondary" id="pg-prev" ${f.page === 0 ? "disabled" : ""}>◀</button>
      <span>Page ${f.page + 1} / ${pages}</span>
      <button class="btn secondary" id="pg-next" ${f.page + 1 >= pages ? "disabled" : ""}>▶</button>
      <span style="flex:1"></span>
      <select id="bulk-cours"><option value="__none">Sans cours</option>${optCours("", "")}</select>
      <button class="btn secondary" id="bulk-go">Déplacer la sélection</button>
    </div>

    <h3 style="margin-top:26px;">Ajouter une carte</h3>
    <form id="form-c" class="card">
      <div class="field"><label>Recto (question)</label><input id="c-recto" required></div>
      <div class="field"><label>Verso — réponse</label><input id="c-reponse" required></div>
      <div class="field"><label>Verso — explication détaillée</label><textarea id="c-expl"></textarea></div>
      <div class="field"><label>Classe</label><select id="c-classe">${window.NEXI_CONFIG.CLASSES.map(cl => `<option value="${cl.code}">${cl.libelle}</option>`).join("")}</select></div>
      <div class="field"><label>Cours</label><select id="c-cours"><option value="">Sans cours</option>${optCours("")}</select></div>
      <button class="btn block" type="submit">Ajouter</button>
    </form>

    <h3 style="margin-top:26px;">Import en masse (classe entière, plusieurs cours)</h3>
    <p style="font-size:.82rem;">Collez depuis Excel / Google Sheets, ou choisissez un fichier .csv. Colonnes dans l'ordre : <code>classe, cours, recto, verso, explication</code> (en-tête facultatif ; classe = code, ex. 4SC, 3Litt, 1erHP).</p>
    <div class="card">
      <textarea id="imp-txt" placeholder="classe&#9;cours&#9;recto&#9;verso&#9;explication"></textarea>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
        <input type="file" id="imp-file" accept=".csv,.tsv,.txt">
        <select id="imp-mode"><option value="ajouter">Ajouter (ignorer les doublons)</option><option value="remplacer">Remplacer le contenu des cours concernés</option></select>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
        <button class="btn secondary" id="imp-check">Vérifier (rien n'est écrit)</button>
        <button class="btn secondary" id="imp-tpl">Télécharger un modèle</button>
      </div>
      <div id="imp-rep" style="margin-top:12px;"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
        <button class="btn" id="imp-go" disabled>Importer maintenant</button>
        <button class="btn ghost" id="imp-undo" style="display:none;color:var(--coral);">Annuler cet import</button>
        <button class="btn secondary" id="imp-notif" style="display:none;">📣 Notifier les élèves</button>
      </div>
      <p id="imp-msg" style="font-size:.85rem;"></p>
    </div>

    <h3 style="margin-top:26px;">Import rapide — ancien format (une carte par ligne)</h3>
    <p style="font-size:.82rem;">Format habituel <code>Recto:Réponse:Explication:Classe:Catégorie</code>, avec un 6ᵉ champ facultatif <code>:Cours</code> (créé s'il n'existe pas). Sans 6ᵉ champ, les catégories math / langue / svt sont rangées automatiquement dans Mathématiques / Langues / SVT.</p>
    <form id="form-c-import" class="card">
      <textarea id="c-import-text" placeholder="Capitale de la RDC ?:Kinshasa:Kinshasa est la capitale depuis 1966.:7EB:svt:Géographie"></textarea>
      <button class="btn secondary block" type="submit" style="margin-top:10px;">Importer</button>
    </form>
  `;

  // --- Cours : créer / éditer / supprimer
  document.getElementById("btn-new-cours").addEventListener("click", () => openCoursModal(null));
  root.querySelectorAll("[data-cours-edit]").forEach(b => b.addEventListener("click", () => openCoursModal(reels.find(c => c.id === b.dataset.coursEdit))));
  root.querySelectorAll("[data-cours-del]").forEach(b => b.addEventListener("click", async () => {
    const c = reels.find(x => x.id === b.dataset.coursDel);
    if (!confirm(`Supprimer le cours « ${c.nom} » ? Ses ${c.nb_cartes} carte(s) seront conservées dans « Sans cours ».`)) return;
    const { error } = await sb.rpc("admin_delete_cours", { p_token: tok(), p_id: c.id, p_supprimer_cartes: false });
    if (error) return NexiGamify.toast(error.message, "error");
    renderCartes();
  }));

  // --- Filtres, pagination
  document.getElementById("f-go").addEventListener("click", () => {
    cartesState.classe = document.getElementById("f-classe").value; cartesState.cours = document.getElementById("f-cours").value;
    cartesState.search = document.getElementById("f-search").value.trim(); cartesState.page = 0; renderCartes();
  });
  document.getElementById("pg-prev").addEventListener("click", () => { cartesState.page--; renderCartes(); });
  document.getElementById("pg-next").addEventListener("click", () => { cartesState.page++; renderCartes(); });

  // --- Actions sur les cartes
  root.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
    if (!confirm("Supprimer définitivement cette carte ?")) return;
    const { error } = await sb.rpc("admin_delete_carte", { p_token: tok(), p_id: b.dataset.del });
    if (error) return NexiGamify.toast(error.message, "error");
    renderCartes();
  }));
  root.querySelectorAll("[data-cedit]").forEach(b => b.addEventListener("click", () => openCarteModal(cartes.find(x => x.id === b.dataset.cedit), reels)));
  root.querySelectorAll("[data-toggle]").forEach(b => b.addEventListener("click", async () => {
    const c = cartes.find(x => x.id === b.dataset.toggle);
    const { error } = await sb.rpc("admin_upsert_carte_v2", { p_token: tok(), p_id: c.id, p_classe: c.classe, p_cours_id: c.cours_id, p_recto: c.recto, p_verso_reponse: c.verso_reponse, p_verso_explication: c.verso_explication, p_masque: !c.masque });
    if (error) return NexiGamify.toast(error.message, "error");
    renderCartes();
  }));
  document.getElementById("chk-all").addEventListener("change", e => root.querySelectorAll(".chk").forEach(c => { c.checked = e.target.checked; }));
  document.getElementById("bulk-go").addEventListener("click", async () => {
    const ids = [...root.querySelectorAll(".chk:checked")].map(c => c.value);
    if (!ids.length) return NexiGamify.toast("Cochez d'abord des cartes.", "error");
    const dest = document.getElementById("bulk-cours").value;
    const { data, error } = await sb.rpc("admin_assigner_cours", { p_token: tok(), p_ids: ids, p_cours_id: dest === "__none" ? null : dest });
    if (error) return NexiGamify.toast(error.message, "error");
    NexiGamify.toast(`${data} carte(s) déplacée(s).`, "success"); renderCartes();
  });
  document.getElementById("form-c").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { error } = await sb.rpc("admin_upsert_carte_v2", { p_token: tok(), p_id: null, p_classe: document.getElementById("c-classe").value, p_cours_id: document.getElementById("c-cours").value || null, p_recto: document.getElementById("c-recto").value, p_verso_reponse: document.getElementById("c-reponse").value, p_verso_explication: document.getElementById("c-expl").value || null, p_masque: false });
    if (error) return NexiGamify.toast(error.message, "error");
    NexiGamify.toast("Carte ajoutée.", "success"); renderCartes();
  });

  // --- Import rapide, ancien format (conservé à l'identique + cours facultatif)
  document.getElementById("form-c-import").addEventListener("submit", async (e) => {
    e.preventDefault();
    const lines = document.getElementById("c-import-text").value.split("\n").map(l => l.trim()).filter(Boolean);
    // La classe est un champ LIBRE ici : une faute de frappe créerait des cartes invisibles pour toujours.
    const codesValides = new Set(window.NEXI_CONFIG.CLASSES.map(c => c.code));
    const classesInconnues = new Set();
    const nrm = t => (t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
    const parCategorie = { math: "mathematiques", langue: "langues", svt: "svt" };
    const coursParNom = new Map(reels.map(c => [nrm(c.nom), c.id]));
    const creations = new Map();
    const coursExistantOuNouveau = (nom) => {
      const k = nrm(nom);
      if (coursParNom.has(k)) return Promise.resolve(coursParNom.get(k));
      if (!creations.has(k)) creations.set(k, (async () => {
        const { data, error } = await sb.rpc("admin_upsert_cours", { p_token: tok(), p_id: null, p_nom: nom.trim(), p_icone: null, p_ordre: 100, p_actif: true, p_categorie_nom: null });
        if (error) throw error; coursParNom.set(k, data); return data;
      })());
      return creations.get(k);
    };
    const { ok, fail } = await runBatched(lines, async (line) => {
      const [recto, reponse, expl, classe, cat, cours] = line.split(":");
      if (!recto || !reponse) throw new Error("ligne invalide");
      const classeTrim = (classe || "").trim();
      if (!codesValides.has(classeTrim)) { classesInconnues.add(classeTrim || "(vide)"); throw new Error("classe inconnue : " + classeTrim); }
      const { data: id, error } = await sb.rpc("admin_upsert_carte", { p_token: tok(), p_id: null, p_classe: classeTrim, p_categorie_nom: (cat || "général").trim(), p_recto: recto.trim(), p_verso_reponse: reponse.trim(), p_verso_explication: expl ? expl.trim() : null, p_masque: false });
      if (error) throw error;
      const cid = (cours || "").trim() ? await coursExistantOuNouveau(cours) : coursParNom.get(parCategorie[nrm(cat)]);
      if (cid && id) { const r = await sb.rpc("admin_assigner_cours", { p_token: tok(), p_ids: [id], p_cours_id: cid }); if (r.error) throw r.error; }
    });
    if (classesInconnues.size) NexiGamify.toast(`${ok} importée(s), ${fail} rejetée(s) — classe(s) non reconnue(s) : ${[...classesInconnues].join(", ")}`, "error");
    else NexiGamify.toast(`${ok} carte(s) importée(s)${fail ? `, ${fail} échec(s)` : ""}.`, fail ? "error" : "success");
    renderCartes();
  });

  // --- Import en masse
  document.getElementById("imp-file").addEventListener("change", async e => { const fl = e.target.files[0]; if (fl) document.getElementById("imp-txt").value = await fl.text(); });
  document.getElementById("imp-tpl").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\uFEFFclasse;cours;recto;verso;explication\n4SC;Chimie;Formule de l'eau ?;H2O;Deux atomes d'hydrogène et un d'oxygène\n"], { type: "text/csv" }));
    a.download = "modele-cartes.csv"; a.click();
  });
  document.getElementById("imp-check").addEventListener("click", impVerifier);
  document.getElementById("imp-go").addEventListener("click", impImporter);
  document.getElementById("imp-undo").addEventListener("click", impAnnuler);
  document.getElementById("imp-notif").addEventListener("click", impNotifier);
}

function openCoursModal(c) {
  const modal = openModal(`
    <h3>${c ? "Éditer" : "Nouveau"} cours</h3>
    <div class="field"><label>Nom du cours</label><input id="co-nom" value="${c ? esc(c.nom) : ""}" placeholder="Ex. Chimie"></div>
    <div class="field"><label>Icône (emoji, facultatif)</label><input id="co-ico" value="${c ? esc(c.icone || "") : ""}" placeholder="🧪"></div>
    <div class="field"><label>Ordre d'affichage (petit = en premier)</label><input id="co-ord" type="number" value="${c ? c.ordre : 100}"></div>
    <div class="field"><label>Catégorie liée (facultatif)</label><select id="co-cat">${["", "math", "langue", "svt", "spc"].map(v => `<option value="${v}" ${c && (c.categorie_nom || "") === v ? "selected" : ""}>${v || "Aucune"}</option>`).join("")}</select></div>
    <div class="field"><label><input type="checkbox" id="co-act" ${!c || c.actif ? "checked" : ""}> Visible par les élèves</label></div>
    <button class="btn block" id="co-save">Enregistrer</button>
  `);
  modal.querySelector("#co-save").addEventListener("click", async () => {
    const { error } = await sb.rpc("admin_upsert_cours", { p_token: tok(), p_id: c ? c.id : null, p_nom: modal.querySelector("#co-nom").value, p_icone: modal.querySelector("#co-ico").value, p_ordre: parseInt(modal.querySelector("#co-ord").value, 10) || 100, p_actif: modal.querySelector("#co-act").checked, p_categorie_nom: modal.querySelector("#co-cat").value || null });
    if (error) return NexiGamify.toast(error.message, "error");
    modal.remove(); NexiGamify.toast("Enregistré.", "success"); renderCartes();
  });
}

function openCarteModal(c, reels) {
  const modal = openModal(`
    <h3>Éditer la carte</h3>
    <div class="field"><label>Recto (question)</label><textarea id="ce-recto">${esc(c.recto)}</textarea></div>
    <div class="field"><label>Verso — réponse</label><textarea id="ce-rep">${esc(c.verso_reponse)}</textarea></div>
    <div class="field"><label>Verso — explication détaillée</label><textarea id="ce-exp">${esc(c.verso_explication || "")}</textarea></div>
    <div class="field"><label>Classe</label><select id="ce-classe">${window.NEXI_CONFIG.CLASSES.map(cl => `<option value="${cl.code}" ${c.classe === cl.code ? "selected" : ""}>${cl.libelle}</option>`).join("")}</select></div>
    <div class="field"><label>Cours</label><select id="ce-cours"><option value="">Sans cours</option>${reels.map(r => `<option value="${r.id}" ${c.cours_id === r.id ? "selected" : ""}>${esc((r.icone || "") + " " + r.nom)}</option>`).join("")}</select></div>
    <div class="field"><label><input type="checkbox" id="ce-vis" ${c.masque ? "" : "checked"}> Visible par les élèves</label></div>
    <button class="btn block" id="ce-save">Enregistrer</button>
  `);
  modal.querySelector("#ce-save").addEventListener("click", async () => {
    const { error } = await sb.rpc("admin_upsert_carte_v2", { p_token: tok(), p_id: c.id, p_classe: modal.querySelector("#ce-classe").value, p_cours_id: modal.querySelector("#ce-cours").value || null, p_recto: modal.querySelector("#ce-recto").value, p_verso_reponse: modal.querySelector("#ce-rep").value, p_verso_explication: modal.querySelector("#ce-exp").value || null, p_masque: !modal.querySelector("#ce-vis").checked });
    if (error) return NexiGamify.toast(error.message, "error");
    modal.remove(); NexiGamify.toast("Carte enregistrée.", "success"); renderCartes();
  });
}

async function impCall(args) {
  for (let essai = 0; ; essai++) {
    const { data, error } = await sb.rpc("admin_import_cartes", args);
    if (!error) return data;
    if (adminAuthFail(error)) throw new Error("session expirée");
    if (essai >= 1) throw new Error(error.message);
    await new Promise(r => setTimeout(r, 800));   // un seul nouvel essai (sans risque : l'import ignore les doublons)
  }
}

async function impRun(apply) {
  const mode = document.getElementById("imp-mode").value;
  const out = { a_importer: 0, importees: 0, doublons: 0, nb_erreurs: 0, erreurs: [], nouveaux: new Set(), pairs: new Map() };
  let faites = 0;
  for (const part of NexiImport.chunk(impRecords, apply ? 200 : 500)) {
    const r = await impCall({ p_token: tok(), p_rows: part, p_mode: mode, p_apply: apply, p_lot: impLot, p_creer_cours: true });
    out.a_importer += r.a_importer; out.importees += r.importees; out.doublons += r.doublons; out.nb_erreurs += r.nb_erreurs;
    r.erreurs.forEach(e => out.erreurs.length < 200 && out.erreurs.push(e));
    r.nouveaux_cours.forEach(n => out.nouveaux.add(n));
    r.resume.forEach(x => {
      const k = x.classe + "|" + x.cours.toLowerCase(), o = out.pairs.get(k);
      out.pairs.set(k, { classe: x.classe, cours: x.cours, nb: (o ? o.nb : 0) + x.nb, existantes: o ? o.existantes : x.existantes, nouveau: x.nouveau_cours && (!o || o.nouveau) });
    });
    faites += part.length;
    document.getElementById("imp-msg").textContent = `${apply ? "Import" : "Vérification"} : ${faites} / ${impRecords.length} ligne(s)…`;
  }
  return out;
}

async function impVerifier() {
  const t = document.getElementById("imp-txt").value;
  if (!t.trim()) return;
  const rep = document.getElementById("imp-rep"), msg = document.getElementById("imp-msg");
  impRecords = NexiImport.toRecords(NexiImport.parseTable(t, NexiImport.detectDelim(t)));
  impLot = crypto.randomUUID();
  const bCheck = document.getElementById("imp-check"); bCheck.disabled = true;
  document.getElementById("imp-go").disabled = true; document.getElementById("imp-undo").style.display = "none"; document.getElementById("imp-notif").style.display = "none"; msg.textContent = "";
  rep.textContent = "Vérification de " + impRecords.length + " ligne(s)…";
  try {
    const o = await impRun(false); msg.textContent = "";
    const rem = document.getElementById("imp-mode").value === "remplacer";
    const del = [...o.pairs.values()].reduce((s, x) => s + x.existantes, 0);
    rep.innerHTML = `
      <p><b>${impRecords.length}</b> ligne(s) lue(s) · <b style="color:var(--mint,#37E29A)">${o.a_importer}</b> à importer · <b>${o.doublons}</b> doublon(s) ignoré(s) · <b style="color:${o.nb_erreurs ? "var(--coral)" : "inherit"}">${o.nb_erreurs}</b> erreur(s)</p>
      ${o.nouveaux.size ? `<p>Nouveaux cours qui seront créés : <b>${[...o.nouveaux].map(esc).join(", ")}</b><br><span style="font-size:.8rem;">Vérifiez l'orthographe : « Maths » et « Mathématiques » seraient deux cours différents.</span></p>` : ""}
      ${rem ? `<p style="color:var(--coral);"><b>Mode « remplacer » :</b> ${del} carte(s) existante(s) de ces cours seront supprimées avant l'import.</p>` : ""}
      <div class="table-wrap"><table><thead><tr><th>Classe</th><th>Cours</th><th>Cartes</th><th>Déjà en base</th></tr></thead><tbody>
        ${[...o.pairs.values()].map(x => `<tr><td>${esc(x.classe)}</td><td>${esc(x.cours)}${x.nouveau ? " <i>(nouveau)</i>" : ""}</td><td>${x.nb}</td><td>${x.existantes}</td></tr>`).join("")}
      </tbody></table></div>
      ${o.erreurs.length ? `<details open><summary style="color:var(--coral);">Lignes ignorées</summary><div class="table-wrap"><table><tbody>${o.erreurs.map(e => `<tr><td>ligne ${e.ligne}</td><td>${esc(e.message)}</td></tr>`).join("")}</tbody></table></div></details>` : ""}`;
    document.getElementById("imp-go").disabled = o.a_importer === 0;
  } catch (e) { msg.textContent = ""; rep.innerHTML = `<p style="color:var(--coral);">Erreur : ${esc(e.message)}</p>`; }
  bCheck.disabled = false;
}

async function impImporter() {
  if (document.getElementById("imp-mode").value === "remplacer" && !confirm("Les cartes existantes des cours concernés vont être supprimées. Continuer ?")) return;
  const msg = document.getElementById("imp-msg"), go = document.getElementById("imp-go");
  go.disabled = true; document.getElementById("imp-check").disabled = true; msg.textContent = "Import en cours…"; impDernier = null;
  try {
    const o = await impRun(true); impDernier = o;
    msg.textContent = `Terminé : ${o.importees} carte(s) importée(s), ${o.doublons} doublon(s) ignoré(s), ${o.nb_erreurs} ligne(s) en erreur.`;
    NexiGamify.toast(`${o.importees} carte(s) importée(s).`, "success");
  } catch (e) { msg.textContent = "Interrompu : " + e.message + " — le lot déjà importé peut être annulé."; }
  document.getElementById("imp-undo").style.display = "inline-block";
  if (impDernier && impDernier.importees > 0) document.getElementById("imp-notif").style.display = "inline-block";
  document.getElementById("imp-check").disabled = false;
}

async function impAnnuler() {
  if (!confirm("Supprimer toutes les cartes créées par cet import ?")) return;
  const { data, error } = await sb.rpc("admin_annuler_import", { p_token: tok(), p_lot: impLot });
  if (error) return NexiGamify.toast(error.message, "error");
  NexiGamify.toast(`${data} carte(s) supprimée(s).`, "success"); renderCartes();
}

// =========================================================
// NOTIFICATIONS (admin) — onglet ajouté par le script, aucune modification de admin.html
// =========================================================
function injectNotifTab() {
  const tabs = document.querySelector(".admin-tabs");
  if (!tabs || tabs.querySelector('[data-view="notifs"]')) return;
  const b = document.createElement("button");
  b.dataset.view = "notifs"; b.textContent = "🔔 Notifications";
  b.addEventListener("click", () => {
    tabs.querySelectorAll("button").forEach(x => x.classList.remove("active"));
    b.classList.add("active"); render("notifs");
  });
  tabs.appendChild(b);
}

async function renderNotifs() {
  const { data: liste, error } = await sb.rpc("admin_list_notifications", { p_token: tok(), p_limit: 50 });
  if (error) {
    if (adminAuthFail(error)) return;
    root.innerHTML = isMissingFn(error)
      ? `<div class="empty-state"><h4>Notifications non activées</h4><p>Exécutez d'abord le patch SQL « notifications » dans Supabase.</p></div>`
      : `<div class="empty-state"><h4>Erreur</h4><p>${esc(error.message || "")}</p></div>`;
    return;
  }
  const ICONES = { defi: "🎯", cartes: "🗂️", message: "📢" };
  const quand = (iso) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  const push = await pushEtat(true);
  const envoyeLe = new Map(((push && push.etat && push.etat.recentes) || []).map(x => [x.id, x.push_envoye_at]));
  const pushManuel = !!(push && !push.absent && !push.etat.auto_actif);
  const cellulePush = (n) => envoyeLe.get(n.id) ? `<small>📲 envoyé</small>` : pushManuel ? `<button class="btn secondary" data-npush="${n.id}" style="padding:4px 10px;">📲 Envoyer</button>` : "—";
  root.innerHTML = `
    <h2>Notifications</h2>
    ${carteAlertesPush(push)}
    <p style="font-size:.82rem;">Les élèves voient une pastille 🔔 dans l'app. Un message « Nouveau défi » part automatiquement quand vous publiez un défi ; pour les cartes, utilisez le bouton « Notifier » après un import.</p>
    <form id="form-n" class="card">
      <div class="field"><label>Destinataires</label><select id="n-classe"><option value="">Tous les élèves</option>${window.NEXI_CONFIG.CLASSES.map(c => `<option value="${c.code}">${c.libelle}</option>`).join("")}</select></div>
      <div class="field"><label>Type</label><select id="n-type"><option value="message">📢 Message</option><option value="cartes">🗂️ Nouvelles cartes</option><option value="defi">🎯 Défi</option></select></div>
      <div class="field"><label>Titre (80 caractères max)</label><input id="n-titre" maxlength="80" required></div>
      <div class="field"><label>Message (facultatif, 300 caractères max)</label><textarea id="n-corps" maxlength="300"></textarea></div>
      ${pushManuel ? `<label style="display:block;margin:8px 0;"><input type="checkbox" id="n-push" checked> 📲 Envoyer aussi sur les téléphones (même appli fermée)</label>` : ""}
      <button class="btn block" type="submit">Envoyer</button>
    </form>
    <h3 style="margin-top:26px;">Historique</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Pour</th><th>Notification</th><th>Vu par</th><th>Téléphones</th><th></th></tr></thead>
      <tbody>${(liste || []).map(n => `
        <tr><td>${quand(n.created_at)}</td><td>${n.classe ? esc(n.classe) : "Tous"}</td>
        <td>${ICONES[n.type] || "🔔"} <b>${esc(n.titre)}</b>${n.corps ? `<br><small>${esc(n.corps)}</small>` : ""}</td>
        <td>${n.nb_vues} / ${n.nb_destinataires}</td><td>${cellulePush(n)}</td>
        <td><button class="btn ghost" data-ndel="${n.id}" style="color:var(--coral);">Suppr.</button></td></tr>`).join("") || `<tr><td colspan="6">Aucune notification envoyée.</td></tr>`}
      </tbody>
    </table></div>`;
  document.getElementById("form-n").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { data: nid, error: err } = await sb.rpc("admin_envoyer_notification", {
      p_token: tok(), p_classe: document.getElementById("n-classe").value || null, p_titre: document.getElementById("n-titre").value,
      p_corps: document.getElementById("n-corps").value || null, p_type: document.getElementById("n-type").value
    });
    if (err) { if (adminAuthFail(err)) return; return NexiGamify.toast(err.message, "error"); }
    NexiGamify.toast("Notification envoyée.", "success");
    const casePush = document.getElementById("n-push");
    if (casePush && casePush.checked) await pousserNotification(nid);
    renderNotifs();
  });
  root.querySelectorAll("[data-npush]").forEach(b => b.addEventListener("click", async () => { b.disabled = true; await pousserNotification(b.dataset.npush); renderNotifs(); }));
  const bAuto = document.getElementById("push-auto");
  if (bAuto) bAuto.addEventListener("click", async () => {
    const { error: e2 } = await sb.rpc("admin_push_auto_set", { p_token: tok(), p_url: location.origin + "/api/push", p_actif: !push.etat.auto_actif });
    if (e2) return NexiGamify.toast(e2.message, "error");
    NexiGamify.toast(push.etat.auto_actif ? "Envoi automatique désactivé." : "Envoi automatique activé : chaque notification part sur les téléphones.", "success");
    renderNotifs();
  });
  root.querySelectorAll("[data-ndel]").forEach(b => b.addEventListener("click", async () => {
    if (!confirm("Supprimer cette notification ? Elle disparaîtra aussi chez les élèves.")) return;
    const { error: err } = await sb.rpc("admin_supprimer_notification", { p_token: tok(), p_id: b.dataset.ndel });
    if (err) return NexiGamify.toast(err.message, "error");
    renderNotifs();
  }));
}

// =========================================================
// ALERTES PUSH (admin) — envoi aux téléphones, état du serveur d'envoi, mode automatique
// =========================================================
let pushCache = null;    // { absent } | { etat, serveur }

async function pushEtat(force) {
  if (pushCache && !force) return pushCache;
  const { data: etat, error } = await sb.rpc("admin_push_etat", { p_token: tok() });
  if (error) { if (adminAuthFail(error)) return null; pushCache = { absent: true }; return pushCache; }
  let serveur = null;
  try { const r = await fetch("/api/push", { cache: "no-store" }); serveur = await r.json(); } catch (e) { serveur = null; }   // null = fichier api/push.js non déployé
  pushCache = { etat, serveur };
  return pushCache;
}

// Envoie une notification déjà enregistrée aux téléphones abonnés. Sans effet si le push n'est pas en place ou est déjà automatique.
async function pousserNotification(id) {
  const p = await pushEtat(false);
  if (!p || p.absent || p.etat.auto_actif) return null;
  if (!p.serveur || !p.serveur.ok) { NexiGamify.toast(p.serveur ? "Alertes téléphone : variables manquantes sur Vercel (voir le guide)." : "Alertes téléphone : fichier api/push.js non déployé (voir le guide).", "error"); return null; }
  try {
    const r = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notification_id: id, admin_token: tok() }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { NexiGamify.toast(`Push : ${j.error || "échec"}`, "error"); return null; }
    NexiGamify.toast(`📲 Push : ${j.envoyes} envoyé(s)${j.echecs ? `, ${j.echecs} échec(s)` : ""}${j.expires ? `, ${j.expires} abonnement(s) périmé(s) retiré(s)` : ""}${j.restants ? `, ${j.restants} restant(s) non envoyé(s) (réessayez)` : ""}.`, j.echecs || j.restants ? "error" : "success");
    return j;
  } catch (e) { NexiGamify.toast("Push : serveur injoignable.", "error"); return null; }
}

function carteAlertesPush(p) {
  if (!p || p.absent) return `<div class="card" style="font-size:.85rem;">📲 <b>Alertes sur téléphone</b> : non activées. Exécutez le patch SQL « push » (voir le guide) pour envoyer les notifications aux téléphones, même appli fermée.</div>`;
  const e = p.etat, ok = p.serveur && p.serveur.ok;
  const serveur = ok ? "✅ prêt" : p.serveur ? "❌ variables manquantes sur Vercel" : "❌ fichier api/push.js non déployé";
  const auto = e.auto_actif ? "✅ actif : chaque notification part automatiquement" : e.pg_net ? "inactif" : "indisponible (activez l'extension pg_net : Supabase › Database › Extensions)";
  return `<div class="card" style="font-size:.88rem;">📲 <b>Alertes sur téléphone</b><br>${e.appareils} appareil(s) abonné(s) · ${e.eleves} élève(s)<br>Serveur d'envoi : ${serveur}<br>Envoi automatique : ${auto}
    ${e.pg_net || e.auto_actif ? `<br><button class="btn secondary" id="push-auto" style="margin-top:6px;">${e.auto_actif ? "Désactiver l'envoi automatique" : "Activer l'envoi automatique"}</button>` : ""}</div>`;
}

// Bouton « Notifier » après un import de cartes : une notification par classe concernée
async function impNotifier() {
  if (!impDernier) return;
  const parClasse = {};
  for (const x of impDernier.pairs.values()) (parClasse[x.classe] = parClasse[x.classe] || []).push(x.cours);
  let envoyees = 0;
  for (const [classe, cours] of Object.entries(parClasse)) {
    const { data: nid, error } = await sb.rpc("admin_envoyer_notification", {
      p_token: tok(), p_classe: classe, p_titre: "Nouvelles cartes de révision",
      p_corps: ("À réviser : " + [...new Set(cours)].join(", ")).slice(0, 300), p_type: "cartes"
    });
    if (error) {
      if (adminAuthFail(error)) return;
      return NexiGamify.toast(isMissingFn(error) ? "Activez d'abord le patch SQL des notifications." : error.message, "error");
    }
    envoyees++;
    await pousserNotification(nid);      // sans effet si le push n'est pas en place ou s'il est automatique
  }
  document.getElementById("imp-notif").style.display = "none";
  NexiGamify.toast(`${envoyees} classe(s) notifiée(s).`, "success");
}

// =========================================================
// STOCKAGE, SÉCURITÉ ET ARCHIVAGE INTELLIGENT — onglet « 📦 Stockage »
// Rien n'est supprimé sans archive vérifiée ; tout est restaurable.
// =========================================================
const NexiArchive = (function () {
  const enc = new TextEncoder(), dec = new TextDecoder(), MAGIC = [0x4e, 0x58, 0x41, 0x31];   // "NXA1" = archive chiffrée

  function fmt(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + " o";
    const u = ["Ko", "Mo", "Go", "To"]; let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < 3);
    return (n >= 100 ? String(Math.round(n)) : n.toFixed(1).replace(".", ",")) + " " + u[i];
  }
  async function lire(stream) { return new Uint8Array(await new Response(stream).arrayBuffer()); }
  async function gzip(bytes) {
    if (typeof CompressionStream === "undefined") return bytes;
    const cs = new CompressionStream("gzip"), w = cs.writable.getWriter(); w.write(bytes); w.close(); return lire(cs.readable);
  }
  async function gunzip(bytes) {
    const ds = new DecompressionStream("gzip"), w = ds.writable.getWriter(); w.write(bytes); w.close(); return lire(ds.readable);
  }
  async function sha256Hex(bytes) {
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return Array.from(h, b => b.toString(16).padStart(2, "0")).join("");
  }
  async function cle(phrase, salt) {
    const base = await crypto.subtle.importKey("raw", enc.encode(phrase), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 200000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function emballer(obj, phrase) {
    const data = await gzip(enc.encode(JSON.stringify(obj)));
    if (!phrase) return data;
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cle(phrase, salt), data));
    const out = new Uint8Array(32 + ct.length); out.set(MAGIC, 0); out.set(salt, 4); out.set(iv, 20); out.set(ct, 32);
    return out;
  }
  const estChiffre = b => b.length > 32 && MAGIC.every((m, i) => b[i] === m);
  async function deballer(bytes, phrase) {
    let data = bytes;
    if (estChiffre(bytes)) {
      if (!phrase) throw new Error("PHRASE_REQUISE");
      try { data = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(20, 32) }, await cle(phrase, bytes.slice(4, 20)), bytes.slice(32))); }
      catch (e) { throw new Error("Phrase secrète incorrecte ou fichier abîmé."); }
    }
    if (data[0] === 0x1f && data[1] === 0x8b) data = await gunzip(data);
    return JSON.parse(dec.decode(data));
  }
  function blobEnB64(blob) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = () => rej(new Error("lecture impossible")); r.readAsDataURL(blob); });
  }
  function b64EnBytes(b64) { const s = atob(b64), o = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i); return o; }
  function telecharger(bytes, nom) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" })); a.download = nom; a.click();
  }
  function compter(obj) { const t = (obj && obj.tables) || {}; return Object.values(t).reduce((s, l) => s + (Array.isArray(l) ? l.length : 0), 0); }

  // Photo → JPEG 512 px (même logique que côté élève)
  async function compresserImage(blob, cote = 512) {
    const img = await new Promise((res, rej) => { const u = URL.createObjectURL(blob), i = new Image(); i.onload = () => { URL.revokeObjectURL(u); res(i); }; i.onerror = () => { URL.revokeObjectURL(u); rej(new Error("image illisible")); }; i.src = u; });
    const r = Math.min(1, cote / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.max(1, Math.round(img.naturalWidth * r)), h = Math.max(1, Math.round(img.naturalHeight * r));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0, w, h);
    let out = null;
    for (const q of [0.82, 0.7, 0.6]) { out = await new Promise(rs => c.toBlob(rs, "image/jpeg", q)); if (out && out.size <= 150 * 1024) break; }
    if (!out) throw new Error("compression impossible");
    return out;
  }

  function courbeSVG(histo) {
    if (!histo || histo.length < 2) return `<p style="font-size:.85rem;">L'historique se construit au fil des jours (un point par jour) : ouvrez ce panneau régulièrement.</p>`;
    const W = 600, H = 150, P = 6, max = Math.max(...histo.map(h => Math.max(h.db, h.fichiers)), 1);
    const x = i => P + (W - 2 * P) * (i / (histo.length - 1)), y = v => H - P - (H - 2 * P) * (v / max);
    const ligne = k => histo.map((h, i) => `${x(i).toFixed(1)},${y(h[k]).toFixed(1)}`).join(" ");
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;" role="img" aria-label="Évolution du stockage">
      <polyline fill="none" stroke="#29F1E0" stroke-width="2" points="${ligne("db")}"/><polyline fill="none" stroke="#8B7CFF" stroke-width="2" points="${ligne("fichiers")}"/></svg>
      <div style="font-size:.78rem;display:flex;gap:14px;flex-wrap:wrap;"><span style="color:#29F1E0;">● Base de données</span><span style="color:#8B7CFF;">● Photos</span>
      <span>${histo[0].jour} → ${histo[histo.length - 1].jour} · maximum ${fmt(max)}</span></div>`;
  }
  // Jours restants avant saturation au rythme observé (30 derniers points), ou null
  function joursAvantSaturation(histo, k, quota) {
    const h = (histo || []).slice(-30); if (h.length < 2) return null;
    const jours = (new Date(h[h.length - 1].jour) - new Date(h[0].jour)) / 86400000;
    const pente = (h[h.length - 1][k] - h[0][k]) / jours;
    if (!(jours > 0) || !(pente > 0)) return null;
    return Math.max(0, Math.ceil((quota - h[h.length - 1][k]) / pente));
  }
  return { fmt, gzip, gunzip, sha256Hex, emballer, deballer, blobEnB64, b64EnBytes, telecharger, compter, compresserImage, courbeSVG, joursAvantSaturation };
})();

function injectStockageTab() {
  const tabs = document.querySelector(".admin-tabs");
  if (!tabs || tabs.querySelector('[data-view="stockage"]')) return;
  const b = document.createElement("button");
  b.dataset.view = "stockage"; b.textContent = "📦 Stockage";
  b.addEventListener("click", () => {
    tabs.querySelectorAll("button").forEach(x => x.classList.remove("active"));
    b.classList.add("active"); render("stockage");
  });
  tabs.appendChild(b);
  rafraichirPastilleStockage();
}

// À chaque ouverture du panel : enregistre le point du jour et signale un problème sur l'onglet
async function rafraichirPastilleStockage() {
  const { data, error } = await sb.rpc("admin_stockage_etat", { p_token: tok() });
  if (error || !data) return;
  const b = document.querySelector('.admin-tabs [data-view="stockage"]');
  if (b) b.textContent = "📦 Stockage" + (data.niveau === "critique" ? " 🔴" : data.niveau === "attention" ? " 🟠" : "");
}

const stCheminAvatar = (url) => { const m = /\/avatars\/([^?#]+)/.exec(url || ""); return m ? decodeURIComponent(m[1]) : null; };

async function stExecuter(btn, fn) {
  const msg = document.getElementById("st-msg");
  if (btn) btn.disabled = true;
  try { await fn(msg); }
  catch (e) { if (!adminAuthFail(e)) NexiGamify.toast(e.message || String(e), "error"); msg.textContent = "Interrompu : " + (e.message || e); }
  finally { if (btn) btn.disabled = false; }
}

async function renderStockage() {
  const { data: s, error } = await sb.rpc("admin_stockage_etat", { p_token: tok() });
  if (error) {
    if (adminAuthFail(error)) return;
    root.innerHTML = isMissingFn(error)
      ? `<div class="empty-state"><h4>Suivi du stockage non activé</h4><p>Exécutez d'abord le patch SQL « stockage » dans Supabase.</p></div>`
      : `<div class="empty-state"><h4>Erreur</h4><p>${esc(error.message || "")}</p></div>`;
    return;
  }
  const A = NexiArchive, COUL = { ok: "#37E29A", info: "#29F1E0", attention: "#FFC857", critique: "#FF5D6C" }, ICO = { ok: "✅", info: "ℹ️", attention: "⚠️", critique: "🔴" };
  const niv = p => p >= s.seuils.critique ? "critique" : p >= s.seuils.attention ? "attention" : "ok";
  const barre = (titre, pct, utilise, quota, extra) => `
    <div style="margin:12px 0;"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;"><b>${titre}</b><span>${A.fmt(utilise)} / ${A.fmt(quota)} — ${pct} %</span></div>
    <div style="height:12px;border-radius:6px;background:rgba(127,127,127,.25);overflow:hidden;margin-top:4px;"><div style="height:100%;width:${Math.min(100, pct)}%;background:${COUL[niv(pct)]};"></div></div>
    ${extra ? `<div style="font-size:.78rem;opacity:.8;margin-top:3px;">${extra}</div>` : ""}</div>`;
  const jDb = A.joursAvantSaturation(s.historique, "db", s.quota_db), jF = A.joursAvantSaturation(s.historique, "fichiers", s.quota_fichiers);
  const duree = j => j > 3650 ? "plus de 10 ans" : j > 730 ? `environ ${Math.round(j / 365)} ans` : j > 60 ? `environ ${Math.round(j / 30)} mois` : `${j} jour(s)`;
  const proj = [jF != null ? `photos : ${duree(jF)}` : null, jDb != null ? `base : ${duree(jDb)}` : null].filter(Boolean);
  const critiques = (s.securite || []).filter(x => x.niveau === "critique");

  const sug = [];
  if (s.orphelines.n > 0) sug.push({ gain: s.orphelines.octets, action: "orph", bouton: "Nettoyer", titre: `Supprimer ${s.orphelines.n} ancienne(s) photo(s) remplacée(s)`, detail: `Plus utilisées par aucun élève. Libère ${A.fmt(s.orphelines.octets)}.` });
  if (s.lourdes.n > 0) sug.push({ gain: s.lourdes.octets * 0.9, action: "opt", bouton: "Alléger", titre: `Alléger ${s.lourdes.n} photo(s) lourde(s)`, detail: `Réduites à 512 px, même visage. Gain estimé : ${A.fmt(s.lourdes.octets * 0.9)}.` });
  if (s.inactifs.n > 0) sug.push({ gain: s.inactifs.octets, action: "arch", bouton: "Préparer l'archive", titre: `Archiver ${s.inactifs.n} élève(s) désactivé(s)`, detail: `Données et photos enregistrées dans un fichier, vérifié, puis retirées de la base. Restaurables. Environ ${A.fmt(s.inactifs.octets)}.` });
  sug.sort((a, b) => b.gain - a.gain);
  const confortable = Math.max(s.pct_db, s.pct_fichiers) < s.seuils.attention;
  const QUAND = iso => new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  const STATUT = { genere: "À vérifier", verifie: "Vérifiée", purge: "Espace libéré", restaure: "Restaurée" };

  root.innerHTML = `
    <h2>Stockage et sécurité</h2>
    ${critiques.length ? `<div class="card" style="border:1px solid ${COUL.critique};"><b style="color:${COUL.critique};">🔴 À traiter en priorité</b>${critiques.map(c => `<p style="margin:6px 0;"><b>${esc(c.titre)}</b><br><span style="font-size:.85rem;">${esc(c.detail)}</span></p>`).join("")}</div>` : ""}
    ${s.depasse_gratuit ? `<div class="card" style="border:1px solid ${COUL.attention};">Vos données dépassent les limites du plan gratuit. <b>Si vous êtes passé au plan Pro, sélectionnez « Pro » ci-dessous</b> : les seuils d'alerte se recalculent.</div>` : ""}

    <div class="card">
      ${barre("Base de données", s.pct_db, s.db_octets, s.quota_db, `dont vos données Nexi : ${A.fmt(s.db_public_octets)} (le reste est le système de Supabase)`)}
      ${barre("Photos de profil", s.pct_fichiers, s.fichiers_octets, s.quota_fichiers, `${s.nb_fichiers} fichier(s) · ${s.nb_eleves} élève(s)`)}
      ${proj.length ? `<p style="font-size:.85rem;">Au rythme actuel, saturation dans ${proj.join(" · ")}.</p>` : ""}
      <p style="font-size:.78rem;opacity:.8;">Le transfert sortant (5 Go/mois en gratuit) n'est pas mesurable ici : consultez <i>Settings › Usage</i> dans Supabase. Les photos allégées le réduisent aussi.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px;">
        <label>Plan Supabase :</label>
        <select id="st-plan"><option value="gratuit" ${s.plan === "gratuit" ? "selected" : ""}>Gratuit</option><option value="pro" ${s.plan === "pro" ? "selected" : ""}>Pro</option></select>
        <button class="btn secondary" id="st-plan-save">Enregistrer</button>
      </div>
      <details style="margin-top:8px;"><summary style="cursor:pointer;font-size:.85rem;">Quotas personnalisés (facultatif)</summary>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
          <input id="st-q-db" type="number" min="1" placeholder="Base (Mo)" value="${s.quota_db_perso ? Math.round(s.quota_db / 1048576) : ""}">
          <input id="st-q-f" type="number" min="1" placeholder="Photos (Mo)" value="${s.quota_fichiers_perso ? Math.round(s.quota_fichiers / 1048576) : ""}">
        </div><p style="font-size:.78rem;">Laissez vide pour utiliser les valeurs standard du plan.</p></details>
    </div>

    <h3 style="margin-top:22px;">Évolution</h3><div class="card">${A.courbeSVG(s.historique)}</div>

    <h3 style="margin-top:22px;">Sécurité</h3>
    <div class="card">${(s.securite || []).map(x => `<p style="margin:8px 0;">${ICO[x.niveau] || "•"} <b>${esc(x.titre)}</b><br><span style="font-size:.85rem;opacity:.85;">${esc(x.detail)}</span></p>`).join("")}</div>

    <h3 style="margin-top:22px;">${confortable ? "Optimisations facultatives" : "Libérer de l'espace — sans rien perdre"}</h3>
    ${confortable ? `<p style="font-size:.85rem;">Vous avez largement la place (${Math.max(s.pct_db, s.pct_fichiers)} %). Ces actions sont facultatives.</p>` : `<p style="font-size:.85rem;">Classées par gain d'espace. Les défis passés comptent dans le classement : ils ne sont jamais archivés.</p>`}
    ${sug.length ? sug.map(x => `<div class="card" style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;"><div style="min-width:220px;"><b>${esc(x.titre)}</b><br><span style="font-size:.85rem;">${esc(x.detail)}</span></div><button class="btn secondary" data-st-act="${x.action}">${x.bouton}</button></div>`).join("") : `<div class="card">Rien à optimiser pour le moment. 👌</div>`}

    <h3 style="margin-top:22px;">Sauvegarde et archives</h3>
    <div class="card">
      <div class="field"><label>Phrase secrète (facultative) — chiffre le fichier. Notez-la : sans elle, le fichier est illisible.</label><input id="st-pass" type="password" autocomplete="new-password"></div>
      <label style="display:block;margin:6px 0;"><input type="checkbox" id="st-photos" checked> Inclure les photos dans la sauvegarde complète</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn" id="st-backup">⬇️ Télécharger une sauvegarde complète</button>
        <button class="btn secondary" id="st-restore">♻️ Restaurer depuis une archive…</button>
      </div>
      <p id="st-msg" style="font-size:.85rem;margin-top:10px;"></p>
      <input type="file" id="st-file" accept=".nxa,.json,.gz" style="display:none;">
    </div>
    ${(s.journal || []).length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Contenu</th><th>Taille</th><th>État</th><th></th></tr></thead><tbody>
      ${s.journal.map(j => `<tr><td>${QUAND(j.created_at)}</td><td>${j.portee === "sauvegarde_complete" ? "Sauvegarde complète" : "Élèves désactivés"}${j.chiffre ? " 🔒" : ""}</td>
        <td>${j.portee === "sauvegarde_complete" ? `${j.nb_lignes} ligne(s)` : `${j.nb_eleves} élève(s), ${j.nb_lignes} ligne(s), ${j.nb_photos} photo(s)`}</td><td>${A.fmt(j.taille)}</td>
        <td>${j.portee === "sauvegarde_complete" ? "—" : STATUT[j.statut] || j.statut}</td>
        <td style="white-space:nowrap;">${j.portee !== "eleves_inactifs" ? "" : j.statut === "genere" ? `<button class="btn secondary" data-st-verif="${j.id}" style="padding:4px 10px;">Vérifier le fichier</button>` : j.statut === "verifie" ? `<button class="btn" data-st-purge="${j.id}" style="padding:4px 10px;">Libérer l'espace</button>` : ""}</td></tr>`).join("")}
      </tbody></table></div>` : ""}`;

  const $ = id => document.getElementById(id);
  $("st-plan-save").addEventListener("click", ev => stExecuter(ev.currentTarget, async () => {
    const { error: e } = await sb.rpc("admin_stockage_config_set", { p_token: tok(), p_plan: $("st-plan").value, p_quota_db_mo: parseInt($("st-q-db").value, 10) || null, p_quota_fichiers_mo: parseInt($("st-q-f").value, 10) || null });
    if (e) throw new Error(e.message);
    NexiGamify.toast("Plan enregistré : les seuils sont recalculés.", "success"); renderStockage();
  }));
  root.querySelectorAll("[data-st-act]").forEach(b => b.addEventListener("click", ev => stExecuter(ev.currentTarget, async () => {
    const a = b.dataset.stAct;
    if (a === "orph") await stNettoyerOrphelines(s.orphelines);
    else if (a === "opt") await stOptimiserPhotos();
    else if (a === "arch") await stArchiverGenerer();
  })));
  $("st-backup").addEventListener("click", ev => stExecuter(ev.currentTarget, stSauvegardeComplete));
  let mode = "";
  const choisir = m => { mode = m; $("st-file").value = ""; $("st-file").click(); };
  $("st-restore").addEventListener("click", () => choisir("restaurer"));
  root.querySelectorAll("[data-st-verif]").forEach(b => b.addEventListener("click", () => choisir("verifier")));
  root.querySelectorAll("[data-st-purge]").forEach(b => b.addEventListener("click", ev => stExecuter(ev.currentTarget, () => stArchiverLiberer(b.dataset.stPurge))));
  $("st-file").addEventListener("change", ev => {
    const f = ev.target.files[0]; if (!f) return;
    stExecuter(null, () => mode === "restaurer" ? stArchiveRestaurer(f) : stArchiveVerifier(f));
  });
}

// ----- 1) Supprimer les photos remplacées (plus utilisées par aucun élève)
async function stNettoyerOrphelines(prevu) {
  const msg = document.getElementById("st-msg");
  if (prevu && !confirm(`Supprimer ${prevu.n} ancienne(s) photo(s) remplacée(s) (${NexiArchive.fmt(prevu.octets)}) ? Aucune n'est utilisée par un élève.`)) return { total: 0, octets: 0 };
  let total = 0, octets = 0;
  for (let tour = 0; tour < 200; tour++) {
    const { data: liste, error } = await sb.rpc("admin_photos_a_traiter", { p_token: tok(), p_type: "orphelines", p_limit: 100 });
    if (error) throw new Error(error.message);
    if (!liste || !liste.length) break;
    const noms = liste.map(p => p.nom);
    const { data: suppr, error: e2 } = await sb.storage.from("avatars").remove(noms);
    if (e2) throw new Error(e2.message);
    if (!suppr || !suppr.length) throw new Error("suppression refusée par la base : exécutez le patch SQL « stockage »");
    total += suppr.length;
    octets += liste.filter(p => suppr.some(x => x.name === p.nom)).reduce((s, p) => s + Number(p.octets || 0), 0);
    msg.textContent = `${total} photo(s) supprimée(s)…`;
    if (suppr.length < noms.length) break;
  }
  if (prevu) { NexiGamify.toast(`${total} photo(s) supprimée(s) — ${NexiArchive.fmt(octets)} libérés.`, "success"); renderStockage(); }
  return { total, octets };
}

// ----- 2) Alléger les photos lourdes (même photo, 512 px)
async function stOptimiserPhotos() {
  const msg = document.getElementById("st-msg"), vus = new Set();
  if (!confirm("Alléger les photos lourdes ? Chaque photo est réduite à 512 px (qualité visuelle conservée) et remplace l'originale.")) return;
  let faites = 0, gagnes = 0, echecs = 0;
  for (let tour = 0; tour < 50; tour++) {
    const { data: liste, error } = await sb.rpc("admin_photos_a_traiter", { p_token: tok(), p_type: "lourdes", p_limit: 20 });
    if (error) throw new Error(error.message);
    const nouvelles = (liste || []).filter(p => !vus.has(p.nom));
    if (!nouvelles.length) break;
    for (const p of nouvelles) {
      vus.add(p.nom);
      try {
        const rep = await fetch(p.url); if (!rep.ok) throw new Error("téléchargement impossible");
        const leger = await NexiArchive.compresserImage(await rep.blob());
        if (leger.size >= Number(p.octets)) continue;
        const chemin = `${p.eleve_id}/${Date.now()}.jpg`;
        const up = await sb.storage.from("avatars").upload(chemin, leger, { upsert: true, contentType: "image/jpeg", cacheControl: "31536000" });
        if (up.error) throw up.error;
        const url = sb.storage.from("avatars").getPublicUrl(chemin).data.publicUrl;
        const { error: e3 } = await sb.rpc("admin_set_avatar", { p_token: tok(), p_eleve_id: p.eleve_id, p_url: url });
        if (e3) throw new Error(e3.message);
        await sb.storage.from("avatars").remove([p.nom]);   // l'ancienne est devenue orpheline
        faites++; gagnes += Number(p.octets) - leger.size;
      } catch (e) { echecs++; console.error("photo", p.nom, e); }
      msg.textContent = `${faites} photo(s) allégée(s)${echecs ? `, ${echecs} échec(s)` : ""}…`;
    }
  }
  NexiGamify.toast(`${faites} photo(s) allégée(s) — ${NexiArchive.fmt(gagnes)} libérés${echecs ? `, ${echecs} échec(s)` : ""}.`, echecs ? "error" : "success");
  renderStockage();
}

// ----- utilitaires d'archive
async function stPhotosDe(eleves, msg) {
  const photos = [], manquantes = [];
  let i = 0;
  for (const e of eleves) {
    i++; const nom = stCheminAvatar(e.avatar_url); if (!nom) continue;
    msg.textContent = `Photos : ${i} / ${eleves.length}…`;
    try {
      const rep = await fetch(e.avatar_url); if (!rep.ok) throw new Error("absente");
      const blob = await rep.blob();
      photos.push({ nom, type: blob.type || "image/jpeg", b64: await NexiArchive.blobEnB64(blob) });
    } catch (err) { manquantes.push(nom); }
  }
  return { photos, manquantes };
}

// ----- 3a) Archiver : générer le fichier (rien n'est encore retiré de la base)
async function stArchiverGenerer() {
  const msg = document.getElementById("st-msg"), phrase = document.getElementById("st-pass").value;
  const { data: cands, error } = await sb.rpc("admin_archive_candidats", { p_token: tok(), p_limit: 500 });
  if (error) throw new Error(error.message);
  if (!cands.length) { NexiGamify.toast("Aucun élève désactivé à archiver.", "success"); return; }
  const apercu = cands.slice(0, 15).map(c => `${c.identifiant} (${c.classe || "—"})`).join(", ");
  if (!confirm(`Préparer l'archive de ${cands.length} élève(s) désactivé(s) :\n${apercu}${cands.length > 15 ? "…" : ""}\n\nÉtape 1/3 : un fichier va être téléchargé. Rien n'est encore retiré de la base.`)) return;
  const ids = cands.map(c => c.id), tables = { eleves: [], defi_resultats: [], affinites_reponses: [] };
  for (const part of NexiImport.chunk(ids, 25)) {
    const { data, error: e2 } = await sb.rpc("admin_archive_donnees", { p_token: tok(), p_ids: part });
    if (e2) throw new Error(e2.message);
    for (const k of Object.keys(tables)) tables[k].push(...(data[k] || []));
    msg.textContent = `Lecture des données : ${tables.eleves.length} / ${ids.length} élève(s)…`;
  }
  const { photos, manquantes } = await stPhotosDe(tables.eleves, msg);
  const obj = { format: "nexi-archive", version: 1, portee: "eleves_inactifs", cree_le: new Date().toISOString(), ids, tables, photos };
  msg.textContent = "Compression" + (phrase ? " et chiffrement" : "") + "…";
  const bytes = await NexiArchive.emballer(obj, phrase), sha = await NexiArchive.sha256Hex(bytes);
  const { error: e3 } = await sb.rpc("admin_archive_enregistrer", { p_token: tok(), p_portee: "eleves_inactifs", p_ids: ids, p_sha256: sha, p_taille: bytes.length, p_nb_lignes: NexiArchive.compter(obj), p_nb_photos: photos.length, p_chiffre: !!phrase });
  if (e3) throw new Error(e3.message);
  NexiArchive.telecharger(bytes, `nexi-archive-eleves-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}.nxa`);
  NexiGamify.toast(`Archive créée (${NexiArchive.fmt(bytes.length)}). Étape 2/3 : vérifiez le fichier téléchargé.`, "success");
  if (manquantes.length) alert(`${manquantes.length} photo(s) étaient introuvables et ne sont pas dans l'archive (sans conséquence sur les données).`);
  renderStockage();
}

// ----- 3b) Vérifier : on ré-ouvre le fichier téléchargé et on le compare à ce qui a été enregistré
async function stArchiveVerifier(file) {
  const phrase = document.getElementById("st-pass").value, bytes = new Uint8Array(await file.arrayBuffer());
  let obj;
  try { obj = await NexiArchive.deballer(bytes, phrase); }
  catch (e) { throw new Error(e.message === "PHRASE_REQUISE" ? "Ce fichier est chiffré : saisissez la phrase secrète dans le champ prévu, puis recommencez." : e.message); }
  const sha = await NexiArchive.sha256Hex(bytes);
  const { data, error } = await sb.rpc("admin_archive_verifier", { p_token: tok(), p_sha256: sha, p_nb_lignes: NexiArchive.compter(obj) });
  if (error) throw new Error(error.message);
  NexiGamify.toast(`Fichier vérifié ✔ (${data.nb_eleves} élève(s), ${data.nb_photos} photo(s)). Étape 3/3 : vous pouvez libérer l'espace.`, "success");
  renderStockage();
}

// ----- 3c) Libérer l'espace : seulement pour une archive vérifiée
async function stArchiverLiberer(id) {
  if ((prompt("Les comptes archivés vont être retirés de la base (leurs données sont dans votre fichier vérifié, restaurables).\nTapez ARCHIVER pour confirmer.") || "").trim() !== "ARCHIVER") return;
  const { data, error } = await sb.rpc("admin_archive_purger", { p_token: tok(), p_id: id });
  if (error) throw new Error(error.message);
  const ph = await stNettoyerOrphelines(null);   // les photos des comptes archivés deviennent orphelines : on les retire
  NexiGamify.toast(`${data.eleves} élève(s) archivé(s), ${NexiArchive.fmt(ph.octets)} de photos libérés.`, "success");
  renderStockage();
}

// ----- 4) Restaurer depuis une archive
async function stArchiveRestaurer(file) {
  const msg = document.getElementById("st-msg"), phrase = document.getElementById("st-pass").value;
  let obj;
  try { obj = await NexiArchive.deballer(new Uint8Array(await file.arrayBuffer()), phrase); }
  catch (e) { throw new Error(e.message === "PHRASE_REQUISE" ? "Ce fichier est chiffré : saisissez la phrase secrète dans le champ prévu, puis recommencez." : e.message); }
  if (obj.format !== "nexi-archive") throw new Error("Ce fichier n'est pas une archive d'élèves (une sauvegarde complète sert de copie de secours).");
  const T = obj.tables, parEleve = (liste) => { const m = {}; (liste || []).forEach(r => (m[r.eleve_id] = m[r.eleve_id] || []).push(r)); return m; };
  const res = parEleve(T.defi_resultats), aff = parEleve(T.affinites_reponses);
  let restaures = 0, deja = 0, ignores = [], idsRestaures = new Set();
  for (const part of NexiImport.chunk(T.eleves || [], 20)) {
    const donnees = { eleves: part, defi_resultats: part.flatMap(e => res[e.id] || []), affinites_reponses: part.flatMap(e => aff[e.id] || []) };
    const { data, error } = await sb.rpc("admin_archive_restaurer", { p_token: tok(), p_donnees: donnees });
    if (error) throw new Error(error.message);
    restaures += data.eleves_restaures; deja += data.deja_presents; ignores = ignores.concat(data.eleves_ignores || []);
    (data.ids_restaures || []).forEach(i => idsRestaures.add(i));
    msg.textContent = `Restauration : ${restaures + deja + ignores.length} / ${T.eleves.length} élève(s)…`;
  }
  let photos = 0;
  for (const p of obj.photos || []) {
    if (!idsRestaures.has(p.nom.split("/")[0])) continue;
    const up = await sb.storage.from("avatars").upload(p.nom, new Blob([NexiArchive.b64EnBytes(p.b64)], { type: p.type }), { upsert: true, contentType: p.type, cacheControl: "31536000" });
    if (!up.error) photos++;
  }
  const sha = await NexiArchive.sha256Hex(new Uint8Array(await file.arrayBuffer()));
  await sb.rpc("admin_archive_marquer_restaure", { p_token: tok(), p_sha256: sha });
  const detail = `${restaures} élève(s) restauré(s), ${deja} déjà présent(s), ${photos} photo(s)`;
  if (ignores.length) alert(`${detail}.\n\nNon restaurés :\n` + ignores.map(i => `• ${i.identifiant} : ${i.motif}`).join("\n"));
  NexiGamify.toast(detail + ".", ignores.length ? "error" : "success");
  renderStockage();
}

// ----- 5) Sauvegarde complète (aucune suppression)
async function stSauvegardeComplete() {
  const msg = document.getElementById("st-msg"), phrase = document.getElementById("st-pass").value, avecPhotos = document.getElementById("st-photos").checked;
  const noms = ["ecoles", "superviseurs", "classes_ref", "eleves", "categories", "defis", "defi_questions", "defi_resultats", "affinites_questions", "affinites_reponses", "cartes_revision", "cours_revision", "notifications"];
  const tables = {};
  for (const t of noms) {
    tables[t] = [];
    for (let off = 0; ; off += 500) {
      const { data, error } = await sb.rpc("admin_export_table", { p_token: tok(), p_table: t, p_offset: off, p_limit: 500 });
      if (error) throw new Error(error.message);
      tables[t].push(...data); msg.textContent = `Lecture de « ${t} » : ${tables[t].length} ligne(s)…`;
      if (data.length < 500) break;
    }
  }
  const photos = avecPhotos ? (await stPhotosDe(tables.eleves, msg)).photos : [];
  const obj = { format: "nexi-sauvegarde", version: 1, cree_le: new Date().toISOString(), tables, photos };
  msg.textContent = "Compression" + (phrase ? " et chiffrement" : "") + "…";
  const bytes = await NexiArchive.emballer(obj, phrase), sha = await NexiArchive.sha256Hex(bytes);
  const { error } = await sb.rpc("admin_archive_enregistrer", { p_token: tok(), p_portee: "sauvegarde_complete", p_ids: null, p_sha256: sha, p_taille: bytes.length, p_nb_lignes: NexiArchive.compter(obj), p_nb_photos: photos.length, p_chiffre: !!phrase });
  if (error) throw new Error(error.message);
  NexiArchive.telecharger(bytes, `nexi-sauvegarde-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}.nxa`);
  NexiGamify.toast(`Sauvegarde téléchargée (${NexiArchive.fmt(bytes.length)}). Gardez-la en lieu sûr.`, "success");
  renderStockage();
}

// =========================================================
// TOURNOIS INTER-ÉCOLES (admin) — onglet « 🏆 Tournois » ajouté par le script
// =========================================================
function injectTournoiTab() {
  const tabs = document.querySelector(".admin-tabs");
  if (!tabs || tabs.querySelector('[data-view="tournois"]')) return;
  const b = document.createElement("button");
  b.dataset.view = "tournois"; b.textContent = "🏆 Tournois";
  b.addEventListener("click", () => {
    tabs.querySelectorAll("button").forEach(x => x.classList.remove("active"));
    b.classList.add("active"); render("tournois");
  });
  tabs.appendChild(b);
}

const TN_STATUT = { brouillon: "Brouillon", a_venir: "À venir", en_cours: "En cours", termine: "Terminé" };
const tnStatut = t => (!t.publie ? "brouillon" : t.statut);
const tnQuand = iso => new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
const tnVersLocal = iso => { const d = new Date(iso), p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
let tnCache = { ecoles: [], defis: [] };

async function renderTournois() {
  const { data: liste, error } = await sb.rpc("admin_list_tournois", { p_token: tok() });
  if (error) {
    if (adminAuthFail(error)) return;
    root.innerHTML = isMissingFn(error)
      ? `<div class="empty-state"><h4>Tournois non activés</h4><p>Exécutez d'abord le patch SQL « tournois » dans Supabase.</p></div>`
      : `<div class="empty-state"><h4>Erreur</h4><p>${esc(error.message || "")}</p></div>`;
    return;
  }
  const [{ data: ecoles }, { data: defis }] = await Promise.all([sb.rpc("admin_list_ecoles", { p_token: tok() }), sb.rpc("admin_list_defis", { p_token: tok() })]);
  tnCache = { ecoles: ecoles || [], defis: defis || [] };
  const nomEcole = id => (tnCache.ecoles.find(e => e.id === id) || {}).nom || "?";
  root.innerHTML = `
    <h2>Tournois inter-écoles</h2>
    <p style="font-size:.82rem;">Un tournoi réunit plusieurs écoles autour de défis réservés, sur une période donnée. Score d'une école = points de ses N meilleurs élèves ÷ N : équitable entre petites et grandes écoles.</p>
    <button class="btn" id="tn-new">＋ Nouveau tournoi</button>
    ${(liste || []).map(t => `
      <div class="card" style="margin-top:12px;">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;"><b>${esc(t.nom)}</b><span class="badge ${tnStatut(t) === "en_cours" ? "on" : ""}">${TN_STATUT[tnStatut(t)]}</span></div>
        <p style="font-size:.85rem;margin:6px 0;">${tnQuand(t.date_debut)} → ${tnQuand(t.date_fin)} · ${t.classes ? esc(t.classes.join(", ")) : "toutes les classes"} · top ${t.top_n}</p>
        <p style="font-size:.85rem;margin:6px 0;">${t.ecole_ids.length} école(s) : ${esc(t.ecole_ids.map(nomEcole).join(", ") || "—")} · ${t.defi_ids.length} défi(s)</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
          <button class="btn" data-tn-res="${t.id}">Résultats</button>
          <button class="btn secondary" data-tn-edit="${t.id}">Éditer</button>
          <button class="btn ghost" data-tn-del="${t.id}" style="color:var(--coral);">Supprimer</button></div>
      </div>`).join("") || `<div class="empty-state" style="margin-top:14px;"><h4>Aucun tournoi</h4><p>Créez le premier : choisissez les écoles, les classes, la période et les défis.</p></div>`}`;
  document.getElementById("tn-new").addEventListener("click", () => openTournoiModal(null));
  root.querySelectorAll("[data-tn-res]").forEach(b => b.addEventListener("click", () => renderTournoiResultats(b.dataset.tnRes, "")));
  root.querySelectorAll("[data-tn-edit]").forEach(b => b.addEventListener("click", () => openTournoiModal(liste.find(x => x.id === b.dataset.tnEdit))));
  root.querySelectorAll("[data-tn-del]").forEach(b => b.addEventListener("click", async () => {
    const t = liste.find(x => x.id === b.dataset.tnDel);
    if (!confirm(`Supprimer le tournoi « ${t.nom} » ? Les défis et leurs résultats sont conservés ; seul le classement du tournoi disparaît.`)) return;
    const { error: e } = await sb.rpc("admin_delete_tournoi", { p_token: tok(), p_id: t.id });
    if (e) return NexiGamify.toast(e.message, "error");
    renderTournois();
  }));
}

function openTournoiModal(t) {
  const maintenant = new Date(), debut = t ? tnVersLocal(t.date_debut) : tnVersLocal(maintenant), fin = t ? tnVersLocal(t.date_fin) : tnVersLocal(new Date(maintenant.getTime() + 7 * 86400000));
  const selClasses = new Set(t && t.classes ? t.classes : []), selEcoles = new Set(t ? t.ecole_ids : []), selDefis = new Set(t ? t.defi_ids : []);
  const modal = openModal(`<div style="max-height:78vh;overflow:auto;">
    <h3>${t ? "Éditer" : "Nouveau"} tournoi</h3>
    <div class="field"><label>Nom du tournoi</label><input id="tn-nom" maxlength="80" value="${t ? esc(t.nom) : ""}" placeholder="Ex. Tournoi de la rentrée"></div>
    <div class="field"><label>Description (facultatif)</label><textarea id="tn-desc">${t ? esc(t.description || "") : ""}</textarea></div>
    <div class="field"><label>Début</label><input id="tn-debut" type="datetime-local" value="${debut}"></div>
    <div class="field"><label>Fin</label><input id="tn-fin" type="datetime-local" value="${fin}"></div>
    <div class="field"><label>Nombre d'élèves comptés par école (top N)</label><input id="tn-top" type="number" min="1" max="100" value="${t ? t.top_n : 10}">
      <small>Score d'une école = points de ses N meilleurs élèves ÷ N. Un élève absent compte 0.</small></div>
    <div class="field"><label>Classes concernées (aucune cochée = toutes)</label>
      <div id="tn-classes" style="display:flex;flex-wrap:wrap;gap:6px 12px;">${window.NEXI_CONFIG.CLASSES.map(c => `<label style="white-space:nowrap;"><input type="checkbox" value="${c.code}" ${selClasses.has(c.code) ? "checked" : ""}> ${c.code}</label>`).join("")}</div></div>
    <div class="field"><label>Écoles inscrites</label>
      <div id="tn-ecoles">${tnCache.ecoles.map(e => `<label style="display:block;"><input type="checkbox" value="${e.id}" ${selEcoles.has(e.id) ? "checked" : ""}> ${esc(e.nom)}</label>`).join("") || "<i>Créez d'abord des écoles (onglet Établissements).</i>"}</div></div>
    <div class="field"><label>Défis du tournoi (un défi ne peut servir qu'à un seul tournoi)</label><div id="tn-defis"></div></div>
    <div class="field"><label><input type="checkbox" id="tn-publie" ${t && t.publie ? "checked" : ""}> Visible par les élèves et les superviseurs</label></div>
    <button class="btn block" id="tn-save">Enregistrer</button></div>`);
  const classesCochees = () => [...modal.querySelectorAll("#tn-classes input:checked")].map(i => i.value);
  const afficherDefis = () => {
    const cl = classesCochees(), coches = new Set([...modal.querySelectorAll("#tn-defis input:checked")].map(i => i.value));
    (selDefis.size && !modal.querySelector("#tn-defis input")) && selDefis.forEach(id => coches.add(id));
    const dispo = tnCache.defis.filter(d => !cl.length || cl.includes(d.classe));
    modal.querySelector("#tn-defis").innerHTML = dispo.map(d => {
      const pris = d.tournoi_id && (!t || d.tournoi_id !== t.id);
      return `<label style="display:block;${pris ? "opacity:.5;" : ""}"><input type="checkbox" value="${d.id}" ${coches.has(d.id) ? "checked" : ""} ${pris ? "disabled" : ""}> ${esc(d.titre)} <small>(${esc(d.classe || "—")}${d.publie ? "" : ", non publié"}${pris ? ", déjà dans un autre tournoi" : ""})</small></label>`;
    }).join("") || "<i>Aucun défi pour ces classes. Créez-les d'abord dans l'onglet Défis.</i>";
  };
  afficherDefis();
  modal.querySelector("#tn-classes").addEventListener("change", afficherDefis);
  modal.querySelector("#tn-save").addEventListener("click", async () => {
    const d = modal.querySelector("#tn-debut").value, f = modal.querySelector("#tn-fin").value;
    if (!d || !f) return NexiGamify.toast("Indiquez les dates de début et de fin.", "error");
    const { error } = await sb.rpc("admin_upsert_tournoi", {
      p_token: tok(), p_id: t ? t.id : null, p_nom: modal.querySelector("#tn-nom").value, p_description: modal.querySelector("#tn-desc").value || null,
      p_debut: new Date(d).toISOString(), p_fin: new Date(f).toISOString(), p_classes: classesCochees().length ? classesCochees() : null,
      p_top_n: parseInt(modal.querySelector("#tn-top").value, 10) || 10, p_publie: modal.querySelector("#tn-publie").checked,
      p_ecole_ids: [...modal.querySelectorAll("#tn-ecoles input:checked")].map(i => i.value),
      p_defi_ids: [...modal.querySelectorAll("#tn-defis input:checked")].map(i => i.value)
    });
    if (error) { if (adminAuthFail(error)) return; return NexiGamify.toast(error.message, "error"); }
    modal.remove(); NexiGamify.toast("Tournoi enregistré.", "success"); renderTournois();
  });
}

async function renderTournoiResultats(id, classe) {
  const { data: r, error } = await sb.rpc("admin_tournoi_resultats", { p_token: tok(), p_id: id, p_classe: classe || null, p_limit: 30 });
  if (error) { if (adminAuthFail(error)) return; return NexiGamify.toast(error.message, "error"); }
  const t = r.tournoi, MED = ["🥇", "🥈", "🥉"], classes = window.NEXI_CONFIG.CLASSES;
  root.innerHTML = `
    <button class="btn secondary" id="tn-back">← Tournois</button>
    <h2 style="margin-top:10px;">🏆 ${esc(t.nom)}</h2>
    <p>${TN_STATUT[t.publie ? t.statut : "brouillon"]} · ${tnQuand(t.date_debut)} → ${tnQuand(t.date_fin)} · top ${t.top_n}</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">
      <label>Niveau :</label>
      <select id="tn-classe"><option value="">Toutes les classes</option>${classes.map(c => `<option value="${c.code}" ${classe === c.code ? "selected" : ""}>${c.libelle}</option>`).join("")}</select>
      <button class="btn secondary" id="tn-csv">⬇️ Exporter (CSV)</button></div>
    <h3>Classement des écoles</h3>
    <div class="table-wrap"><table><thead><tr><th>Rang</th><th>École</th><th>Score</th><th>Participation</th><th>Points cumulés</th></tr></thead><tbody>
      ${r.classement_ecoles.map(x => `<tr><td>${MED[x.rang - 1] || x.rang}</td><td>${esc(x.ecole)}</td><td><b>${Number(x.score)}</b></td>
        <td>${x.participants} / ${x.eligibles}${x.eligibles ? ` (${Math.round(100 * x.participants / x.eligibles)} %)` : ""}</td><td>${Number(x.points_total)}</td></tr>`).join("") || `<tr><td colspan="5">Aucune école inscrite.</td></tr>`}
    </tbody></table></div>
    <h3 style="margin-top:20px;">Meilleurs élèves (30 premiers)</h3>
    <div class="table-wrap"><table><thead><tr><th>Rang</th><th>Pseudo</th><th>École</th><th>Classe</th><th>Défis</th><th>Points</th></tr></thead><tbody>
      ${r.top_eleves.map(x => `<tr><td>${x.rang}</td><td>${esc(x.identifiant)}</td><td>${esc(x.ecole)}</td><td>${esc(x.classe || "")}</td><td>${x.defis}</td><td><b>${Number(x.points)}</b></td></tr>`).join("") || `<tr><td colspan="6">Aucun résultat pour l'instant.</td></tr>`}
    </tbody></table></div>`;
  document.getElementById("tn-back").addEventListener("click", renderTournois);
  document.getElementById("tn-classe").addEventListener("change", e => renderTournoiResultats(id, e.target.value));
  document.getElementById("tn-csv").addEventListener("click", async () => {
    const { data: full, error: e2 } = await sb.rpc("admin_tournoi_resultats", { p_token: tok(), p_id: id, p_classe: document.getElementById("tn-classe").value || null, p_limit: 2000 });
    if (e2) return NexiGamify.toast(e2.message, "error");
    const c = v => `"${String(v ?? "").replace(/"/g, '""')}"`, L = [];
    L.push(`Tournoi;${c(t.nom)}`, "", "Classement des écoles", "Rang;École;Score;Points cumulés;Ont joué;Éligibles");
    full.classement_ecoles.forEach(x => L.push([x.rang, c(x.ecole), x.score, x.points_total, x.participants, x.eligibles].join(";")));
    L.push("", "Classement des élèves", "Rang;Pseudo;École;Classe;Défis;Points");
    full.top_eleves.forEach(x => L.push([x.rang, c(x.identifiant), c(x.ecole), c(x.classe), x.defis, x.points].join(";")));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\uFEFF" + L.join("\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `tournoi-${t.nom.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`; a.click();
  });
}

// =========================================================
// PROGRAMMES ET ÉCOLES SPÉCIALES (admin) — onglet « 🎓 Programmes »
// Un programme a ses propres classes ; son contenu (défis, cartes, affinités, tournois) a la même
// structure que le national mais reste séparé. Une école spéciale suit un programme.
// =========================================================
function injectProgrammesTab() {
  const tabs = document.querySelector(".admin-tabs");
  if (!tabs || tabs.querySelector('[data-view="programmes"]')) return;
  const b = document.createElement("button");
  b.dataset.view = "programmes"; b.textContent = "🎓 Programmes";
  b.addEventListener("click", () => {
    tabs.querySelectorAll("button").forEach(x => x.classList.remove("active"));
    b.classList.add("active"); render("programmes");
  });
  tabs.appendChild(b);
}
const nomProgramme = id => (window.NexiProgrammes && NexiProgrammes.nom(id)) || null;
const progBadge = ecole => ecole.programme_id ? `<span class="badge on">${esc(nomProgramme(ecole.programme_id) || "Spécial")}</span>` : "National";

async function renderProgrammes() {
  const { data: d, error } = await sb.rpc("admin_list_programmes", { p_token: tok() });
  if (error) {
    if (adminAuthFail(error)) return;
    root.innerHTML = isMissingFn(error)
      ? `<div class="empty-state"><h4>Programmes non activés</h4><p>Exécutez d'abord le patch SQL « programmes » dans Supabase.</p></div>`
      : `<div class="empty-state"><h4>Erreur</h4><p>${esc(error.message || "")}</p></div>`;
    return;
  }
  root.innerHTML = `
    <h2>Programmes et écoles spéciales</h2>
    <p style="font-size:.85rem;">Toutes les écoles suivent par défaut le <b>programme national</b>. Une <b>école spéciale</b> (bilingue, européenne…) suit son propre <b>programme</b> : ses propres classes et son propre contenu (défis, cartes de révision, affinités, tournois), avec exactement la même structure. Les contenus créés pour une classe du programme ne sont vus que par les élèves de cette classe.</p>
    <p style="font-size:.85rem;">${d.classement_separe ? "✅ Le classement général compare uniquement des élèves du même programme." : "⚠️ Le classement général n'est pas séparé par programme (la fonction actuelle a une forme inattendue) : envoyez-moi ce message."}</p>
    <div class="card">🇨🇩 <b>Programme national</b> · ${d.nb_ecoles_nationales} école(s)</div>
    <button class="btn" id="pg-new" style="margin-top:12px;">＋ Nouveau programme</button>
    ${d.programmes.map(p => `
      <div class="card" style="margin-top:14px;">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;"><b>🎓 ${esc(p.nom)}</b><span><span class="badge on">${esc(p.code)}</span>${p.langue ? ` ${esc(p.langue)}` : ""}</span></div>
        ${p.description ? `<p style="font-size:.85rem;margin:6px 0;">${esc(p.description)}</p>` : ""}
        <div class="table-wrap"><table><thead><tr><th>Classe</th><th>Libellé</th><th>Élèves</th><th>Défis</th><th>Cartes</th></tr></thead><tbody>
          ${p.niveaux.map(n => `<tr><td>${esc(n.code)}</td><td>${esc(n.libelle)}</td><td>${n.nb_eleves}</td><td>${n.nb_defis}</td><td>${n.nb_cartes}</td></tr>`).join("")}
        </tbody></table></div>
        <p style="font-size:.85rem;margin:8px 0;"><b>Écoles :</b> ${p.ecoles.map(e => `${esc(e.nom)} (${e.nb_eleves}/${e.limite_eleves})`).join(", ") || "aucune pour l'instant"} · <b>Affinités propres :</b> ${p.nb_affinites} question(s)</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn" data-pg-ecole="${p.id}">＋ École spéciale</button>
          <button class="btn secondary" data-pg-copie="${p.id}">Reprendre du contenu</button>
          <button class="btn secondary" data-pg-aff="${p.id}">Affinités</button>
          <button class="btn secondary" data-pg-edit="${p.id}">Éditer</button>
          <button class="btn ghost" data-pg-del="${p.id}" style="color:var(--coral);">Supprimer</button></div>
      </div>`).join("")}`;
  const trouver = id => d.programmes.find(x => x.id === id);
  document.getElementById("pg-new").addEventListener("click", () => openProgrammeModal(null));
  root.querySelectorAll("[data-pg-edit]").forEach(b => b.addEventListener("click", () => openProgrammeModal(trouver(b.dataset.pgEdit))));
  root.querySelectorAll("[data-pg-ecole]").forEach(b => b.addEventListener("click", () => openEcoleSpecialeModal(trouver(b.dataset.pgEcole), renderProgrammes)));
  root.querySelectorAll("[data-pg-copie]").forEach(b => b.addEventListener("click", () => openCopieModal(trouver(b.dataset.pgCopie))));
  root.querySelectorAll("[data-pg-aff]").forEach(b => b.addEventListener("click", () => renderAffinitesProgramme(trouver(b.dataset.pgAff))));
  root.querySelectorAll("[data-pg-del]").forEach(b => b.addEventListener("click", async () => {
    const p = trouver(b.dataset.pgDel);
    if (!confirm(`Supprimer le programme « ${p.nom} » ? (Possible seulement s'il n'a ni école, ni élève, ni contenu.)`)) return;
    const { error: e } = await sb.rpc("admin_delete_programme", { p_token: tok(), p_id: p.id });
    if (e) return NexiGamify.toast(e.message, "error");
    if (window.NexiProgrammes) await NexiProgrammes.charger();
    renderProgrammes();
  }));
}

function openProgrammeModal(p) {
  const modal = openModal(`<div style="max-height:78vh;overflow:auto;">
    <h3>${p ? "Éditer" : "Nouveau"} programme</h3>
    <div class="field"><label>Nom du programme</label><input id="pg-nom" maxlength="60" value="${p ? esc(p.nom) : ""}" placeholder="Ex. Programme bilingue"></div>
    <div class="field"><label>Code (2 à 6 lettres ou chiffres — préfixe des classes, non modifiable ensuite)</label><input id="pg-code" maxlength="6" value="${p ? esc(p.code) : ""}" ${p ? "disabled" : ""} placeholder="Ex. BIL"></div>
    <div class="field"><label>Langue d'enseignement (indicatif)</label><input id="pg-langue" value="${p ? esc(p.langue || "") : ""}" placeholder="Ex. fr/en"></div>
    <div class="field"><label>Description (facultatif)</label><textarea id="pg-desc">${p ? esc(p.description || "") : ""}</textarea></div>
    <div class="field"><label>Niveaux (classes) : une ligne par classe, « suffixe | libellé »</label>
      <textarea id="pg-niv" style="min-height:130px;font-family:monospace;" placeholder="6e | 6ème&#10;5e | 5ème&#10;4e | 4ème">${p ? esc(p.niveaux.map(n => `${n.suffixe} | ${n.libelle}`).join("\n")) : ""}</textarea>
      <small>Le code de chaque classe sera CODE-suffixe (ex. BIL-6e). Un niveau qui contient déjà des élèves ou du contenu ne peut plus être retiré.</small>
      <button class="btn secondary" type="button" id="pg-nat" style="margin-top:6px;">Reprendre les niveaux nationaux</button></div>
    <button class="btn block" id="pg-save">Enregistrer</button></div>`);
  modal.querySelector("#pg-nat").addEventListener("click", () => {
    modal.querySelector("#pg-niv").value = window.NEXI_CONFIG.CLASSES.filter(c => !c.programme_id).map(c => `${c.code} | ${c.libelle}`).join("\n");
  });
  modal.querySelector("#pg-save").addEventListener("click", async () => {
    const niveaux = modal.querySelector("#pg-niv").value.split("\n").map(l => l.trim()).filter(Boolean).map(l => {
      const i = l.indexOf("|"); return i < 0 ? { suffixe: l, libelle: l } : { suffixe: l.slice(0, i).trim(), libelle: l.slice(i + 1).trim() };
    });
    const { error } = await sb.rpc("admin_upsert_programme", {
      p_token: tok(), p_id: p ? p.id : null, p_nom: modal.querySelector("#pg-nom").value, p_code: p ? p.code : modal.querySelector("#pg-code").value,
      p_description: modal.querySelector("#pg-desc").value || null, p_langue: modal.querySelector("#pg-langue").value || null, p_niveaux: niveaux
    });
    if (error) { if (adminAuthFail(error)) return; return NexiGamify.toast(error.message, "error"); }
    if (window.NexiProgrammes) await NexiProgrammes.charger();     // les nouvelles classes apparaissent aussitôt dans tous les formulaires
    modal.remove(); NexiGamify.toast("Programme enregistré.", "success"); renderProgrammes();
  });
}

// prog = programme imposé (onglet Programmes) ou null (bouton « + École spéciale » de l'onglet Écoles : on choisit)
async function openEcoleSpecialeModal(prog, apres) {
  let liste = prog ? [prog] : [];
  if (!prog) {
    const { data, error } = await sb.rpc("admin_list_programmes", { p_token: tok() });
    if (error) return NexiGamify.toast(isMissingFn(error) ? "Activez d'abord le patch SQL « programmes »." : error.message, "error");
    liste = data.programmes;
    if (!liste.length) return NexiGamify.toast("Créez d'abord un programme (onglet 🎓 Programmes).", "error");
  }
  const modal = openModal(`
    <h3>Nouvelle école spéciale</h3>
    <div class="field"><label>Nom de l'établissement</label><input id="es-nom" maxlength="100"></div>
    <div class="field"><label>Programme suivi</label><select id="es-prog">${liste.map(x => `<option value="${x.id}" ${prog && prog.id === x.id ? "selected" : ""}>${esc(x.nom)}</option>`).join("")}</select></div>
    <div class="field"><label>Limite d'élèves</label><input id="es-lim" type="number" min="1" value="300"></div>
    <p style="font-size:.8rem;">Les élèves de cette école ne pourront être placés que dans les classes du programme choisi.</p>
    <button class="btn block" id="es-save">Créer l'école</button>`);
  modal.querySelector("#es-save").addEventListener("click", async () => {
    const { error } = await sb.rpc("admin_creer_ecole_speciale", { p_token: tok(), p_nom: modal.querySelector("#es-nom").value, p_limite: parseInt(modal.querySelector("#es-lim").value, 10) || 300, p_programme_id: modal.querySelector("#es-prog").value });
    if (error) { if (adminAuthFail(error)) return; return NexiGamify.toast(error.message, "error"); }
    modal.remove(); NexiGamify.toast("École spéciale créée.", "success"); if (apres) apres();
  });
}

function openCopieModal(p) {
  const tout = window.NEXI_CONFIG.CLASSES, opt = (list, sel) => list.map(c => `<option value="${c.code}" ${sel === c.code ? "selected" : ""}>${esc(c.libelle)} (${esc(c.code)})</option>`).join("");
  const modal = openModal(`
    <h3>Reprendre du contenu dans « ${esc(p.nom)} »</h3>
    <p style="font-size:.85rem;">Copie le contenu d'une classe vers une classe du programme, pour partir d'une base à adapter. Les défis copiés ne sont <b>jamais publiés</b> automatiquement ; les cartes sont masquées sauf si vous cochez l'option.</p>
    <div class="field"><label>Depuis la classe</label><select id="cp-src">${opt(tout.filter(c => !c.programme_id), "")}${opt(tout.filter(c => c.programme_id), "")}</select></div>
    <div class="field"><label>Vers la classe du programme</label><select id="cp-dst">${p.niveaux.map(n => `<option value="${esc(n.code)}">${esc(n.libelle)} (${esc(n.code)})</option>`).join("")}</select></div>
    <div class="field"><label><input type="checkbox" id="cp-cartes" checked> Cartes de révision</label></div>
    <div class="field"><label><input type="checkbox" id="cp-vis"> Rendre les cartes copiées visibles tout de suite</label></div>
    <div class="field"><label><input type="checkbox" id="cp-defis" checked> Défis et leurs questions</label></div>
    <button class="btn block" id="cp-go">Copier</button>`);
  modal.querySelector("#cp-go").addEventListener("click", async () => {
    const { data, error } = await sb.rpc("admin_copier_contenu", { p_token: tok(), p_source: modal.querySelector("#cp-src").value, p_cible: modal.querySelector("#cp-dst").value,
      p_cartes: modal.querySelector("#cp-cartes").checked, p_defis: modal.querySelector("#cp-defis").checked, p_cartes_visibles: modal.querySelector("#cp-vis").checked });
    if (error) { if (adminAuthFail(error)) return; return NexiGamify.toast(error.message, "error"); }
    modal.remove(); NexiGamify.toast(`${data.cartes} carte(s), ${data.defis} défi(s) (${data.questions} questions) copiés.`, "success"); renderProgrammes();
  });
}

async function renderAffinitesProgramme(p) {
  const { data: liste, error } = await sb.rpc("admin_list_affinites_prog", { p_token: tok(), p_programme_id: p.id });
  if (error) { if (adminAuthFail(error)) return; return NexiGamify.toast(error.message, "error"); }
  const L = window.NEXI_CONFIG.RIASEC_LABELS || {};
  root.innerHTML = `
    <button class="btn secondary" id="af-back">← Programmes</button>
    <h2 style="margin-top:10px;">Affinités — ${esc(p.nom)}</h2>
    <p style="font-size:.85rem;">Si ce programme a ses propres questions, ses élèves passent ce test à la place du test national (utile pour une autre langue). Sans question propre, ils passent le test national.</p>
    <form id="af-form" class="card">
      <div class="field"><label>Question</label><input id="af-texte" maxlength="300" required></div>
      <div class="field"><label>Dimension</label><select id="af-dim">${["R", "I", "A", "S", "E", "C"].map(k => `<option value="${k}">${k} — ${esc(L[k] || k)}</option>`).join("")}</select></div>
      <button class="btn" type="submit">Ajouter la question</button>
      <button class="btn secondary" type="button" id="af-copie">Reprendre les questions nationales</button>
    </form>
    <div class="table-wrap"><table><thead><tr><th>Dim.</th><th>Question</th><th>Active</th><th></th></tr></thead><tbody>
      ${liste.map(q => `<tr><td>${esc(q.dimension)}</td><td>${esc(q.texte)}</td><td>${q.actif ? "Oui" : "Non"}</td>
        <td style="white-space:nowrap;"><button class="btn secondary" data-af-tog="${q.id}" style="padding:4px 10px;">${q.actif ? "Désactiver" : "Activer"}</button>
        <button class="btn ghost" data-af-del="${q.id}" style="color:var(--coral);">Suppr.</button></td></tr>`).join("") || `<tr><td colspan="4">Aucune question propre : le test national est utilisé.</td></tr>`}
    </tbody></table></div>`;
  document.getElementById("af-back").addEventListener("click", renderProgrammes);
  const refresh = () => renderAffinitesProgramme(p);
  document.getElementById("af-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { error: er } = await sb.rpc("admin_upsert_affinite_prog", { p_token: tok(), p_id: null, p_programme_id: p.id, p_texte: document.getElementById("af-texte").value, p_dimension: document.getElementById("af-dim").value, p_actif: true });
    if (er) return NexiGamify.toast(er.message, "error"); refresh();
  });
  document.getElementById("af-copie").addEventListener("click", async () => {
    const { data, error: er } = await sb.rpc("admin_copier_affinites_nationales", { p_token: tok(), p_programme_id: p.id });
    if (er) return NexiGamify.toast(er.message, "error");
    NexiGamify.toast(`${data} question(s) reprise(s) : traduisez/adaptez-les puis désactivez celles qui ne conviennent pas.`, "success"); refresh();
  });
  root.querySelectorAll("[data-af-tog]").forEach(b => b.addEventListener("click", async () => {
    const q = liste.find(x => x.id === b.dataset.afTog);
    const { error: er } = await sb.rpc("admin_upsert_affinite_prog", { p_token: tok(), p_id: q.id, p_programme_id: p.id, p_texte: q.texte, p_dimension: q.dimension, p_actif: !q.actif });
    if (er) return NexiGamify.toast(er.message, "error"); refresh();
  }));
  root.querySelectorAll("[data-af-del]").forEach(b => b.addEventListener("click", async () => {
    if (!confirm("Supprimer cette question ?")) return;
    const { error: er } = await sb.rpc("admin_delete_affinite_prog", { p_token: tok(), p_id: b.dataset.afDel });
    if (er) return NexiGamify.toast(er.message, "error"); refresh();
  }));
}

// =========================================================
// ÉTABLISSEMENTS
// =========================================================
async function renderEtablissements() {
  const { data: ecoles } = await sb.rpc("admin_list_ecoles", { p_token: tok() });
  const { data: sups } = await sb.rpc("admin_list_superviseurs", { p_token: tok() });
  const ecoleName = (id) => (ecoles || []).find(e => e.id === id)?.nom || "—";
  root.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;"><h2 style="margin:0;">Écoles</h2><span style="display:flex;gap:8px;"><button class="btn" id="btn-add-ecole">+ École</button><button class="btn secondary" id="btn-add-ecole-speciale">+ École spéciale</button></span></div>
    <div class="table-wrap" style="margin-bottom:26px;"><table>
      <thead><tr><th>Nom</th><th>Programme</th><th>Limite élèves</th><th></th></tr></thead>
      <tbody>${(ecoles || []).map(e => `<tr><td>${esc(e.nom)}</td><td>${progBadge(e)}</td><td>${e.limite_eleves}</td><td><button class="btn secondary" data-edit-ecole="${e.id}" style="padding:5px 12px;">Éditer</button></td></tr>`).join("") || `<tr><td colspan="4">Aucune école.</td></tr>`}</tbody>
    </table></div>

    <div style="display:flex; justify-content:space-between; align-items:center;"><h2 style="margin:0;">Superviseurs</h2><button class="btn" id="btn-add-sup">+ Superviseur</button></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Nom</th><th>Identifiant</th><th>École</th><th>Statut</th><th></th></tr></thead>
      <tbody>${(sups || []).map(s => `<tr><td>${esc(s.nom_complet)}</td><td>${esc(s.identifiant)}</td><td>${esc(ecoleName(s.ecole_id))}</td><td>${s.actif ? `<span class="badge on">Actif</span>` : `<span class="badge off">Suspendu</span>`}</td><td><button class="btn secondary" data-edit-sup="${s.id}" style="padding:5px 12px;">Éditer</button></td></tr>`).join("") || `<tr><td colspan="5">Aucun superviseur.</td></tr>`}</tbody>
    </table></div>
  `;
  document.getElementById("btn-add-ecole").addEventListener("click", () => openEcoleModal(null));
  document.getElementById("btn-add-ecole-speciale").addEventListener("click", () => openEcoleSpecialeModal(null, renderEtablissements));
  root.querySelectorAll("[data-edit-ecole]").forEach(b => b.addEventListener("click", () => openEcoleModal(ecoles.find(x => x.id === b.dataset.editEcole))));
  document.getElementById("btn-add-sup").addEventListener("click", () => openSupModal(null, ecoles));
  root.querySelectorAll("[data-edit-sup]").forEach(b => b.addEventListener("click", () => openSupModal(sups.find(x => x.id === b.dataset.editSup), ecoles)));
}

function openEcoleModal(ec) {
  const modal = openModal(`
    <h3>${ec ? "Éditer" : "Nouvelle"} école</h3>
    <div class="field"><label>Nom de l'établissement</label><input id="e-nom" value="${ec ? esc(ec.nom) : ""}"></div>
    <div class="field"><label>Limite d'élèves</label><input id="e-limite" type="number" value="${ec ? ec.limite_eleves : 300}"></div>
    <button class="btn block" id="e-save">Enregistrer</button>
  `);
  modal.querySelector("#e-save").addEventListener("click", async () => {
    await sb.rpc("admin_upsert_ecole", { p_token: tok(), p_id: ec ? ec.id : null, p_nom: modal.querySelector("#e-nom").value, p_limite: parseInt(modal.querySelector("#e-limite").value, 10) });
    modal.remove(); NexiGamify.toast("Enregistré.", "success"); renderEtablissements();
  });
}

function openSupModal(s, ecoles) {
  const modal = openModal(`
    <h3>${s ? "Éditer" : "Nouveau"} superviseur</h3>
    <div class="field"><label>Nom complet</label><input id="s-nom" value="${s ? esc(s.nom_complet) : ""}"></div>
    <div class="field"><label>Identifiant</label><input id="s-id" value="${s ? esc(s.identifiant) : ""}"></div>
    <div class="field"><label>Mot de passe ${s ? "(laisser vide pour ne pas changer)" : ""}</label><input id="s-pw" type="text"></div>
    <div class="field"><label>École</label><select id="s-ecole">${(ecoles || []).map(e => `<option value="${e.id}" ${s?.ecole_id === e.id ? "selected" : ""}>${esc(e.nom)}</option>`).join("")}</select></div>
    <div class="field"><label><input type="checkbox" id="s-actif" ${!s || s.actif ? "checked" : ""}> Compte actif</label></div>
    <button class="btn block" id="s-save">Enregistrer</button>
  `);
  modal.querySelector("#s-save").addEventListener("click", async () => {
    const { error } = await sb.rpc("admin_upsert_superviseur", {
      p_token: tok(), p_id: s ? s.id : null, p_nom_complet: modal.querySelector("#s-nom").value,
      p_identifiant: modal.querySelector("#s-id").value, p_password: modal.querySelector("#s-pw").value,
      p_ecole_id: modal.querySelector("#s-ecole").value, p_actif: modal.querySelector("#s-actif").checked
    });
    if (error) { NexiGamify.toast("Erreur : " + error.message, "error"); return; }
    modal.remove(); NexiGamify.toast("Enregistré.", "success"); renderEtablissements();
  });
}

// =========================================================
// CLASSEMENT GLOBAL — réutilise la RPC partagée (jamais de nom exposé)
// =========================================================
async function renderClassements() {
  const { data } = await sb.rpc("rpc_classement", { p_scope: "global", p_ecole_id: null, p_classe: null, p_limit: 100, p_offset: 0 });
  root.innerHTML = `
    <h2>Classement global</h2>
    <ul class="rank-list">${(data || []).map((r, i) => `<li><span class="pos">${i + 1}</span><span class="id">${esc(r.identifiant)} · ${esc(r.classe || "")}</span><span class="pts">${Math.round(r.points_total)} pts</span></li>`).join("") || `<div class="empty-state"><h4>Pas encore de données</h4></div>`}</ul>
  `;
}

// =========================================================
// DIAGNOSTIC — teste en direct chaque brique (lecture publique, RPC
// élève/superviseur/admin, upload Storage) sur VOTRE projet Supabase et
// affiche le message d'erreur réel de Postgres/PostgREST pour chaque
// échec, au lieu de deviner à distance ce qui bloque.
// =========================================================
async function renderDiagnostic() {
  root.innerHTML = `
    <h2>Diagnostic</h2>
    <p>Vérifie en direct la connexion à Supabase, les fonctions RPC et le
    stockage des photos. Relancez après toute modification du schéma ou
    des policies.</p>
    <button class="btn" id="btn-run-diag">Lancer le diagnostic</button>
    <div id="diag-results" style="margin-top:18px;"></div>
  `;
  document.getElementById("btn-run-diag").addEventListener("click", runDiagnostic);
}

async function runDiagnostic() {
  const out = document.getElementById("diag-results");
  out.innerHTML = `<div class="empty-state"><h4>Tests en cours…</h4></div>`;
  const results = [];
  const test = async (label, fn) => {
    try {
      const r = await fn();
      if (r && r.error) throw r.error;
      results.push({ label, ok: true, detail: r && r.detail });
    } catch (err) {
      results.push({ label, ok: false, detail: err?.message || String(err) });
    }
  };

  await test("Connexion Supabase (lecture publique classes_ref)", async () => {
    const r = await sb.from("classes_ref").select("code").limit(1);
    return { error: r.error };
  });
  await test("Lecture publique — categories", async () => (await sb.from("categories").select("id").limit(1)));
  await test("Lecture publique — défis publiés", async () => (await sb.from("defis").select("id").eq("publie", true).limit(1)));
  await test("RPC admin — admin_diag_cartes (cartes visibles)", async () => (await sb.rpc("admin_diag_cartes", { p_token: tok(), p_classes: null })));
  await test("Lecture publique — affinités actives", async () => (await sb.from("affinites_questions").select("id").eq("actif", true).limit(1)));

  await test("RPC admin — admin_list_ecoles", async () => (await sb.rpc("admin_list_ecoles", { p_token: tok() })));
  await test("RPC admin — admin_list_eleves", async () => (await sb.rpc("admin_list_eleves", { p_token: tok(), p_limit: 1 })));
  await test("RPC admin — admin_list_defis", async () => (await sb.rpc("admin_list_defis", { p_token: tok() })));
  await test("RPC admin — admin_list_affinites", async () => (await sb.rpc("admin_list_affinites", { p_token: tok() })));
  await test("RPC admin — admin_list_cours (cartes par cours)", async () => (await sb.rpc("admin_list_cours", { p_token: tok() })));
  await test("RPC admin — admin_list_cartes_v2", async () => (await sb.rpc("admin_list_cartes_v2", { p_token: tok(), p_limit: 1 })));
  await test("RPC classement (rpc_classement, portée globale)", async () => (await sb.rpc("rpc_classement", { p_scope: "global", p_ecole_id: null, p_classe: null, p_limit: 1, p_offset: 0 })));

  await test("Stockage — upload test dans le bucket \"avatars\"", async () => {
    const path = `_diagnostic/test-${Date.now()}.txt`;
    const blob = new Blob(["diagnostic nexi one"], { type: "text/plain" });
    const up = await sb.storage.from("avatars").upload(path, blob, { upsert: true });
    if (up.error) return { error: up.error };
    await sb.storage.from("avatars").remove([path]);
    return { error: null };
  });

  // ---- Cohérence des données : classes avec élèves mais sans contenu publié ----
  const { data: eleves } = await sb.rpc("admin_list_eleves", { p_token: tok(), p_limit: 1000 });
  const { data: defis } = await sb.rpc("admin_list_defis", { p_token: tok() });
  if (eleves && defis) {
    const classesAvecEleves = [...new Set(eleves.filter(e => e.valide).map(e => e.classe))];
    const classesAvecDefiPublie = new Set(defis.filter(d => d.publie).map(d => d.classe));
    const { data: nbCartes } = await sb.rpc("admin_diag_cartes", { p_token: tok(), p_classes: classesAvecEleves });
    const classesAvecCarteVisible = new Set((nbCartes || []).filter(x => Number(x.nb) > 0).map(x => x.classe));
    classesAvecEleves.forEach(classe => {
      const hasDefi = classesAvecDefiPublie.has(classe);
      const hasCarte = classesAvecCarteVisible.has(classe);
      results.push({
        label: `Classe ${classe} — contenu disponible pour ses élèves`,
        ok: hasDefi && hasCarte,
        detail: hasDefi && hasCarte ? "défi publié + cartes visibles trouvés" : `manque : ${!hasDefi ? "aucun défi publié" : ""}${!hasDefi && !hasCarte ? " et " : ""}${!hasCarte ? "aucune carte visible" : ""} pour cette classe précise — vérifiez l'orthographe exacte du code classe utilisé à la création`
      });
    });
  }

  const okCount = results.filter(r => r.ok).length;
  out.innerHTML = `
    <p style="margin-bottom:12px;"><b>${okCount} / ${results.length}</b> tests réussis.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Test</th><th>Résultat</th></tr></thead>
      <tbody>
        ${results.map(r => `
          <tr>
            <td>${esc(r.label)}</td>
            <td>${r.ok ? `<span class="badge on">OK</span>` : `<span class="badge off">Échec</span><br><span style="font-size:.78rem; color:var(--text-dim);">${esc(r.detail || "")}</span>`}</td>
          </tr>`).join("")}
      </tbody>
    </table></div>
  `;
}

// =========================================================
// RÉGLAGES
// =========================================================
async function renderReglages() {
  root.innerHTML = `
    <h2>Réglages</h2>
    <div class="card" style="max-width:420px;">
      <h4>Changer le mot de passe administrateur</h4>
      <div class="field"><label>Nouveau mot de passe</label><input id="new-pw" type="text"></div>
      <button class="btn block" id="btn-change-pw">Mettre à jour</button>
    </div>
  `;
  document.getElementById("btn-change-pw").addEventListener("click", async () => {
    const pw = document.getElementById("new-pw").value;
    if (pw.length < 6) { NexiGamify.toast("Mot de passe trop court (min. 6).", "error"); return; }
    await sb.rpc("admin_change_password", { p_token: tok(), p_new_password: pw });
    NexiGamify.toast("Mot de passe mis à jour.", "success");
  });
}

// =========================================================
// ABONNEMENTS (admin) — dates de début / fin, état calculé, renouvellement en masse, blocage général.
// Onglet ajouté par le script (aucune modification de admin.html).
// =========================================================
const aboState = { page: 0, pageSize: 25, search: "", classe: "", ecole: "", etat: "" };
const aboSel = new Set();
const ABO_LIB = { actif: ["on", "Actif"], a_venir: ["pending", "À venir"], expire: ["off", "Expiré"], inactif: ["off", "Inactif"] };
const aboDate = (iso) => iso ? new Date(iso + "T00:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "—";
const aboAbsent = (error) => !!error && (error.code === "PGRST202" || /could not find the function|schema cache/i.test(error.message || ""));

function badgeAbo(e, map) {
  const st = map && map[e.id];
  if (!st) return e.abonnement_actif ? `<span class="badge on">Actif</span>` : `<span class="badge off">Expiré</span>`;
  const [cls, lib] = ABO_LIB[st.etat] || ["off", st.etat];
  const note = st.etat === "a_venir" ? `<br><small>dès le ${aboDate(st.debut)}</small>`
    : st.fin ? `<br><small>${st.etat === "expire" ? "fini le " : "jusqu'au "}${aboDate(st.fin)}</small>`
    : st.etat === "actif" ? `<br><small>sans date de fin</small>` : "";
  return `<span class="badge ${cls}">${lib}</span>${note}`;
}

// Enregistre les dates saisies dans la fiche d'un élève (uniquement si elles ont changé).
async function enregistrerDatesAbo(modal, e, saved) {
  if (modal._aboOff) return null;
  const debut = modal.querySelector("#m-abo-debut").value || null, fin = modal.querySelector("#m-abo-fin").value || null;
  const init = modal._aboInit;
  if (e && init && init.debut === debut && init.fin === fin) return null;
  if (!e && !debut && !fin) return null;
  const id = e ? e.id : (typeof saved === "string" ? saved : null);
  if (!id) return "Élève créé. Saisissez ses dates d'abonnement dans l'onglet Abonnements.";
  const { error } = await sb.rpc("admin_set_abonnement", { p_token: tok(), p_eleve_ids: [id], p_debut: debut, p_fin: fin, p_actif: modal.querySelector("#m-abo").checked });
  return error ? "Élève enregistré, mais dates d'abonnement refusées : " + error.message : null;
}

function injectAbonnementsTab() {
  const tabs = document.querySelector(".admin-tabs");
  if (!tabs || tabs.querySelector('[data-view="abonnements"]')) return;
  const b = document.createElement("button");
  b.dataset.view = "abonnements"; b.textContent = "💳 Abonnements";
  b.addEventListener("click", () => {
    tabs.querySelectorAll("button").forEach(x => x.classList.remove("active"));
    b.classList.add("active"); render("abonnements");
  });
  tabs.appendChild(b);
}

async function renderAbonnements() {
  const s = aboState;
  const filtres = () => ({ p_token: tok(), p_search: s.search || null, p_classe: s.classe || null, p_ecole_id: s.ecole || null, p_etat: s.etat || null });
  const [lst, res, eco, secu] = await Promise.all([
    sb.rpc("admin_list_abonnements", { ...filtres(), p_limit: s.pageSize, p_offset: s.page * s.pageSize }),
    sb.rpc("admin_abonnements_resume", { p_token: tok() }),
    sb.rpc("admin_list_ecoles", { p_token: tok() }),
    sb.rpc("admin_get_securite", { p_token: tok() })
  ]);
  const sec = secu.error ? null : (secu.data || {});   // null = patch « sécurité » non appliqué : la carte n'apparaît pas
  if (lst.error) {
    const absent = aboAbsent(lst.error);
    root.innerHTML = `<div class="empty-state"><h4>${absent ? "Abonnements non activés" : "Erreur d'accès"}</h4><p>${esc(absent ? "Exécutez d'abord le patch SQL « abonnements » dans Supabase." : lst.error.message || "")}</p></div>`;
    return;
  }
  const rows = lst.data || [], total = rows.length ? Number(rows[0].total) : 0, r = res.data || {}, ecoles = eco.data || [];
  const pages = Math.max(1, Math.ceil(total / s.pageSize));
  const ecoleNom = (id) => ecoles.find(x => x.id === id)?.nom || "Domicile";
  const chip = (k, lib, n) => `<button class="btn ${s.etat === k ? "" : "secondary"}" data-chip="${k}" style="padding:6px 12px;">${lib} (${n || 0})</button>`;

  root.innerHTML = `
    <h2 style="margin:0 0 12px;">Abonnements</h2>
    ${sec ? `<div class="card" style="margin-bottom:16px; border-color:${sec.session_unique ? "var(--cyan)" : "var(--gold)"};">
      <b>Un seul appareil à la fois : ${sec.session_unique ? "✅ ACTIVÉ" : "⏸ DÉSACTIVÉ"}</b>
      <p style="margin:6px 0 10px; font-size:.9rem;">${sec.session_unique
        ? "Un élève ne peut pas être connecté sur deux appareils en même temps : si un ami utilise ses identifiants pendant qu'il est actif, la connexion est refusée (« Compte déjà utilisé »)."
        : "Désactivé : un compte peut être ouvert sur plusieurs appareils à la fois."}</p>
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <button class="btn ${sec.session_unique ? "secondary" : ""}" id="sec-toggle">${sec.session_unique ? "Désactiver" : "Activer"}</button>
        <label style="font-size:.9rem;">Libéré après
          <select id="sec-fenetre">${[1, 2, 3, 5, 10, 15, 30].map(m => `<option value="${m}" ${Number(sec.fenetre_minutes) === m ? "selected" : ""}>${m} min</option>`).join("")}</select>
          sans activité</label>
      </div>
    </div>` : ""}
    <div class="card" style="margin-bottom:16px; border-color:${r.blocage ? "var(--cyan)" : "var(--gold)"};">
      <b>Blocage des comptes sans abonnement actif : ${r.blocage ? "✅ ACTIVÉ" : "⏸ DÉSACTIVÉ"}</b>
      <p style="margin:6px 0 10px; font-size:.9rem;">${r.blocage
        ? "Un élève dont l'abonnement est expiré, pas encore commencé ou inactif ne peut ouvrir que son profil."
        : "Mode préparation : les élèves ne voient aucun changement. Saisissez les dates, vérifiez la liste, puis activez le blocage."}</p>
      <button class="btn ${r.blocage ? "secondary" : ""}" id="ab-blocage">${r.blocage ? "Désactiver le blocage" : "Activer le blocage"}</button>
    </div>
    <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px;">
      ${chip("", "Tous", r.total)}${chip("actif", "Actifs", r.actif)}${chip("bientot", "Fin ≤ 7 jours", r.bientot)}${chip("expire", "Expirés", r.expire)}${chip("a_venir", "À venir", r.a_venir)}${chip("inactif", "Inactifs", r.inactif)}
    </div>
    <div class="filters-row">
      <input id="ab-search" placeholder="Rechercher (nom ou identifiant)" value="${esc(s.search)}">
      <select id="ab-classe"><option value="">Toutes les classes</option>${window.NEXI_CONFIG.CLASSES.map(c => `<option value="${c.code}" ${s.classe === c.code ? "selected" : ""}>${c.libelle}</option>`).join("")}</select>
      <select id="ab-ecole"><option value="">Toutes les écoles</option>${ecoles.map(x => `<option value="${x.id}" ${s.ecole === x.id ? "selected" : ""}>${esc(x.nom)}</option>`).join("")}</select>
      <button class="btn secondary" id="ab-filtrer">Filtrer</button>
    </div>
    <div class="card" style="margin:12px 0;">
      <b id="ab-count">0 élève sélectionné</b>
      <label style="margin-left:12px; font-size:.9rem;"><input type="checkbox" id="ab-all"> Les ${total} résultat(s) du filtre (toutes les pages)</label>
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:flex-end; margin-top:10px;">
        <div class="field" style="margin:0;"><label>Début</label><input type="date" id="ab-d"></div>
        <div class="field" style="margin:0;"><label>Fin</label><input type="date" id="ab-f"></div>
        <button class="btn" id="ab-dates">Appliquer ces dates</button>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top:10px;">
        <span style="font-size:.9rem;">Renouveler :</span>
        ${[1, 3, 6, 12].map(m => `<button class="btn secondary" data-mois="${m}" style="padding:6px 12px;">+${m} mois</button>`).join("")}
      </div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th><input type="checkbox" id="ab-page" aria-label="Tout sélectionner sur cette page"></th><th>Nom</th><th>Identifiant</th><th>Classe</th><th>École</th><th>Début</th><th>Fin</th><th>État</th><th></th></tr></thead>
      <tbody>${rows.map(x => `<tr>
        <td><input type="checkbox" data-sel="${x.id}" ${aboSel.has(x.id) ? "checked" : ""}></td>
        <td>${esc(x.nom_complet)}</td><td>${esc(x.identifiant)}</td><td>${esc(x.classe || "—")}</td><td>${esc(ecoleNom(x.ecole_id))}</td>
        <td>${aboDate(x.debut)}</td><td>${aboDate(x.fin)}</td><td>${badgeAbo({ id: x.id }, { [x.id]: x })}</td>
        <td><button class="btn secondary" data-edit="${x.id}" style="padding:6px 12px;">Modifier</button></td></tr>`).join("") || `<tr><td colspan="9">Aucun résultat.</td></tr>`}</tbody>
    </table></div>
    <div class="pager">
      <button class="btn ghost" id="ab-prev" ${s.page === 0 ? "disabled" : ""}>‹ Précédent</button>
      Page ${s.page + 1} / ${pages}
      <button class="btn ghost" id="ab-next" ${s.page >= pages - 1 ? "disabled" : ""}>Suivant ›</button>
    </div>`;

  const $ = (id) => document.getElementById(id);
  const majCompte = () => { const all = $("ab-all").checked; $("ab-count").textContent = all ? `${total} élève(s) (tous les résultats du filtre)` : `${aboSel.size} élève(s) sélectionné(s)`; };
  majCompte();

  $("ab-filtrer").addEventListener("click", () => { s.search = $("ab-search").value.trim(); s.classe = $("ab-classe").value; s.ecole = $("ab-ecole").value; s.page = 0; aboSel.clear(); renderAbonnements(); });
  $("ab-search").addEventListener("keydown", (ev) => { if (ev.key === "Enter") $("ab-filtrer").click(); });
  root.querySelectorAll("[data-chip]").forEach(b => b.addEventListener("click", () => { s.etat = b.dataset.chip; s.page = 0; aboSel.clear(); renderAbonnements(); }));
  $("ab-prev").addEventListener("click", () => { s.page--; renderAbonnements(); });
  $("ab-next").addEventListener("click", () => { s.page++; renderAbonnements(); });
  $("ab-all").addEventListener("change", majCompte);
  $("ab-page").addEventListener("change", (ev) => {
    root.querySelectorAll("[data-sel]").forEach(c => { c.checked = ev.target.checked; ev.target.checked ? aboSel.add(c.dataset.sel) : aboSel.delete(c.dataset.sel); });
    majCompte();
  });
  root.querySelectorAll("[data-sel]").forEach(c => c.addEventListener("change", () => { c.checked ? aboSel.add(c.dataset.sel) : aboSel.delete(c.dataset.sel); majCompte(); }));

  // Identifiants visés : la sélection, ou tous les résultats du filtre (toutes pages, par paquets de 200).
  const idsVises = async () => {
    if (!$("ab-all").checked) return [...aboSel];
    const out = [];
    for (let off = 0; off < 20000; off += 200) {
      const { data, error } = await sb.rpc("admin_list_abonnements", { ...filtres(), p_limit: 200, p_offset: off });
      if (error || !data || !data.length) break;
      data.forEach(x => out.push(x.id));
      if (data.length < 200) break;
    }
    return out;
  };
  const appliquer = async (libelle, action) => {
    const ids = await idsVises();
    if (!ids.length) { NexiGamify.toast("Sélectionnez au moins un élève.", "error"); return; }
    if (!confirm(`${libelle} pour ${ids.length} élève(s) ?`)) return;
    for (let i = 0; i < ids.length; i += 1000) {
      const { error } = await action(ids.slice(i, i + 1000));
      if (error) { NexiGamify.toast("Erreur : " + error.message, "error"); return; }
    }
    NexiGamify.toast(`Abonnement mis à jour (${ids.length} élève${ids.length > 1 ? "s" : ""}).`, "success");
    aboSel.clear(); renderAbonnements();
  };
  $("ab-dates").addEventListener("click", () => {
    const d = $("ab-d").value || null, f = $("ab-f").value || null;
    if (d && f && d > f) { NexiGamify.toast("La date de fin doit être postérieure à la date de début.", "error"); return; }
    appliquer(d || f ? `Fixer l'abonnement${d ? " du " + aboDate(d) : ""}${f ? " au " + aboDate(f) : ""}` : "Retirer les dates d'abonnement (sans limite)",
      (lot) => sb.rpc("admin_set_abonnement", { p_token: tok(), p_eleve_ids: lot, p_debut: d, p_fin: f, p_actif: true }));
  });
  root.querySelectorAll("[data-mois]").forEach(b => b.addEventListener("click", () => {
    const m = Number(b.dataset.mois);
    appliquer(`Renouveler de ${m} mois`, (lot) => sb.rpc("admin_prolonger_abonnement", { p_token: tok(), p_eleve_ids: lot, p_mois: m }));
  }));

  root.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => {
    const x = rows.find(y => y.id === b.dataset.edit);
    const m = openModal(`
      <h3>Abonnement — ${esc(x.nom_complet)}</h3>
      <div class="field"><label>Début</label><input type="date" id="am-d" value="${x.debut || ""}"></div>
      <div class="field"><label>Fin (incluse)</label><input type="date" id="am-f" value="${x.fin || ""}"></div>
      <div class="field"><label><input type="checkbox" id="am-a" ${x.abonnement_actif ? "checked" : ""}> Abonnement actif (décocher pour suspendre immédiatement)</label></div>
      <button class="btn block" id="am-save">Enregistrer</button>`);
    m.querySelector("#am-save").addEventListener("click", async () => {
      const d = m.querySelector("#am-d").value || null, f = m.querySelector("#am-f").value || null;
      if (d && f && d > f) { NexiGamify.toast("La date de fin doit être postérieure à la date de début.", "error"); return; }
      const { error } = await sb.rpc("admin_set_abonnement", { p_token: tok(), p_eleve_ids: [x.id], p_debut: d, p_fin: f, p_actif: m.querySelector("#am-a").checked });
      if (error) { NexiGamify.toast("Erreur : " + error.message, "error"); return; }
      m.remove(); NexiGamify.toast("Abonnement enregistré.", "success"); renderAbonnements();
    });
  }));

  if (sec) {
    $("sec-toggle").addEventListener("click", async () => {
      const activer = !sec.session_unique;
      if (!confirm(activer ? "Activer « un seul appareil à la fois » ?" : "Désactiver « un seul appareil à la fois » ? Les comptes pourront être ouverts sur plusieurs appareils.")) return;
      const { error } = await sb.rpc("admin_set_securite", { p_token: tok(), p_session_unique: activer, p_fenetre: null });
      if (error) { NexiGamify.toast("Erreur : " + error.message, "error"); return; }
      NexiGamify.toast(activer ? "Un seul appareil à la fois : activé." : "Un seul appareil à la fois : désactivé.", "success"); renderAbonnements();
    });
    $("sec-fenetre").addEventListener("change", async (ev) => {
      const { error } = await sb.rpc("admin_set_securite", { p_token: tok(), p_session_unique: null, p_fenetre: Number(ev.target.value) });
      NexiGamify.toast(error ? "Erreur : " + error.message : "Délai d'inactivité enregistré.", error ? "error" : "success");
    });
  }

  $("ab-blocage").addEventListener("click", async () => {
    const activer = !r.blocage, touches = (r.expire || 0) + (r.a_venir || 0) + (r.inactif || 0);
    const msg = activer
      ? `Activer le blocage ?\n\n${touches} élève(s) (expirés, pas encore commencés ou inactifs) n'auront plus accès qu'à leur profil.`
      : "Désactiver le blocage ? Tous les élèves retrouvent l'accès complet.";
    if (!confirm(msg)) return;
    const { error } = await sb.rpc("admin_set_blocage_abonnement", { p_token: tok(), p_actif: activer });
    if (error) { NexiGamify.toast("Erreur : " + error.message, "error"); return; }
    NexiGamify.toast(activer ? "Blocage activé." : "Blocage désactivé.", "success"); renderAbonnements();
  });
}

// =========================================================
// CLASSES NATIONALES (admin) — options / sections des Humanités : ajouter, renommer, supprimer.
// Une option ajoutée ici apparaît aussitôt (par ordre alphabétique) dans l'inscription, les fiches élèves, les défis, les cartes…
// =========================================================
const clsEtat = { filtre: "" };
const clsAbsent = (error) => !!error && (error.code === "PGRST202" || /could not find the function|schema cache/i.test(error.message || ""));
const clsTri = (a, b) => String(a.libelle).localeCompare(String(b.libelle), "fr", { sensitivity: "base", numeric: true });

function injectClassesTab() {
  const tabs = document.querySelector(".admin-tabs");
  if (!tabs || tabs.querySelector('[data-view="classes"]')) return;
  const b = document.createElement("button");
  b.dataset.view = "classes"; b.textContent = "🎓 Classes";
  b.addEventListener("click", () => {
    tabs.querySelectorAll("button").forEach(x => x.classList.remove("active"));
    b.classList.add("active"); render("classes");
  });
  tabs.appendChild(b);
}

async function renderClasses() {
  const { data, error } = await sb.rpc("admin_list_classes_nationales", { p_token: tok() });
  if (error) {
    const absent = clsAbsent(error);
    root.innerHTML = `<div class="empty-state"><h4>${absent ? "Classes non activées" : "Erreur d'accès"}</h4><p>${esc(absent ? "Exécutez d'abord le patch SQL « options des Humanités » dans Supabase." : error.message || "")}</p></div>`;
    return;
  }
  const rows = data || [];
  const ajoutees = rows.filter(r => r.modifiable).sort(clsTri), origine = rows.filter(r => !r.modifiable);
  const q = clsEtat.filtre.toLowerCase();
  const visibles = q ? ajoutees.filter(r => (r.libelle + " " + r.code).toLowerCase().includes(q)) : ajoutees;
  const ligne = (r, edit) => `<tr><td>${esc(r.libelle)}</td><td><code>${esc(r.code)}</code></td><td>${r.nb_eleves}</td><td>${r.nb_defis}</td><td>${r.nb_cartes}</td>
    <td>${edit ? `<button class="btn secondary" data-ren="${esc(r.code)}" style="padding:6px 12px;">Renommer</button>
      <button class="btn secondary" data-sup="${esc(r.code)}" style="padding:6px 12px;" ${Number(r.nb_eleves) + Number(r.nb_defis) + Number(r.nb_cartes) > 0 ? 'disabled title="Classe utilisée : suppression impossible"' : ""}>Supprimer</button>` : ""}</td></tr>`;
  const entete = `<thead><tr><th>Classe</th><th>Code</th><th>Élèves</th><th>Défis</th><th>Cartes</th><th></th></tr></thead>`;

  root.innerHTML = `
    <h2 style="margin:0 0 6px;">Classes nationales</h2>
    <p style="margin:0 0 14px; font-size:.92rem;">Ajoutez ici une option (ex. Électronique) : ses niveaux apparaissent aussitôt, par ordre alphabétique, dans l'inscription et dans tous les formulaires. Une classe utilisée par des élèves, des défis ou des cartes ne peut pas être supprimée.</p>
    <div class="card" style="margin-bottom:16px;">
      <b>Ajouter une option</b>
      <div class="field" style="margin-top:10px;"><label>Nom de l'option (ex. Électronique, Commerciale et gestion, Littéraire…)</label><input id="cl-nom" maxlength="60" placeholder="Nom de l'option"></div>
      <div style="display:flex; gap:14px; flex-wrap:wrap; margin-bottom:12px;">
        ${[1, 2, 3, 4].map(n => `<label><input type="checkbox" data-niv="${n}" checked> ${n}${n === 1 ? "ère" : "ème"} année</label>`).join("")}
      </div>
      <button class="btn" id="cl-add">Ajouter l'option</button>
    </div>
    <div class="filters-row"><input id="cl-filtre" placeholder="Rechercher une classe ajoutée" value="${esc(clsEtat.filtre)}"></div>
    <h3 style="margin:14px 0 8px;">Options ajoutées (${ajoutees.length} classes)</h3>
    <div class="table-wrap"><table>${entete}<tbody>${visibles.map(r => ligne(r, true)).join("") || `<tr><td colspan="6">Aucune classe.</td></tr>`}</tbody></table></div>
    <details style="margin-top:18px;"><summary style="cursor:pointer;">Classes d'origine (${origine.length}), non modifiables</summary>
      <div class="table-wrap" style="margin-top:8px;"><table>${entete}<tbody>${origine.map(r => ligne(r, false)).join("") || `<tr><td colspan="6">—</td></tr>`}</tbody></table></div>
    </details>`;

  const $ = (id) => document.getElementById(id);
  const actualiser = async () => { if (window.NexiProgrammes) await NexiProgrammes.charger(); renderClasses(); };   // la nouvelle liste est reprise partout
  $("cl-filtre").addEventListener("input", (ev) => { clsEtat.filtre = ev.target.value.trim(); renderClasses(); const f = $("cl-filtre"); f.focus(); f.setSelectionRange(f.value.length, f.value.length); });
  $("cl-add").addEventListener("click", async () => {
    const nom = $("cl-nom").value.trim();
    const niveaux = [...root.querySelectorAll("[data-niv]")].filter(c => c.checked).map(c => Number(c.dataset.niv));
    if (nom.length < 3) { NexiGamify.toast("Saisissez le nom de l'option (3 caractères minimum).", "error"); return; }
    if (!niveaux.length) { NexiGamify.toast("Choisissez au moins un niveau.", "error"); return; }
    const { data: n, error: err } = await sb.rpc("admin_ajouter_section", { p_token: tok(), p_section: nom, p_niveaux: niveaux });
    if (err) { NexiGamify.toast("Erreur : " + err.message, "error"); return; }
    NexiGamify.toast(n > 0 ? `${n} classe(s) ajoutée(s).` : "Cette option existe déjà pour ces niveaux.", n > 0 ? "success" : "error");
    clsEtat.filtre = ""; actualiser();
  });
  root.querySelectorAll("[data-ren]").forEach(b => b.addEventListener("click", () => {
    const r = rows.find(x => x.code === b.dataset.ren);
    const m = openModal(`<h3>Renommer la classe</h3>
      <p style="font-size:.85rem;">Code : <code>${esc(r.code)}</code> (ne change jamais : les élèves, défis et cartes restent rattachés).</p>
      <div class="field"><label>Libellé affiché</label><input id="cr-lib" maxlength="90" value="${esc(r.libelle)}"></div>
      <button class="btn block" id="cr-save">Enregistrer</button>`);
    m.querySelector("#cr-save").addEventListener("click", async () => {
      const { error: err } = await sb.rpc("admin_renommer_classe", { p_token: tok(), p_code: r.code, p_libelle: m.querySelector("#cr-lib").value });
      if (err) { NexiGamify.toast("Erreur : " + err.message, "error"); return; }
      m.remove(); NexiGamify.toast("Classe renommée.", "success"); actualiser();
    });
  }));
  root.querySelectorAll("[data-sup]").forEach(b => b.addEventListener("click", async () => {
    const r = rows.find(x => x.code === b.dataset.sup);
    if (!confirm(`Supprimer la classe « ${r.libelle} » ?`)) return;
    const { error: err } = await sb.rpc("admin_supprimer_classe", { p_token: tok(), p_code: r.code });
    if (err) { NexiGamify.toast("Erreur : " + err.message, "error"); return; }
    NexiGamify.toast("Classe supprimée.", "success"); actualiser();
  }));
}

// Premier affichage : volontairement en fin de fichier, une fois toutes les constantes initialisées.
if (session && session.role === "admin") { injectNotifTab(); injectStockageTab(); injectTournoiTab(); injectProgrammesTab(); injectAbonnementsTab(); injectClassesTab();
  // Les classes des programmes spéciaux sont chargées AVANT le premier affichage (les formulaires les proposent aussitôt).
  (window.NexiProgrammes ? NexiProgrammes.charger() : Promise.resolve()).catch(() => {}).then(() => render("eleves")); }
