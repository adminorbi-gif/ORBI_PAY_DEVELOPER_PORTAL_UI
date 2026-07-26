import { json, proxyPortalRequest, readEnvironment, readJsonBody } from './_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch {
    return json(res, 400, { error: 'Invalid JSON body.' });
  }

  return proxyPortalRequest(req, res, {
    path: '/v1/portal/gateway',
    method: 'POST',
    body: payload,
    environment: readEnvironment(payload.environment),
  });
}
