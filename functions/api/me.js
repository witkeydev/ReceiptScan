import { authenticate } from '../_lib/auth.js';
import { loadUser, summarizeUser, PLANS } from '../_lib/usage.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export async function onRequestGet(context) {
  const { request, env } = context;

  const authResult = await authenticate(request, env);
  if (authResult.error) return authResult.error;

  try {
    const { user } = await loadUser(env.USERS, authResult.claims.email);
    return new Response(JSON.stringify({
      ...summarizeUser(user),
      plans: Object.values(PLANS).map(p => ({
        id: p.id, label: p.label, limit: p.limit, priceJpy: p.priceJpy
      }))
    }), { status: 200, headers: JSON_HEADERS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: JSON_HEADERS
    });
  }
}
