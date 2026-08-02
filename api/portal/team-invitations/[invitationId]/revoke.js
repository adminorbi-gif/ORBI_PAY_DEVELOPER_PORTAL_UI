import { json, proxyPortalRequest, readEnvironment, readJsonBody } from '../../_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  const environment = readEnvironment(req.query.environment);
  const invitationId = String(req.query.invitationId || '');
  if (!invitationId) return json(res, 400, { error: 'Invitation ID is required.' });
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return json(res, 400, { error: 'Invalid JSON body.' });
  }
  return proxyPortalRequest(req, res, {
    path: `/v1/portal/team-invitations/${encodeURIComponent(invitationId)}/revoke`,
    method: 'POST',
    body,
    environment,
  });
}
