import { json, proxyPortalRequest, readEnvironment } from './_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });
  return proxyPortalRequest(req, res, {
    path: '/v1/portal/audit-events',
    method: 'GET',
    environment: readEnvironment(req.query.environment),
  });
}
