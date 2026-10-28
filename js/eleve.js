// =========================================================
// PANEL ÉLÈVE — toutes les données sensibles passent par des RPC
// Supabase (jamais de fetch brut de table), la correction des défis
// se fait côté serveur : le client ne reçoit jamais la clé de réponses.
// =========================================================
const session = NexiAuth.requireRole("eleve");
const sb = getSupabase();
const root = document.getElementById("view-root");
let bot;

// ---------------------------------------------------------
// ABONNEMENT — état (début / fin) et verrouillage des rubriques d'apprentissage.
// Sans effet tant que le patch SQL « abonnements » n'est pas appliqué, et tant que l'admin n'a pas activé le blocage.
// ---------------------------------------------------------
// [ABO-DEBUT]
let classesPrete = Promise.resolve();   // chargement des classes (libellés lisibles, ex. « Mécanique générale — 4ème humanités »)
function libelleClasse(code) { return (window.NexiProgrammes && NexiProgrammes.libelle) ? NexiProgrammes.libelle(code) : (code || ""); }
let vueCourante = "profil";       // dernière rubrique demandée (pour revenir au profil si l'abonnement s'arrête en cours de session)
const VUES_LIBRES = ["profil"];   // seules pages ouvertes sans abonnement actif (ajoute "notifs" pour laisser lire les messages)
let abo = null;                   // { etat: actif | a_venir | expire | inactif, acces, blocage, debut, fin, jours_restants } ou null (inconnu = accès normal)
let aboEnCours = null;
const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
function dateLongueFr(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${Number(m[3])} ${MOIS_FR[Number(m[2]) - 1]} ${m[1]}` : "";
}
function aAcces() { return !abo || abo.acces !== false; }
function isAboError(error) { return (error?.message || "").toLowerCase().includes("abonnement inactif"); }
function appliquerVerrouNav() {
  const verrou = !aAcces();
  document.querySelectorAll(".bottomnav button").forEach(b => {
    const ferme = verrou && !VUES_LIBRES.includes(b.dataset.view);
    b.style.opacity = ferme ? ".5" : "";
    b.setAttribute("aria-disabled", ferme ? "true" : "false");
  });
}
// Une seule requête à la fois (le démarrage et l'affichage du profil la partagent).
function chargerAbonnement() {
  if (aboEnCours) return aboEnCours;
  aboEnCours = (async () => {
    try {
      const { data, error } = await sb.rpc("rpc_mon_abonnement", { p_eleve_id: session.id, p_token: session.token });
      if (error) { if (isAuthError(error)) handleAuthError(); abo = null; }   // patch absent ou réseau : accès normal (le serveur reste juge)
      else abo = data || null;
    } catch (e) { abo = null; }
    appliquerVerrouNav();
    return abo;
  })().finally(() => { aboEnCours = null; });
  return aboEnCours;
}
// Boutons de contact : renseigne NEXI_CONFIG.CONTACT_ABONNEMENT = { whatsapp: "243…", email: "…" } dans js/config.js.
function boutonsContactAbo() {
  const c = Object.assign({}, window.NEXI_CONTACT, (window.NEXI_CONFIG && window.NEXI_CONFIG.CONTACT_ABONNEMENT) || {});
  const msg = `Bonjour NEXI ACADEMY, je suis ${session.nom_complet} (identifiant : ${session.identifiant}, classe : ${libelleClasse(session.classe) || "—"}). Mon abonnement apparaît inactif.`;
  const out = [];
  const wa = String(c.whatsapp || "").replace(/\D/g, "");
  if (wa) out.push(`<a class="btn" href="https://wa.me/${wa}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">💬 Écrire sur WhatsApp</a>`);
  if (/^[^\s@<>"']+@[^\s@<>"']+$/.test(String(c.email || ""))) out.push(`<a class="btn secondary" href="mailto:${escapeHtml(c.email)}?subject=${encodeURIComponent("Abonnement NEXI ONE — " + session.identifiant)}&body=${encodeURIComponent(msg)}">✉️ Envoyer un e-mail</a>`);
  return out.join(" ");
}
// Carte « Mon abonnement » du profil — affichée seulement quand le blocage est activé par l'admin.
function carteAbonnement() {
  if (!abo || !abo.blocage) return "";
  const fin = dateLongueFr(abo.fin), debut = dateLongueFr(abo.debut), j = abo.jours_restants;
  let couleur = "var(--cyan)", badge = `<span class="badge on">Actif</span>`, titre = "Abonnement actif", detail = "", action = false;
  if (abo.etat === "actif") {
    if (j !== null && j !== undefined && j <= 7) {
      couleur = "var(--gold)"; titre = "Abonnement actif — il se termine bientôt";
      detail = `Fin ${j === 0 ? "aujourd'hui" : j === 1 ? "demain" : `dans ${j} jours`} (le ${fin}). Renouvelle-le pour ne pas perdre l'accès aux cartes de révision, aux défis et au classement.`;
      action = true;
    } else {
      detail = fin ? `Valable${debut ? ` du ${debut}` : ""} jusqu'au ${fin}.` : "Accès complet aux cartes de révision, aux défis et au classement.";
    }
  } else if (abo.etat === "a_venir") {
    couleur = "var(--gold)"; badge = `<span class="badge pending">À venir</span>`; titre = "Abonnement pas encore commencé";
    detail = debut ? `Ton accès s'ouvrira le ${debut}.` : "Ton accès s'ouvrira prochainement."; action = true;
  } else if (abo.etat === "expire") {
    couleur = "#FF6B6B"; badge = `<span class="badge off">Expiré</span>`; titre = "Abonnement expiré";
    detail = `${fin ? `Il a pris fin le ${fin}. ` : ""}Réabonne-toi pour retrouver les cartes de révision, les défis et le classement.`; action = true;
  } else {
    couleur = "#FF6B6B"; badge = `<span class="badge off">Inactif</span>`; titre = "Abonnement inactif";
    detail = "Ton accès aux rubriques d'apprentissage est actuellement suspendu."; action = true;
  }
  const contact = action ? boutonsContactAbo() : "";
  return `<div class="card" style="margin:16px 0; border-color:${couleur};">
      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">${badge}<b>${titre}</b></div>
      <p style="margin:8px 0 ${contact ? "12px" : "0"}; color:var(--text-dim);">${detail}</p>
      ${contact ? `<div style="display:flex; gap:8px; flex-wrap:wrap;">${contact}</div>` : ""}
    </div>`;
}
// Écran affiché à la place d'une rubrique verrouillée.
function renderAbonnementInactif(view) {
  const quoi = { defis: "les défis", cartes: "les cartes de révision", affinites: "le test d'affinités", classement: "le classement", tournois: "les tournois", notifs: "tes notifications" }[view] || "cette rubrique";
  const e = abo ? abo.etat : "inactif";
  const titre = e === "expire" ? "Ton abonnement a expiré" : e === "a_venir" ? "Ton abonnement n'a pas encore commencé" : "Ton abonnement est inactif";
  const precision = e === "expire" && abo.fin ? `Il a pris fin le <b>${dateLongueFr(abo.fin)}</b>.`
    : e === "a_venir" && abo.debut ? `Ton accès s'ouvrira le <b>${dateLongueFr(abo.debut)}</b>.`
    : "Ton accès aux rubriques d'apprentissage est actuellement suspendu.";
  const contact = boutonsContactAbo();
  root.innerHTML = `
    <div class="card" style="max-width:540px; margin:20px auto; text-align:center;">
      <div style="font-size:2.2rem;" aria-hidden="true">🔒</div>
      <h2 style="margin:6px 0 10px;">${titre}</h2>
      <p style="margin:0 0 6px;">Pour accéder à ${quoi}, ton abonnement NEXI ONE doit être actif.</p>
      <p style="margin:0 0 16px; color:var(--text-dim);">${precision}</p>
      <div style="text-align:left; border-top:1px solid #1E2A47; padding-top:14px;">
        <p style="margin:0 0 12px;"><b>Tu veux t'abonner ou te réabonner ?</b><br>Rapproche-toi de ton école ou de NEXI ACADEMY.</p>
        <p style="margin:0 0 14px;"><b>Tu es déjà abonné(e) mais ton accès reste bloqué ?</b><br>Contacte NEXI ACADEMY en indiquant ton identifiant <b style="color:var(--cyan);">${escapeHtml(session.identifiant)}</b> : ton accès sera rétabli après vérification.</p>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:center; margin-top:6px;">
        ${contact}<button class="btn secondary" id="abo-retour" type="button">← Retour à mon profil</button>
      </div>
    </div>`;
  const back = document.getElementById("abo-retour");
  if (back) back.addEventListener("click", () => { setActiveNav("profil"); render("profil"); });
}
// [ABO-FIN]

