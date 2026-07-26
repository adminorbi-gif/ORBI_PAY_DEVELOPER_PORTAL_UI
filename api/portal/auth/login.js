import {
  findPortalAccountAsync,
  json,
  publicPortalUser,
  readJsonBody,
  signPortalSession,
  verifyPortalPassword,
  verifyTotp,
  writePortalAuditEvent,
} from '../_shared.js';

function publicClaims(account) {
  return publicPortalUser(account);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return json(res, 400, { error: 'Invalid JSON body.' });
  }

  const account = await findPortalAccountAsync(body.email);
  if (!account || !verifyPortalPassword(account, body.password)) {
    await writePortalAuditEvent(req, {
      action: 'portal.auth.failed',
      target: String(body.email || '').trim().toLowerCase(),
      metadata: { reason: 'invalid_credentials' },
    });
    return json(res, 401, { error: 'Invalid email or password.' });
  }

  if (account.mfaRequired && !verifyTotp(account, body.otp)) {
    await writePortalAuditEvent(req, {
      action: 'portal.auth.mfa_failed',
      target: account.email,
      metadata: { reason: 'invalid_otp' },
    });
    return json(res, 401, { error: 'Enter the 6-digit authenticator code.' });
  }

  await writePortalAuditEvent(req, {
    action: 'portal.auth.login',
    target: account.email,
    metadata: { actorEmail: account.email, actorRole: account.role },
  });

  return json(res, 200, {
    token: signPortalSession(account),
    user: publicClaims(account),
  });
}
