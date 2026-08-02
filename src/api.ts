export type PortalEnvironment = 'sandbox' | 'live';
export type PortalAccessLevel = 'public' | 'developer' | 'operator' | 'admin';

type CredentialMode = 'none' | 'operator' | 'service';

export type GatewayResult<T> =
  | { ok: true; data: T }
  | { ok: false; status?: number; error: string; detail?: unknown };

export type PortalConfig = {
  baseUrl: string;
  bffBaseUrl: string;
  environment: PortalEnvironment;
  sessionToken?: string;
};

export type PortalUser = {
  userId?: string;
  username?: string;
  email: string;
  name: string;
  role: 'developer' | 'operator' | 'admin';
  permissions?: string[];
  liveAccess?: boolean;
  serviceCodes?: string[];
  mfaRequired?: boolean;
  mfaStatus?: 'disabled' | 'pending' | 'active';
  enabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type PortalTeamInvitation = Record<string, unknown> & {
  invitationId?: string;
  email?: string;
  name?: string;
  role?: 'developer' | 'operator' | 'admin' | string;
  serviceCodes?: string[];
  liveAccess?: boolean;
  status?: 'pending' | 'accepted' | 'revoked' | 'expired' | string;
  deliveryStatus?: string;
  invitedBy?: string;
  expiresAt?: string;
  createdAt?: string;
};

export type PortalSession = {
  token: string;
  user: PortalUser;
  expiresAt?: string;
  mfaEnrollmentRequired?: boolean;
};

export type MfaEnrollmentResult = PortalSession & {
  recoveryCodes: string[];
};

export type MfaEnrollmentSetup = {
  otpauthUri: string;
  secret: string;
  status: 'pending';
};

export type ServiceRecord = Record<string, unknown> & {
  serviceCode?: string;
  code?: string;
  displayName?: string;
  legalName?: string;
  status?: string;
  environment?: string;
  scopesApproved?: string[];
  scopesPending?: string[];
  browserOrigins?: string[];
  redirectUrls?: string[];
  webhookUrls?: string[];
};

export type ServiceApplication = Record<string, unknown> & {
  applicationId?: string;
  serviceCode?: string;
  displayName?: string;
  legalName?: string;
  status?: string;
  requestedScopes?: string[];
};

export type ScopeRequest = Record<string, unknown> & {
  requestId?: string;
  serviceCode?: string;
  requestedScopes?: string[];
  reason?: string;
  environment?: PortalEnvironment;
  status?: 'pending_review' | 'approved' | 'rejected' | string;
  submittedAt?: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionReason?: string;
};

export type DeveloperEvent = Record<string, unknown> & {
  eventId?: string;
  eventType?: string;
  serviceCode?: string;
  occurredAt?: string;
};

export type WebhookDelivery = Record<string, unknown> & {
  deliveryId?: string;
  id?: string;
  eventType?: string;
  resourceId?: string;
  status?: string;
  httpStatus?: number;
  attempts?: number;
  createdAt?: string;
};

export type MessagingDelivery = Record<string, unknown> & {
  deliveryId?: string;
  eventId?: string;
  threadId?: string;
  templateCode?: string;
  channel?: string;
  language?: string;
  recipientIdentityRef?: string;
  status?: string;
  attempt?: number;
  statusCode?: number;
  readBy?: string[];
  readAtBy?: Record<string, string>;
  safeMetadata?: Record<string, unknown>;
  createdAt?: string;
};

export type OperatorIncident = Record<string, unknown> & {
  incidentId?: string;
  incidentType?: string;
  severity?: 'warning' | 'critical' | string;
  status?: 'open' | 'acknowledged' | 'assigned' | 'resolved' | string;
  title?: string;
  message?: string;
  resource?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  runbook?: {
    name?: string;
    steps?: string[];
  };
  assignedTo?: string;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  resolution?: string;
  escalatedAt?: string;
  escalationLevel?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type PortalSecuritySummary = Record<string, unknown> & {
  generatedAt?: string;
  health?: 'healthy' | 'attention' | 'critical' | string;
  apiCalls24h?: number;
  blockedRequests?: number;
  signatureFailures?: number;
  idempotencyFailures?: number;
  originDenials?: number;
  rateLimitEvents?: number;
  failedWebhooks?: number;
  failedMessages?: number;
  openIncidents?: number;
  criticalIncidents?: number;
  activeServices?: number;
  suspendedServices?: number;
  pendingAccess?: number;
  sdkReady?: number;
  controls?: Array<{
    code?: string;
    label?: string;
    status?: 'ok' | 'review' | string;
    detail?: string;
  }>;
};

export type SandboxAccount = Record<string, unknown> & {
  id?: string;
  name?: string;
  role?: string;
  balance?: number;
  currency?: string;
};

export type PortalSnapshot = {
  health?: unknown;
  ready?: unknown;
  services: ServiceRecord[];
  applications: ServiceApplication[];
  scopeRequests: ScopeRequest[];
  events: DeveloperEvent[];
  webhookDeliveries: WebhookDelivery[];
  messagingDeliveries: MessagingDelivery[];
  docs: Array<Record<string, unknown>>;
  sdks: Array<Record<string, unknown>>;
  consentScopes: Array<Record<string, unknown>>;
  environmentProfiles?: Record<string, unknown>;
  sandboxAccounts: SandboxAccount[];
  integrationHealth?: unknown;
  serviceProfile?: Record<string, unknown>;
  portalUsers?: PortalUser[];
  portalTeamInvitations?: PortalTeamInvitation[];
  portalAudit?: Array<Record<string, unknown>>;
  incidents?: OperatorIncident[];
  securitySummary?: PortalSecuritySummary;
};

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '');

const publicGatewayBaseUrlFor = (environment: PortalEnvironment) =>
  environment === 'live' ? 'https://pay.orbifinancial.com' : 'https://sandbox-pay.orbifinancial.com';

export const getPortalConfig = (environment: PortalEnvironment): PortalConfig => ({
  baseUrl: publicGatewayBaseUrlFor(environment),
  bffBaseUrl: normalizeBaseUrl(import.meta.env.VITE_ORBI_PORTAL_BFF_BASE_URL || '/api/portal'),
  environment,
  sessionToken: window.localStorage.getItem('orbi_portal_session_token') || undefined,
});

export function portalRealtimeUrl(config: PortalConfig) {
  const base = new URL(config.baseUrl);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = '/v1/portal/realtime';
  base.search = '';
  if (config.sessionToken) base.searchParams.set('token', config.sessionToken);
  return base.toString();
}

function shouldUseBff(config: PortalConfig) {
  return Boolean(config.bffBaseUrl);
}

export function readStoredPortalSession(): PortalSession | undefined {
  try {
    const raw = window.localStorage.getItem('orbi_portal_session');
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as PortalSession;
    if (!parsed?.token || !parsed?.user?.role) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function storePortalSession(session: PortalSession) {
  window.localStorage.setItem('orbi_portal_session', JSON.stringify(session));
  window.localStorage.setItem('orbi_portal_session_token', session.token);
}

export function clearPortalSession() {
  window.localStorage.removeItem('orbi_portal_session');
  window.localStorage.removeItem('orbi_portal_session_token');
}

export async function loginPortal(config: PortalConfig, email: string, password: string): Promise<GatewayResult<PortalSession>> {
  return loginPortalWithOtp(config, email, password);
}

export async function loginPortalWithOtp(
  config: PortalConfig,
  email: string,
  password: string,
  otp?: string,
  recoveryCode?: string,
): Promise<GatewayResult<PortalSession>> {
  try {
    const response = await fetch(`${config.bffBaseUrl}/auth/login`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, otp, recoveryCode, environment: config.environment }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, status: response.status, error: String(body?.error || `Login failed with HTTP ${response.status}`), detail: body };
    }
    const session = body as PortalSession;
    storePortalSession(session);
    return { ok: true, data: session };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Login failed.', detail: error };
  }
}

export async function startPortalMfaEnrollment(config: PortalConfig): Promise<GatewayResult<MfaEnrollmentSetup>> {
  try {
    const response = await fetch(`${config.bffBaseUrl}/auth/mfa-action`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(config.sessionToken ? { Authorization: `Bearer ${config.sessionToken}` } : {}),
      },
      body: JSON.stringify({ action: 'enroll', environment: config.environment }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, status: response.status, error: String(body?.error || `MFA setup failed with HTTP ${response.status}`), detail: body };
    }
    return { ok: true, data: unwrapGatewayEnvelope<MfaEnrollmentSetup>(body) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unable to start MFA setup.', detail: error };
  }
}

export async function verifyPortalMfaEnrollment(config: PortalConfig, code: string): Promise<GatewayResult<MfaEnrollmentResult>> {
  try {
    const response = await fetch(`${config.bffBaseUrl}/auth/mfa-action`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(config.sessionToken ? { Authorization: `Bearer ${config.sessionToken}` } : {}),
      },
      body: JSON.stringify({ action: 'verify', code, environment: config.environment }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, status: response.status, error: String(body?.error || `MFA verification failed with HTTP ${response.status}`), detail: body };
    }
    const session = unwrapGatewayEnvelope<MfaEnrollmentResult>(body);
    storePortalSession({ token: session.token, user: session.user, expiresAt: session.expiresAt });
    return { ok: true, data: session };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unable to verify MFA.', detail: error };
  }
}

