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
  email: string;
  name: string;
  role: 'developer' | 'operator' | 'admin';
  permissions?: string[];
  liveAccess?: boolean;
  serviceCodes?: string[];
  mfaRequired?: boolean;
  enabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type PortalSession = {
  token: string;
  user: PortalUser;
  expiresAt?: string;
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
  events: DeveloperEvent[];
  webhookDeliveries: WebhookDelivery[];
  docs: Array<Record<string, unknown>>;
  sdks: Array<Record<string, unknown>>;
  consentScopes: Array<Record<string, unknown>>;
  environmentProfiles?: Record<string, unknown>;
  sandboxAccounts: SandboxAccount[];
  integrationHealth?: unknown;
  serviceProfile?: Record<string, unknown>;
  portalUsers?: PortalUser[];
  portalAudit?: Array<Record<string, unknown>>;
};

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '');

export const getPortalConfig = (environment: PortalEnvironment): PortalConfig => ({
  baseUrl: normalizeBaseUrl(import.meta.env.VITE_ORBI_PAY_GATEWAY_BASE_URL || 'https://sandbox-pay.orbifinancial.com'),
  bffBaseUrl: normalizeBaseUrl(import.meta.env.VITE_ORBI_PORTAL_BFF_BASE_URL || '/api/portal'),
  environment,
  sessionToken: window.localStorage.getItem('orbi_portal_session_token') || undefined,
});

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