// ---------------------------------------------------------
// SESSION UNIQUE — signal de présence toutes les 45 s (application ouverte) et libération à la déconnexion.
// Le serveur répond aussi avec l'état d'abonnement à jour : un abonnement qui s'arrête pendant la session
// ferme les rubriques dans la minute qui suit. Sans effet tant que le patch SQL « sécurité » n'est pas appliqué.
// ---------------------------------------------------------
async function pingSession() {
  try {
    const { data, error } = await sb.rpc("rpc_session_ping", { p_eleve_id: session.id, p_token: session.token });
    if (error || !data) return;                                  // réseau ou patch absent : on ne fait rien
    if (data.ok === false) {
      if (data.motif === "compte_utilise") { NexiSecurite.compteUtilise({ deconnecter: true }); return; }
      NexiGamify.toast("Ta session a pris fin : ton compte a été ouvert sur un autre appareil.", "error");
      setTimeout(() => NexiAuth.logout(), 2500);
      return;
    }
    if (data.abonnement) {
      abo = data.abonnement; appliquerVerrouNav();
      if (!aAcces() && !VUES_LIBRES.includes(vueCourante)) { setActiveNav("profil"); render("profil"); }
    }
  } catch (e) { /* ignoré */ }
}
function demarrerPing() {
  pingSession();
  setInterval(() => { if (document.visibilityState === "visible") pingSession(); }, 45000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pingSession(); });
}
// À la déconnexion : le compte est libéré tout de suite (un autre appareil peut s'y connecter aussitôt).
async function libererSession() {
  try { await Promise.race([sb.rpc("rpc_session_liberer", { p_eleve_id: session.id, p_token: session.token }), new Promise(r => setTimeout(r, 2500))]); } catch (e) { /* ignoré */ }
}

document.getElementById("btn-logout").addEventListener("click", async () => { await detacherAppareilPush(); await libererSession(); NexiAuth.logout(); });
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
  return msg.includes("non autorisé") || msg.includes("jwt") || msg.includes("permission denied") || msg.includes("compte déjà utilisé");
}
function handleAuthError() {
  if (window.NexiSecurite && NexiSecurite.recent()) return;   // « Compte déjà utilisé » : le message s'en charge (et déconnecte à la fermeture)
  NexiGamify.toast("Session expirée — reconnexion nécessaire.", "error");
  setTimeout(() => NexiAuth.logout(), 1500);
}

async function init() { bot = mountNexiBot(document.body); const pAbo = chargerAbonnement(); classesPrete = window.NexiProgrammes ? NexiProgrammes.charger().catch(() => {}) : Promise.resolve(); render("profil"); await pAbo; demarrerPing(); await initNotifs(); if (aAcces()) initTournois(); initPush(); }

