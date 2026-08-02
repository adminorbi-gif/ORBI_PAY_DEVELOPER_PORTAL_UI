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
    request_password_reset: '/v1/portal/auth/password-reset/request',
    complete_password_reset: '/v1/portal/auth/password-reset/complete',
  };
  if (!paths[action]) return json(res, 400, { error: 'Unsupported account action.' });
  const { action: _action, resetUrl: _resetUrl, ...payload } = body;
  if (action === 'request_password_reset') {
    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim() || 'https';
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    payload.resetUrl = `${proto}://${host || 'developers.orbifinancial.com'}/?resetToken={token}`;
  }
  return proxyPortalRequest(req, res, {
    path: paths[action],
    method: 'POST',
    body: payload,
    environment: readEnvironment(body.environment),
  });
}
