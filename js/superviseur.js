// =========================================================
// PANEL SUPERVISEUR — toutes les lectures passent par des RPC
// agrégées côté serveur (aucun fetch de table brute, scalable à
// plusieurs centaines d'élèves par école).
// =========================================================
const session = NexiAuth.requireRole("superviseur");
const sb = getSupabase();
const root = document.getElementById("view-root");

document.getElementById("btn-logout").addEventListener("click", () => NexiAuth.logout());
document.querySelectorAll(".admin-tabs button").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".admin-tabs button").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    render(btn.dataset.view);
  });
});
function escapeHtml(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

async function render(view) {
  root.innerHTML = `<div class="empty-state"><h4>Chargement…</h4></div>`;
  if (view === "eleves") return renderEleves();
  if (view === "stats") return renderStats();
  if (view === "suggerer") return renderSuggerer();
}

async function renderEleves() {
  const { data: eleves, error } = await sb.rpc("rpc_superviseur_eleves", { p_superviseur_id: session.id, p_token: session.token });
  if (error) { console.error("rpc_superviseur_eleves:", error); root.innerHTML = `<div class="empty-state"><h4>Erreur d'accès</h4><p>${escapeHtml(error.message || "")}</p></div>`; return; }
  const parClasse = {};
  (eleves || []).forEach(e => { (parClasse[e.classe] = parClasse[e.classe] || []).push(e); });
  const classes = window.NEXI_CONFIG.CLASSES.filter(c => parClasse[c.code]);

  root.innerHTML = `<div id="classes-grid" class="features"></div><div id="classe-detail"></div>`;
  const grid = document.getElementById("classes-grid");
  if (!classes.length) { grid.innerHTML = `<div class="empty-state"><h4>Aucun élève validé pour l'instant</h4></div>`; return; }
  grid.innerHTML = classes.map(c => `
    <div class="feature card" style="cursor:pointer;" data-classe="${c.code}"><h4>${c.libelle}</h4><p>${parClasse[c.code].length} élève(s)</p></div>
  `).join("");
  grid.querySelectorAll("[data-classe]").forEach(card => card.addEventListener("click", () => renderClasseDetail(card.dataset.classe)));
}

async function renderClasseDetail(classe) {
  const detail = document.getElementById("classe-detail");
  const { data: cats } = await sb.from("categories").select("*");
  detail.innerHTML = `
    <h3 style="margin-top:24px;">Classement — ${escapeHtml(classe)}</h3>
    <div class="admin-tabs" id="cat-tabs"><button class="active" data-cat="">Global</button>${(cats || []).map(c => `<button data-cat="${c.nom}">${c.nom}</button>`).join("")}</div>
    <ul class="rank-list" id="detail-rank"></ul>
  `;
  detail.querySelector("#cat-tabs").querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    detail.querySelectorAll("#cat-tabs button").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    loadClasseRanking(classe, b.dataset.cat || null);
  }));
  loadClasseRanking(classe, null);
}

async function loadClasseRanking(classe, categorie) {
  const { data } = await sb.rpc("rpc_superviseur_classement", { p_superviseur_id: session.id, p_token: session.token, p_classe: classe, p_categorie: categorie });
  document.getElementById("detail-rank").innerHTML = (data || []).map((r, i) => `
    <li><span class="pos">${i + 1}</span><span class="id">${escapeHtml(r.identifiant)}</span><span class="pts">${Math.round(r.points)} pts</span></li>
  `).join("") || `<div class="empty-state"><h4>Pas encore de données</h4></div>`;
}

async function renderStats() {
  const { data, error } = await sb.rpc("rpc_superviseur_stats", { p_superviseur_id: session.id, p_token: session.token });
  if (error) { console.error("rpc_superviseur_stats:", error); root.innerHTML = `<div class="empty-state"><h4>Erreur d'accès</h4><p>${escapeHtml(error.message || "")}</p></div>`; return; }
  root.innerHTML = `
    <h2>Statistiques de mon école</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Classe</th><th>Élèves</th><th>Moyenne de points cumulés</th></tr></thead>
      <tbody>${(data || []).map(v => `<tr><td>${escapeHtml(v.classe)}</td><td>${v.nb_eleves}</td><td>${v.moyenne_points}</td></tr>`).join("") || `<tr><td colspan="3">Aucune donnée</td></tr>`}</tbody>
    </table></div>
  `;
}

async function renderSuggerer() {
  root.innerHTML = `
    <h2>Suggérer un élève</h2>
    <p>L'administrateur devra valider cette suggestion avant que l'élève puisse se connecter.</p>
    <form id="form-suggerer" class="card">
      <div class="field"><label>Nom complet</label><input required id="s-nom"></div>
      <div class="field"><label>Identifiant (pseudo public)</label><input required id="s-id"></div>
      <div class="field"><label>Mot de passe provisoire</label><input required id="s-pw" type="text"></div>
      <div class="field"><label>Sexe</label><select id="s-sexe"><option value="M">M</option><option value="F">F</option></select></div>
      <div class="field"><label>Classe</label><select id="s-classe">${window.NEXI_CONFIG.CLASSES.map(c => `<option value="${c.code}">${c.libelle}</option>`).join("")}</select></div>
      <button class="btn block" type="submit">Envoyer la suggestion</button>
    </form>
  `;
  document.getElementById("form-suggerer").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { error } = await sb.rpc("superviseur_suggerer_eleve", {
      p_superviseur_id: session.id, p_token: session.token,
      p_nom_complet: document.getElementById("s-nom").value,
      p_identifiant: document.getElementById("s-id").value,
      p_password: document.getElementById("s-pw").value,
      p_sexe: document.getElementById("s-sexe").value,
      p_classe: document.getElementById("s-classe").value
    });
    if (error) { NexiGamify.toast("Erreur : identifiant peut-être déjà pris.", "error"); return; }
    NexiGamify.toast("Suggestion envoyée à l'admin.", "success");
    e.target.reset();
  });
}

render("eleves");