async function render(view) {
  vueCourante = view;
  if (!aAcces() && !VUES_LIBRES.includes(view)) return renderAbonnementInactif(view);   // abonnement non actif : profil uniquement
  root.innerHTML = `<div class="empty-state"><h4>Chargement…</h4></div>`;
  if (view === "profil") return renderProfil();
  if (view === "defis") return renderDefisListe();
  if (view === "affinites") return renderAffinites();
  if (view === "cartes") return renderCartes();
  if (view === "classement") return renderClassement();
  if (view === "notifs") return renderNotifs();
  if (view === "tournois") return renderTournois();
}

// ---------------------------------------------------------
// PROFIL — un seul appel RPC agrégé côté serveur
// ---------------------------------------------------------
async function renderProfil() {
  const [{ data, error }] = await Promise.all([sb.rpc("rpc_mon_profil", { p_eleve_id: session.id, p_token: session.token }), chargerAbonnement(), classesPrete]);
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
        <p style="margin:0;">Identifiant : <b style="color:var(--cyan);">${escapeHtml(session.identifiant)}</b> · Classe ${escapeHtml(libelleClasse(session.classe) || "—")}</p>
      </div>
    </div>
    <input type="file" id="avatar-input" accept="image/*" style="display:none;">
    ${carteAbonnement()}
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
    const ancienneUrl = session.avatar_url;
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
      supprimerAncienAvatar(ancienneUrl, url, session.id);   // libère l'espace de l'ancienne photo
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
    root.innerHTML = `<div class="empty-state"><h4>Aucun défi disponible</h4><p>Reviens bientôt, ton superviseur ou l'admin publiera le prochain défi pour la classe <b>${escapeHtml(libelleClasse(session.classe) || "—")}</b>.</p></div>`;
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
  let { data: questions, error } = await sb.rpc("rpc_questions_defi_v2", { p_eleve_id: session.id, p_token: session.token, p_defi_id: defiId });
  if (error && isMissingFn(error)) ({ data: questions, error } = await sb.rpc("rpc_questions_defi", { p_defi_id: defiId }));   // avant le patch sécurité
  if (error && isAuthError(error)) return handleAuthError();
  if (error && isAboError(error)) { await chargerAbonnement(); return renderAbonnementInactif("defis"); }
  if (error || !questions || !questions.length) { NexiGamify.toast("Ce défi n'a pas encore de questions.", "error"); return; }
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
// Questions d'affinités : celles du programme de l'école si elle en a (école spéciale), sinon les questions nationales.
async function questionsAffinites() {
  try {
    const { data: prog, error } = await sb.rpc("rpc_mon_programme", { p_eleve_id: session.id, p_token: session.token });
    if (!error && prog && prog.length && prog[0].programme_id) {
      const { data: propres, error: e2 } = await sb.from("affinites_questions_programme").select("*").eq("programme_id", prog[0].programme_id).eq("actif", true);
      if (!e2 && propres && propres.length) return propres;
    }
  } catch (err) { /* repli sur les questions nationales */ }
  const { data } = await sb.from("affinites_questions").select("*").eq("actif", true);
  return data;
}

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
  const questions = await questionsAffinites();
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
// CARTES DE RÉVISION — ancien affichage (conservé comme filet de sécurité)
// ---------------------------------------------------------
// ---------------------------------------------------------
// CARTES DE RÉVISION PAR COURS
// L'élève voit d'abord les cours de sa classe, puis les cartes du cours choisi.
// Tant que le patch SQL « cours et import » n'est pas appliqué (ou si l'appel
// échoue), on retombe sur l'ancien affichage : jamais pire qu'avant.
// ---------------------------------------------------------
function isMissingFn(error) {
  const m = (error?.message || "").toLowerCase();
  return error?.code === "PGRST202" || m.includes("could not find the function") || m.includes("schema cache");
}

function ensureCoursCss() {
  if (document.getElementById("nexi-cours-css")) return;
  const st = document.createElement("style");
  st.id = "nexi-cours-css";
  st.textContent = `
    .cours-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-top:14px}
    .cours-tile{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-height:118px;padding:14px 10px;
      border-radius:18px;border:1px solid rgba(127,127,127,.35);background:rgba(127,127,127,.12);color:inherit;font:inherit;cursor:pointer;
      text-align:center;-webkit-tap-highlight-color:transparent;transition:transform .15s ease,border-color .15s ease,background .15s ease}
    .cours-tile:hover,.cours-tile:focus-visible{border-color:#29F1E0;background:rgba(41,241,224,.10);outline:none}
    .cours-tile:active{transform:scale(.96)}
    .cours-tile .ico{font-size:2rem;line-height:1}
    .cours-tile .nom{font-weight:700;word-break:break-word}
    .cours-tile .nb{font-size:.8rem;opacity:.7}
    .cours-back{margin-bottom:8px}
    @media (prefers-reduced-motion:reduce){.cours-tile{transition:none}}`;
  document.head.appendChild(st);
}

async function renderCartes() {
  ensureCoursCss();
  const { data: cours, error } = await sb.rpc("rpc_cours_classe", { p_eleve_id: session.id, p_token: session.token });
  if (error) {
    if (isAuthError(error)) return handleAuthError();
    if (isAboError(error)) { await chargerAbonnement(); return renderAbonnementInactif("cartes"); }   // jamais de repli sur l'ancienne lecture directe
    console.error("rpc_cours_classe:", error);
    root.innerHTML = `<div class="empty-state"><h4>Cartes indisponibles</h4><p>Impossible de charger les cartes pour le moment. Réessaie dans un instant.</p></div>`;
    return;
  }
  if (!cours || !cours.length) {
    root.innerHTML = `<div class="empty-state"><h4>Pas encore de cartes</h4><p>Aucune carte visible pour la classe <b>${escapeHtml(libelleClasse(session.classe) || "—")}</b> pour l'instant. Reviens bientôt !</p></div>`;
    return;
  }
  root.innerHTML = `
    <h2>Cartes de révision</h2>
    <p style="text-align:center; color:var(--text-dim);">Choisis un cours</p>
    <div class="cours-grid">
      ${cours.map((c, i) => `
        <button type="button" class="cours-tile" data-i="${i}">
          <span class="ico">${escapeHtml(c.icone || "📘")}</span>
          <span class="nom">${escapeHtml(c.nom)}</span>
          <span class="nb">${c.nb_cartes} carte${c.nb_cartes > 1 ? "s" : ""}</span>
        </button>`).join("")}
    </div>`;
  root.querySelectorAll("[data-i]").forEach(el => el.addEventListener("click", () => {
    window.NexiGamify && NexiGamify.playSound("click");
    ouvrirCours(cours[Number(el.dataset.i)]);
  }));
}

async function ouvrirCours(c) {
  ensureCoursCss();
  root.innerHTML = `<div class="empty-state"><h4>Chargement…</h4></div>`;
  // Lecture par pages de 500 (jusqu'à 5000 cartes par cours et par classe).
  let cartes = [];
  for (let page = 0; page < 10; page++) {
    const { data, error } = await sb.rpc("rpc_cartes_cours", { p_eleve_id: session.id, p_token: session.token, p_cours_id: c.id, p_limit: 500, p_offset: page * 500 });
    if (error) {
      if (isAuthError(error)) return handleAuthError();
      if (isAboError(error)) { await chargerAbonnement(); return renderAbonnementInactif("cartes"); }
      console.error("rpc_cartes_cours:", error);
      root.innerHTML = `<div class="empty-state"><h4>Erreur de chargement</h4><p>${escapeHtml(error.message || "")}</p><button class="btn secondary" id="c-back">← Les cours</button></div>`;
      document.getElementById("c-back").addEventListener("click", renderCartes);
      return;
    }
    cartes = cartes.concat(data || []);
    if (!data || data.length < 500) break;
  }
  if (!cartes.length) { renderCartes(); return; }

  let idx = 0, celebre = false, swipedAt = 0;
  const go = (d) => { const n = idx + d; if (n < 0 || n >= cartes.length) return; idx = n; renderCard(); };
  const onKey = (e) => {
    if (!document.getElementById("flash")) { document.removeEventListener("keydown", onKey); return; }
    if (e.key === "ArrowRight") go(1); else if (e.key === "ArrowLeft") go(-1);
    else if (e.key === " " || e.key === "Enter") { e.preventDefault(); flip(); }
  };
  const flip = () => {
    const f = document.getElementById("flash"); if (!f) return;
    f.classList.toggle("flipped");
    if (f.classList.contains("flipped") && idx === cartes.length - 1 && !celebre && cartes.length > 1) {
      celebre = true; bot && bot.reactBravo();   // dernier recto retourné : petite célébration
    }
  };
  function renderCard() {
    const k = cartes[idx];
    root.innerHTML = `
      <button class="btn secondary cours-back" id="c-back">← Les cours</button>
      <h2>${escapeHtml((c.icone || "") + " " + c.nom)}</h2>
      <p style="text-align:center; color:var(--text-dim);">${idx + 1} / ${cartes.length}</p>
      <div class="flash-wrap">
        <div class="flash-card" id="flash">
          <div class="flash-face front">${escapeHtml(k.recto)}</div>
          <div class="flash-face back">
            <div class="reponse">${escapeHtml(k.verso_reponse)}</div>
            ${k.verso_explication ? `<div class="explication">${escapeHtml(k.verso_explication)}</div>` : ""}
          </div>
        </div>
      </div>
      <div class="flash-nav">
        <button class="btn secondary" id="c-prev" ${idx === 0 ? "disabled" : ""}>◀ Précédent</button>
        <button class="btn secondary" id="c-next" ${idx === cartes.length - 1 ? "disabled" : ""}>Suivant ▶</button>
      </div>`;
    document.getElementById("c-back").addEventListener("click", () => { document.removeEventListener("keydown", onKey); renderCartes(); });
    const flash = document.getElementById("flash");
    flash.addEventListener("click", () => { if (Date.now() - swipedAt > 400) flip(); });
    let x0 = 0, y0 = 0;
    flash.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    flash.addEventListener("touchend", (e) => {                      // glisser : carte suivante / précédente
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { swipedAt = Date.now(); go(dx < 0 ? 1 : -1); }
    }, { passive: true });
    document.getElementById("c-prev").addEventListener("click", () => go(-1));
    document.getElementById("c-next").addEventListener("click", () => go(1));
  }
  document.addEventListener("keydown", onKey);
  renderCard();
}

// ---------------------------------------------------------
// NOTIFICATIONS — cloche à côté du bouton de déconnexion, compteur, liste.
// Totalement silencieux tant que le patch SQL « notifications » n'est pas appliqué.
// ---------------------------------------------------------
let notifsCount = 0, notifsBell = null;

function ensureNotifsCss() {
  if (document.getElementById("nexi-notif-css")) return;
  const st = document.createElement("style");
  st.id = "nexi-notif-css";
  st.textContent = `
    .notif-bell{position:relative}
    .notif-fab{position:fixed;left:14px;bottom:88px;z-index:50;border-radius:50%;width:46px;height:46px;padding:0}
    .notif-badge{position:absolute;top:-5px;right:-5px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#FF5D6C;color:#fff;
      font-size:.7rem;font-weight:700;line-height:18px;text-align:center;box-sizing:border-box}
    .notif-badge[hidden]{display:none}
    .notif-list{display:grid;gap:10px;margin-top:14px}
    .notif-item{display:flex;gap:12px;align-items:flex-start;width:100%;text-align:left;padding:12px 14px;border-radius:16px;
      border:1px solid rgba(127,127,127,.35);background:rgba(127,127,127,.12);color:inherit;font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
    .notif-item.new{border-color:#29F1E0;background:rgba(41,241,224,.10)}
    .notif-item .ico{font-size:1.5rem;line-height:1.2}
    .notif-item .txt{display:flex;flex-direction:column;gap:2px;min-width:0}
    .notif-item .txt small{opacity:.8;word-break:break-word}
    .notif-item .txt em{font-size:.75rem;opacity:.6;font-style:normal}`;
  document.head.appendChild(st);
}

function dateRelative(iso) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.floor(h / 24);
  if (j === 1) return "hier";
  if (j < 7) return `il y a ${j} jours`;
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function setNotifsBadge(n, annoncer) {
  if (annoncer && n > notifsCount) NexiGamify.toast(`🔔 ${n - notifsCount > 1 ? "Nouvelles notifications" : "Nouvelle notification"}`, "success");
  notifsCount = n;
  if (!notifsBell) return;
  const b = notifsBell.querySelector(".notif-badge");
  b.textContent = n > 9 ? "9+" : String(n);
  b.hidden = n <= 0;
}

async function rafraichirNotifs() {
  if (document.hidden || !notifsBell) return;
  const { data, error } = await sb.rpc("rpc_notifs_non_lues", { p_eleve_id: session.id, p_token: session.token });
  if (error) { if (isAuthError(error)) handleAuthError(); return; }
  setNotifsBadge(Number(data) || 0, true);
}

async function initNotifs() {
  const { data, error } = await sb.rpc("rpc_notifs_non_lues", { p_eleve_id: session.id, p_token: session.token });
  if (error) return;                         // patch absent (ou erreur) : pas de cloche, rien ne change
  ensureNotifsCss();
  const logout = document.getElementById("btn-logout");
  const bell = document.createElement("button");
  bell.type = "button";
  bell.className = (logout && logout.className) || "btn secondary";
  bell.classList.add("notif-bell");
  bell.setAttribute("aria-label", "Notifications");
  bell.innerHTML = `🔔<span class="notif-badge" hidden></span>`;
  bell.addEventListener("click", () => { setActiveNav(""); render("notifs"); });
  if (logout && logout.parentNode) logout.parentNode.insertBefore(bell, logout);
  else { bell.classList.add("notif-fab"); document.body.appendChild(bell); }
  notifsBell = bell;
  setNotifsBadge(Number(data) || 0, false);
  if (notifsCount > 0) NexiGamify.toast(`🔔 ${notifsCount} nouvelle${notifsCount > 1 ? "s" : ""} notification${notifsCount > 1 ? "s" : ""}`, "success");
  setInterval(rafraichirNotifs, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) rafraichirNotifs(); });
}

