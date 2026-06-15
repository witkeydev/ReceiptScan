const { authenticate } = require('./_lib/auth');
const { loadUser, summarizeUser, PLANS } = require('./_lib/usage');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const authResult = await authenticate(event);
  if (authResult.error) return authResult.error;

  try {
    const { user } = await loadUser(authResult.claims.email);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...summarizeUser(user),
        plans: Object.values(PLANS).map(p => ({
          id: p.id, label: p.label, limit: p.limit, priceJpy: p.priceJpy
        }))
      })
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message })
    };
  }
};
