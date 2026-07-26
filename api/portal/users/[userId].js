import { json, proxyPortalRequest, readEnvironment, readJsonBody } from '../_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return json(res, 405, { error: 'Method not allowed.' });
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return json(res, 400, { error: 'Invalid JSON body.' });
  }
  return proxyPortalRequest(req, res, {
    path: `/v1/portal/users/${encodeURIComponent(String(req.query.userId || ''))}`,
    method: 'PATCH',
    body,
    environment: readEnvironment(req.query.environment),
  });
}