async function renderNotifs() {
  ensureNotifsCss();
  const { data, error } = await sb.rpc("rpc_mes_notifs", { p_eleve_id: session.id, p_token: session.token, p_limit: 30 });
  if (error) {
    if (isAuthError(error)) return handleAuthError();
    root.innerHTML = `<div class="empty-state"><h4>Erreur de chargement</h4><p>${escapeHtml(error.message || "")}</p></div>`;
    return;
  }
  const liste = data || [], ICONES = { defi: "🎯", cartes: "🗂️", message: "📢" };
  root.innerHTML = `<h2>Notifications</h2><div id="push-card"></div>` + (liste.length
    ? `<div class="notif-list">${liste.map((n, i) => `
        <button type="button" class="notif-item${n.nouvelle ? " new" : ""}" data-i="${i}">
          <span class="ico">${ICONES[n.type] || "🔔"}</span>
          <span class="txt"><b>${escapeHtml(n.titre)}</b>${n.corps ? `<small>${escapeHtml(n.corps)}</small>` : ""}<em>${dateRelative(n.created_at)}</em></span>
        </button>`).join("")}</div>`
    : `<div class="empty-state"><h4>Aucune notification</h4><p>Les nouveautés de ta classe apparaîtront ici.</p></div>`);
  root.querySelectorAll("[data-i]").forEach(el => el.addEventListener("click", () => {
    const n = liste[Number(el.dataset.i)];
    if (n.type === "defi") { setActiveNav("defis"); render("defis"); }
    else if (n.type === "cartes") { setActiveNav("cartes"); render("cartes"); }
  }));
  remplirCartePush();
  if (liste.some(n => n.nouvelle)) {                  // l'affichage garde la mise en évidence ; le compteur retombe à 0
    const r = await sb.rpc("rpc_notifs_marquer_lues", { p_eleve_id: session.id, p_token: session.token });
    if (!r.error) setNotifsBadge(0, false);
  }
}

