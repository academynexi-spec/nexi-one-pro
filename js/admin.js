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
  render("eleves");
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
            <td>${e.abonnement_actif ? `<span class="badge on">Actif</span>` : `<span class="badge off">Expiré</span>`}</td>
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
    <button class="btn block" id="m-save">Enregistrer</button>
  `);
  modal.querySelector("#m-save").addEventListener("click", async () => {
    const { error } = await sb.rpc("admin_upsert_eleve", {
      p_token: tok(), p_id: e ? e.id : null,
      p_nom_complet: modal.querySelector("#m-nom").value, p_identifiant: modal.querySelector("#m-id").value,
      p_password: modal.querySelector("#m-pw").value, p_sexe: modal.querySelector("#m-sexe").value,
      p_classe: modal.querySelector("#m-classe").value, p_ecole_id: modal.querySelector("#m-ecole").value || null,
      p_actif: modal.querySelector("#m-actif").checked, p_abonnement_actif: modal.querySelector("#m-abo").checked
    });
    if (error) { NexiGamify.toast("Erreur : " + error.message, "error"); return; }
    modal.remove(); NexiGamify.toast("Enregistré.", "success"); renderEleves();
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
    if (!confirm("Supprimer ce défi supprime AUSSI tous les résultats des élèves qui l'ont joué (scores, classement). Pour le retirer sans rien perdre : Éditer, puis décocher « Publié ». Supprimer quand même ?")) return;
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
      p_options: opts, p_bonnes: bonnes, p_explication: document.getElementById("q-expl").value,
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
        p_enonce: enonce.trim(), p_options: opts, p_bonnes: bonnes,
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
// CARTES DE RÉVISION
// =========================================================
async function renderCartes() {
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
// ÉTABLISSEMENTS
// =========================================================
async function renderEtablissements() {
  const { data: ecoles } = await sb.rpc("admin_list_ecoles", { p_token: tok() });
  const { data: sups } = await sb.rpc("admin_list_superviseurs", { p_token: tok() });
  const ecoleName = (id) => (ecoles || []).find(e => e.id === id)?.nom || "—";
  root.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;"><h2 style="margin:0;">Écoles</h2><button class="btn" id="btn-add-ecole">+ École</button></div>
    <div class="table-wrap" style="margin-bottom:26px;"><table>
      <thead><tr><th>Nom</th><th>Limite élèves</th><th></th></tr></thead>
      <tbody>${(ecoles || []).map(e => `<tr><td>${esc(e.nom)}</td><td>${e.limite_eleves}</td><td><button class="btn secondary" data-edit-ecole="${e.id}" style="padding:5px 12px;">Éditer</button></td></tr>`).join("") || `<tr><td colspan="3">Aucune école.</td></tr>`}</tbody>
    </table></div>

    <div style="display:flex; justify-content:space-between; align-items:center;"><h2 style="margin:0;">Superviseurs</h2><button class="btn" id="btn-add-sup">+ Superviseur</button></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Nom</th><th>Identifiant</th><th>École</th><th>Statut</th><th></th></tr></thead>
      <tbody>${(sups || []).map(s => `<tr><td>${esc(s.nom_complet)}</td><td>${esc(s.identifiant)}</td><td>${esc(ecoleName(s.ecole_id))}</td><td>${s.actif ? `<span class="badge on">Actif</span>` : `<span class="badge off">Suspendu</span>`}</td><td><button class="btn secondary" data-edit-sup="${s.id}" style="padding:5px 12px;">Éditer</button></td></tr>`).join("") || `<tr><td colspan="5">Aucun superviseur.</td></tr>`}</tbody>
    </table></div>
  `;
  document.getElementById("btn-add-ecole").addEventListener("click", () => openEcoleModal(null));
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
    <div class="card" id="diag-space" style="margin-bottom:18px;">
      <h4 style="margin-top:0;">Espace de la base</h4>
      <p>Chargement…</p>
    </div>
    <p>Vérifie en direct la connexion à Supabase, les fonctions RPC et le
    stockage des photos. Relancez après toute modification du schéma ou
    des policies.</p>
    <button class="btn" id="btn-run-diag">Lancer le diagnostic</button>
    <div id="diag-results" style="margin-top:18px;"></div>
  `;
  document.getElementById("btn-run-diag").addEventListener("click", runDiagnostic);
  renderEspaceBase();
}

async function renderEspaceBase() {
  const box = document.getElementById("diag-space");
  if (!box) return;
  const [u, t] = await Promise.all([
    sb.rpc("admin_db_usage", { p_token: tok() }),
    sb.rpc("admin_db_tables", { p_token: tok() })
  ]);
  if (u.error) {
    box.innerHTML = `<h4 style="margin-top:0;">Espace de la base</h4>
      <p style="color:var(--coral);">Indisponible : ${esc(u.error.message)}</p>
      <p style="font-size:.82rem;">Le patch SQL d'archivage a-t-il été exécuté ?</p>`;
    return;
  }
  const r = Array.isArray(u.data) ? u.data[0] : u.data;
  const pct = Number(r.pourcentage) || 0;
  const couleur = r.niveau === "critique" ? "var(--coral)" : r.niveau === "attention" ? "var(--gold)" : "var(--teal, #21c4b3)";
  const message = r.niveau === "critique" ? "Archivez maintenant : le blocage approche."
    : r.niveau === "attention" ? "Prévoyez l'archivage prochainement."
    : "Marge confortable.";
  const lignes = (t.data || []).slice(0, 8);
  box.innerHTML = `
    <h4 style="margin-top:0;">Espace de la base</h4>
    <p style="margin:6px 0;"><b>${esc(r.taille_lisible)}</b> utilisés sur 500 Mo (offre gratuite) — <b style="color:${couleur};">${pct} %</b></p>
    <div style="height:10px; border-radius:6px; background:rgba(255,255,255,.12); overflow:hidden;">
      <div style="height:100%; width:${Math.min(100, pct)}%; background:${couleur};"></div>
    </div>
    <p style="font-size:.85rem; margin:8px 0 0;">${esc(message)}</p>
    <p style="font-size:.78rem; color:var(--text-dim);">Mesure approximative de la taille totale de la base (tables système incluses) ; vérifiez la valeur officielle dans Supabase > Settings > Usage.</p>
    ${lignes.length ? `
      <div class="table-wrap" style="margin-top:10px;"><table>
        <thead><tr><th>Table</th><th>Taille</th><th>Lignes</th></tr></thead>
        <tbody>${lignes.map(x => `<tr><td>${esc(x.nom_table)}</td><td>${esc(x.taille)}</td><td>${x.lignes}</td></tr>`).join("")}</tbody>
      </table></div>` : ""}
  `;
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
  await test("Lecture publique — cartes visibles", async () => (await sb.from("cartes_revision").select("id").eq("masque", false).limit(1)));
  await test("Lecture publique — affinités actives", async () => (await sb.from("affinites_questions").select("id").eq("actif", true).limit(1)));

  await test("RPC admin — admin_list_ecoles", async () => (await sb.rpc("admin_list_ecoles", { p_token: tok() })));
  await test("RPC admin — admin_list_eleves", async () => (await sb.rpc("admin_list_eleves", { p_token: tok(), p_limit: 1 })));
  await test("RPC admin — admin_list_defis", async () => (await sb.rpc("admin_list_defis", { p_token: tok() })));
  await test("RPC admin — admin_list_affinites", async () => (await sb.rpc("admin_list_affinites", { p_token: tok() })));
  await test("RPC admin — admin_list_cartes", async () => (await sb.rpc("admin_list_cartes", { p_token: tok() })));
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
  const { data: cartes } = await sb.rpc("admin_list_cartes", { p_token: tok() });
  if (eleves && defis && cartes) {
    const classesAvecEleves = [...new Set(eleves.filter(e => e.valide).map(e => e.classe))];
    const classesAvecDefiPublie = new Set(defis.filter(d => d.publie).map(d => d.classe));
    const classesAvecCarteVisible = new Set(cartes.filter(c => !c.masque).map(c => c.classe));
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
