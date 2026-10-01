// =========================================================
// GAMIFICATION — confettis (canvas natif) + sons (Web Audio API, aucun asset)
// =========================================================
window.NexiGamify = (function () {
  let audioCtx;
  function ctx() { return audioCtx || (audioCtx = new (window.AudioContext || window.webkitAudioContext)()); }

  function beep(freq, dur, type = "sine", vol = 0.18) {
    try {
      const c = ctx();
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type; osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
      osc.connect(gain).connect(c.destination);
      osc.start(); osc.stop(c.currentTime + dur);
    } catch (e) { /* audio indisponible avant interaction utilisateur */ }
  }

  function playSound(name) {
    if (name === "click") beep(700, 0.08, "square", 0.08);
    if (name === "success") { beep(523, 0.12); setTimeout(() => beep(659, 0.12), 100); setTimeout(() => beep(784, 0.22), 200); }
    if (name === "miss") beep(220, 0.25, "sawtooth", 0.12);
    if (name === "tick") beep(880, 0.05, "square", 0.05);
  }

  let canvas, cctx, particles = [], raf;
  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement("canvas");
    canvas.id = "confetti-canvas";
    document.body.appendChild(canvas);
    const resize = () => { canvas.width = innerWidth; canvas.height = innerHeight; };
    resize(); window.addEventListener("resize", resize);
    cctx = canvas.getContext("2d");
  }

  function confetti(count = 90) {
    ensureCanvas();
    const colors = ["#29F1E0", "#8B7CFF", "#FFC857", "#37E29A", "#FF5D6C"];
    for (let i = 0; i < count; i++) {
      particles.push({
        x: canvas.width / 2 + (Math.random() - 0.5) * 120,
        y: canvas.height * 0.25,
        vx: (Math.random() - 0.5) * 8, vy: Math.random() * -6 - 4,
        size: Math.random() * 6 + 4, color: colors[Math.floor(Math.random() * colors.length)],
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3, life: 0
      });
    }
    if (!raf) loop();
  }

  function loop() {
    cctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.vy += 0.18; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life++;
      cctx.save(); cctx.translate(p.x, p.y); cctx.rotate(p.rot);
      cctx.fillStyle = p.color; cctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      cctx.restore();
    });
    particles = particles.filter(p => p.y < canvas.height + 40 && p.life < 240);
    raf = particles.length ? requestAnimationFrame(loop) : null;
  }

  function toast(msg, type = "") {
    let t = document.querySelector(".toast");
    if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
    t.className = "toast " + type;
    t.textContent = msg;
    requestAnimationFrame(() => t.classList.add("show"));
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  return { playSound, confetti, toast };
})();
