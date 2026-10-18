"use strict";
// =========================================================
// Web Push sans dépendance : chiffrement RFC 8291 (aes128gcm) + authentification VAPID RFC 8292.
// Utilise uniquement l'API WebCrypto (Node 18+). Le fichier commence par « _ » : Vercel ne le publie pas comme route.
// =========================================================
const enc = new TextEncoder();
const subtle = globalThis.crypto.subtle;
const b64u = { enc: (u8) => Buffer.from(u8).toString("base64url"), dec: (s) => new Uint8Array(Buffer.from(String(s), "base64url")) };
const concat = (...parts) => { const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };

async function hkdf(salt, ikm, info, longueur) {
  const cle = await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, cle, longueur * 8));
}

// plaintext : Uint8Array ; uaPublic : clé publique du navigateur (65 octets) ; authSecret : 16 octets
async function chiffrer(plaintext, uaPublic, authSecret, opts = {}) {
  const eph = opts.ephemere || await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await subtle.exportKey("raw", eph.publicKey));
  const uaCle = await subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: uaCle }, eph.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = opts.sel || globalThis.crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const chiffre = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(plaintext, new Uint8Array([2]))));   // 0x02 = dernier (seul) enregistrement
  const corps = concat(salt, new Uint8Array([0, 0, 0x10, 0]), new Uint8Array([asPublic.length]), asPublic, chiffre);                   // salt | rs=4096 | idlen | clé publique | données
  return { corps, interne: { ecdh, ikm, cek, nonce, asPublic } };
}

// En-tête Authorization VAPID pour un point d'accès donné
async function vapid(endpoint, sujet, clePublique, clePrivee) {
  const pub = b64u.dec(clePublique);
  const jwk = { kty: "EC", crv: "P-256", d: clePrivee, x: b64u.enc(pub.slice(1, 33)), y: b64u.enc(pub.slice(33, 65)), ext: true };
  const cle = await subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const entete = b64u.enc(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const charge = b64u.enc(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: sujet })));
  const sig = new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, cle, enc.encode(`${entete}.${charge}`)));
  return `vapid t=${entete}.${charge}.${b64u.enc(sig)}, k=${clePublique}`;
}

// Envoie une notification à un abonnement {endpoint, p256dh, auth}. Renvoie le statut HTTP du service de push.
async function envoyer(abo, message, cfg, fetchImpl = globalThis.fetch) {
  const { corps } = await chiffrer(enc.encode(JSON.stringify(message)), b64u.dec(abo.p256dh), b64u.dec(abo.auth));
  const rep = await fetchImpl(abo.endpoint, {
    method: "POST",
    headers: { "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "high",
               Authorization: await vapid(abo.endpoint, cfg.sujet, cfg.clePublique, cfg.clePrivee) },
    body: corps
  });
  return rep.status;
}

module.exports = { chiffrer, vapid, envoyer, b64u, hkdf, concat };