export async function stepUpPortalMfa(config: PortalConfig, code: string): Promise<GatewayResult<PortalSession>> {
  try {
    const response = await fetch(`${config.bffBaseUrl}/auth/mfa-action`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(config.sessionToken ? { Authorization: `Bearer ${config.sessionToken}` } : {}),
      },
      body: JSON.stringify({ action: 'step-up', code, environment: config.environment }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, status: response.status, error: String(body?.error || `MFA verification failed with HTTP ${response.status}`), detail: body };
    }
    const session = unwrapGatewayEnvelope<PortalSession>(body);
    storePortalSession(session);
    return { ok: true, data: session };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unable to refresh MFA verification.', detail: error };
  }
}

export async function signupPortalDeveloper(
  config: PortalConfig,
  input: {
    name: string;
    username: string;
    email: string;
    password: string;
    companyName: string;
    countryCode?: string;
    useCase: string;
    termsAccepted: boolean;
  },
): Promise<GatewayResult<{ user: PortalUser; verificationRequired?: boolean; verificationDelivery?: string; nextStep?: string }>> {
  try {
    const response = await fetch(`${config.bffBaseUrl}/auth/signup`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, environment: config.environment }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, status: response.status, error: String(body?.error || `Signup failed with HTTP ${response.status}`), detail: body };
    }
    return { ok: true, data: unwrapGatewayEnvelope<{ user: PortalUser; verificationRequired?: boolean; verificationDelivery?: string; nextStep?: string }>(body) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Signup failed.', detail: error };
  }
}

