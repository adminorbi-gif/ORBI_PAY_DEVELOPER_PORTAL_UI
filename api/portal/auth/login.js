import { json, proxyPortalRequest, readEnvironment, readJsonBody } from '../_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    body = {};
  }
  return proxyPortalRequest(req, res, {
    path: '/v1/portal/auth/login',
    method: 'POST',
    body,
    environment: readEnvironment(body.environment),
  });
}
