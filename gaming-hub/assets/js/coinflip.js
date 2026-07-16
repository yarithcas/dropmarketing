/* Coinflip — pile ou face, monnaie virtuelle uniquement. */

const PAYOUT_MULTIPLIER = 1.94; // ~50/50 avec 3% de marge

const betInput = document.getElementById('betAmount');
const halfBtn = document.getElementById('halfBtn');
const doubleBtn = document.getElementById('doubleBtn');
const maxBtn = document.getElementById('maxBtn');
const sidePileBtn = document.getElementById('sidePile');
const sideFaceBtn = document.getElementById('sideFace');
const potentialPayoutEl = document.getElementById('potentialPayout');
const flipBtn = document.getElementById('flipBtn');
const coin = document.getElementById('coin');
const resultFlash = document.getElementById('resultFlash');
const historyStrip = document.getElementById('historyStrip');

let side = 'pile';

function updatePotential() {
  const bet = parseFloat(betInput.value) || 0;
  potentialPayoutEl.textContent = (bet * PAYOUT_MULTIPLIER).toFixed(2) + ' GC';
}
betInput.addEventListener('input', updatePotential);

function setSide(newSide) {
  side = newSide;
  sidePileBtn.classList.toggle('active', side === 'pile');
  sideFaceBtn.classList.toggle('active', side === 'face');
}
sidePileBtn.addEventListener('click', () => setSide('pile'));
sideFaceBtn.addEventListener('click', () => setSide('face'));

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

function addHistory(result, win) {
  const chip = document.createElement('span');
  chip.className = 'history-chip ' + (win ? 'win' : 'lose');
  chip.textContent = result === 'pile' ? 'Pile' : 'Face';
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

flipBtn.addEventListener('click', () => {
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
  flipBtn.disabled = true;
  coin.classList.add('flipping');

  const result = Math.random() < 0.5 ? 'pile' : 'face';

  setTimeout(() => {
    coin.classList.remove('flipping');
    coin.textContent = result === 'pile' ? '🪙' : '⚪';
    const win = result === side;

    if (win) {
      const payout = bet * PAYOUT_MULTIPLIER;
      addBalance(payout);
      flashResult('+' + payout.toFixed(2) + ' GC', true);
      showToast(`${result === 'pile' ? 'Pile' : 'Face'} ! Gagné +${payout.toFixed(2)} GC`);
    } else {
      flashResult('-' + bet.toFixed(2) + ' GC', false);
    }

    addHistory(result, win);
    flipBtn.disabled = false;
  }, 1150);
});

updatePotential();
