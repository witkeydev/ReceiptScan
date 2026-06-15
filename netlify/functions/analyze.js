const { jwtVerify, createRemoteJWKSet } = require('jose');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const APPLE_CLIENT_ID = process.env.APPLE_CLIENT_ID;
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

const googleJWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const appleJWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

function peekIssuer(token) {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1], 'base64').toString('utf8');
    return JSON.parse(json).iss;
  } catch {
    return null;
  }
}

async function verifyIdToken(token) {
  const iss = peekIssuer(token);
  if (iss === 'https://accounts.google.com' || iss === 'accounts.google.com') {
    if (!GOOGLE_CLIENT_ID) throw new Error('GOOGLE_CLIENT_ID not configured');
    const { payload } = await jwtVerify(token, googleJWKS, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: GOOGLE_CLIENT_ID
    });
    return { ...payload, provider: 'google' };
  }
  if (iss === 'https://appleid.apple.com') {
    if (!APPLE_CLIENT_ID) throw new Error('APPLE_CLIENT_ID not configured');
    const { payload } = await jwtVerify(token, appleJWKS, {
      issuer: 'https://appleid.apple.com',
      audience: APPLE_CLIENT_ID
    });
    return { ...payload, provider: 'apple' };
  }
  throw new Error('Unknown token issuer');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Missing bearer token' }) };
  }
  const token = authHeader.slice(7);

  let claims;
  try {
    claims = await verifyIdToken(token);
  } catch (e) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid token: ' + e.message }) };
  }

  if (ALLOWED_EMAILS.length) {
    const email = (claims.email || '').toLowerCase();
    if (!email || !ALLOWED_EMAILS.includes(email)) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Email not in allowlist' }) };
    }
  }

  const apiKey = process.env.WITKEY_RS_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
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
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message })
    };
  }
};
