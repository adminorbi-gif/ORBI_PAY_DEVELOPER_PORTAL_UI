import { json, proxyPortalRequest, readEnvironment, readJsonBody } from '../_shared.js';

export default async function handler(req, res) {
  const environment = readEnvironment(req.query.environment);
  if (req.method === 'GET') {
    return proxyPortalRequest(req, res, { path: '/v1/portal/users', method: 'GET', environment });
  }
  if (req.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return json(res, 400, { error: 'Invalid JSON body.' });
    }
    return proxyPortalRequest(req, res, { path: '/v1/portal/users', method: 'POST', body, environment });
  }
  return json(res, 405, { error: 'Method not allowed.' });
}
