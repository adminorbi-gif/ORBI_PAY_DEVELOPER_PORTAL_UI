import { environmentConfig, gatewayFetch, json, listPortalAuditEvents, listPortalUsers, publicArray, readEnvironment, requirePortalSession } from './_shared.js';

const operatorPaths = [
  ['/v1/developer/services', []],
  ['/v1/developer/service-applications', []],
  ['/v1/developer/events', []],
  ['/v1/developer/webhook-deliveries', []],
  ['/v1/developer/docs-catalog', []],
  ['/v1/developer/sdk-catalog', []],
  ['/v1/developer/consent-scopes', []],
  ['/v1/developer/environment-profiles', {}],
  ['/v1/developer/sandbox-simulator/accounts', []],
  ['/v1/developer/integration-health', undefined],
];

const unwrap = (body) => {
  if (body && typeof body === 'object' && 'success' in body) return body.data;
  return body;
};

const arrayFrom = (value, key) => {
  if (Array.isArray(value)) return value;
  if (key && value && Array.isArray(value[key])) return value[key];
  return [];
};

async function safeGateway(environment, path, credential = 'none', fallback = undefined) {
  try {
    const { response, data } = await gatewayFetch({ environment, path, credential });
    if (!response.ok) {
      return { ok: false, error: data?.message || data?.error || `Gateway HTTP ${response.status}`, data: fallback };
    }
    return { ok: true, data: unwrap(data) ?? fallback };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Gateway request failed.', data: fallback };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });

  const environment = readEnvironment(req.query.environment);
  const accessLevel = ['developer', 'operator', 'admin'].includes(String(req.query.accessLevel))
    ? String(req.query.accessLevel)
    : 'public';
  const env = environmentConfig(environment);

  const publicResults = await Promise.all([
    safeGateway(environment, '/health'),
    safeGateway(environment, '/ready'),
  ]);

  const canUseOperator = accessLevel === 'operator' || accessLevel === 'admin';
  const session = canUseOperator ? requirePortalSession(req, 'operator') : { ok: false };
  const operatorResults = [];
  if (canUseOperator && session.ok) {
    for (const [path, fallback] of operatorPaths) {
      operatorResults.push(await safeGateway(environment, path, 'operator', fallback));
    }
  } else {
    for (const [, fallback] of operatorPaths) {
      operatorResults.push({ ok: true, data: fallback });
    }
  }

  const errors = [
    ['health', publicResults[0]],
    ['ready', publicResults[1]],
    ['services', operatorResults[0]],
    ['applications', operatorResults[1]],
    ['events', operatorResults[2]],
    ['webhookDeliveries', operatorResults[3]],
    ['docs', operatorResults[4]],
    ['sdks', operatorResults[5]],
    ['consentScopes', operatorResults[6]],
    ['environmentProfiles', operatorResults[7]],
    ['sandboxAccounts', operatorResults[8]],
    ['integrationHealth', operatorResults[9]],
  ]
    .filter(([, result]) => !result.ok)
    .map(([name, result]) => ({ name, error: result.error }));

  if (canUseOperator && !session.ok) {
    errors.push({ name: 'session', error: session.error || 'Sign in to continue.' });
  }

  const adminUsers = accessLevel === 'admin' && session.ok ? await listPortalUsers(req) : { ok: true, data: [] };
  const adminAudit = accessLevel === 'admin' && session.ok ? await listPortalAuditEvents(req) : { ok: true, data: [] };
  if (!adminUsers.ok) errors.push({ name: 'portalUsers', error: adminUsers.error });
  if (!adminAudit.ok) errors.push({ name: 'portalAudit', error: adminAudit.error });

  return json(res, 200, {
    environment,
    gatewayBaseUrl: env.publicBaseUrl,
    snapshot: {
      health: publicResults[0].data,
      ready: publicResults[1].data,
      services: arrayFrom(operatorResults[0].data),
      applications: arrayFrom(operatorResults[1].data),
      events: arrayFrom(operatorResults[2].data),
      webhookDeliveries: arrayFrom(operatorResults[3].data),
      docs: arrayFrom(operatorResults[4].data),
      sdks: arrayFrom(operatorResults[5].data),
      consentScopes: arrayFrom(operatorResults[6].data),
      environmentProfiles: operatorResults[7].data || {},
      sandboxAccounts: arrayFrom(operatorResults[8].data, 'accounts'),
      integrationHealth: operatorResults[9].data,
      serviceProfile: undefined,
      portalUsers: adminUsers.ok ? adminUsers.data : [],
      portalAudit: adminAudit.ok ? adminAudit.data : [],
    },
    errors,
  });
}
