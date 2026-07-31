import { json, proxyPortalRequest, readEnvironment, readJsonBody } from '../_shared.js';

const ACTIONS = {
  status: { method: 'GET', path: '/v1/portal/auth/mfa' },
  enroll: { method: 'POST', path: '/v1/portal/auth/mfa/enroll' },
  verify: { method: 'POST', path: '/v1/portal/auth/mfa/verify' },
  'step-up': { method: 'POST', path: '/v1/portal/auth/mfa/step-up' },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    body = {};
  }
  const route = ACTIONS[String(body.action || '')];
  if (!route) return json(res, 404, { error: 'MFA action not found.' });
  const { action: _action, ...payload } = body;
  return proxyPortalRequest(req, res, {
    path: route.path,
    method: route.method,
    body: route.method === 'POST' ? payload : undefined,
    environment: readEnvironment(body.environment),
  });
}
