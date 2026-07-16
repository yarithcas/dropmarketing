/* Dice — roll under/over, monnaie virtuelle uniquement. */

const HOUSE_EDGE = 0.01; // 1%

let mode = 'under'; // 'under' | 'over'
let target = 50; // 2 - 98

const betInput = document.getElementById('betAmount');
const halfBtn = document.getElementById('halfBtn');
const doubleBtn = document.getElementById('doubleBtn');
const maxBtn = document.getElementById('maxBtn');
const modeUnderBtn = document.getElementById('modeUnder');
const modeOverBtn = document.getElementById('modeOver');
const targetSlider = document.getElementById('targetSlider');
const targetValue = document.getElementById('targetValue');
const multiplierValue = document.getElementById('multiplierValue');
const chanceValue = document.getElementById('chanceValue');
const rollBtn = document.getElementById('rollBtn');
const diceBar = document.getElementById('diceBar');
const targetMarker = document.getElementById('targetMarker');
const rollMarkerLabel = document.getElementById('rollMarkerLabel');
const resultFlash = document.getElementById('resultFlash');
const historyStrip = document.getElementById('historyStrip');

function winChance() {
  return mode === 'under' ? target : 100 - target;
}

function multiplier() {
  const chance = winChance();
  return chance > 0 ? (100 / chance) * (1 - HOUSE_EDGE) : 0;
}

function updateStats() {
  targetValue.textContent = target.toFixed(2);
  chanceValue.textContent = winChance().toFixed(4) + '%';
  multiplierValue.textContent = multiplier().toFixed(4) + 'x';
  targetMarker.style.left = target + '%';

  if (mode === 'under') {
    diceBar.style.setProperty('--split', target + '%');
    diceBar.style.background = `linear-gradient(90deg, var(--accent) 0%, var(--accent) ${target}%, var(--red) ${target}%, var(--red) 100%)`;
  } else {
    diceBar.style.background = `linear-gradient(90deg, var(--red) 0%, var(--red) ${target}%, var(--accent) ${target}%, var(--accent) 100%)`;
  }
}

function setMode(newMode) {
  mode = newMode;
  modeUnderBtn.classList.toggle('active', mode === 'under');
  modeOverBtn.classList.toggle('active', mode === 'over');
  updateStats();
}

targetSlider.addEventListener('input', () => {
  target = Math.min(98, Math.max(2, parseFloat(targetSlider.value)));
  updateStats();
});

modeUnderBtn.addEventListener('click', () => setMode('under'));
modeOverBtn.addEventListener('click', () => setMode('over'));

halfBtn.addEventListener('click', () => {
  betInput.value = Math.max(0.01, (parseFloat(betInput.value) || 0) / 2).toFixed(2);
});
doubleBtn.addEventListener('click', () => {
  betInput.value = ((parseFloat(betInput.value) || 0) * 2).toFixed(2);
});
maxBtn.addEventListener('click', () => {
  betInput.value = getBalance().toFixed(2);
});

function addHistory(roll, win) {
  const chip = document.createElement('span');
  chip.className = 'history-chip ' + (win ? 'win' : 'lose');
  chip.textContent = roll.toFixed(2);
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

rollBtn.addEventListener('click', () => {
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

  const roll = Math.round(Math.random() * 10000) / 100; // 0.00 - 100.00
  const win = mode === 'under' ? roll < target : roll > target;

  rollMarkerLabel.style.left = Math.min(100, Math.max(0, roll)) + '%';
  rollMarkerLabel.textContent = roll.toFixed(2);

  if (win) {
    const payout = bet * multiplier();
    addBalance(payout);
    flashResult('+' + payout.toFixed(2) + ' GC', true);
    showToast(`Gagné ! Roll ${roll.toFixed(2)} — +${payout.toFixed(2)} GC`);
  } else {
    flashResult('-' + bet.toFixed(2) + ' GC', false);
  }

  addHistory(roll, win);
});

setMode('under');
updateStats();
