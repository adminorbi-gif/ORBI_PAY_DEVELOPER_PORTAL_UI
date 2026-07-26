const ENVIRONMENTS = {
  sandbox: {
    publicBaseUrl: process.env.ORBI_PAY_GATEWAY_SANDBOX_BASE_URL || 'https://sandbox-pay.orbifinancial.com',
    operatorKey: process.env.ORBI_PORTAL_SANDBOX_OPERATOR_KEY,
    serviceKey: process.env.ORBI_PORTAL_SANDBOX_SERVICE_KEY,
  },
  live: {
    publicBaseUrl: process.env.ORBI_PAY_GATEWAY_LIVE_BASE_URL || 'https://pay.orbifinancial.com',
    operatorKey: process.env.ORBI_PORTAL_LIVE_OPERATOR_KEY,
    serviceKey: process.env.ORBI_PORTAL_LIVE_SERVICE_KEY,
  },
};

export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

export function readEnvironment(value) {
  return value === 'live' ? 'live' : 'sandbox';
}

export function environmentConfig(environment) {
  return ENVIRONMENTS[readEnvironment(environment)] || ENVIRONMENTS.sandbox;
}

export function requirePortalSession(req, minRole = 'developer') {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const expected = process.env.ORBI_PORTAL_BFF_SESSION_TOKEN;
  if (!expected || !token || token !== expected) {
    return { ok: false, status: 401, error: 'Sign in to continue.' };
  }
  const role = process.env.ORBI_PORTAL_BFF_SESSION_ROLE || 'operator';
  const order = { public: 0, developer: 1, operator: 2, admin: 3 };
  if ((order[role] ?? 0) < (order[minRole] ?? 1)) {
    return { ok: false, status: 403, error: 'Your account does not have access to this action.' };
  }
  return { ok: true, role };
}

export async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

export async function gatewayFetch({ environment, path, method = 'GET', credential = 'none', body }) {
  if (!path.startsWith('/')) {
    throw new Error('Gateway path must start with /.');
  }
  const env = environmentConfig(environment);
  const headers = {
    accept: 'application/json',
    'x-orbi-environment': readEnvironment(environment) === 'live' ? 'Production' : 'Demo',
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (credential === 'operator') {
    if (!env.operatorKey) throw new Error('Operator access is not configured for this environment.');
    headers['x-orbi-pay-operator-key'] = env.operatorKey;
  }
  if (credential === 'service') {
    if (!env.serviceKey) throw new Error('Service access is not configured for this environment.');
    headers['x-orbi-pay-service-key'] = env.serviceKey;
  }
  const response = await fetch(`${env.publicBaseUrl.replace(/\/+$/, '')}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  return { response, data };
}

export function publicArray() {
  return { success: true, data: [] };
}