export async function loginPortalWithOtp(config: PortalConfig, email: string, password: string, otp?: string): Promise<GatewayResult<PortalSession>> {
  try {
    const response = await fetch(`${config.bffBaseUrl}/auth/login`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, otp }),
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

export async function validatePortalSession(config: PortalConfig): Promise<GatewayResult<Omit<PortalSession, 'token'>>> {
  if (!config.sessionToken) return { ok: false, status: 401, error: 'No active portal session.' };
  try {
    const response = await fetch(`${config.bffBaseUrl}/auth/session`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${config.sessionToken}` },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, status: response.status, error: String(body?.error || `Session check failed with HTTP ${response.status}`), detail: body };
    }
    return { ok: true, data: body as Omit<PortalSession, 'token'> };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Session check failed.', detail: error };
  }
}

export async function logoutPortal(config: PortalConfig) {
  if (config.sessionToken) {
    await fetch(`${config.bffBaseUrl}/auth/logout`, {
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
  if (credential !== 'none' && shouldUseBff(config)) {
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
        return {
          ok: false,
          status: response.status,
          error: String(body?.error || body?.message || `Portal BFF returned HTTP ${response.status}`),
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

  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  headers.set('x-orbi-environment', config.environment === 'live' ? 'Production' : 'Demo');

  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (credential === 'operator') {
    if (!config.sessionToken) {
      return { ok: false, error: 'Operator key is required for this developer portal endpoint.' };
    }
  }

  if (credential === 'service') {
    if (!config.sessionToken) {
      return { ok: false, error: 'Service key is required for this runtime endpoint.' };
    }
  }

  try {
    const response = await fetch(`${config.baseUrl}${path}`, { ...init, headers });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;

    if (!response.ok) {
      const message =
        body && typeof body === 'object' && 'error' in body
          ? String((body as { error?: string; message?: string }).message || (body as { error?: string }).error)
          : `Gateway returned HTTP ${response.status}`;
      return { ok: false, status: response.status, error: message, detail: body };
    }

    return { ok: true, data: unwrapGatewayEnvelope<T>(body) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Gateway request failed.',
      detail: error,
    };
  }
}

const arrayFrom = <T>(result: GatewayResult<unknown>, key?: string): T[] => {
  if (!result.ok) return [];
  const data = result.data;
  if (Array.isArray(data)) return data as T[];
  if (key && data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>)[key])) {
    return (data as Record<string, unknown>)[key] as T[];
  }
  return [];
};

const okData = <T>(result: GatewayResult<T>): T | undefined => (result.ok ? result.data : undefined);

export async function fetchPortalSnapshot(config: PortalConfig, accessLevel: PortalAccessLevel) {
  if (shouldUseBff(config)) {
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
    } catch {
      // Local Vite dev does not serve Vercel functions. Fall back to safe direct reads.
    }
  }

  const canUseOperatorEndpoints = accessLevel === 'operator' || accessLevel === 'admin';
  const canUseServiceEndpoints = Boolean(config.sessionToken) && accessLevel !== 'public';
  const operatorArray = <T,>(path: string) =>
    canUseOperatorEndpoints
      ? gatewayRequest<T>(config, path, 'operator')
      : Promise.resolve({ ok: true, data: [] as T } as GatewayResult<T>);
  const operatorObject = <T,>(path: string, fallback: T) =>
    canUseOperatorEndpoints
      ? gatewayRequest<T>(config, path, 'operator')
      : Promise.resolve({ ok: true, data: fallback } as GatewayResult<T>);
  const serviceObject = <T,>(path: string, fallback: T) =>
    canUseServiceEndpoints
      ? gatewayRequest<T>(config, path, 'service')
      : Promise.resolve({ ok: true, data: fallback } as GatewayResult<T>);

  const entries = await Promise.allSettled([
    gatewayRequest<unknown>(config, '/health'),
    gatewayRequest<unknown>(config, '/ready'),
    operatorArray<ServiceRecord[]>('/v1/developer/services'),
    operatorArray<ServiceApplication[]>('/v1/developer/service-applications'),
    operatorArray<DeveloperEvent[]>('/v1/developer/events'),
    operatorArray<WebhookDelivery[]>('/v1/developer/webhook-deliveries'),
    operatorArray<Array<Record<string, unknown>>>('/v1/developer/docs-catalog'),
    operatorArray<Array<Record<string, unknown>>>('/v1/developer/sdk-catalog'),
    operatorArray<Array<Record<string, unknown>>>('/v1/developer/consent-scopes'),
    operatorObject<Record<string, unknown>>('/v1/developer/environment-profiles', {}),
    operatorArray<SandboxAccount[]>('/v1/developer/sandbox-simulator/accounts'),
    operatorObject<unknown>('/v1/developer/integration-health', undefined),
    serviceObject<Record<string, unknown> | undefined>('/v1/service-profile', undefined),
  ]);

  const resultAt = <T>(index: number): GatewayResult<T> => {
    const settled = entries[index];
    return settled.status === 'fulfilled'
      ? (settled.value as GatewayResult<T>)
      : { ok: false, error: settled.reason instanceof Error ? settled.reason.message : 'Request failed.' };
  };

  const errors = [
    ['health', resultAt(0)],
    ['ready', resultAt(1)],
    ['services', resultAt(2)],
    ['applications', resultAt(3)],
    ['events', resultAt(4)],
    ['webhookDeliveries', resultAt(5)],
    ['docs', resultAt(6)],
    ['sdks', resultAt(7)],
    ['consentScopes', resultAt(8)],
    ['environmentProfiles', resultAt(9)],
    ['sandboxAccounts', resultAt(10)],
    ['integrationHealth', resultAt(11)],
    ['serviceProfile', resultAt(12)],
  ]
    .filter(([, result]) => !(result as GatewayResult<unknown>).ok)
    .map(([name, result]) => {
      const typed = result as GatewayResult<unknown>;
      return { name: String(name), error: typed.ok ? 'Unknown endpoint state.' : typed.error };
    });

  const snapshot: PortalSnapshot = {
    health: okData(resultAt<unknown>(0)),
    ready: okData(resultAt<unknown>(1)),
    services: arrayFrom<ServiceRecord>(resultAt(2)),
    applications: arrayFrom<ServiceApplication>(resultAt(3)),
    events: arrayFrom<DeveloperEvent>(resultAt(4)),
    webhookDeliveries: arrayFrom<WebhookDelivery>(resultAt(5)),
    docs: arrayFrom<Record<string, unknown>>(resultAt(6)),
    sdks: arrayFrom<Record<string, unknown>>(resultAt(7)),
    consentScopes: arrayFrom<Record<string, unknown>>(resultAt(8)),
    environmentProfiles: okData(resultAt<Record<string, unknown>>(9)),
    sandboxAccounts: arrayFrom<SandboxAccount>(resultAt(10), 'accounts'),
    integrationHealth: okData(resultAt<unknown>(11)),
    serviceProfile: okData(resultAt<Record<string, unknown>>(12)),
  };

  return { snapshot, errors };
}
