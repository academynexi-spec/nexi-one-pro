"use strict";
// =========================================================
// NEXI ONE — serveur d'envoi des notifications push (fonction Vercel, gratuite)
//   POST /api/push  { notification_id, admin_token }   → envoi manuel depuis l'admin
//   POST /api/push  { notification_id, secret }        → envoi automatique (déclenché par la base de données)
//   GET  /api/push                                     → diagnostic (aucune valeur secrète)
// Variables à définir dans Vercel : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, SUPABASE_URL, SUPABASE_ANON_KEY
// L'autorisation est vérifiée par la base (jeton admin ou secret partagé) : cette fonction ne contient aucun mot de passe.
// =========================================================
const { envoyer } = require("./_webpush");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DUREE_MAX_MS = 8000;      // limite de sécurité (les fonctions gratuites s'arrêtent vers 10 s)

async function rpc(nom, args, env) {
  const r = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/${nom}`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args)
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error((j && (j.message || j.hint)) || `HTTP ${r.status}`), { status: r.status });
  return j;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const env = process.env;
  const pret = { vapid: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY), supabase: !!(env.SUPABASE_URL && env.SUPABASE_ANON_KEY) };
  if (req.method === "GET") return res.status(200).json({ ok: pret.vapid && pret.supabase, ...pret });
  if (req.method !== "POST") return res.status(405).json({ error: "méthode non autorisée" });
  if (!pret.vapid || !pret.supabase) return res.status(500).json({ error: "serveur push non configuré", ...pret });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const { notification_id: nid, admin_token: jeton, secret } = body || {};
  if (!UUID.test(String(nid || "")) || (!jeton && !secret) || (jeton && !UUID.test(String(jeton)))) return res.status(400).json({ error: "requête invalide" });

  const auth = { p_secret: secret ? String(secret) : null, p_admin_token: jeton || null };
  try {
    const cibles = await rpc("push_cibles", { ...auth, p_notification_id: nid }, env);
    const n = cibles.notification, abos = cibles.abonnements || [];
    const message = { titre: n.titre, corps: n.corps || "", url: "./eleve.html", tag: `nexi-${n.id}` };
    const cfg = { sujet: env.VAPID_SUBJECT || "https://nexi-one-pro.vercel.app", clePublique: env.VAPID_PUBLIC_KEY, clePrivee: env.VAPID_PRIVATE_KEY };
    const debut = Date.now(); let envoyes = 0, echecs = 0, restants = 0; const expires = [];
    for (let i = 0; i < abos.length; i += 40) {
      if (Date.now() - debut > DUREE_MAX_MS) { restants = abos.length - i; break; }
      await Promise.all(abos.slice(i, i + 40).map(async (a) => {
        try {
          const st = await envoyer(a, message, cfg);
          if (st >= 200 && st < 300) envoyes++; else if (st === 404 || st === 410) expires.push(a.endpoint); else echecs++;
        } catch (e) { echecs++; }
      }));
    }
    await rpc("push_resultat", { ...auth, p_notification_id: nid, p_expires: expires }, env);
    return res.status(200).json({ ok: true, cibles: abos.length, envoyes, echecs, expires: expires.length, restants });
  } catch (e) {
    const refuse = /non autorisé/i.test(e.message || "");
    return res.status(refuse ? 403 : 500).json({ error: refuse ? "non autorisé" : "erreur du serveur push" });
  }
};
