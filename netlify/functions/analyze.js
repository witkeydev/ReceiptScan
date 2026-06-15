const { authenticate } = require('./_lib/auth');
const { loadUser, saveUser, summarizeUser, planInfo, initBlobs } = require('./_lib/usage');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  initBlobs(event);

  const authResult = await authenticate(event);
  if (authResult.error) return authResult.error;
  const claims = authResult.claims;

  const apiKey = process.env.WITKEY_RS_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  // ---- 使用量チェック ----
  let userCtx;
  try {
    userCtx = await loadUser(claims.email);
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Storage error: ' + e.message }) };
  }
  const { user, store, key } = userCtx;
  const info = planInfo(user.plan);
  if (user.usedCount >= info.limit) {
    return {
      statusCode: 402,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Usage limit reached',
        ...summarizeUser(user)
      })
    };
  }

  try {
    const { image } = JSON.parse(event.body);

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
      try { await saveUser(store, key, user); } catch (e) { /* ログのみ */ }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...data,
        _usage: summarizeUser(user)
      })
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message })
    };
  }
};
