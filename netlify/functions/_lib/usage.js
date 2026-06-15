const { getStore, connectLambda } = require('@netlify/blobs');

// Lambda-compatible 関数では event を connectLambda に渡して
// Blobs のコンテキスト (siteID/token) を初期化する必要がある
function initBlobs(event) {
  if (typeof connectLambda === 'function' && event) {
    try { connectLambda(event); } catch (e) { /* 既に初期化済み等は無視 */ }
  }
}

const PLANS = {
  free:  { id: 'free',  limit: 5,    label: '無料',         priceJpy: 0   },
  p100:  { id: 'p100',  limit: 100,  label: 'ライト',       priceJpy: 300 },
  p300:  { id: 'p300',  limit: 300,  label: 'スタンダード', priceJpy: 500 },
  p1000: { id: 'p1000', limit: 1000, label: 'プロ',         priceJpy: 900 }
};

function planInfo(plan) {
  return PLANS[plan] || PLANS.free;
}

// JST の YYYY-MM を返す（毎月1日0時 JST にリセット）
function currentMonthKeyJST(now = new Date()) {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}`;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function getUserStore() {
  return getStore({ name: 'users', consistency: 'strong' });
}

async function loadUser(email) {
  const key = normalizeEmail(email);
  if (!key) throw new Error('Email required');
  const store = getUserStore();
  const existing = await store.get(key, { type: 'json' });
  const monthKey = currentMonthKeyJST();
  const user = existing || {
    email: key,
    plan: 'free',
    monthKey,
    usedCount: 0,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subStatus: null
  };
  // 月が変わっていれば使用量リセット
  if (user.monthKey !== monthKey) {
    user.monthKey = monthKey;
    user.usedCount = 0;
  }
  return { user, store, key };
}

async function saveUser(store, key, user) {
  user.updatedAt = new Date().toISOString();
  await store.setJSON(key, user);
}

function summarizeUser(user) {
  const info = planInfo(user.plan);
  return {
    email: user.email,
    plan: user.plan,
    planLabel: info.label,
    limit: info.limit,
    used: user.usedCount,
    remaining: Math.max(0, info.limit - user.usedCount),
    monthKey: user.monthKey,
    subStatus: user.subStatus || null
  };
}

module.exports = {
  PLANS,
  planInfo,
  currentMonthKeyJST,
  normalizeEmail,
  loadUser,
  saveUser,
  summarizeUser,
  initBlobs
};
