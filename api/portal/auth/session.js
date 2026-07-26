import { json, verifyPortalSessionToken } from '../_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });

  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const session = verifyPortalSessionToken(token);
  if (!session.ok) return json(res, session.status, { error: session.error });

  return json(res, 200, {
    user: {
      email: session.claims.email,
      name: session.claims.name,
      role: session.claims.role,
      liveAccess: Boolean(session.claims.liveAccess),
      serviceCodes: Array.isArray(session.claims.serviceCodes) ? session.claims.serviceCodes : [],
    },
    expiresAt: session.claims.exp ? new Date(Number(session.claims.exp) * 1000).toISOString() : undefined,
  });
}
