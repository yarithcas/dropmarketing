/* Plinko — bille + quilles + paniers multiplicateurs, monnaie virtuelle uniquement. */

const ROWS = 8;
const BUCKET_COUNT = ROWS + 1;

const TABLES = {
  low: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6],
  medium: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
  high: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
};

const betInput = document.getElementById('betAmount');
const halfBtn = document.getElementById('halfBtn');
const doubleBtn = document.getElementById('doubleBtn');
const maxBtn = document.getElementById('maxBtn');
const riskButtons = document.querySelectorAll('[data-risk]');
const dropBtn = document.getElementById('dropBtn');
const board = document.getElementById('plinkoBoard');
const bucketsEl = document.getElementById('plinkoBuckets');
const resultFlash = document.getElementById('resultFlash');
const historyStrip = document.getElementById('historyStrip');

let risk = 'low';

function colorForMultiplier(m, maxM) {
  const t = Math.min(1, Math.log(m + 1) / Math.log(maxM + 1));
  const hue = 220 - t * 220; // bleu -> vert -> jaune/rouge
  const light = 45 + t * 10;
  return `hsl(${hue}, 85%, ${light}%)`;
}

function renderBuckets() {
  const table = TABLES[risk];
  const maxM = Math.max(...table);
  bucketsEl.innerHTML = '';
  table.forEach((m) => {
    const b = document.createElement('div');
    b.className = 'plinko-bucket';
    b.textContent = m + 'x';
    b.style.background = colorForMultiplier(m, maxM);
    bucketsEl.appendChild(b);
  });
}

function buildPegs() {
  board.querySelectorAll('.plinko-peg').forEach((el) => el.remove());
  for (let r = 0; r < ROWS; r++) {
    const pegCount = r + 3;
    for (let c = 0; c < pegCount; c++) {
      const peg = document.createElement('div');
      peg.className = 'plinko-peg';
      const xPercent = ((c + 1) / (pegCount + 1)) * 100;
      const yPercent = 6 + (r / (ROWS - 1)) * 78;
      peg.style.left = xPercent + '%';
      peg.style.top = yPercent + '%';
      board.appendChild(peg);
    }
  }
}

buildPegs();
renderBuckets();

riskButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    riskButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    risk = btn.dataset.risk;
    renderBuckets();
  });
});

function setRiskLocked(locked) {
  riskButtons.forEach((b) => {
    b.disabled = locked;
  });
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

function addHistory(mult, win) {
  const chip = document.createElement('span');
  chip.className = 'history-chip ' + (win ? 'win' : 'lose');
  chip.textContent = mult + 'x';
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dropBall(bet, riskAtDrop) {
  const ball = document.createElement('div');
  ball.className = 'plinko-ball';
  ball.style.left = '50%';
  ball.style.top = '4%';
  board.appendChild(ball);

  let rightCount = 0;
  const path = [];
  for (let t = 1; t <= ROWS; t++) {
    if (Math.random() < 0.5) rightCount++;
    const x = 50 + (2 * rightCount - t) * (50 / ROWS);
    const y = 6 + (t / ROWS) * 78;
    path.push({ x, y });
  }

  const bucketIndex = rightCount;
  path[path.length - 1] = {
    x: ((bucketIndex + 0.5) / BUCKET_COUNT) * 100,
    y: 92,
  };

  for (const p of path) {
    ball.style.left = p.x + '%';
    ball.style.top = p.y + '%';
    // eslint-disable-next-line no-await-in-loop
    await sleep(190);
  }

  const mult = TABLES[riskAtDrop][bucketIndex];
  const payout = bet * mult;
  const win = mult >= 1;

  addBalance(payout);
  flashResult((win ? '+' : '') + payout.toFixed(2) + ' GC', win);
  addHistory(mult, win);
  if (win) {
    showToast(`Bille dans la case ${mult}x — +${payout.toFixed(2)} GC`);
  }

  await sleep(500);
  ball.remove();
  dropBtn.disabled = false;
  setRiskLocked(false);
}

dropBtn.addEventListener('click', () => {
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
  dropBtn.disabled = true;
  setRiskLocked(true);
  dropBall(bet, risk);
});