export async function verifyPortalDeveloperEmail(
  config: PortalConfig,
  email: string,
  code: string,
): Promise<GatewayResult<{ email: string; verified: boolean }>> {
  try {
    const response = await fetch(`${config.bffBaseUrl}/auth/signup`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify_email', email, code, environment: config.environment }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, status: response.status, error: String(body?.error || `Verification failed with HTTP ${response.status}`), detail: body };
    }
    return { ok: true, data: unwrapGatewayEnvelope<{ email: string; verified: boolean }>(body) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Email verification failed.', detail: error };
  }
}

export async function resendPortalDeveloperEmail(
  config: PortalConfig,
  email: string,
): Promise<GatewayResult<{ accepted: boolean; delivery?: string; nextStep?: string }>> {
  try {
    const response = await fetch(`${config.bffBaseUrl}/auth/signup`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resend_email', email, environment: config.environment }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, status: response.status, error: String(body?.error || `Resend failed with HTTP ${response.status}`), detail: body };
    }
    return { ok: true, data: unwrapGatewayEnvelope<{ accepted: boolean; delivery?: string; nextStep?: string }>(body) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unable to resend verification email.', detail: error };
  }
}

export async function requestPortalPasswordReset(
  config: PortalConfig,
  email: string,
): Promise<GatewayResult<{ accepted: boolean; nextStep?: string }>> {
  try {
    const resetUrl = `${window.location.origin}/?resetToken={token}`;
    const response = await fetch(`${config.bffBaseUrl}/auth/signup`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'request_password_reset', email, resetUrl, environment: config.environment }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, status: response.status, error: String(body?.error || `Password reset failed with HTTP ${response.status}`), detail: body };
    }
    return { ok: true, data: unwrapGatewayEnvelope<{ accepted: boolean; nextStep?: string }>(body) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unable to request password reset.', detail: error };
  }
}

export async function completePortalPasswordReset(
  config: PortalConfig,
  token: string,
  password: string,
): Promise<GatewayResult<{ reset: boolean; sessionsRevoked?: boolean; nextStep?: string }>> {
  try {
    const response = await fetch(`${config.bffBaseUrl}/auth/signup`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'complete_password_reset', token, password, environment: config.environment }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, status: response.status, error: String(body?.error || `Password reset failed with HTTP ${response.status}`), detail: body };
    }
    return { ok: true, data: unwrapGatewayEnvelope<{ reset: boolean; sessionsRevoked?: boolean; nextStep?: string }>(body) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unable to change password.', detail: error };
  }
}

