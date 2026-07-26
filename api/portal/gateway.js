import { gatewayFetch, json, readEnvironment, readJsonBody, requirePortalSession } from './_shared.js';

const allowedOperatorPaths = [
  /^\/v1\/developer\/services\/[^/]+\/scope-requests$/,
  /^\/v1\/developer\/service-applications\/[^/]+\/approve$/,
  /^\/v1\/developer\/services\/[^/]+\/status$/,
  /^\/v1\/developer\/sandbox-simulator\/reset$/,
  /^\/v1\/developer\/service-applications$/,
  /^\/v1\/developer\/services\/[^/]+\/api-key-rotations$/,
  /^\/v1\/developer\/services\/[^/]+\/webhook-secrets\/issue$/,
  /^\/v1\/developer\/webhook-deliveries\/[^/]+\/replay$/,
  /^\/v1\/developer\/services\/[^/]+\/api-keys\/issue$/,
];

function isAllowedPath(path) {
  return allowedOperatorPaths.some((pattern) => pattern.test(path));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });

  const session = requirePortalSession(req, 'operator');
  if (!session.ok) return json(res, session.status, { error: session.error });

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch {
    return json(res, 400, { error: 'Invalid JSON body.' });
  }

  const environment = readEnvironment(payload.environment);
  const path = String(payload.path || '');
  const method = String(payload.method || 'GET').toUpperCase();
  const credential = String(payload.credential || 'operator');

  if (credential !== 'operator') return json(res, 403, { error: 'This portal route allows operator actions only.' });
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return json(res, 405, { error: 'Unsupported action method.' });
  if (!isAllowedPath(path)) return json(res, 403, { error: 'This gateway action is not allowlisted for the portal.' });

  try {
    const { response, data } = await gatewayFetch({ environment, path, method, credential: 'operator', body: payload.body || {} });
    return json(res, response.status, data);
  } catch (error) {
    return json(res, 502, { error: error instanceof Error ? error.message : 'Gateway proxy failed.' });
  }
}
