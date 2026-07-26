import crypto from 'node:crypto';
import { Pool } from 'pg';

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
const ROLE_PERMISSIONS = {
  developer: ['developer:request_access', 'developer:read_own'],
  operator: [
    'developer:request_access',
    'developer:read_all',
    'developer:approve_applications',
    'developer:manage_scopes',
    'developer:manage_services',
    'developer:manage_keys',
    'developer:replay_webhooks',
    'developer:manage_sandbox',
  ],
  admin: [
    'developer:request_access',
    'developer:read_all',
    'developer:approve_applications',
    'developer:manage_scopes',
    'developer:manage_services',
    'developer:manage_keys',
    'developer:replay_webhooks',
    'developer:manage_sandbox',
    'portal:manage_users',
    'portal:read_audit',
  ],
};

let portalPool;
let portalSchemaReady;

function portalDatabaseUrl() {
  return process.env.ORBI_PORTAL_DATABASE_URL || process.env.DATABASE_URL || '';
}

function getPortalPool() {
  const url = portalDatabaseUrl();
  if (!url) return undefined;
  if (!portalPool) portalPool = new Pool({ connectionString: url });
  return portalPool;
}

async function ensurePortalSchema() {
  const pool = getPortalPool();
  if (!pool) return false;
  if (portalSchemaReady) return true;
  await pool.query(`
    create table if not exists public.orbi_portal_users (
      user_id text primary key,
      email text not null unique,
      name text not null,
      role text not null check (role in ('developer','operator','admin')),
      permissions text[] not null default '{}',
      live_access boolean not null default false,
      service_codes text[] not null default '{}',
      password_salt text not null,
      password_hash text not null,
      password_iterations integer not null default 210000,
      totp_secret text,
      mfa_required boolean not null default false,
      enabled boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table if not exists public.orbi_portal_audit_events (
      event_id text primary key,
      actor_email text,
      actor_role text,
      action text not null,
      target text,
      environment text,
      ip_hash text,
      user_agent_hash text,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
  `);
  portalSchemaReady = true;
  return true;
}

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
    permissions: permissionsForAccount(account),
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

export function requirePermission(req, permission, minRole = 'developer') {
  const session = requirePortalSession(req, minRole);
  if (!session.ok) return session;
  if (!hasPermission(session.claims, permission)) {
    return { ok: false, status: 403, error: 'Your account does not have permission for this action.' };
  }
  return session;
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
        totpSecret: process.env.ORBI_PORTAL_ADMIN_TOTP_SECRET || undefined,
        mfaRequired: process.env.ORBI_PORTAL_ADMIN_MFA_REQUIRED === 'true',
      },
    ];
  }

  return [];
}

