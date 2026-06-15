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
    return JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8')).iss;
  } catch { return null; }
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

async function authenticate(event) {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  if (!auth.startsWith('Bearer ')) {
    return { error: { statusCode: 401, body: JSON.stringify({ error: 'Missing bearer token' }) } };
  }
  let claims;
  try {
    claims = await verifyIdToken(auth.slice(7));
  } catch (e) {
    return { error: { statusCode: 401, body: JSON.stringify({ error: 'Invalid token: ' + e.message }) } };
  }
  if (!claims.email) {
    return { error: { statusCode: 401, body: JSON.stringify({ error: 'Email claim missing' }) } };
  }
  if (ALLOWED_EMAILS.length) {
    const email = String(claims.email).toLowerCase();
    if (!ALLOWED_EMAILS.includes(email)) {
      return { error: { statusCode: 403, body: JSON.stringify({ error: 'Email not in allowlist' }) } };
    }
  }
  return { claims };
}

module.exports = { authenticate, verifyIdToken };
