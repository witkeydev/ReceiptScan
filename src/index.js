import { authenticate } from './lib/auth.js';
import { loadUser, saveUser, summarizeUser, planInfo, PLANS } from './lib/usage.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

async function handleMe(request, env) {
  const authResult = await authenticate(request, env);
  if (authResult.error) return authResult.error;

  try {
    const { user } = await loadUser(env.USERS, authResult.claims.email);
    return json({
      ...summarizeUser(user),
      plans: Object.values(PLANS).map(p => ({
        id: p.id, label: p.label, limit: p.limit, priceJpy: p.priceJpy
      }))
    });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

async function handleAnalyze(request, env) {
  const authResult = await authenticate(request, env);
  if (authResult.error) return authResult.error;
  const claims = authResult.claims;

  const apiKey = env.WITKEY_RS_KEY;
  if (!apiKey) return json({ error: 'API key not configured' }, 500);

  let userCtx;
  try {
    userCtx = await loadUser(env.USERS, claims.email);
  } catch (e) {
    return json({ error: 'Storage error: ' + e.message }, 500);
  }
  const { user, kv, key } = userCtx;
  const info = planInfo(user.plan);
  if (user.usedCount >= info.limit) {
    return json({ error: 'Usage limit reached', ...summarizeUser(user) }, 402);
  }

  try {
    const { image } = await request.json();

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1000,
        system: `あなたは日本の経理・会計の専門家です。レシート画像を分析して、以下のJSON形式のみで回答してください。JSONのみ、コードブロックなし、説明なし：
{"date":"YYYY/MM/DD","store":"店舗名","amount":金額数値,"tax":消費税数値,"items":[{"name":"商品名","price":価格}],"account":"勘定科目","category":"経費区分","memo":"摘要"}
画像が不明瞭な場合は推定値を入力し、nullは使わないでください。`,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
            { type: 'text', text: 'このレシートを分析してJSONで返してください。' }
          ]
        }]
      })
    });

    const data = await response.json();

    if (response.ok) {
      user.usedCount += 1;
      try { await saveUser(kv, key, user); } catch (e) { /* ログのみ */ }
    }

    return json({ ...data, _usage: summarizeUser(user) });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (path === '/api/me' && method === 'GET') return handleMe(request, env);
    if (path === '/api/analyze' && method === 'POST') return handleAnalyze(request, env);
    if (path.startsWith('/api/')) return json({ error: 'Not Found' }, 404);

    return new Response('Not Found', { status: 404 });
  }
};
