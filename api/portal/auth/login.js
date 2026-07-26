import { findPortalAccount, json, readJsonBody, signPortalSession, verifyPortalPassword } from '../_shared.js';

function publicClaims(account) {
  return {
    email: account.email,
    name: account.name || account.email,
    role: account.role || 'developer',
    liveAccess: Boolean(account.liveAccess),
    serviceCodes: Array.isArray(account.serviceCodes) ? account.serviceCodes : [],
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return json(res, 400, { error: 'Invalid JSON body.' });
  }

  const account = findPortalAccount(body.email);
  if (!account || !verifyPortalPassword(account, body.password)) {
    return json(res, 401, { error: 'Invalid email or password.' });
  }

  return json(res, 200, {
    token: signPortalSession(account),
    user: publicClaims(account),
  });
}
