// =========================================================
// PWA : enregistrement du service worker + bannière d'installation
// =========================================================
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(console.error);
  });
}

let _deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  _deferredInstallPrompt = e;
  showInstallBanner();
});

function showInstallBanner() {
  if (document.querySelector(".install-banner")) return;
  const b = document.createElement("div");
  b.className = "install-banner";
  b.innerHTML = `
    <img src="icons/icon-192.png" alt="">
    <div class="txt"><b>Installer NEXI ONE</b>Accès rapide, hors-ligne partiel, plein écran.</div>
    <button class="btn" id="btn-install">Installer</button>
    <button class="btn ghost" id="btn-dismiss-install">✕</button>
  `;
  document.body.appendChild(b);
  requestAnimationFrame(() => b.classList.add("show"));
  b.querySelector("#btn-install").addEventListener("click", async () => {
    b.classList.remove("show");
    if (_deferredInstallPrompt) {
      _deferredInstallPrompt.prompt();
      await _deferredInstallPrompt.userChoice;
      _deferredInstallPrompt = null;
    }
    setTimeout(() => b.remove(), 300);
  });
  b.querySelector("#btn-dismiss-install").addEventListener("click", () => {
    b.classList.remove("show");
    setTimeout(() => b.remove(), 300);
  });
}

// =========================================================
// Upload de la photo de profil (Supabase Storage, bucket "avatars")
// - La photo est recadrée au carré, réduite (384 px max) et convertie en WebP
//   (≈ 10 à 40 Ko), au lieu d'envoyer la photo brute du téléphone (2 à 6 Mo).
// - Chemin FIXE par élève : changer de photo REMPLACE l'ancienne au lieu de
//   s'accumuler dans le stockage.
// - L'URL renvoyée contient "?v=<horodatage>" pour contourner le cache du CDN.
// =========================================================
const AVATAR_MAX_SIDE = 384;          // pixels
const AVATAR_MAX_BYTES = 100 * 1024;  // 100 Ko visés

async function loadImageSource_(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (e) {
    // Navigateur sans cette option : repli sur <img> (respecte aussi l'orientation EXIF)
    return await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image illisible.")); };
      img.src = url;
    });
  }
}

async function compressAvatar(file) {
  if (!file || !file.type || !file.type.startsWith("image/")) {
    throw new Error("Le fichier choisi n'est pas une image.");
  }
  const src = await loadImageSource_(file);
  const w0 = src.width, h0 = src.height;
  const side = Math.min(w0, h0);                       // recadrage carré centré
  const sx = Math.round((w0 - side) / 2), sy = Math.round((h0 - side) / 2);
  const out = Math.max(1, Math.min(AVATAR_MAX_SIDE, side));
  const canvas = document.createElement("canvas");
  canvas.width = out; canvas.height = out;
  canvas.getContext("2d").drawImage(src, sx, sy, side, side, 0, 0, out, out);
  if (src.close) src.close();

  const toBlob = (type, q) => new Promise(res => canvas.toBlob(res, type, q));

  // 1) WebP, qualité décroissante jusqu'à passer sous la taille cible
  let blob = null;
  for (const q of [0.85, 0.75, 0.65, 0.55, 0.45]) {
    blob = await toBlob("image/webp", q);
    if (!blob || blob.type !== "image/webp") break;    // WebP non encodable par ce navigateur
    if (blob.size <= AVATAR_MAX_BYTES) return blob;
  }
  // 2) Repli JPEG (anciens navigateurs)
  for (const q of [0.8, 0.7, 0.6, 0.5, 0.4]) {
    blob = await toBlob("image/jpeg", q);
    if (blob && blob.size <= AVATAR_MAX_BYTES) return blob;
  }
  throw new Error("Image trop lourde, même après compression. Essayez une autre photo.");
}

async function uploadAvatar(file, eleveId) {
  const sb = getSupabase();
  let blob;
  try {
    blob = await compressAvatar(file);
  } catch (err) {
    console.error("compression avatar:", err);
    NexiGamify.toast(err.message || "Impossible de préparer la photo.", "error");
    return null;
  }
  const path = `${eleveId}/avatar`;   // chemin fixe : remplace l'ancienne photo
  const { error } = await sb.storage.from("avatars").upload(path, blob, {
    upsert: true, contentType: blob.type, cacheControl: "3600"
  });
  if (error) {
    console.error("upload avatar:", error);
    NexiGamify.toast(`Échec de l'envoi : ${error.message || "vérifiez les policies du bucket avatars"}`, "error");
    return null;
  }
  const { data } = sb.storage.from("avatars").getPublicUrl(path);
  return data.publicUrl + "?v=" + Date.now();
}
