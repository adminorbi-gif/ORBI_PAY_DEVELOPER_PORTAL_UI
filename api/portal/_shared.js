const ENVIRONMENTS = {
  sandbox: {
    publicBaseUrl: process.env.ORBI_PAY_GATEWAY_SANDBOX_BASE_URL || 'https://sandbox-pay.orbifinancial.com',
    operatorKey: process.env.ORBI_PORTAL_SANDBOX_OPERATOR_KEY,
  },
  live: {
    publicBaseUrl: process.env.ORBI_PAY_GATEWAY_LIVE_BASE_URL || 'https://pay.orbifinancial.com',
    operatorKey: process.env.ORBI_PORTAL_LIVE_OPERATOR_KEY,
  },
};

export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

export async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

export function readEnvironment(value) {
  return value === 'live' ? 'live' : 'sandbox';
}

export function environmentConfig(environment) {
  return ENVIRONMENTS[readEnvironment(environment)] || ENVIRONMENTS.sandbox;
}

function bearer(req) {
  const header = String(req.headers.authorization || '');
  return header.startsWith('Bearer ') ? header : undefined;
}

export async function portalGatewayFetch({
  environment = 'sandbox',
  path,
  method = 'GET',
  body,
  req,
}) {
  if (!path.startsWith('/')) throw new Error('Gateway path must start with /.');
  const env = environmentConfig(environment);
  if (!env.operatorKey) throw new Error('Portal gateway operator key is not configured for this environment.');

  const headers = {
    accept: 'application/json',
    'x-orbi-pay-operator-key': env.operatorKey,
    'x-orbi-environment': readEnvironment(environment) === 'live' ? 'Production' : 'Demo',
  };
  const auth = req ? bearer(req) : undefined;
  if (auth) headers.authorization = auth;
  if (body !== undefined) headers['content-type'] = 'application/json';

  const response = await fetch(`${env.publicBaseUrl.replace(/\/+$/, '')}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  return { response, data };
}

export async function proxyPortalRequest(req, res, { path, method, body, environment }) {
  try {
    const { response, data } = await portalGatewayFetch({
      environment: readEnvironment(environment),
      path,
      method,
      body,
      req,
    });
    return json(res, response.status, data);
  } catch (error) {
    return json(res, 502, {
      success: false,
      error: error instanceof Error ? error.message : 'Portal gateway proxy failed.',
    });
  }
}
