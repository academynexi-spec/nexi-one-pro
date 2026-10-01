// =========================================================
// PANEL ÉLÈVE — toutes les données sensibles passent par des RPC
// Supabase (jamais de fetch brut de table), la correction des défis
// se fait côté serveur : le client ne reçoit jamais la clé de réponses.
// =========================================================
const session = NexiAuth.requireRole("eleve");
const sb = getSupabase();
const root = document.getElementById("view-root");
let bot;

document.getElementById("btn-logout").addEventListener("click", () => NexiAuth.logout());
document.querySelectorAll(".bottomnav button").forEach(btn => {
  btn.addEventListener("click", () => { setActiveNav(btn.dataset.view); render(btn.dataset.view); });
});
function setActiveNav(view) { document.querySelectorAll(".bottomnav button").forEach(b => b.classList.toggle("active", b.dataset.view === view)); }
function escapeHtml(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// Une session périmée/invalide (jeton révoqué par une reconnexion ailleurs,
// par ex.) fait échouer chaque RPC avec "non autorisé" — plutôt que de
// laisser un écran d'erreur muet, on détecte ce cas précis et on renvoie
// proprement vers la reconnexion.
function isAuthError(error) {
  const msg = (error?.message || "").toLowerCase();
  return msg.includes("non autorisé") || msg.includes("jwt") || msg.includes("permission denied");
}
function handleAuthError() {
  NexiGamify.toast("Session expirée — reconnexion nécessaire.", "error");
  setTimeout(() => NexiAuth.logout(), 1500);
}

async function init() { bot = mountNexiBot(document.body); render("profil"); }

async function render(view) {
  root.innerHTML = `<div class="empty-state"><h4>Chargement…</h4></div>`;
  if (view === "profil") return renderProfil();
  if (view === "defis") return renderDefisListe();
  if (view === "affinites") return renderAffinites();
  if (view === "cartes") return renderCartes();
  if (view === "classement") return renderClassement();
}

// ---------------------------------------------------------
// PROFIL — un seul appel RPC agrégé côté serveur
// ---------------------------------------------------------
async function renderProfil() {
  const { data, error } = await sb.rpc("rpc_mon_profil", { p_eleve_id: session.id, p_token: session.token });
  const profil = (data && data[0]) || { score_par_categorie: {}, score_total: 0, defis_faits: 0, profil_dominant: null };
  if (error) {
    console.error("rpc_mon_profil:", error);
    NexiGamify.toast(`Profil : ${error.message || "erreur inconnue"}`, "error");
    if (isAuthError(error)) return handleAuthError();
  }

  root.innerHTML = `
    <div class="profil-header">
      <div class="avatar-wrap">
        <img id="avatar-img" src="${session.avatar_url || 'icons/icon-192.png'}" alt="Avatar">
        <div class="edit-badge" id="btn-edit-avatar">✎</div>
      </div>
      <div>
        <h2 style="margin-bottom:2px;">${escapeHtml(session.nom_complet)}</h2>
        <p style="margin:0;">Identifiant : <b style="color:var(--cyan);">${escapeHtml(session.identifiant)}</b> · Classe ${escapeHtml(session.classe || "—")}</p>
      </div>
    </div>
    <input type="file" id="avatar-input" accept="image/*" style="display:none;">
    <div class="stat-grid">
      <div class="stat"><div class="val">${Math.round(profil.score_total)}</div><div class="lab">Points cumulés</div></div>
      <div class="stat"><div class="val">${profil.defis_faits}</div><div class="lab">Défis complétés</div></div>
      <div class="stat"><div class="val">${profil.profil_dominant ? window.NEXI_CONFIG.RIASEC_LABELS[profil.profil_dominant] : "—"}</div><div class="lab">Profil dominant</div></div>
    </div>
    <h3 style="margin-top:26px;">Progression par catégorie</h3>
    <div class="radar-wrap"><canvas id="radar" width="280" height="280"></canvas></div>
  `;
  drawRadar(profil.score_par_categorie || {});

  document.getElementById("btn-edit-avatar").addEventListener("click", () => document.getElementById("avatar-input").click());
  document.getElementById("avatar-input").addEventListener("change", async (e) => {
    const file = e.target.files[0]; if (!file) return;
    NexiGamify.toast("Envoi de la photo…");
    const url = await uploadAvatar(file, session.id);
    if (url) {
      const { error } = await sb.rpc("rpc_update_avatar", { p_eleve_id: session.id, p_token: session.token, p_url: url });
      if (error) {
        console.error("rpc_update_avatar:", error);
        NexiGamify.toast(`Photo envoyée mais non enregistrée : ${error.message}`, "error");
        if (isAuthError(error)) return handleAuthError();
        return;
      }
      session.avatar_url = url; NexiAuth.setSession(session);
      document.getElementById("avatar-img").src = url;
      NexiGamify.toast("Photo mise à jour !", "success");
    }
  });
}

function drawRadar(totaux) {
  const canvas = document.getElementById("radar");
  const ctx = canvas.getContext("2d");
  const cats = Object.keys(totaux).length ? Object.keys(totaux) : ["math", "langue", "svt", "spc"];
  const max = Math.max(50, ...cats.map(c => Number(totaux[c]) || 0));
  const cx = 140, cy = 140, r = 105;
  ctx.clearRect(0, 0, 280, 280);
  ctx.strokeStyle = "#1E2A47";
  for (let ring = 1; ring <= 4; ring++) {
    ctx.beginPath();
    cats.forEach((_, i) => {
      const a = (Math.PI * 2 * i) / cats.length - Math.PI / 2, rr = (r * ring) / 4;
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.closePath(); ctx.stroke();
  }
  ctx.beginPath();
  cats.forEach((c, i) => {
    const a = (Math.PI * 2 * i) / cats.length - Math.PI / 2;
    const val = (Number(totaux[c]) || 0) / max;
    const x = cx + Math.cos(a) * r * val, y = cy + Math.sin(a) * r * val;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.closePath(); ctx.fillStyle = "rgba(41,241,224,.28)"; ctx.strokeStyle = "#29F1E0"; ctx.lineWidth = 2;
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#8C9BC2"; ctx.font = "12px Inter"; ctx.textAlign = "center";
  cats.forEach((c, i) => {
    const a = (Math.PI * 2 * i) / cats.length - Math.PI / 2;
    const x = cx + Math.cos(a) * (r + 20), y = cy + Math.sin(a) * (r + 20);
    ctx.fillText(c, x, y);
  });
}

// ---------------------------------------------------------
// DÉFIS — liste + statut "fait" en un seul appel serveur
// ---------------------------------------------------------
async function renderDefisListe() {
  const { data: defis, error } = await sb.rpc("rpc_mes_defis", { p_eleve_id: session.id, p_token: session.token });
  if (error) {
    console.error("rpc_mes_defis:", error);
    root.innerHTML = `<div class="empty-state"><h4>Erreur de chargement</h4><p>${escapeHtml(error.message || "")}</p></div>`;
    if (isAuthError(error)) handleAuthError();
    return;
  }
  if (!defis || !defis.length) {
    root.innerHTML = `<div class="empty-state"><h4>Aucun défi disponible</h4><p>Reviens bientôt, ton superviseur ou l'admin publiera le prochain défi pour la classe <b>${escapeHtml(session.classe || "—")}</b>.</p></div>`;
    return;
  }
  root.innerHTML = `<h2>Défis</h2>` + defis.map(d => `
    <div class="card" style="margin-bottom:12px; display:flex; align-items:center; justify-content:space-between; gap:12px;">
      <div><b>${escapeHtml(d.titre)}</b><br><span style="color:var(--text-dim); font-size:.82rem;">Classe ${escapeHtml(d.classe)}</span></div>
      ${d.fait ? `<span class="badge on">Fait · ${Math.round(d.score_total)} pts</span>` : `<button class="btn" data-defi="${d.id}">Jouer</button>`}
    </div>
  `).join("");
  root.querySelectorAll("button[data-defi]").forEach(btn => btn.addEventListener("click", () => startQuiz(btn.dataset.defi)));
}

async function startQuiz(defiId) {
  const { data: questions, error } = await sb.rpc("rpc_questions_defi", { p_defi_id: defiId });
  if (error || !questions || !questions.length) { NexiGamify.toast("Ce défi n'a pas encore de questions.", "error"); return; }
  // Sécurité : accepte aussi des options reçues sous forme de texte JSON
  questions.forEach(q => {
    if (!Array.isArray(q.options)) {
      try { const p = typeof q.options === "string" ? JSON.parse(q.options) : []; q.options = Array.isArray(p) ? p : []; }
      catch (e) { q.options = []; }
    }
  });
  let idx = 0, reponses = [], timerInterval;

  function renderQuestion() {
    clearInterval(timerInterval);
    const q = questions[idx];
    const opts = q.options;
    root.innerHTML = `
      <div class="quiz-header">
        <span>Question ${idx + 1} / ${questions.length}</span>
        <div class="timer-ring">
          <svg width="56" height="56"><circle cx="28" cy="28" r="24" stroke="#1E2A47" stroke-width="5" fill="none"/>
          <circle id="timer-circle" cx="28" cy="28" r="24" stroke="#29F1E0" stroke-width="5" fill="none" stroke-dasharray="${2 * Math.PI * 24}" stroke-dashoffset="0"/></svg>
          <span class="num" id="timer-num">${q.temps_secondes}</span>
        </div>
      </div>
      <div class="progress-bar"><span style="width:${(idx / questions.length) * 100}%"></span></div>
      <div class="question-text">${escapeHtml(q.enonce)}</div>
      <div class="options" id="options-list">${opts.map((o, i) => `<div class="option" data-i="${i}">${escapeHtml(o)}</div>`).join("")}</div>
      <button class="btn block" id="btn-next" style="margin-top:20px; display:none;">${idx === questions.length - 1 ? "Voir mon score" : "Question suivante"}</button>
    `;

    let selected = new Set(), answered = false;
    root.querySelectorAll(".option").forEach(opt => {
      opt.addEventListener("click", () => {
        if (answered) return;
        NexiGamify.playSound("click");
        opt.classList.toggle("selected");
        const i = Number(opt.dataset.i);
        selected.has(i) ? selected.delete(i) : selected.add(i);
      });
    });
    const validateBtn = document.createElement("button");
    validateBtn.className = "btn secondary block"; validateBtn.textContent = "Valider ma réponse";
    validateBtn.style.marginTop = "14px";
    document.getElementById("options-list").after(validateBtn);
    validateBtn.addEventListener("click", () => { if (!answered) { validateBtn.disabled = true; lock(); } });

    let timeLeft = q.temps_secondes;
    const circle = document.getElementById("timer-circle");
    const circumference = 2 * Math.PI * 24;
    timerInterval = setInterval(() => {
      timeLeft--;
      document.getElementById("timer-num").textContent = Math.max(timeLeft, 0);
      circle.style.strokeDashoffset = circumference * (1 - timeLeft / q.temps_secondes);
      if (timeLeft <= 3 && timeLeft > 0) NexiGamify.playSound("tick");
      if (timeLeft <= 0) { clearInterval(timerInterval); if (!answered) lock(); }
    }, 1000);

    function lock() {
      if (answered) return;
      answered = true;
      clearInterval(timerInterval);
      root.querySelectorAll(".option").forEach(o => o.style.pointerEvents = "none");
      reponses.push({ question_id: q.id, choix: [...selected] });
      const nextBtn = document.getElementById("btn-next");
      nextBtn.style.display = "block";
      nextBtn.addEventListener("click", () => { idx++; idx < questions.length ? renderQuestion() : finishQuiz(); }, { once: true });
      NexiGamify.playSound("click");
    }
  }

  async function finishQuiz() {
    root.innerHTML = `<div class="empty-state"><h4>Correction en cours…</h4></div>`;
    const { data, error } = await sb.rpc("soumettre_defi", { p_eleve_id: session.id, p_token: session.token, p_defi_id: defiId, p_reponses: reponses });
    if (error) {
      console.error("soumettre_defi:", error);
      root.innerHTML = `<div class="empty-state"><h4>Erreur</h4><p>${escapeHtml(error.message)}</p></div>`;
      if (isAuthError(error)) handleAuthError();
      return;
    }
    const result = data[0];
    const corrections = result.corrections || [];
    const questionMap = Object.fromEntries(questions.map(q => [q.id, q]));

    root.innerHTML = `
      <div class="empty-state">
        <h4>Défi terminé !</h4>
        <div class="stat" style="max-width:200px; margin:16px auto;"><div class="val">${Math.round(result.score_total)}</div><div class="lab">Points obtenus</div></div>
      </div>
      <h3>Corrigé détaillé</h3>
      ${corrections.map((c, i) => `
        <div class="card" style="margin-bottom:10px;">
          <b>${c.correct ? "✅" : "❌"} ${escapeHtml(questionMap[c.question_id]?.enonce || "Question")}</b>
          <div class="explication-box" style="margin-top:10px;">
            Bonne(s) réponse(s) : ${c.bonnes_reponses.map(bi => escapeHtml(questionMap[c.question_id]?.options[bi] ?? "")).join(", ")}<br>
            ${c.explication ? escapeHtml(c.explication) : ""}
          </div>
        </div>
      `).join("")}
      <button class="btn block" id="btn-back-defis" style="margin-top:10px;">Retour aux défis</button>
    `;
    document.getElementById("btn-back-defis").addEventListener("click", () => render("defis"));
    if (result.score_total >= 70) bot && bot.reactBravo(); else bot && bot.reactEncourage();
  }

  renderQuestion();
}

// ---------------------------------------------------------
// AFFINITÉS (RIASEC)
// ---------------------------------------------------------
async function renderAffinites() {
  const { data: today, error: todayError } = await sb.rpc("rpc_affinite_today", { p_eleve_id: session.id, p_token: session.token });
  if (todayError) {
    console.error("rpc_affinite_today:", todayError);
    root.innerHTML = `<div class="empty-state"><h4>Erreur de chargement</h4><p>${escapeHtml(todayError.message || "")}</p></div>`;
    if (isAuthError(todayError)) handleAuthError();
    return;
  }
  if (today && today.length) {
    const dom = today[0].profil_dominant;
    root.innerHTML = `
      <div class="empty-state">
        <h4>Déjà fait aujourd'hui ✅</h4>
        <p>Ton profil du jour : <b style="color:var(--violet);">${window.NEXI_CONFIG.RIASEC_LABELS[dom] || dom}</b></p>
        <p>Reviens demain pour continuer à affiner ton profil.</p>
      </div>`;
    return;
  }
  const { data: questions } = await sb.from("affinites_questions").select("*").eq("actif", true);
  if (!questions || !questions.length) {
    root.innerHTML = `<div class="empty-state"><h4>Pas encore de questions</h4><p>L'admin n'a pas encore ajouté de questions d'affinités.</p></div>`;
    return;
  }
  let idx = 0; const scores = { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 };

  function renderQ() {
    const q = questions[idx];
    root.innerHTML = `
      <h2>Mes affinités</h2>
      <div class="progress-bar"><span style="width:${(idx / questions.length) * 100}%"></span></div>
      <div class="card glow" style="text-align:center; padding:34px 20px;">
        <p style="color:var(--text); font-size:1.1rem; font-weight:600;">${escapeHtml(q.texte)}</p>
        <div style="display:flex; justify-content:center; gap:8px; margin-top:20px; flex-wrap:wrap;">
          ${[1, 2, 3, 4, 5].map(v => `<button class="btn secondary" data-v="${v}" style="width:52px; height:52px; border-radius:50%; padding:0;">${v}</button>`).join("")}
        </div>
        <p style="font-size:.72rem; margin-top:14px;">1 = pas du tout · 5 = tout à fait</p>
      </div>
    `;
    root.querySelectorAll("button[data-v]").forEach(btn => {
      btn.addEventListener("click", () => {
        NexiGamify.playSound("click");
        scores[q.dimension] += Number(btn.dataset.v);
        idx++;
        idx < questions.length ? renderQ() : finishAffinites();
      });
    });
  }

  async function finishAffinites() {
    const dominant = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
    await sb.rpc("soumettre_affinites", { p_eleve_id: session.id, p_token: session.token, p_scores: scores, p_profil_dominant: dominant });
    root.innerHTML = `
      <div class="empty-state">
        <h4>Merci !</h4>
        <p>Ton profil dominant du jour : <b style="color:var(--violet);">${window.NEXI_CONFIG.RIASEC_LABELS[dominant]}</b></p>
        <div class="riasec-legend">${Object.entries(scores).map(([k, v]) => `<span>${window.NEXI_CONFIG.RIASEC_LABELS[k]} · ${v}</span>`).join("")}</div>
      </div>`;
    bot && bot.reactBravo();
  }

  renderQ();
}

// ---------------------------------------------------------
// CARTES DE RÉVISION
// ---------------------------------------------------------
async function renderCartes() {
  const { data: cartes, error } = await sb.from("cartes_revision").select("*, categories(nom)").eq("classe", session.classe).eq("masque", false);
  if (error) console.error("cartes_revision:", error);
  if (!cartes || !cartes.length) {
    root.innerHTML = `<div class="empty-state"><h4>Pas encore de cartes</h4><p>Aucune carte visible pour la classe <b>${escapeHtml(session.classe || "—")}</b> pour l'instant. Si l'admin en a pourtant importé, vérifie que la classe saisie lors de l'import correspond exactement à ce code.</p></div>`;
    return;
  }
  let idx = 0;
  function renderCard() {
    const c = cartes[idx];
    root.innerHTML = `
      <h2>Cartes de révision</h2>
      <p style="text-align:center; color:var(--text-dim);">${idx + 1} / ${cartes.length} — ${escapeHtml(c.categories?.nom || "")}</p>
      <div class="flash-wrap">
        <div class="flash-card" id="flash">
          <div class="flash-face front">${escapeHtml(c.recto)}</div>
          <div class="flash-face back">
            <div class="reponse">${escapeHtml(c.verso_reponse)}</div>
            ${c.verso_explication ? `<div class="explication">${escapeHtml(c.verso_explication)}</div>` : ""}
          </div>
        </div>
      </div>
      <div class="flash-nav">
        <button class="btn secondary" id="c-prev" ${idx === 0 ? "disabled" : ""}>◀ Précédent</button>
        <button class="btn secondary" id="c-next" ${idx === cartes.length - 1 ? "disabled" : ""}>Suivant ▶</button>
      </div>
    `;
    document.getElementById("flash").addEventListener("click", (e) => e.currentTarget.classList.toggle("flipped"));
    document.getElementById("c-prev").addEventListener("click", () => { idx--; renderCard(); });
    document.getElementById("c-next").addEventListener("click", () => { idx++; renderCard(); });
  }
  renderCard();
}

// ---------------------------------------------------------
// CLASSEMENT — RPC paginée, jamais de nom, juste l'identifiant
// ---------------------------------------------------------
async function renderClassement() {
  root.innerHTML = `
    <h2>Classement</h2>
    <div class="admin-tabs">
      <button class="active" data-scope="ecole">Mon école</button>
      <button data-scope="classe">Ma classe</button>
    </div>
    <ul class="rank-list" id="rank-list"></ul>
  `;
  root.querySelectorAll(".admin-tabs button").forEach(btn => {
    btn.addEventListener("click", () => {
      root.querySelectorAll(".admin-tabs button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      loadRanking(btn.dataset.scope);
    });
  });
  loadRanking("ecole");
}

async function loadRanking(scope) {
  const { data, error } = await sb.rpc("rpc_classement", { p_scope: scope, p_ecole_id: session.ecole_id, p_classe: session.classe, p_limit: 50, p_offset: 0 });
  const list = document.getElementById("rank-list");
  if (error) { console.error("rpc_classement:", error); list.innerHTML = `<div class="empty-state"><h4>Erreur</h4><p>${escapeHtml(error.message || "")}</p></div>`; return; }
  if (!data || !data.length) { list.innerHTML = `<div class="empty-state"><h4>Pas encore de classement</h4></div>`; return; }
  list.innerHTML = data.map((r, i) => `
    <li class="${r.eleve_id === session.id ? "me" : ""}">
      <span class="pos">${i + 1}</span><span class="id">${escapeHtml(r.identifiant)}</span><span class="pts">${Math.round(r.points_total)} pts</span>
    </li>`).join("");
}

init();
