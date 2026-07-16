/* Limbo — multiplicateur cible instantané, monnaie virtuelle uniquement. */

const HOUSE_EDGE = 0.01; // 1%

const betInput = document.getElementById('betAmount');
const halfBtn = document.getElementById('halfBtn');
const doubleBtn = document.getElementById('doubleBtn');
const maxBtn = document.getElementById('maxBtn');
const targetInput = document.getElementById('targetInput');
const chanceValue = document.getElementById('chanceValue');
const potentialPayoutEl = document.getElementById('potentialPayout');
const playBtn = document.getElementById('playBtn');
const multiplierDisplay = document.getElementById('multiplierDisplay');
const resultFlash = document.getElementById('resultFlash');
const historyStrip = document.getElementById('historyStrip');

function winChance(target) {
  return Math.min(100, ((1 - HOUSE_EDGE) * 100) / target);
}

function updateStats() {
  const target = Math.max(1.01, parseFloat(targetInput.value) || 1.01);
  const bet = parseFloat(betInput.value) || 0;
  chanceValue.textContent = winChance(target).toFixed(4) + '%';
  potentialPayoutEl.textContent = (bet * target).toFixed(2) + ' GC';
}

targetInput.addEventListener('input', updateStats);
betInput.addEventListener('input', updateStats);

halfBtn.addEventListener('click', () => {
  betInput.value = Math.max(0.01, (parseFloat(betInput.value) || 0) / 2).toFixed(2);
  updateStats();
});
doubleBtn.addEventListener('click', () => {
  betInput.value = ((parseFloat(betInput.value) || 0) * 2).toFixed(2);
  updateStats();
});
maxBtn.addEventListener('click', () => {
  betInput.value = getBalance().toFixed(2);
  updateStats();
});

function addHistory(result, win) {
  const chip = document.createElement('span');
  chip.className = 'history-chip ' + (win ? 'win' : 'lose');
  chip.textContent = result.toFixed(2) + 'x';
  historyStrip.prepend(chip);
  while (historyStrip.children.length > 12) {
    historyStrip.removeChild(historyStrip.lastChild);
  }
}

function flashResult(text, win) {
  resultFlash.textContent = text;
  resultFlash.className = 'result-flash show ' + (win ? 'win' : 'lose');
  clearTimeout(flashResult._t);
  flashResult._t = setTimeout(() => resultFlash.classList.remove('show'), 1400);
}

function generateResult() {
  const r = Math.random();
  const raw = (1 - HOUSE_EDGE) / (1 - r);
  return Math.max(1, Math.floor(raw * 100) / 100);
}

function animateTo(value, win) {
  const duration = 600;
  const start = performance.now();
  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const current = 1 + (value - 1) * eased;
    multiplierDisplay.textContent = current.toFixed(2) + 'x';
    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      multiplierDisplay.className = 'multiplier-display ' + (win ? 'win' : 'lose');
    }
  }
  multiplierDisplay.className = 'multiplier-display';
  requestAnimationFrame(frame);
}

playBtn.addEventListener('click', () => {
  const bet = parseFloat(betInput.value);
  const target = Math.max(1.01, parseFloat(targetInput.value) || 1.01);

  if (!bet || bet <= 0) {
    showToast('Entre une mise valide.', 'error');
    return;
  }
  if (!canAfford(bet)) {
    showToast('Solde insuffisant. Récupère des GC gratuits !', 'error');
    return;
  }

  setBalance(getBalance() - bet);
  playBtn.disabled = true;

  const result = generateResult();
  const win = result >= target;

  animateTo(result, win);

  setTimeout(() => {
    if (win) {
      const payout = bet * target;
      addBalance(payout);
      flashResult('+' + payout.toFixed(2) + ' GC', true);
      showToast(`Gagné ! Résultat ${result.toFixed(2)}x — +${payout.toFixed(2)} GC`);
    } else {
      flashResult('-' + bet.toFixed(2) + ' GC', false);
    }
    addHistory(result, win);
    playBtn.disabled = false;
  }, 650);
});

updateStats();
