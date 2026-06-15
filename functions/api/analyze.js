import { authenticate } from '../_lib/auth.js';
import { loadUser, saveUser, summarizeUser, planInfo } from '../_lib/usage.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export async function onRequestPost(context) {
  const { request, env } = context;

  const authResult = await authenticate(request, env);
  if (authResult.error) return authResult.error;
  const claims = authResult.claims;

  const apiKey = env.WITKEY_RS_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500, headers: JSON_HEADERS
    });
  }

  // ---- 使用量チェック ----
  let userCtx;
  try {
    userCtx = await loadUser(env.USERS, claims.email);
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Storage error: ' + e.message }), {
      status: 500, headers: JSON_HEADERS
    });
  }
  const { user, kv, key } = userCtx;
  const info = planInfo(user.plan);
  if (user.usedCount >= info.limit) {
    return new Response(JSON.stringify({
      error: 'Usage limit reached',
      ...summarizeUser(user)
    }), { status: 402, headers: JSON_HEADERS });
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
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: image }
            },
            { type: 'text', text: 'このレシートを分析してJSONで返してください。' }
          ]
        }]
      })
    });

    const data = await response.json();

    // 成功時のみカウント加算
    if (response.ok) {
      user.usedCount += 1;
      try { await saveUser(kv, key, user); } catch (e) { /* ログのみ */ }
    }

    return new Response(JSON.stringify({
      ...data,
      _usage: summarizeUser(user)
    }), { status: 200, headers: JSON_HEADERS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: JSON_HEADERS
    });
  }
}