export async function validatePortalSession(config: PortalConfig): Promise<GatewayResult<Omit<PortalSession, 'token'>>> {
  if (!config.sessionToken) return { ok: false, status: 401, error: 'No active portal session.' };
  try {
    const url = new URL(`${config.bffBaseUrl}/auth/session`, window.location.origin);
    url.searchParams.set('environment', config.environment);
    const response = await fetch(url, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${config.sessionToken}` },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, status: response.status, error: String(body?.error || `Session check failed with HTTP ${response.status}`), detail: body };
    }
    return { ok: true, data: unwrapGatewayEnvelope<Omit<PortalSession, 'token'>>(body) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Session check failed.', detail: error };
  }
}

export async function logoutPortal(config: PortalConfig) {
  if (config.sessionToken) {
    const url = new URL(`${config.bffBaseUrl}/auth/logout`, window.location.origin);
    url.searchParams.set('environment', config.environment);
    await fetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `Bearer ${config.sessionToken}` },
    }).catch(() => undefined);
  }
  clearPortalSession();
}

const unwrapGatewayEnvelope = <T>(body: unknown): T => {
  if (body && typeof body === 'object' && 'success' in body) {
    const envelope = body as { success?: boolean; data?: T; error?: string; message?: string; details?: unknown };
    if (envelope.success === false) {
      throw new Error(envelope.message || envelope.error || 'Gateway request failed.');
    }
    return envelope.data as T;
  }

  return body as T;
};

export async function gatewayRequest<T>(
  config: PortalConfig,
  path: string,
  credential: CredentialMode = 'none',
  init: RequestInit & { portalConfirmationAccepted?: boolean; portalReason?: string } = {},
): Promise<GatewayResult<T>> {
  if (!shouldUseBff(config)) {
    return { ok: false, error: 'Portal backend proxy is not configured.' };
  }

  try {
    const headers = new Headers({ Accept: 'application/json', 'Content-Type': 'application/json' });
    if (config.sessionToken) {
      headers.set('Authorization', `Bearer ${config.sessionToken}`);
    }
    const response = await fetch(`${config.bffBaseUrl}/gateway`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        environment: config.environment,
        credential,
        path,
        method: init.method || 'GET',
        body: init.body ? JSON.parse(String(init.body)) : undefined,
        confirmationAccepted: Boolean(init.portalConfirmationAccepted),
        reason: init.portalReason,
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error = String(body?.error || body?.message || `Portal BFF returned HTTP ${response.status}`);
      if (response.status === 403 && error.toLowerCase().includes('fresh mfa')) {
        window.dispatchEvent(new CustomEvent('orbi-mfa-step-up-required'));
      }
      return {
        ok: false,
        status: response.status,
        error,
        detail: body,
      };
    }
    return { ok: true, data: unwrapGatewayEnvelope<T>(body) };
  } catch (error) {
    return {
        ok: false,
        error: error instanceof Error ? error.message : 'Portal BFF request failed.',
        detail: error,
      };
  }
}

const emptySnapshot = (): PortalSnapshot => ({
  services: [],
  applications: [],
  scopeRequests: [],
  events: [],
  webhookDeliveries: [],
  messagingDeliveries: [],
  docs: [],
  sdks: [],
  consentScopes: [],
  sandboxAccounts: [],
  portalUsers: [],
  portalAudit: [],
  incidents: [],
});

export async function fetchPortalSnapshot(config: PortalConfig, accessLevel: PortalAccessLevel) {
  if (!shouldUseBff(config)) {
    return {
      snapshot: emptySnapshot(),
      errors: [{ name: 'portalSnapshot', error: 'Portal backend proxy is not configured.' }],
    };
  }

  const url = new URL(`${config.bffBaseUrl}/snapshot`, window.location.origin);
  url.searchParams.set('environment', config.environment);
  url.searchParams.set('accessLevel', accessLevel);
  try {
    const headers = new Headers({ Accept: 'application/json' });
    if (config.sessionToken) {
      headers.set('Authorization', `Bearer ${config.sessionToken}`);
    }
    const response = await fetch(url, { headers });
    const body = await response.json().catch(() => null);
    if (response.ok && body?.snapshot) {
      return { snapshot: body.snapshot as PortalSnapshot, errors: Array.isArray(body.errors) ? body.errors : [] };
    }
    return {
      snapshot: emptySnapshot(),
      errors: [{ name: 'portalSnapshot', error: String(body?.error || `Portal BFF returned HTTP ${response.status}`) }],
    };
  } catch (error) {
    return {
      snapshot: emptySnapshot(),
      errors: [{ name: 'portalSnapshot', error: error instanceof Error ? error.message : 'Portal BFF snapshot failed.' }],
    };
  }
}