// ---------------------------------------------------------
// TOURNOIS INTER-ÉCOLES — bouton 🏆 (uniquement si ton école est inscrite à un tournoi),
// classements des écoles, ton rang, défis du tournoi. Silencieux sans le patch SQL.
// ---------------------------------------------------------
function ensureTournoiCss() {
  if (document.getElementById("nexi-tn-css")) return;
  const st = document.createElement("style");
  st.id = "nexi-tn-css";
  st.textContent = `
    .tn-list{display:grid;gap:10px;margin-top:14px}
    .tn-item{display:flex;flex-direction:column;gap:4px;width:100%;text-align:left;padding:14px;border-radius:16px;border:1px solid rgba(127,127,127,.35);
      background:rgba(127,127,127,.12);color:inherit;font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
    .tn-item:hover{border-color:#FFC857}
    .tn-item em{font-size:.78rem;opacity:.65;font-style:normal}
    .tn-chip{display:inline-block;align-self:flex-start;padding:2px 10px;border-radius:999px;font-size:.75rem;font-weight:700;background:rgba(127,127,127,.25)}
    .tn-chip.on{background:#37E29A;color:#06281a}
    .tn-podium{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0;align-items:end}
    .tn-pod{text-align:center;padding:10px 6px;border-radius:14px;border:1px solid rgba(127,127,127,.35);background:rgba(127,127,127,.12)}
    .tn-pod.moi,.tn-row.moi{border-color:#29F1E0;background:rgba(41,241,224,.12)}
    .tn-pod .med{font-size:1.7rem}.tn-pod b{display:block;word-break:break-word}.tn-pod small{opacity:.75}
    .tn-pod.p1{padding-top:18px}
    .tn-row{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:12px;border:1px solid rgba(127,127,127,.25);margin:6px 0}
    .tn-row .rg{min-width:26px;font-weight:700;text-align:center}.tn-row .nm{flex:1;min-width:0;word-break:break-word}.tn-row .sc{font-weight:700}.tn-row small{opacity:.7;display:block}
    .tn-card{padding:12px 14px;border-radius:14px;border:1px solid rgba(127,127,127,.35);background:rgba(127,127,127,.12);margin:12px 0}`;
  document.head.appendChild(st);
}

