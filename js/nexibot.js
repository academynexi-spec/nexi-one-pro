// =========================================================
// NEXIBOT — mascotte 3D (CSS 3D réel : perspective + preserve-3d +
// translateZ sur les faces, rotation Y complète au tap). Pas de WebGL :
// fluide et léger même sur les téléphones bas de gamme, à l'échelle
// de plusieurs centaines d'élèves connectés en simultané.
// =========================================================
const NexiBotPhrases = {
  idle: ["Prêt à apprendre ? 😄", "Tape-moi si tu veux un encouragement !", "On progresse chaque jour !"],
  encourage: ["Pas grave, on retente !", "L'erreur fait partie de l'apprentissage !", "Allez, la prochaine est pour toi !", "Tu vas y arriver, continue !"],
  bravo: ["Bravo, incroyable !", "Tu gères total !", "Score parfait, champion !", "C'est ça l'esprit Nexi !"],
  tap: ["Hé, ça chatouille 😆", "On continue ?", "Je suis toujours là pour toi !", "Clic reçu 5/5 !"]
};

class NexiBot {
  constructor(mount, { inline = false } = {}) {
    this.el = document.createElement("div");
    this.el.className = "nexibot" + (inline ? " inline" : "");
    this.el.innerHTML = `
      <div class="bubble"></div>
      <div class="bot-scene">
        <div class="bot-3d">
          <div class="bot-ear l"></div>
          <div class="bot-ear r"></div>
          <div class="bot-top"></div>
          <div class="bot-side l"></div>
          <div class="bot-side r"></div>
          <div class="bot-face">
            <div class="bot-screen">
              <div class="bot-eye l"></div>
              <div class="bot-eye r"></div>
            </div>
          </div>
          <div class="bot-collar"><div class="bot-badge"></div></div>
        </div>
        <div class="bot-shadow"></div>
      </div>
    `;
    mount.appendChild(this.el);
    this.bubble = this.el.querySelector(".bubble");
    this.eyes = this.el.querySelectorAll(".bot-eye");
    this.el.addEventListener("click", () => this.onTap());
    setInterval(() => { if (Math.random() < 0.15) this.say(this._rand("idle")); }, 14000);
  }
  _rand(mood) { const arr = NexiBotPhrases[mood]; return arr[Math.floor(Math.random() * arr.length)]; }

  say(text, ms = 2800) {
    this.bubble.textContent = text;
    this.bubble.classList.add("show");
    clearTimeout(this._t);
    this._t = setTimeout(() => this.bubble.classList.remove("show"), ms);
  }

  spin() {
    this.el.classList.remove("spin"); void this.el.offsetWidth; this.el.classList.add("spin");
  }

  onTap() { this.spin(); this.say(this._rand("tap")); }

  reactBravo() {
    this.spin();
    this.eyes.forEach(e => e.style.background = "var(--gold)");
    this.say(this._rand("bravo"), 3200);
    setTimeout(() => this.eyes.forEach(e => e.style.background = ""), 3200);
    if (window.NexiGamify) { window.NexiGamify.confetti(); window.NexiGamify.playSound("success"); }
  }

  reactEncourage() {
    this.say(this._rand("encourage"), 3200);
    if (window.NexiGamify) window.NexiGamify.playSound("miss");
  }

  reactBloque() { this.say("Regarde par ici, je crois que la réponse se cache là 👀"); }
}

function mountNexiBot(selector = "body", opts = {}) {
  const mount = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!mount) return null;
  return new NexiBot(mount, opts);
}
