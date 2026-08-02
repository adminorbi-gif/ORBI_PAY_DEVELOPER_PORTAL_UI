import { json, proxyPortalRequest, readEnvironment, readJsonBody } from '../_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    body = {};
  }
  const action = String(body.action || 'signup');
  const paths = {
    signup: '/v1/portal/auth/signup',
    verify_email: '/v1/portal/auth/email/verify',
    resend_email: '/v1/portal/auth/email/resend',
    accept_invite: '/v1/portal/auth/invitations/accept',
  };
  if (!paths[action]) return json(res, 400, { error: 'Unsupported account action.' });
  const { action: _action, ...payload } = body;
  return proxyPortalRequest(req, res, {
    path: paths[action],
    method: 'POST',
    body: payload,
    environment: readEnvironment(body.environment),
  });
}
