/* Portefeuille virtuel partagé — GC (Game Coins), aucune valeur réelle. */

const WALLET_KEY = 'luckyhub_balance_gc';
const DEFAULT_BALANCE = 1000;
const FREE_CLAIM_AMOUNT = 1000;

function getBalance() {
  const raw = localStorage.getItem(WALLET_KEY);
  if (raw === null) {
    localStorage.setItem(WALLET_KEY, String(DEFAULT_BALANCE));
    return DEFAULT_BALANCE;
  }
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : DEFAULT_BALANCE;
}

function setBalance(amount) {
  const clamped = Math.max(0, Math.round(amount * 100) / 100);
  localStorage.setItem(WALLET_KEY, String(clamped));
  renderBalance();
  return clamped;
}

function addBalance(delta) {
  return setBalance(getBalance() + delta);
}

function canAfford(amount) {
  return amount > 0 && amount <= getBalance();
}

function renderBalance() {
  const value = getBalance();
  document.querySelectorAll('[data-balance]').forEach((el) => {
    el.textContent = value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  });
}

function claimFreeCoins() {
  addBalance(FREE_CLAIM_AMOUNT);
  showToast(`+${FREE_CLAIM_AMOUNT.toLocaleString('fr-FR')} GC crédités gratuitement !`);
}

function showToast(message, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'toast' + (type === 'error' ? ' error' : '');
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

function initWalletUI() {
  renderBalance();
  document.querySelectorAll('[data-claim-btn]').forEach((btn) => {
    btn.addEventListener('click', claimFreeCoins);
  });
}

document.addEventListener('DOMContentLoaded', initWalletUI);
