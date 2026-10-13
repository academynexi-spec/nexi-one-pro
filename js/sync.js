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
// Photo de profil (Supabase Storage, bucket "avatars")
//  - réduite à 512 px et recompressée en JPEG avant l'envoi : quelques dizaines de Ko
//    au lieu de plusieurs Mo (économise le stockage et les données mobiles des élèves) ;
//  - l'ancienne photo est supprimée après remplacement (voir supprimerAncienAvatar).
// =========================================================
function cheminAvatar(url) {
  const m = /\/avatars\/([^?#]+)/.exec(url || "");
  return m ? decodeURIComponent(m[1]) : null;
}

function chargerImage(file) {
  return new Promise((resolve, reject) => {
    const u = URL.createObjectURL(file), img = new Image();
    img.onload = () => { URL.revokeObjectURL(u); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(u); reject(new Error("format d'image non pris en charge")); };
    img.src = u;
  });
}

async function compresserImage(file, cote = 512) {
  const img = await chargerImage(file);
  const ratio = Math.min(1, cote / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * ratio)), h = Math.max(1, Math.round(img.naturalHeight * ratio));
  const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);   // fond blanc : un PNG transparent reste lisible en JPEG
  ctx.drawImage(img, 0, 0, w, h);                     // l'orientation EXIF est appliquée par le navigateur
  let blob = null;
  for (const q of [0.82, 0.7, 0.6]) {
    blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", q));
    if (blob && blob.size <= 150 * 1024) break;
  }
  if (!blob) throw new Error("compression impossible");
  return blob;
}

async function uploadAvatar(file, eleveId) {
  const sb = getSupabase();
  let corps;
  try { corps = await compresserImage(file); }
  catch (e) {
    console.error("compression avatar:", e);
    NexiGamify.toast(`Photo illisible (${e.message}). Essaie une photo JPEG ou PNG.`, "error");
    return null;
  }
  const path = `${eleveId}/${Date.now()}.jpg`;
  const { error } = await sb.storage.from("avatars").upload(path, corps, { upsert: true, contentType: "image/jpeg", cacheControl: "31536000" });
  if (error) {
    console.error("upload avatar:", error);
    NexiGamify.toast(`Échec de l'envoi : ${error.message || "vérifiez les policies du bucket avatars"}`, "error");
    return null;
  }
  const { data } = sb.storage.from("avatars").getPublicUrl(path);
  return data.publicUrl;
}

// Supprime l'ancienne photo une fois la nouvelle enregistrée. Sans gravité en cas d'échec :
// le panneau admin « Stockage » nettoie les photos remplacées. (La base n'autorise de toute façon
// que la suppression de photos qu'aucun élève n'utilise.)
async function supprimerAncienAvatar(ancienneUrl, nouvelleUrl, eleveId) {
  try {
    const nom = cheminAvatar(ancienneUrl);
    if (!nom || ancienneUrl === nouvelleUrl || !nom.startsWith(eleveId + "/")) return;
    await getSupabase().storage.from("avatars").remove([nom]);
  } catch (e) { /* ignoré */ }
}
