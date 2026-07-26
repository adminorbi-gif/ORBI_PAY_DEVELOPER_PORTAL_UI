import crypto from 'node:crypto';

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

const ROLE_ORDER = { public: 0, developer: 1, operator: 2, admin: 3 };
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 8;

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

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlJson(value) {
  return base64UrlEncode(JSON.stringify(value));
}

function hmac(value) {
  const secret = process.env.ORBI_PORTAL_AUTH_SECRET || process.env.ORBI_PORTAL_BFF_SESSION_TOKEN;
  if (!secret) throw new Error('Portal auth secret is not configured.');
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

export function signPortalSession(account) {
  const now = Math.floor(Date.now() / 1000);
  const ttl = Number(process.env.ORBI_PORTAL_SESSION_TTL_SECONDS || DEFAULT_SESSION_TTL_SECONDS);
  const header = base64UrlJson({ alg: 'HS256', typ: 'ORBI_PORTAL_SESSION' });
  const payload = base64UrlJson({
    sub: account.email,
    name: account.name || account.email,
    email: account.email,
    role: account.role || 'developer',
    liveAccess: Boolean(account.liveAccess),
    serviceCodes: Array.isArray(account.serviceCodes) ? account.serviceCodes : [],
    iat: now,
    exp: now + ttl,
  });
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${hmac(unsigned)}`;
}

export function verifyPortalSessionToken(token) {
  if (!token || typeof token !== 'string') return { ok: false, status: 401, error: 'Sign in to continue.' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, status: 401, error: 'Invalid portal session.' };
  const [header, payload, signature] = parts;
  const expected = hmac(`${header}.${payload}`);
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== signatureBuffer.length || !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) {
    return { ok: false, status: 401, error: 'Invalid portal session.' };
  }
  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, status: 401, error: 'Invalid portal session.' };
  }
  if (!claims.exp || Number(claims.exp) <= Math.floor(Date.now() / 1000)) {
    return { ok: false, status: 401, error: 'Your session has expired. Sign in again.' };
  }
  return { ok: true, claims };
}

export function requirePortalSession(req, minRole = 'developer') {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  const session = verifyPortalSessionToken(token);
  if (!session.ok) return session;

  const role = session.claims.role || 'developer';
  if ((ROLE_ORDER[role] ?? 0) < (ROLE_ORDER[minRole] ?? 1)) {
    return { ok: false, status: 403, error: 'Your account does not have access to this action.' };
  }
  return { ok: true, role, claims: session.claims };
}

function readAccounts() {
  const raw = process.env.ORBI_PORTAL_ACCOUNTS_JSON;
  if (raw) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('ORBI_PORTAL_ACCOUNTS_JSON must be an array.');
    return parsed;
  }

  if (process.env.ORBI_PORTAL_ADMIN_EMAIL && process.env.ORBI_PORTAL_ADMIN_PASSWORD_HASH && process.env.ORBI_PORTAL_ADMIN_PASSWORD_SALT) {
    return [
      {
        email: process.env.ORBI_PORTAL_ADMIN_EMAIL,
        name: process.env.ORBI_PORTAL_ADMIN_NAME || 'ORBI Admin',
        role: process.env.ORBI_PORTAL_ADMIN_ROLE || 'admin',
        liveAccess: true,
        enabled: true,
        passwordHash: process.env.ORBI_PORTAL_ADMIN_PASSWORD_HASH,
        passwordSalt: process.env.ORBI_PORTAL_ADMIN_PASSWORD_SALT,
        passwordIterations: Number(process.env.ORBI_PORTAL_ADMIN_PASSWORD_ITERATIONS || 210000),
      },
    ];
  }

  return [];
}

function hashPassword(password, salt, iterations) {
  return crypto.pbkdf2Sync(password, salt, Number(iterations || 210000), 32, 'sha256').toString('base64url');
}

export function findPortalAccount(email) {
  const normalized = String(email || '').trim().toLowerCase();
  return readAccounts().find((account) => String(account.email || '').trim().toLowerCase() === normalized && account.enabled !== false);
}

export function verifyPortalPassword(account, password) {
  if (!account?.passwordHash || !account?.passwordSalt) return false;
  const calculated = hashPassword(String(password || ''), String(account.passwordSalt), Number(account.passwordIterations || 210000));
  const actual = Buffer.from(String(account.passwordHash));
  const expected = Buffer.from(calculated);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
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