function dureeRestante(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "";
  const m = Math.floor(ms / 60000), j = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return j > 0 ? `${j} j ${h} h` : h > 0 ? `${h} h ${m % 60} min` : `${Math.max(1, m)} min`;
}
function etiquetteTournoi(t) {
  if (t.statut === "en_cours") return { cls: "on", txt: `En cours · reste ${dureeRestante(t.date_fin)}` };
  if (t.statut === "a_venir") return { cls: "", txt: `Commence dans ${dureeRestante(t.date_debut)}` };
  return { cls: "", txt: "Terminé" };
}
const dateCourteFr = (iso) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

async function initTournois() {
  const { data, error } = await sb.rpc("rpc_mes_tournois", { p_eleve_id: session.id, p_token: session.token });
  if (error || !data || !data.length) return;           // patch absent ou aucun tournoi pour mon école : rien ne change
  ensureTournoiCss();
  const logout = document.getElementById("btn-logout"), ancre = notifsBell || logout;
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = (logout && logout.className) || "btn secondary";
  btn.setAttribute("aria-label", "Tournois"); btn.textContent = "🏆";
  btn.addEventListener("click", () => { setActiveNav(""); render("tournois"); });
  if (ancre && ancre.parentNode) ancre.parentNode.insertBefore(btn, ancre);
  else { btn.className = "btn secondary notif-fab"; btn.style.bottom = "140px"; document.body.appendChild(btn); }
  const actif = data.find(t => t.statut === "en_cours");
  if (actif) {
    try { const k = "nexi_tn_" + actif.id; if (!localStorage.getItem(k)) { localStorage.setItem(k, "1"); NexiGamify.toast(`🏆 Tournoi en cours : ${actif.nom}`, "success"); } } catch (e) { /* ignoré */ }
  }
}

async function renderTournois() {
  ensureTournoiCss();
  const { data, error } = await sb.rpc("rpc_mes_tournois", { p_eleve_id: session.id, p_token: session.token });
  if (error) {
    if (isAuthError(error)) return handleAuthError();
    root.innerHTML = `<div class="empty-state"><h4>Erreur de chargement</h4><p>${escapeHtml(error.message || "")}</p></div>`; return;
  }
  const liste = data || [];
  if (!liste.length) { root.innerHTML = `<div class="empty-state"><h4>Aucun tournoi pour le moment</h4><p>Quand ton école participera à un tournoi inter-écoles, il apparaîtra ici.</p></div>`; return; }
  root.innerHTML = `<h2>🏆 Tournois</h2><div class="tn-list">${liste.map((t, i) => {
    const e = etiquetteTournoi(t);
    return `<button type="button" class="tn-item" data-i="${i}"><b>${escapeHtml(t.nom)}</b><span class="tn-chip ${e.cls}">${escapeHtml(e.txt)}</span>
      ${t.description ? `<small>${escapeHtml(t.description)}</small>` : ""}<em>${dateCourteFr(t.date_debut)} → ${dateCourteFr(t.date_fin)} · ${t.nb_ecoles} école${t.nb_ecoles > 1 ? "s" : ""}</em></button>`;
  }).join("")}</div>`;
  root.querySelectorAll("[data-i]").forEach(el => el.addEventListener("click", () => renderTournoiDetail(liste[Number(el.dataset.i)].id)));
}

