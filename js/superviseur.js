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
  if (view === "tournois") return renderTournois();
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

// =========================================================
// TOURNOIS INTER-ÉCOLES (superviseur) — onglet ajouté par le script
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

const STATUT_TN = { en_cours: "En cours", a_venir: "À venir", termine: "Terminé" };
const dateTn = (iso) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

async function renderTournois() {
  const { data, error } = await sb.rpc("rpc_superviseur_tournois", { p_superviseur_id: session.id, p_token: session.token });
  if (error) {
    const absent = (error.code === "PGRST202" || /could not find the function|schema cache/i.test(error.message || ""));
    root.innerHTML = `<div class="empty-state"><h4>${absent ? "Tournois non activés" : "Erreur d'accès"}</h4><p>${escapeHtml(absent ? "Cette fonction n'est pas encore disponible." : (error.message || ""))}</p></div>`; return;
  }
  if (!data || !data.length) { root.innerHTML = `<div class="empty-state"><h4>Aucun tournoi pour votre école</h4><p>Lorsque votre école sera inscrite à un tournoi inter-écoles, il apparaîtra ici.</p></div>`; return; }
  root.innerHTML = `<h2>🏆 Tournois inter-écoles</h2><div class="features">${data.map((t, i) => `
    <div class="feature card" style="cursor:pointer;" data-i="${i}"><h4>${escapeHtml(t.nom)}</h4>
      <p>${STATUT_TN[t.statut] || t.statut} · ${dateTn(t.date_debut)} → ${dateTn(t.date_fin)}</p>
      <p>Votre école : <b>${t.rang ? t.rang + "ᵉ" : "—"}</b> sur ${t.nb_ecoles}</p></div>`).join("")}</div>`;
  root.querySelectorAll("[data-i]").forEach(el => el.addEventListener("click", () => renderTournoiDetail(data[Number(el.dataset.i)].id)));
}

async function renderTournoiDetail(id) {
  root.innerHTML = `<div class="empty-state"><h4>Chargement…</h4></div>`;
  const { data: d, error } = await sb.rpc("rpc_superviseur_tournoi", { p_superviseur_id: session.id, p_token: session.token, p_tournoi_id: id });
  if (error) { root.innerHTML = `<div class="empty-state"><h4>Erreur d'accès</h4><p>${escapeHtml(error.message || "")}</p></div>`; return; }
  const t = d.tournoi, MED = ["🥇", "🥈", "🥉"], mon = d.classement_ecoles.find(r => r.moi);
  const absents = d.eleves.filter(e => Number(e.nb_defis) === 0);
  root.innerHTML = `
    <button class="btn secondary" id="tn-back" style="margin-bottom:10px;">← Tournois</button>
    <h2>🏆 ${escapeHtml(t.nom)}</h2>
    <p>${STATUT_TN[t.statut] || t.statut} · du ${dateTn(t.date_debut)} au ${dateTn(t.date_fin)} · ${d.nb_defis} défi(s)</p>
    ${t.description ? `<p>${escapeHtml(t.description)}</p>` : ""}
    <div class="card"><b>Votre école : ${mon ? mon.rang + "ᵉ sur " + d.classement_ecoles.length : "—"}</b>${mon ? ` · score ${Number(mon.score)} · ${mon.participants} / ${mon.eligibles} élèves ont joué (${mon.eligibles ? Math.round(100 * mon.participants / mon.eligibles) : 0} %)` : ""}
      <p style="font-size:.85rem;margin:6px 0 0;">Score = points des ${t.top_n} meilleurs élèves ÷ ${t.top_n}. Mobiliser plus d'élèves fait monter l'école.</p></div>
    <h3 style="margin-top:20px;">Classement des écoles</h3>
    <div class="table-wrap"><table><thead><tr><th>Rang</th><th>École</th><th>Score</th><th>Participation</th></tr></thead><tbody>
      ${d.classement_ecoles.map(r => `<tr${r.moi ? ' style="font-weight:700;"' : ""}><td>${MED[r.rang - 1] || r.rang}</td><td>${escapeHtml(r.ecole)}${r.moi ? " (vous)" : ""}</td><td>${Number(r.score)}</td><td>${r.participants} / ${r.eligibles}</td></tr>`).join("")}
    </tbody></table></div>
    <h3 style="margin-top:20px;">Par classe</h3>
    <div class="table-wrap"><table><thead><tr><th>Classe</th><th>Ont joué</th><th>Points cumulés</th></tr></thead><tbody>
      ${d.par_classe.map(c => `<tr><td>${escapeHtml(c.classe)}</td><td>${c.participants} / ${c.eligibles}</td><td>${Number(c.points)}</td></tr>`).join("") || `<tr><td colspan="3">—</td></tr>`}
    </tbody></table></div>
    <h3 style="margin-top:20px;">Vos élèves</h3>
    ${absents.length ? `<p style="font-size:.88rem;">⚠️ ${absents.length} élève(s) n'ont pas encore joué : <b>${absents.map(e => escapeHtml(e.identifiant)).join(", ")}</b></p>` : ""}
    <div class="table-wrap"><table><thead><tr><th>Pseudo</th><th>Classe</th><th>Défis joués</th><th>Points</th></tr></thead><tbody>
      ${d.eleves.map(e => `<tr><td>${escapeHtml(e.identifiant)}</td><td>${escapeHtml(e.classe || "")}</td><td>${e.nb_defis}</td><td>${Number(e.points)}</td></tr>`).join("") || `<tr><td colspan="4">Aucun élève éligible.</td></tr>`}
    </tbody></table></div>`;
  document.getElementById("tn-back").addEventListener("click", renderTournois);
}

injectTournoiTab();
// Superviseur d'une école spéciale : seules les classes de son programme sont proposées (sans effet pour une école nationale).
(window.NexiProgrammes ? NexiProgrammes.charger({ ecoleId: session.ecole_id, restreindre: true }) : Promise.resolve()).catch(() => {}).then(() => render("eleves"));
