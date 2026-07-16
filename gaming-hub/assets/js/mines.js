/* Mines — grille 5x5, monnaie virtuelle uniquement. */

const GRID_SIZE = 25;
const HOUSE_EDGE_FACTOR = 0.99; // 1% house edge

const betInput = document.getElementById('betAmount');
const halfBtn = document.getElementById('halfBtn');
const doubleBtn = document.getElementById('doubleBtn');
const maxBtn = document.getElementById('maxBtn');
const minesCountSelect = document.getElementById('minesCount');
const currentMultiplierEl = document.getElementById('currentMultiplier');
const potentialPayoutEl = document.getElementById('potentialPayout');
const startBtn = document.getElementById('startBtn');
const cashoutBtn = document.getElementById('cashoutBtn');
const minesGrid = document.getElementById('minesGrid');
const resultFlash = document.getElementById('resultFlash');

let state = 'idle'; // idle | playing
let minePositions = new Set();
let minesCount = 3;
let currentBet = 0;
let revealedSafe = 0;
let currentMultiplier = 1;

for (let i = 1; i <= 24; i++) {
  const opt = document.createElement('option');
  opt.value = i;
  opt.textContent = `${i} mine${i > 1 ? 's' : ''}`;
  if (i === 3) opt.selected = true;
  minesCountSelect.appendChild(opt);
}
minesCount = 3;

function buildGrid() {
  minesGrid.innerHTML = '';
  for (let i = 0; i < GRID_SIZE; i++) {
    const tile = document.createElement('button');
    tile.className = 'mine-tile';
    tile.dataset.index = String(i);
    tile.disabled = state !== 'playing';
    tile.addEventListener('click', () => onTileClick(i, tile));
    minesGrid.appendChild(tile);
  }
}
buildGrid();

function fairMultiplier(revealed, mines) {
  let m = 1;
  for (let i = 0; i < revealed; i++) {
    m *= (GRID_SIZE - i) / (GRID_SIZE - i - mines);
  }
  return m * HOUSE_EDGE_FACTOR;
}

function updateStats() {
  currentMultiplierEl.textContent = currentMultiplier.toFixed(4) + 'x';
  potentialPayoutEl.textContent = (currentBet * currentMultiplier).toFixed(2) + ' GC';
}

function flashResult(text, win) {
  resultFlash.textContent = text;
  resultFlash.className = 'result-flash show ' + (win ? 'win' : 'lose');
  clearTimeout(flashResult._t);
  flashResult._t = setTimeout(() => resultFlash.classList.remove('show'), 1800);
}

halfBtn.addEventListener('click', () => {
  betInput.value = Math.max(0.01, (parseFloat(betInput.value) || 0) / 2).toFixed(2);
});
doubleBtn.addEventListener('click', () => {
  betInput.value = ((parseFloat(betInput.value) || 0) * 2).toFixed(2);
});
maxBtn.addEventListener('click', () => {
  betInput.value = getBalance().toFixed(2);
});

function setPlayingUI(playing) {
  startBtn.disabled = playing;
  betInput.disabled = playing;
  minesCountSelect.disabled = playing;
  halfBtn.disabled = playing;
  doubleBtn.disabled = playing;
  maxBtn.disabled = playing;
  cashoutBtn.disabled = !playing || revealedSafe === 0;
  Array.from(minesGrid.children).forEach((tile) => {
    if (!tile.classList.contains('revealed-gem') && !tile.classList.contains('revealed-mine')) {
      tile.disabled = !playing;
    }
  });
}

startBtn.addEventListener('click', () => {
  const bet = parseFloat(betInput.value);
  minesCount = parseInt(minesCountSelect.value, 10);

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
  revealedSafe = 0;
  currentMultiplier = 1;
  minePositions = new Set();
  while (minePositions.size < minesCount) {
    minePositions.add(Math.floor(Math.random() * GRID_SIZE));
  }

  state = 'playing';
  buildGrid();
  updateStats();
  setPlayingUI(true);
  resultFlash.classList.remove('show');
});

function revealAllMines(exploded) {
  Array.from(minesGrid.children).forEach((tile) => {
    const idx = parseInt(tile.dataset.index, 10);
    if (minePositions.has(idx)) {
      tile.classList.add('revealed-mine');
      tile.textContent = idx === exploded ? '💥' : '💣';
    }
    tile.disabled = true;
  });
}

function onTileClick(index, tile) {
  if (state !== 'playing' || tile.disabled) return;

  if (minePositions.has(index)) {
    tile.classList.add('revealed-mine');
    tile.textContent = '💥';
    revealAllMines(index);
    state = 'idle';
    setPlayingUI(false);
    flashResult('-' + currentBet.toFixed(2) + ' GC', false);
    return;
  }

  revealedSafe += 1;
  currentMultiplier = fairMultiplier(revealedSafe, minesCount);
  tile.classList.add('revealed-gem');
  tile.textContent = '💎';
  tile.disabled = true;
  updateStats();
  cashoutBtn.disabled = false;

  if (revealedSafe === GRID_SIZE - minesCount) {
    doCashout();
  }
}

function doCashout() {
  if (state !== 'playing' || revealedSafe === 0) return;
  const payout = currentBet * currentMultiplier;
  addBalance(payout);
  revealAllMines(-1);
  state = 'idle';
  setPlayingUI(false);
  flashResult('+' + payout.toFixed(2) + ' GC', true);
  showToast(`Encaissé à ${currentMultiplier.toFixed(2)}x — +${payout.toFixed(2)} GC`);
}

cashoutBtn.addEventListener('click', doCashout);

setPlayingUI(false);
updateStats();
