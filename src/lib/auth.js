import { jwtVerify, createRemoteJWKSet } from 'jose';

const googleJWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const appleJWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

function peekIssuer(token) {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64);
    return JSON.parse(json).iss;
  } catch { return null; }
}

async function verifyIdToken(token, env) {
  const googleId = (env.GOOGLE_CLIENT_ID || '').trim();
  const appleId = (env.APPLE_CLIENT_ID || '').trim();
  const iss = peekIssuer(token);

  if (iss === 'https://accounts.google.com' || iss === 'accounts.google.com') {
    if (!googleId) throw new Error('GOOGLE_CLIENT_ID not configured');
    const { payload } = await jwtVerify(token, googleJWKS, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: googleId
    });
    return { ...payload, provider: 'google' };
  }
  if (iss === 'https://appleid.apple.com') {
    if (!appleId) throw new Error('APPLE_CLIENT_ID not configured');
    const { payload } = await jwtVerify(token, appleJWKS, {
      issuer: 'https://appleid.apple.com',
      audience: appleId
    });
    return { ...payload, provider: 'apple' };
  }
  throw new Error('Unknown token issuer');
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function authenticate(request, env) {
  const auth = request.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) {
    return { error: jsonError('Missing bearer token', 401) };
  }
  let claims;
  try {
    claims = await verifyIdToken(auth.slice(7), env);
  } catch (e) {
    return { error: jsonError('Invalid token: ' + e.message, 401) };
  }
  if (!claims.email) {
    return { error: jsonError('Email claim missing', 401) };
  }
  const allowed = (env.ALLOWED_EMAILS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length) {
    const email = String(claims.email).toLowerCase();
    if (!allowed.includes(email)) {
      return { error: jsonError('Email not in allowlist', 403) };
    }
  }
  return { claims };
}
