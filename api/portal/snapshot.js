import { json, portalGatewayFetch, readEnvironment } from './_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });

  const environment = readEnvironment(req.query.environment);
  const accessLevel = String(req.query.accessLevel || 'public');
  const query = new URLSearchParams({ environment, accessLevel });

  try {
    const { response, data } = await portalGatewayFetch({
      environment,
      path: `/v1/portal/snapshot?${query.toString()}`,
      method: 'GET',
      req,
    });
    if (!response.ok) return json(res, response.status, data);
    return json(res, 200, data?.data || data);
  } catch (error) {
    return json(res, 502, {
      environment,
      gatewayBaseUrl: '',
      snapshot: {
        health: undefined,
        ready: undefined,
        services: [],
        applications: [],
        events: [],
        webhookDeliveries: [],
        docs: [],
        sdks: [],
        consentScopes: [],
        environmentProfiles: {},
        sandboxAccounts: [],
        integrationHealth: undefined,
        serviceProfile: undefined,
        portalUsers: [],
        portalAudit: [],
      },
      errors: [{ name: 'gateway', error: error instanceof Error ? error.message : 'Gateway snapshot failed.' }],
    });
  }
}