function accountFromRow(row) {
  if (!row) return undefined;
  return {
    userId: row.user_id,
    email: row.email,
    name: row.name,
    role: row.role,
    permissions: row.permissions || [],
    liveAccess: Boolean(row.live_access),
    serviceCodes: row.service_codes || [],
    passwordSalt: row.password_salt,
    passwordHash: row.password_hash,
    passwordIterations: Number(row.password_iterations || 210000),
    totpSecret: row.totp_secret || undefined,
    mfaRequired: Boolean(row.mfa_required),
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findPortalAccountAsync(email) {
  const normalized = String(email || '').trim().toLowerCase();
  const pool = getPortalPool();
  if (pool) {
    await ensurePortalSchema();
    const result = await pool.query('select * from public.orbi_portal_users where lower(email) = lower($1) and enabled = true limit 1', [normalized]);
    const rowAccount = accountFromRow(result.rows[0]);
    if (rowAccount) return rowAccount;
  }
  return findPortalAccount(normalized);
}

export async function listPortalUsers(req) {
  const session = requirePermission(req, 'portal:manage_users', 'admin');
  if (!session.ok) return session;
  const pool = getPortalPool();
  if (!pool) return { ok: true, data: readAccounts().map(publicPortalUser) };
  await ensurePortalSchema();
  const result = await pool.query('select * from public.orbi_portal_users order by created_at desc');
  return { ok: true, data: result.rows.map(accountFromRow).map(publicPortalUser) };
}

export async function createPortalUser(req, input) {
  const session = requirePermission(req, 'portal:manage_users', 'admin');
  if (!session.ok) return session;
  const pool = getPortalPool();
  if (!pool) return { ok: false, status: 503, error: 'Portal database is required to create users.' };
  await ensurePortalSchema();
  const password = String(input.password || '').trim();
  if (password.length < 12) return { ok: false, status: 400, error: 'Password must contain at least 12 characters.' };
  const role = ['developer', 'operator', 'admin'].includes(String(input.role)) ? String(input.role) : 'developer';
  const salt = crypto.randomBytes(16).toString('base64url');
  const iterations = 210000;
  const hash = hashPassword(password, salt, iterations);
  const userId = `portal_user_${crypto.randomUUID()}`;
  const result = await pool.query(
    `insert into public.orbi_portal_users (
      user_id, email, name, role, permissions, live_access, service_codes,
      password_salt, password_hash, password_iterations, totp_secret, mfa_required, enabled
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true)
    returning *`,
    [
      userId,
      String(input.email || '').trim().toLowerCase(),
      String(input.name || input.email || '').trim(),
      role,
      Array.isArray(input.permissions) ? input.permissions.map(String) : [],
      Boolean(input.liveAccess),
      Array.isArray(input.serviceCodes) ? input.serviceCodes.map(String) : [],
      salt,
      hash,
      iterations,
      input.totpSecret ? String(input.totpSecret).trim().replace(/\s+/g, '').toUpperCase() : null,
      Boolean(input.mfaRequired),
    ],
  );
  await writePortalAuditEvent(req, {
    action: 'portal.user.created',
    target: String(input.email || '').trim().toLowerCase(),
    metadata: { role, liveAccess: Boolean(input.liveAccess), createdUserId: userId },
  });
  return { ok: true, data: publicPortalUser(accountFromRow(result.rows[0])) };
}

export async function updatePortalUser(req, userId, input) {
  const session = requirePermission(req, 'portal:manage_users', 'admin');
  if (!session.ok) return session;
  const pool = getPortalPool();
  if (!pool) return { ok: false, status: 503, error: 'Portal database is required to update users.' };
  await ensurePortalSchema();
  const current = await pool.query('select * from public.orbi_portal_users where user_id = $1 limit 1', [userId]);
  if (!current.rows[0]) return { ok: false, status: 404, error: 'Portal user not found.' };
  const existing = accountFromRow(current.rows[0]);
  const role = input.role && ['developer', 'operator', 'admin'].includes(String(input.role)) ? String(input.role) : existing.role;
  const result = await pool.query(
    `update public.orbi_portal_users set
      name = $2,
      role = $3,
      permissions = $4,
      live_access = $5,
      service_codes = $6,
      mfa_required = $7,
      enabled = $8,
      updated_at = now()
    where user_id = $1
    returning *`,
    [
      userId,
      String(input.name || existing.name),
      role,
      Array.isArray(input.permissions) ? input.permissions.map(String) : existing.permissions || [],
      input.liveAccess === undefined ? existing.liveAccess : Boolean(input.liveAccess),
      Array.isArray(input.serviceCodes) ? input.serviceCodes.map(String) : existing.serviceCodes || [],
      input.mfaRequired === undefined ? existing.mfaRequired : Boolean(input.mfaRequired),
      input.enabled === undefined ? existing.enabled : Boolean(input.enabled),
    ],
  );
  await writePortalAuditEvent(req, {
    action: 'portal.user.updated',
    target: existing.email,
    metadata: { userId, role },
  });
  return { ok: true, data: publicPortalUser(accountFromRow(result.rows[0])) };
}

function hashPassword(password, salt, iterations) {
  return crypto.pbkdf2Sync(password, salt, Number(iterations || 210000), 32, 'sha256').toString('base64url');
}

export function findPortalAccount(email) {
  const normalized = String(email || '').trim().toLowerCase();
  return readAccounts().find((account) => String(account.email || '').trim().toLowerCase() === normalized && account.enabled !== false);
}

export function permissionsForAccount(account) {
  return [...new Set([...(ROLE_PERMISSIONS[account.role] || []), ...((account.permissions || []).map(String))])];
}

export function hasPermission(claims, permission) {
  const permissions = Array.isArray(claims.permissions) ? claims.permissions : permissionsForAccount(claims);
  return permissions.includes(permission);
}

export function publicPortalUser(account) {
  return {
    userId: account.userId,
    email: account.email,
    name: account.name || account.email,
    role: account.role || 'developer',
    permissions: permissionsForAccount(account),
    liveAccess: Boolean(account.liveAccess),
    serviceCodes: Array.isArray(account.serviceCodes) ? account.serviceCodes : [],
    mfaRequired: Boolean(account.mfaRequired),
    enabled: account.enabled !== false,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

export function verifyPortalPassword(account, password) {
  if (!account?.passwordHash || !account?.passwordSalt) return false;
  const calculated = hashPassword(String(password || ''), String(account.passwordSalt), Number(account.passwordIterations || 210000));
  const actual = Buffer.from(String(account.passwordHash));
  const expected = Buffer.from(calculated);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function base32Decode(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(value || '').replace(/\s+/g, '').replace(/=+$/g, '').toUpperCase();
  let bits = '';
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('Invalid TOTP secret.');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function totpCode(secret, stepOffset = 0) {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 30000) + stepOffset;
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buffer.writeUInt32BE(counter >>> 0, 4);
  const digest = crypto.createHmac('sha1', key).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0xf;
  const code = ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
  return code;
}

export function verifyTotp(account, code) {
  if (!account?.mfaRequired) return true;
  if (!account.totpSecret) return false;
  const clean = String(code || '').trim();
  if (!/^\d{6}$/.test(clean)) return false;
  return [-1, 0, 1].some((offset) => totpCode(account.totpSecret, offset) === clean);
}

function hashOptional(value) {
  if (!value) return undefined;
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
}

export async function writePortalAuditEvent(req, { action, target, environment, metadata = {} }) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const session = verifyPortalSessionToken(token);
  const claims = session.ok ? session.claims : {};
  const event = {
    eventId: `portal_audit_${crypto.randomUUID()}`,
    actorEmail: claims.email || metadata.actorEmail || undefined,
    actorRole: claims.role || metadata.actorRole || undefined,
    action,
    target,
    environment,
    ipHash: hashOptional(req.headers['x-forwarded-for'] || req.socket?.remoteAddress),
    userAgentHash: hashOptional(req.headers['user-agent']),
    metadata,
  };
  const pool = getPortalPool();
  if (pool) {
    await ensurePortalSchema();
    await pool.query(
      `insert into public.orbi_portal_audit_events (
        event_id, actor_email, actor_role, action, target, environment,
        ip_hash, user_agent_hash, metadata
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        event.eventId,
        event.actorEmail || null,
        event.actorRole || null,
        event.action,
        event.target || null,
        event.environment || null,
        event.ipHash || null,
        event.userAgentHash || null,
        event.metadata || {},
      ],
    );
  }
  console.info(JSON.stringify({ level: 'info', service: 'orbi-pay-developer-portal', message: 'portal.audit_event', ...event }));
  return event;
}

export async function listPortalAuditEvents(req) {
  const session = requirePermission(req, 'portal:read_audit', 'admin');
  if (!session.ok) return session;
  const pool = getPortalPool();
  if (!pool) return { ok: true, data: [] };
  await ensurePortalSchema();
  const result = await pool.query('select * from public.orbi_portal_audit_events order by created_at desc limit 200');
  return {
    ok: true,
    data: result.rows.map((row) => ({
      eventId: row.event_id,
      actorEmail: row.actor_email,
      actorRole: row.actor_role,
      action: row.action,
      target: row.target,
      environment: row.environment,
      createdAt: row.created_at,
      metadata: row.metadata || {},
    })),
  };
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
