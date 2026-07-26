import { findPortalAccountAsync, json, requirePortalSession, totpSetupUri } from '../_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });

  const session = requirePortalSession(req, 'developer');
  if (!session.ok) return json(res, session.status, { error: session.error });

  const account = await findPortalAccountAsync(session.claims.email);
  if (!account?.totpSecret) {
    return json(res, 404, { error: 'MFA setup is not configured for this account.' });
  }

  return json(res, 200, {
    success: true,
    data: {
      otpauthUri: totpSetupUri(account),
      secret: account.totpSecret,
      mfaRequired: Boolean(account.mfaRequired),
    },
  });
}
