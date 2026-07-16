/* Crash — encaisse avant l'effondrement, monnaie virtuelle uniquement. */

const HOUSE_EDGE = 0.01; // 1%
const BETTING_PHASE_MS = 5000;
const POST_CRASH_PAUSE_MS = 2500;
const GROWTH_RATE = 0.13; // vitesse de montée du multiplicateur

const betInput = document.getElementById('betAmount');
const halfBtn = document.getElementById('halfBtn');
const doubleBtn = document.getElementById('doubleBtn');
const maxBtn = document.getElementById('maxBtn');
const statusValue = document.getElementById('statusValue');
const potentialPayoutEl = document.getElementById('potentialPayout');
const placeBetBtn = document.getElementById('placeBetBtn');
const cashoutBtn = document.getElementById('cashoutBtn');
const multiplierDisplay = document.getElementById('multiplierDisplay');
const resultFlash = document.getElementById('resultFlash');
const historyStrip = document.getElementById('historyStrip');
const canvas = document.getElementById('crashCanvas');
const ctx = canvas.getContext('2d');

let phase = 'betting'; // betting | running | crashed
let hasBet = false;
let cashedOut = false;
let currentBet = 0;
let crashPoint = 1;
let displayedMultiplier = 1;
let points = [];

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * ratio;
  canvas.height = canvas.clientHeight * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}
window.addEventListener('resize', resizeCanvas);
setTimeout(resizeCanvas, 0);

function drawCurve() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  if (points.length < 2) return;

  const maxM = Math.max(2, ...points.map((p) => p.m));
  const maxT = points[points.length - 1].t || 1;

  ctx.beginPath();
  ctx.strokeStyle = phase === 'crashed' && !cashedOut && hasBet ? '#ff4d4f' : '#00e701';
  ctx.lineWidth = 3;
  points.forEach((p, i) => {
    const x = (p.t / maxT) * (w - 20) + 10;
    const y = h - 10 - ((p.m - 1) / (maxM - 1 || 1)) * (h - 30);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function generateCrashPoint() {
  const r = Math.random();
  const raw = (1 - HOUSE_EDGE) / (1 - r);
  return Math.max(1, Math.floor(raw * 100) / 100);
}

function updatePotential() {
  const bet = parseFloat(betInput.value) || 0;
  potentialPayoutEl.textContent = (bet * displayedMultiplier).toFixed(2) + ' GC';
}

halfBtn.addEventListener('click', () => {
  betInput.value = Math.max(0.01, (parseFloat(betInput.value) || 0) / 2).toFixed(2);
  updatePotential();
});
doubleBtn.addEventListener('click', () => {
  betInput.value = ((parseFloat(betInput.value) || 0) * 2).toFixed(2);
  updatePotential();
});
maxBtn.addEventListener('click', () => {
  betInput.value = getBalance().toFixed(2);
  updatePotential();
});

function addHistory(value, crashedOnUs) {
  const chip = document.createElement('span');
  chip.className = 'history-chip ' + (crashedOnUs ? 'lose' : 'win');
  chip.textContent = value.toFixed(2) + 'x';
  historyStrip.prepend(chip);
  while (historyStrip.children.length > 12) {
    historyStrip.removeChild(historyStrip.lastChild);
  }
}

function flashResult(text, win) {
  resultFlash.textContent = text;
  resultFlash.className = 'result-flash show ' + (win ? 'win' : 'lose');
  clearTimeout(flashResult._t);
  flashResult._t = setTimeout(() => resultFlash.classList.remove('show'), 1800);
}

placeBetBtn.addEventListener('click', () => {
  if (phase !== 'betting' || hasBet) return;
  const bet = parseFloat(betInput.value);
  if (!bet || bet <= 0) {
    showToast('Entre une mise valide.', 'error');
    return;
  }
  if (!canAfford(bet)) {
    showToast('Solde insuffisant. Récupère des GC gratuits !', 'error');
    return;
  }
  setBalance(getBalance() - bet);
  currentBet = bet;
  hasBet = true;
  cashedOut = false;
  placeBetBtn.disabled = true;
  placeBetBtn.textContent = 'Mise placée — prochain tour';
  showToast(`Mise de ${bet.toFixed(2)} GC placée pour le prochain tour.`);
});

cashoutBtn.addEventListener('click', () => {
  if (phase !== 'running' || !hasBet || cashedOut) return;
  cashedOut = true;
  const payout = currentBet * displayedMultiplier;
  addBalance(payout);
  cashoutBtn.disabled = true;
  flashResult('+' + payout.toFixed(2) + ' GC', true);
  showToast(`Encaissé à ${displayedMultiplier.toFixed(2)}x — +${payout.toFixed(2)} GC`);
});

function setStatus(text) {
  statusValue.textContent = text;
}

function runRound() {
  phase = 'betting';
  displayedMultiplier = 1;
  points = [];
  multiplierDisplay.textContent = '1.00x';
  multiplierDisplay.className = 'multiplier-display';
  drawCurve();
  placeBetBtn.disabled = false;
  placeBetBtn.textContent = 'Miser pour le prochain tour';
  cashoutBtn.disabled = true;
  hasBet = false;
  cashedOut = false;

  let remaining = BETTING_PHASE_MS / 1000;
  setStatus(`Placez vos mises — ${remaining}s`);
  const countdown = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) setStatus(`Placez vos mises — ${remaining}s`);
  }, 1000);

  setTimeout(() => {
    clearInterval(countdown);
    startRunning();
  }, BETTING_PHASE_MS);
}

function startRunning() {
  phase = 'running';
  setStatus('En vol 🚀');
  placeBetBtn.disabled = true;
  cashoutBtn.disabled = !hasBet;
  crashPoint = generateCrashPoint();
  const startTime = performance.now();

  function frame(now) {
    const elapsed = (now - startTime) / 1000;
    const m = Math.min(crashPoint, Math.exp(elapsed * GROWTH_RATE));
    displayedMultiplier = m;
    multiplierDisplay.textContent = m.toFixed(2) + 'x';
    updatePotential();
    points.push({ t: elapsed, m });
    if (points.length > 400) points.shift();
    drawCurve();

    if (m >= crashPoint) {
      endRound();
      return;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function endRound() {
  phase = 'crashed';
  setStatus(`Crash à ${crashPoint.toFixed(2)}x 💥`);
  multiplierDisplay.className = 'multiplier-display lose';
  cashoutBtn.disabled = true;
  drawCurve();

  if (hasBet && !cashedOut) {
    flashResult('-' + currentBet.toFixed(2) + ' GC', false);
  }
  addHistory(crashPoint, hasBet && !cashedOut);

  setTimeout(runRound, POST_CRASH_PAUSE_MS);
}

runRound();
