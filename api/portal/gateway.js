import { gatewayFetch, json, readEnvironment, readJsonBody, requirePermission, requirePortalSession, writePortalAuditEvent } from './_shared.js';

const allowedOperatorPaths = [
  { pattern: /^\/v1\/developer\/services\/[^/]+\/scope-requests$/, permission: 'developer:manage_scopes' },
  { pattern: /^\/v1\/developer\/service-applications\/[^/]+\/approve$/, permission: 'developer:approve_applications', confirmation: true },
  { pattern: /^\/v1\/developer\/services\/[^/]+\/status$/, permission: 'developer:manage_services', confirmation: true },
  { pattern: /^\/v1\/developer\/sandbox-simulator\/reset$/, permission: 'developer:manage_sandbox', confirmation: true },
  { pattern: /^\/v1\/developer\/service-applications$/, permission: 'developer:request_access', developerAllowed: true },
  { pattern: /^\/v1\/developer\/services\/[^/]+\/api-key-rotations$/, permission: 'developer:manage_keys', confirmation: true },
  { pattern: /^\/v1\/developer\/services\/[^/]+\/webhook-secrets\/issue$/, permission: 'developer:manage_keys', confirmation: true },
  { pattern: /^\/v1\/developer\/webhook-deliveries\/[^/]+\/replay$/, permission: 'developer:replay_webhooks', confirmation: true },
  { pattern: /^\/v1\/developer\/services\/[^/]+\/api-keys\/issue$/, permission: 'developer:manage_keys', confirmation: true },
];

function allowedPath(path) {
  return allowedOperatorPaths.find((item) => item.pattern.test(path));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });

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
  const rule = allowedPath(path);

  if (credential !== 'operator') return json(res, 403, { error: 'This portal route allows operator actions only.' });
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return json(res, 405, { error: 'Unsupported action method.' });
  if (!rule) return json(res, 403, { error: 'This gateway action is not allowlisted for the portal.' });

  const minRole = rule.developerAllowed ? 'developer' : 'operator';
  const session = requirePermission(req, rule.permission, minRole);
  if (!session.ok) return json(res, session.status, { error: session.error });

  if (rule.confirmation && !payload.confirmationAccepted) {
    return json(res, 409, { error: 'Confirmation is required before this admin action can continue.' });
  }
  if (rule.confirmation && !String(payload.reason || payload.body?.reason || payload.body?.rotationReason || '').trim()) {
    return json(res, 400, { error: 'A clear reason is required for this admin action.' });
  }

  const body = {
    ...(payload.body || {}),
    actor: {
      email: session.claims.email,
      role: session.claims.role,
      name: session.claims.name,
    },
  };

  try {
    await writePortalAuditEvent(req, {
      action: `portal.gateway.${method.toLowerCase()}`,
      target: path,
      environment,
      metadata: {
        permission: rule.permission,
        reason: payload.reason || payload.body?.reason || payload.body?.rotationReason || undefined,
      },
    });
    const { response, data } = await gatewayFetch({ environment, path, method, credential: 'operator', body });
    return json(res, response.status, data);
  } catch (error) {
    return json(res, 502, { error: error instanceof Error ? error.message : 'Gateway proxy failed.' });
  }
}