async function renderTournoiDetail(id) {
  ensureTournoiCss();
  root.innerHTML = `<div class="empty-state"><h4>Chargement…</h4></div>`;
  const { data: d, error } = await sb.rpc("rpc_tournoi_detail", { p_eleve_id: session.id, p_token: session.token, p_tournoi_id: id });
  if (error) {
    if (isAuthError(error)) return handleAuthError();
    root.innerHTML = `<div class="empty-state"><h4>Tournoi introuvable</h4><p>${escapeHtml(error.message || "")}</p><button class="btn secondary" id="tn-back">← Tournois</button></div>`;
    document.getElementById("tn-back").addEventListener("click", renderTournois); return;
  }
  const t = d.tournoi, e = etiquetteTournoi(t), MED = ["🥇", "🥈", "🥉"];
  const ligne = (r, nomCle) => `<div class="tn-row${r.moi ? " moi" : ""}"><span class="rg">${MED[r.rang - 1] || r.rang}</span>
      <span class="nm">${escapeHtml(r[nomCle])}${r.classe ? `<small>${escapeHtml(r.classe)}</small>` : ""}${r.participants != null ? `<small>${r.participants} / ${r.eligibles} élèves ont joué</small>` : ""}</span>
      <span class="sc">${Number(r.score ?? r.points)}${r.score != null ? "" : " pts"}</span></div>`;
  const podium = d.classement_ecoles.slice(0, 3);
  const mon = d.classement_ecoles.find(r => r.moi);
  const fini = t.statut === "termine";
  root.innerHTML = `
    <button class="btn secondary" id="tn-back" style="margin-bottom:8px;">← Tournois</button>
    <h2>🏆 ${escapeHtml(t.nom)}</h2>
    <span class="tn-chip ${e.cls}">${escapeHtml(e.txt)}</span>
    ${t.description ? `<p style="color:var(--text-dim);">${escapeHtml(t.description)}</p>` : ""}
    ${fini && mon ? `<div class="tn-card"><b>Résultat final : ton école est ${mon.rang === 1 ? "🥇 1ʳᵉ" : "n° " + mon.rang} sur ${d.classement_ecoles.length}.</b></div>` : ""}
    <div class="tn-podium">${podium.map((r, i) => `<div class="tn-pod p${i + 1}${r.moi ? " moi" : ""}"><span class="med">${MED[i]}</span><b>${escapeHtml(r.ecole)}</b><small>${Number(r.score)} pts</small></div>`).join("")}</div>
    <div class="tn-card">Tes points : <b>${Number(d.mes_points ?? 0)}</b>${d.mon_rang_ecole && Number(d.mes_points) > 0 ? ` · n° <b>${d.mon_rang_ecole}</b> dans ton école` : " · joue un défi du tournoi pour marquer des points !"}</div>
    ${d.defis.length ? `<h3>Défis du tournoi</h3>${d.defis.map(x => `<div class="tn-row"><span class="nm"><b>${escapeHtml(x.titre)}</b></span>
        ${x.fait ? `<span class="sc">✔ ${Math.round(Number(x.points))} pts</span>` : (t.statut === "en_cours" ? `<button class="btn" data-jouer="${x.id}">Jouer</button>` : `<span>—</span>`)}</div>`).join("")}` : ""}
    <h3>Classement des écoles</h3>${d.classement_ecoles.map(r => ligne(r, "ecole")).join("")}
    <h3>Dans ta classe (${escapeHtml(d.classe || "")})</h3>${d.classement_niveau.map(r => ligne(r, "ecole")).join("") || "<p>—</p>"}
    ${d.top_eleves.length ? `<h3>Meilleurs élèves</h3>${d.top_eleves.map(r => ligne({ ...r, moi: r.moi, rang: r.rang }, "identifiant").replace(/<small>.*?<\/small>/, `<small>${escapeHtml(r.ecole)} · ${escapeHtml(r.classe)}</small>`)).join("")}` : ""}
    <details style="margin-top:14px;"><summary style="cursor:pointer;">Comment est calculé le score d'une école ?</summary>
      <p style="font-size:.88rem;">Le score d'une école est la somme des points de ses <b>${t.top_n} meilleurs élèves</b> divisée par ${t.top_n}. Un élève qui ne joue pas compte 0 : plus ton école compte d'élèves actifs, plus elle monte. Seuls comptent les défis du tournoi joués pendant sa période.</p></details>`;
  document.getElementById("tn-back").addEventListener("click", renderTournois);
  root.querySelectorAll("[data-jouer]").forEach(b => b.addEventListener("click", () => startQuiz(b.dataset.jouer)));
  if (fini && mon && mon.rang === 1) { try { const k = "nexi_tn_win_" + t.id; if (!localStorage.getItem(k)) { localStorage.setItem(k, "1"); bot && bot.reactBravo(); } } catch (e) { /* ignoré */ } }
}

