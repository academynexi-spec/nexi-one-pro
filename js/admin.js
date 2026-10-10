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
let impRecords = [], impLot = null;

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
  document.getElementById("imp-go").disabled = true; document.getElementById("imp-undo").style.display = "none"; msg.textContent = "";
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
  go.disabled = true; document.getElementById("imp-check").disabled = true; msg.textContent = "Import en cours…";
  try {
    const o = await impRun(true);
    msg.textContent = `Terminé : ${o.importees} carte(s) importée(s), ${o.doublons} doublon(s) ignoré(s), ${o.nb_erreurs} ligne(s) en erreur.`;
    NexiGamify.toast(`${o.importees} carte(s) importée(s).`, "success");
  } catch (e) { msg.textContent = "Interrompu : " + e.message + " — le lot déjà importé peut être annulé."; }
  document.getElementById("imp-undo").style.display = "inline-block";
  document.getElementById("imp-check").disabled = false;
}

async function impAnnuler() {
  if (!confirm("Supprimer toutes les cartes créées par cet import ?")) return;
  const { data, error } = await sb.rpc("admin_annuler_import", { p_token: tok(), p_lot: impLot });
  if (error) return NexiGamify.toast(error.message, "error");
  NexiGamify.toast(`${data} carte(s) supprimée(s).`, "success"); renderCartes();
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
  await test("Lecture publique — cartes visibles", async () => (await sb.from("cartes_revision").select("id").eq("masque", false).limit(1)));
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
    const comptes = await Promise.all(classesAvecEleves.map(async classe => {
      const r = await sb.from("cartes_revision").select("id", { count: "exact", head: true }).eq("classe", classe).eq("masque", false);
      return [classe, (r.count || 0) > 0];
    }));
    const classesAvecCarteVisible = new Set(comptes.filter(([, ok]) => ok).map(([c]) => c));
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

// Premier affichage : volontairement en fin de fichier, une fois toutes les constantes initialisées.
if (session && session.role === "admin") render("eleves");
