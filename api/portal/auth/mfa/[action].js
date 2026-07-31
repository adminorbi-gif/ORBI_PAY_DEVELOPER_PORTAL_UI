import { json, proxyPortalRequest, readEnvironment, readJsonBody } from '../../_shared.js';

const ACTIONS = {
  status: { method: 'GET', path: '/v1/portal/auth/mfa' },
  enroll: { method: 'POST', path: '/v1/portal/auth/mfa/enroll' },
  verify: { method: 'POST', path: '/v1/portal/auth/mfa/verify' },
  'step-up': { method: 'POST', path: '/v1/portal/auth/mfa/step-up' },
};

export default async function handler(req, res) {
  const route = ACTIONS[String(req.query.action || '')];
  if (!route) return json(res, 404, { error: 'MFA action not found.' });
  if (req.method !== route.method) return json(res, 405, { error: 'Method not allowed.' });

  let body = {};
  if (route.method === 'POST') {
    try {
      body = await readJsonBody(req);
    } catch {
      body = {};
    }
  }

  return proxyPortalRequest(req, res, {
    path: route.path,
    method: route.method,
    body: route.method === 'POST' ? body : undefined,
    environment: readEnvironment(route.method === 'POST' ? body.environment : req.query.environment),
  });
}
