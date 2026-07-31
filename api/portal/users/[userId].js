import { json, proxyPortalRequest, readEnvironment, readJsonBody } from '../_shared.js';

export default async function handler(req, res) {
  if (!['PATCH', 'POST'].includes(req.method)) return json(res, 405, { error: 'Method not allowed.' });
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return json(res, 400, { error: 'Invalid JSON body.' });
  }
  const resetMfa = req.method === 'POST' && body.action === 'reset_mfa';
  if (req.method === 'POST' && !resetMfa) return json(res, 400, { error: 'Unsupported user action.' });
  return proxyPortalRequest(req, res, {
    path: `/v1/portal/users/${encodeURIComponent(String(req.query.userId || ''))}${resetMfa ? '/mfa/reset' : ''}`,
    method: resetMfa ? 'POST' : 'PATCH',
    body,
    environment: readEnvironment(req.query.environment),
  });
}