// ---------------------------------------------------------
// ALERTES PUSH — recevoir les notifications sur le téléphone, même appli fermée / écran verrouillé.
// Gratuit (Web Push). Silencieux tant que le patch SQL « push » n'est pas appliqué.
// Android : fonctionne dans Chrome. iPhone : l'appli doit d'abord être ajoutée à l'écran d'accueil.
// ---------------------------------------------------------
const VAPID_PUBLIC_KEY = "BK8Gi7AE0oL3Lv_1qJbZ6J5OC1BWB7TDCUQtHI6owFH_G_klfKhpzJXst-RhTBeRJFXve7Z4JfALYrbdLaiKxiM";
const pushSupporte = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const estIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent || "");
const estInstallee = () => (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
const cleVersBytes = (b64u) => { const b = atob((b64u + "=".repeat((4 - (b64u.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, c => c.charCodeAt(0)); };
const memeCle = (a, b) => { if (!a || !b || a.byteLength !== b.length) return false; const x = new Uint8Array(a); return x.every((v, i) => v === b[i]); };
let pushDisponible = null;   // null = pas encore testé ; true/false ensuite

async function pushServeurPret() {
  if (pushDisponible !== null) return pushDisponible;
  // Sonde inoffensive : la fonction existe-t-elle ? (ne supprime rien : l'adresse testée n'existe pas)
  const { error } = await sb.rpc("rpc_push_desabonner", { p_eleve_id: session.id, p_token: session.token, p_endpoint: "https://sonde.invalid/" });
  pushDisponible = !error;
  return pushDisponible;
}

async function etatPush() {
  if (!pushSupporte()) return estIOS() && !estInstallee() ? "ios_installer" : "non_supporte";
  if (estIOS() && !estInstallee()) return "ios_installer";
  if (Notification.permission === "denied") return "refuse";
  if (Notification.permission !== "granted") return "inactif";
  try { const reg = await navigator.serviceWorker.ready; return (await reg.pushManager.getSubscription()) ? "actif" : "inactif"; } catch (e) { return "inactif"; }
}

async function enregistrerAbonnement(sub) {
  const j = sub.toJSON();
  const { error } = await sb.rpc("rpc_push_abonner", { p_eleve_id: session.id, p_token: session.token, p_endpoint: sub.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent });
  if (error) { if (isAuthError(error)) { handleAuthError(); throw new Error("Session expirée."); } throw new Error(isMissingFn(error) ? "Alertes pas encore disponibles." : error.message); }
}

async function activerPush() {
  if (!pushSupporte()) throw new Error("Ce navigateur ne permet pas les alertes sur téléphone.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error(perm === "denied" ? "Alertes bloquées : autorise-les dans les réglages du navigateur." : "Alertes non activées.");
  const reg = await navigator.serviceWorker.ready, cle = cleVersBytes(VAPID_PUBLIC_KEY);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !memeCle(sub.options && sub.options.applicationServerKey, cle)) { await sub.unsubscribe(); sub = null; }   // ancienne clé du serveur : on repart proprement
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cle });
  await enregistrerAbonnement(sub);
  try { localStorage.setItem("nexi_push", "1"); } catch (e) { /* ignoré */ }
}

async function desactiverPush() {
  const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
  if (sub) {
    await sb.rpc("rpc_push_desabonner", { p_eleve_id: session.id, p_token: session.token, p_endpoint: sub.endpoint });
    await sub.unsubscribe();
  }
  try { localStorage.removeItem("nexi_push"); } catch (e) { /* ignoré */ }
}

// À la déconnexion : cet appareil ne doit plus recevoir les alertes de cet élève (le suivant les reprendra à sa connexion)
async function detacherAppareilPush() {
  try {
    if (!pushSupporte() || Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
    if (sub) await Promise.race([sb.rpc("rpc_push_desabonner", { p_eleve_id: session.id, p_token: session.token, p_endpoint: sub.endpoint }), new Promise(r => setTimeout(r, 1500))]);
  } catch (e) { /* ignoré : la déconnexion ne doit jamais être bloquée */ }
}

function cssPush() {
  if (document.getElementById("nexi-push-css")) return;
  const st = document.createElement("style"); st.id = "nexi-push-css";
  st.textContent = ".push-banner{position:fixed;left:12px;right:12px;bottom:88px;z-index:70;padding:12px 14px;border-radius:16px;border:1px solid #29F1E0;background:rgba(11,22,48,.96);color:#fff;box-shadow:0 8px 30px rgba(0,0,0,.4)}" +
    ".push-banner b{display:block;margin-bottom:4px}.push-banner .row{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}";
  document.head.appendChild(st);
}

// Bandeau d'invitation (une fois par appareil, puis rappel après 7 jours si « Plus tard »)
async function initPush() {
  try {
    if (!(await pushServeurPret())) return;
    const etat = await etatPush();
    if (etat === "actif") { activerPush().catch(() => {}); return; }   // permission déjà accordée (aucune fenêtre) : rattache l'appareil à l'élève connecté et se réabonne si la clé du serveur a changé
    if (etat === "refuse" || etat === "non_supporte") return;
    let plusTard = 0; try { plusTard = Number(localStorage.getItem("nexi_push_plus_tard") || 0); } catch (e) { /* ignoré */ }
    if (Date.now() - plusTard < 7 * 86400000) return;
    cssPush();
    const b = document.createElement("div"); b.className = "push-banner"; b.id = "push-banner";
    b.innerHTML = etat === "ios_installer"
      ? `<b>📲 Reçois les alertes sur ton iPhone</b>Ajoute d'abord NEXI ONE à l'écran d'accueil (Partager → « Sur l'écran d'accueil »), puis ouvre-la depuis l'icône.<div class="row"><button class="btn secondary" id="push-later">OK</button></div>`
      : `<b>🔔 Reçois les alertes sur ton téléphone</b>Nouveaux défis, tournois, messages de ton école : même quand l'appli est fermée.<div class="row"><button class="btn" id="push-go">Activer</button><button class="btn secondary" id="push-later">Plus tard</button></div>`;
    document.body.appendChild(b);
    const fermer = () => { try { localStorage.setItem("nexi_push_plus_tard", String(Date.now())); } catch (e) { /* ignoré */ } b.remove(); };
    document.getElementById("push-later").addEventListener("click", fermer);
    const go = document.getElementById("push-go");
    if (go) go.addEventListener("click", async () => {
      try { await activerPush(); b.remove(); NexiGamify.toast("🔔 Alertes activées sur ce téléphone.", "success"); }
      catch (e) { NexiGamify.toast(e.message, "error"); if (Notification.permission === "denied") b.remove(); }
    });
  } catch (e) { /* jamais bloquant */ }
}

// Carte « Alertes sur ce téléphone » en haut de l'écran Notifications
async function remplirCartePush() { try { await remplirCartePushInterne(); } catch (e) { /* l'écran des notifications ne doit jamais dépendre du push */ } }
async function remplirCartePushInterne() {
  const zone = document.getElementById("push-card"); if (!zone) return;
  if (!(await pushServeurPret())) { zone.innerHTML = ""; return; }
  const etat = await etatPush(); let html = "";
  if (etat === "actif") html = `📲 Alertes activées sur ce téléphone ✅ <button class="btn secondary" id="push-off" style="margin-left:8px;">Désactiver</button>`;
  else if (etat === "inactif") html = `📲 Reçois les alertes sur ton téléphone, même appli fermée. <button class="btn" id="push-on" style="margin-left:8px;">Activer</button>`;
  else if (etat === "refuse") html = "📲 Alertes bloquées. Pour les recevoir, autorise les notifications de ce site dans les réglages de ton navigateur.";
  else if (etat === "ios_installer") html = "📲 Sur iPhone : ajoute d'abord NEXI ONE à l'écran d'accueil (Partager → « Sur l'écran d'accueil »), puis ouvre-la depuis l'icône pour activer les alertes.";
  else html = "📲 Ce navigateur ne permet pas les alertes sur téléphone.";
  zone.innerHTML = `<div class="tn-card">${html}</div>`;
  const on = document.getElementById("push-on"), off = document.getElementById("push-off");
  if (on) on.addEventListener("click", async () => { on.disabled = true; try { await activerPush(); NexiGamify.toast("🔔 Alertes activées.", "success"); } catch (e) { NexiGamify.toast(e.message, "error"); } remplirCartePush(); });
  if (off) off.addEventListener("click", async () => { off.disabled = true; try { await desactiverPush(); NexiGamify.toast("Alertes désactivées sur ce téléphone.", "success"); } catch (e) { NexiGamify.toast(e.message, "error"); } remplirCartePush(); });
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
