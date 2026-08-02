import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Globe,
  Menu,
  Play,
  Plus,
  RefreshCcw,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  fetchPortalSnapshot,
  gatewayRequest,
  getPortalConfig,
  completePortalPasswordReset,
  loginPortalWithOtp,
  logoutPortal,
  portalRealtimeUrl,
  readStoredPortalSession,
  requestPortalPasswordReset,
  resendPortalDeveloperEmail,
  signupPortalDeveloper,
  startPortalMfaEnrollment,
  stepUpPortalMfa,
  validatePortalSession,
  verifyPortalDeveloperEmail,
  verifyPortalMfaEnrollment,
  type DeveloperEvent,
  type PortalConfig,
  type PortalSession,
  type MfaEnrollmentSetup,
  type PortalUser,
  type PortalSnapshot,
  type PortalTeamInvitation,
  type OperatorIncident,
  type SandboxAccount,
  type ServiceApplication,
  type ServiceRecord,
  type ScopeRequest,
  type WebhookDelivery,
  type MessagingDelivery,
} from './api';
import { Environment, navItems, SectionId, StatusTone } from './data';

type PortalRole = 'public_developer' | 'developer' | 'operator' | 'admin';
type AuthMode = 'signin' | 'signup' | 'forgot' | 'reset';

const titleFor: Record<SectionId, string> = {
  overview: 'BaaS Operations',
  services: 'Integration Control',
  access: 'Get Access',
  sandbox: 'Sandbox',
  keys: 'Credential Vault',
  team: 'Team Access',
  messages: 'Developer Messages',
  scopes: 'Access Control',
  webhooks: 'Webhook Operations',
  health: 'Gateway Health',
  incidents: 'Risk & Incidents',
  docs: 'Docs & SDKs',
  events: 'Audit Trail',
  runtime: 'SDK Setup',
};

type PortalState = {
  loading: boolean;
  snapshot?: PortalSnapshot;
  errors: Array<{ name: string; error: string }>;
  lastLoadedAt?: Date;
};

type PortalSearchResult = {
  id: string;
  section: SectionId;
  title: string;
  detail: string;
  label: string;
};

const roleMeta: Record<PortalRole, { label: string; subtitle: string; initials: string; policy: string }> = {
  public_developer: {
    label: 'Explore ORBI Pay',
    subtitle: 'Docs and sandbox guide',
    initials: 'OP',
    policy: 'Learn the ORBI Pay flow, install the SDK, and prepare your sandbox integration. Sign in when you are ready to request live access.',
  },
  developer: {
    label: 'Developer Account',
    subtitle: 'Sandbox workspace',
    initials: 'DV',
    policy: 'Developers can build in sandbox, test payments safely, and request the permissions needed for production.',
  },
  operator: {
    label: 'ORBI Operator',
    subtitle: 'BaaS operations desk',
    initials: 'OP',
    policy: 'Operators run day-to-day BaaS controls: review access requests, verify domains, replay webhooks, rotate credentials, and pause risky integrations.',
  },
  admin: {
    label: 'ORBI Admin',
    subtitle: 'Full BaaS control center',
    initials: 'OA',
    policy: 'Admins have full operational control across developer accounts, service access, credential lifecycle, webhook recovery, audit trails, incidents, and production readiness.',
  },
};

const money = new Intl.NumberFormat('en-TZ', {
  style: 'currency',
  currency: 'TZS',
  maximumFractionDigits: 0,
});

export function App() {
  const docRouteId = docIdFromPath(window.location.pathname);
  const docsRouteOpen = window.location.pathname === '/docs' || Boolean(docRouteId);
  const initialQuery = new URLSearchParams(window.location.search);
  const initialSection = sectionFromQuery(initialQuery);
  const [section, setSection] = useState<SectionId>(initialSection);
  const [session, setSession] = useState<PortalSession | undefined>(() => readStoredPortalSession());
  const role = session?.user.role || 'public_developer';
  const currentRole = roleMeta[role];
  const profileInitials = initialsFor(session?.user.name || session?.user.email || currentRole.label);
  const requestedEnvironment = initialQuery.get('env') === 'live' ? 'live' : 'sandbox';
  const [environment, setEnvironment] = useState<Environment>(
    initialQuery.get('admin') === 'true'
      ? requestedEnvironment
      : 'sandbox',
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modal, setModal] = useState<'service' | 'key' | null>(null);
  const [authOpen, setAuthOpen] = useState(() => Boolean(initialQuery.get('invite_token') || initialQuery.get('resetToken')));
  const [authMode, setAuthMode] = useState<AuthMode>(initialQuery.get('resetToken') ? 'reset' : 'signin');
  const [mfaStepUpOpen, setMfaStepUpOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [portalState, setPortalState] = useState<PortalState>({ loading: true, errors: [] });

  const config = useMemo(() => ({ ...getPortalConfig(environment), sessionToken: session?.token }), [environment, session?.token]);

  const loadPortal = async () => {
    setPortalState((current) => ({ ...current, loading: true }));
    const { snapshot, errors } = await fetchPortalSnapshot(config, roleToAccessLevel(role));
    setPortalState({ loading: false, snapshot, errors, lastLoadedAt: new Date() });
  };

  const pushMessagingDelivery = (delivery: MessagingDelivery) => {
    setPortalState((current) => {
      if (!current.snapshot) return current;
      const existing = current.snapshot.messagingDeliveries || [];
      const deliveryId = String(delivery.deliveryId || '');
      const nextDeliveries = deliveryId
        ? [delivery, ...existing.filter((item) => String(item.deliveryId || '') !== deliveryId)]
        : [delivery, ...existing];
      return {
        ...current,
        snapshot: {
          ...current.snapshot,
          messagingDeliveries: nextDeliveries,
        },
      };
    });
  };

  const markMessagingRead = (payload: { threadId?: string; deliveryIds?: string[]; readBy?: string; readAt?: string }) => {
    const readBy = String(payload.readBy || '').toLowerCase();
    if (!readBy) return;
    const readAt = String(payload.readAt || new Date().toISOString());
    const ids = new Set((payload.deliveryIds || []).map((item) => String(item)));
    setPortalState((current) => {
      if (!current.snapshot) return current;
      return {
        ...current,
        snapshot: {
          ...current.snapshot,
          messagingDeliveries: (current.snapshot.messagingDeliveries || []).map((delivery) => {
            const sameThread = payload.threadId && messageThreadId(delivery) === payload.threadId;
            const sameDelivery = ids.has(String(delivery.deliveryId || ''));
            if (!sameThread && !sameDelivery) return delivery;
            const nextReadBy = new Set([...(delivery.readBy || []).map((item) => item.toLowerCase()), readBy]);
            return {
              ...delivery,
              readBy: [...nextReadBy],
              readAtBy: {
                ...(delivery.readAtBy || {}),
                [readBy]: readAt,
              },
            };
          }),
        },
      };
    });
  };

  useEffect(() => {
    if (!roleCanManageServices(role) && environment !== 'sandbox') {
      setEnvironment('sandbox');
    }
  }, [environment, portalState.snapshot, role]);

  useEffect(() => {
    if (docsRouteOpen) return;
    const query = new URLSearchParams(window.location.search);
    query.set('section', section);
    if (roleCanManageServices(role)) {
      query.set('admin', 'true');
      query.set('role', role);
      query.delete('env');
    } else {
      query.set('env', environment);
      query.delete('admin');
      query.delete('role');
    }
    const nextUrl = `${window.location.pathname}?${query.toString()}${window.location.hash}`;
    window.history.replaceState({}, '', nextUrl);
  }, [docsRouteOpen, environment, role, section]);

  useEffect(() => {
    void loadPortal();
  }, [config.baseUrl, config.bffBaseUrl, config.environment, config.sessionToken]);

  useEffect(() => {
    if (!session?.token) return;
    let socket: WebSocket | undefined;
    let reconnectTimer: number | undefined;
    let closed = false;
    const connect = () => {
      socket = new WebSocket(portalRealtimeUrl(config));
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data || '{}'));
          if (message?.type === 'portal.message.created' && message.payload) {
            pushMessagingDelivery(message.payload as MessagingDelivery);
          } else if (message?.type === 'portal.message.read' && message.payload) {
            markMessagingRead(message.payload as { threadId?: string; deliveryIds?: string[]; readBy?: string; readAt?: string });
          }
        } catch {
          // Ignore malformed realtime frames; REST snapshot remains the source of truth.
        }
      };
      socket.onclose = () => {
        if (closed) return;
        reconnectTimer = window.setTimeout(connect, 5000);
      };
    };
    connect();
    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [config.baseUrl, config.environment, config.sessionToken, session?.token]);

  useEffect(() => {
    const openSignup = () => {
      setAuthMode('signup');
      setAuthOpen(true);
    };
    window.addEventListener('orbi-open-signup', openSignup);
    return () => window.removeEventListener('orbi-open-signup', openSignup);
  }, []);

  useEffect(() => {
    const openStepUp = () => setMfaStepUpOpen(true);
    window.addEventListener('orbi-mfa-step-up-required', openStepUp);
    return () => window.removeEventListener('orbi-mfa-step-up-required', openStepUp);
  }, []);

  useEffect(() => {
    if (!session?.token) return;
    let cancelled = false;
    const validate = async () => {
      const result = await validatePortalSession(config);
      if (cancelled) return;
      if (!result.ok) {
        setSession(undefined);
        setEnvironment('sandbox');
        return;
      }
      setSession((current) => (current ? { ...current, user: result.data.user, expiresAt: result.data.expiresAt } : current));
    };
    void validate();
    return () => {
      cancelled = true;
    };
  }, []);

  const navigate = (next: SectionId) => {
    setSection(next);
    setSidebarOpen(false);
    setSearchOpen(false);
    setSearchQuery('');
  };
  const searchResults = useMemo(
    () => buildPortalSearchResults(portalState.snapshot, role).filter((result) => {
      const query = searchQuery.trim().toLowerCase();
      if (!query) return false;
      return [result.title, result.detail, result.label, titleFor[result.section]]
        .join(' ')
        .toLowerCase()
        .includes(query);
    }).slice(0, 10),
    [portalState.snapshot, role, searchQuery],
  );

  const signOut = async () => {
    await logoutPortal(config);
    setSession(undefined);
    setEnvironment('sandbox');
    setSection('overview');
  };
  const messageNotificationCount = (portalState.snapshot?.messagingDeliveries || [])
    .filter((delivery) => isUnreadMessageFor(delivery, session?.user.email))
    .slice(0, 99)
    .length;

  if (docsRouteOpen) {
    return (
      <DocsStandaloneShell
        state={portalState}
        config={config}
        routeDocId={docRouteId}
        onCreateAccount={() => {
          setAuthMode('signup');
          setAuthOpen(true);
        }}
        authModal={authOpen ? (
          <AuthModal
            config={config}
            initialMode={authMode}
            onClose={() => setAuthOpen(false)}
            onSignedIn={(nextSession) => {
              setSession(nextSession);
              setAuthOpen(false);
              setSection(roleCanManageServices(nextSession.user.role) ? 'overview' : 'sandbox');
            }}
          />
        ) : null}
      />
    );
  }

  return (
    <div className={`app-shell ${roleCanManageServices(role) ? 'staff-shell' : 'developer-shell'}`}>
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="orbi-mark">O</div>
          <div>
            <div className="brand-name">{roleCanManageServices(role) ? 'ORBI BaaS' : 'ORBI Pay'}</div>
            <div className="brand-subtitle">{roleCanManageServices(role) ? 'Operations Console' : 'Developer Portal'}</div>
          </div>
          <button className="icon-button mobile-only" onClick={() => setSidebarOpen(false)} aria-label="Close menu">
            <X size={20} />
          </button>
        </div>

        <EnvironmentSwitch environment={environment} role={role} compact />
        <RoleBadge role={role} />

        <nav className="nav-list">
          {navItems.filter((item) => isSectionVisibleForRole(item.id, role)).map((item) => {
            const Icon = item.icon;
            if (item.id === 'docs') {
              return (
                <a
                  className={`nav-item ${section === item.id ? 'active' : ''}`}
                  href={`${portalPublicOrigin()}/docs`}
                  key={item.id}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </a>
              );
            }
            return (
              <button
                className={`nav-item ${section === item.id ? 'active' : ''}`}
                key={item.id}
                onClick={() => navigate(item.id)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
                {item.id === 'messages' && messageNotificationCount > 0 ? (
                  <b className="nav-count">{messageNotificationCount > 98 ? '99+' : messageNotificationCount}</b>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-user">
          <div className="avatar">{profileInitials}</div>
          <div>
            <strong>{session?.user.name || currentRole.label}</strong>
            <small>{session?.user.email || currentRole.subtitle}</small>
            <span>{session ? `${roleLabel(role)} access` : 'Public developer guide'}</span>
          </div>
          {session ? (
            <button className="mini-link" onClick={signOut}>Logout</button>
          ) : (
            <button className="mini-link" onClick={() => {
              setAuthMode('signin');
              setAuthOpen(true);
            }}>Login</button>
          )}
        </div>
      </aside>

      {sidebarOpen && <button className="sidebar-overlay" onClick={() => setSidebarOpen(false)} aria-label="Close menu" />}

      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-only" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            <Menu size={22} />
          </button>
          <div className="search-box">
            <Search size={17} />
            <input
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && searchResults[0]) {
                  navigate(searchResults[0].section);
                }
                if (event.key === 'Escape') setSearchOpen(false);
              }}
              placeholder="Search integrations, permissions, activity..."
            />
            {searchOpen && searchQuery.trim() ? (
              <div className="search-results" role="listbox">
                {searchResults.length ? searchResults.map((result) => (
                  <button
                    key={result.id}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => navigate(result.section)}
                  >
                    <span>{result.label}</span>
                    <strong>{result.title}</strong>
                    <small>{result.detail}</small>
                  </button>
                )) : (
                  <div className="search-empty">No result found for “{searchQuery.trim()}”.</div>
                )}
              </div>
            ) : null}
          </div>
          <h1>{docsRouteOpen ? 'Developer Docs' : titleFor[section]}</h1>
          <EnvironmentSwitch environment={environment} role={role} />
          {roleCanManageServices(role) ? (
            <button className="primary-action" onClick={() => setModal('service')}>
              <Plus size={18} />
              <span>Provision Integration</span>
            </button>
          ) : role === 'public_developer' ? (
            <button className="primary-action" onClick={() => {
              setAuthMode('signup');
              setAuthOpen(true);
            }}>
              <ArrowRight size={18} />
              <span>Create account</span>
            </button>
          ) : (
            <button className="primary-action" onClick={() => navigate('sandbox')}>
              <ArrowRight size={18} />
              <span>Request Production</span>
            </button>
          )}
        </header>

        <div className="content">
          <Breadcrumb section={docsRouteOpen ? 'Developer Docs' : titleFor[section]} />
          {roleCanManageServices(role) && (
            <>
              <EnterpriseCommandStrip role={role} config={config} state={portalState} environment={environment} />
              <ConnectionBanner config={config} state={portalState} role={role} onRefresh={loadPortal} />
            </>
          )}
          {environment === 'live' && (
            <div className="live-warning">
              <AlertTriangle size={18} />
              Production mode processes real money. Use only approved live keys and verified customer flows.
            </div>
          )}
          {docsRouteOpen ? (
            <Docs state={portalState} config={config} routeDocId={docRouteId} />
          ) : (
            <SectionRenderer
              section={section}
              role={role}
              config={config}
              portalState={portalState}
              currentUser={session?.user}
              refresh={loadPortal}
              openKeyModal={() => setModal('key')}
            />
          )}
        </div>
      </main>

      {portalState.loading && <GlobalLoadingOverlay />}

      {modal && <PortalModal type={modal} config={config} onClose={() => setModal(null)} refresh={loadPortal} />}
      {authOpen && (
        <AuthModal
          config={config}
          initialMode={authMode}
          onClose={() => setAuthOpen(false)}
          onSignedIn={(nextSession) => {
            setSession(nextSession);
            setAuthOpen(false);
            setSection(roleCanManageServices(nextSession.user.role) ? 'overview' : 'sandbox');
          }}
        />
      )}
      {session?.user.mfaRequired && session.user.mfaStatus !== 'active' && (
        <MfaEnrollmentModal
          config={config}
          onCompleted={(verifiedSession) => {
            setSession(verifiedSession);
            void loadPortal();
          }}
          onSignOut={signOut}
        />
      )}
      {session && mfaStepUpOpen && (
        <MfaStepUpModal
          config={config}
          onClose={() => setMfaStepUpOpen(false)}
          onVerified={(verifiedSession) => {
            setSession(verifiedSession);
            setMfaStepUpOpen(false);
          }}
        />
      )}
    </div>
  );
}

function RoleBadge({ role }: { role: PortalRole }) {
  return (
    <div className="role-badge">
      <span>{role === 'public_developer' ? 'Welcome' : 'Account'}</span>
      <strong>{roleMeta[role].label}</strong>
    </div>
  );
}

function roleToAccessLevel(role: PortalRole) {
  if (role === 'public_developer') return 'public';
  return role;
}

function roleLabel(role: PortalRole) {
  if (role === 'admin') return 'Admin';
  if (role === 'operator') return 'Operator';
  if (role === 'developer') return 'Developer';
  return 'Guest';
}

function initialsFor(value: string) {
  const parts = value
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
  return initials || 'OP';
}

function isSectionVisibleForRole(section: SectionId, role: PortalRole) {
  if (role === 'public_developer') return ['overview', 'access', 'sandbox', 'docs', 'runtime'].includes(section);
  if (role === 'developer') return ['overview', 'access', 'sandbox', 'docs', 'runtime', 'keys', 'messages', 'scopes', 'webhooks', 'health'].includes(section);
  if (role === 'operator') return ['overview', 'services', 'access', 'keys', 'messages', 'scopes', 'webhooks', 'health', 'incidents', 'events'].includes(section);
  return ['overview', 'services', 'access', 'keys', 'team', 'messages', 'scopes', 'webhooks', 'health', 'incidents', 'events', 'runtime'].includes(section);
}

function buildPortalSearchResults(snapshot: PortalSnapshot | undefined, role: PortalRole): PortalSearchResult[] {
  const visibleSections = new Set(navItems.filter((item) => isSectionVisibleForRole(item.id, role)).map((item) => item.id));
  const results: PortalSearchResult[] = [];
  const add = (section: SectionId, title: string, detail: string, label = titleFor[section]) => {
    if (!visibleSections.has(section)) return;
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    results.push({
      id: `${section}:${results.length}:${cleanTitle}`,
      section,
      title: cleanTitle,
      detail: detail.trim() || titleFor[section],
      label,
    });
  };

  for (const item of navItems) add(item.id, item.label, titleFor[item.id], 'Page');
  for (const service of snapshot?.services || []) {
    const code = String(service.serviceCode || service.code || '');
    add('services', String(service.displayName || service.legalName || code), `${code} ${service.status || ''}`, 'Integration');
    add('keys', `${code} credentials`, `${valueOf(service, 'keyStatus', 'key_status') || 'Key status'} ${valueOf(service, 'webhookSecretStatus', 'webhook_secret_status') || ''}`, 'Credential');
  }
  for (const request of snapshot?.scopeRequests || []) {
    add('scopes', String(request.serviceCode || 'Permission request'), `${(request.requestedScopes || []).join(', ')} ${request.status || ''}`, 'Permission');
  }
  for (const app of snapshot?.applications || []) {
    add('access', String(app.displayName || app.legalName || app.serviceCode || 'Access request'), `${(app.requestedScopes || []).join(', ')} ${app.status || ''}`, 'Access');
  }
  for (const delivery of snapshot?.messagingDeliveries || []) {
    add('messages', messageTitle(delivery), `${messageBody(delivery)} ${delivery.recipientIdentityRef || ''}`, 'Message');
  }
  for (const webhook of snapshot?.webhookDeliveries || []) {
    add('webhooks', String(webhook.eventType || webhook.deliveryId || 'Payment update'), `${webhook.status || ''} ${webhook.resourceId || ''}`, 'Payment update');
  }
  for (const incident of snapshot?.incidents || []) {
    add('incidents', String(incident.title || incident.incidentType || 'Service issue'), `${incident.status || ''} ${incident.message || ''}`, 'Issue');
  }
  const security = snapshot?.securitySummary;
  if (security) {
    add('overview', 'Security control summary', [
      `health ${security.health || ''}`,
      `blocked ${security.blockedRequests || 0}`,
      `signature ${security.signatureFailures || 0}`,
      `idempotency ${security.idempotencyFailures || 0}`,
      `origin ${security.originDenials || 0}`,
      `rate ${security.rateLimitEvents || 0}`,
    ].join(' '), 'Security');
    for (const control of security.controls || []) {
      add('overview', String(control.label || control.code || 'Security control'), String(control.detail || control.status || ''), 'Security');
    }
  }
  for (const event of snapshot?.events || []) {
    add('events', String(event.eventType || event.eventId || 'Activity'), `${event.serviceCode || ''} ${event.occurredAt || ''}`, 'Activity');
  }
  for (const user of snapshot?.portalUsers || []) {
    add('team', String(user.name || user.email || 'Portal user'), `${user.email || ''} ${user.role || ''}`, 'Team');
  }
  for (const doc of snapshot?.docs || []) {
    add('docs', String(doc.title || doc.id || 'Developer guide'), String(doc.description || doc.category || ''), 'Docs');
  }
  return results;
}

function roleCanManageServices(role: PortalRole) {
  return role === 'operator' || role === 'admin';
}

function sectionFromQuery(query: URLSearchParams): SectionId {
  const requested = query.get('section') || query.get('page');
  return navItems.some((item) => item.id === requested) ? (requested as SectionId) : 'overview';
}

function formatShortDate(value: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function messageThreadId(delivery: MessagingDelivery) {
  const metaThread = delivery.safeMetadata?.threadId;
  return String(delivery.threadId || (typeof metaThread === 'string' ? metaThread : '') || delivery.serviceCode || delivery.recipientIdentityRef || delivery.eventId || 'general');
}

function isUnreadMessageFor(delivery: MessagingDelivery, email?: string) {
  const viewer = String(email || '').trim().toLowerCase();
  if (!viewer) return false;
  const readBy = new Set((delivery.readBy || []).map((item) => String(item).toLowerCase()));
  const sentBy = String(delivery.safeMetadata?.sentBy || '').toLowerCase();
  if (sentBy === viewer) return false;
  return !readBy.has(viewer);
}

function messageTitle(delivery: MessagingDelivery) {
  const subject = delivery.safeMetadata?.emailSubject;
  if (typeof subject === 'string' && subject.trim()) return subject.trim();
  const service = String(delivery.serviceCode || '').trim();
  if (service) return service;
  return String(delivery.recipientIdentityRef || 'General conversation');
}

function messageBody(delivery: MessagingDelivery) {
  const body = delivery.safeMetadata?.emailBody;
  return typeof body === 'string' ? body : '';
}

function GlobalLoadingOverlay() {
  return (
    <div className="global-loading-overlay" role="status" aria-live="polite">
      <div className="loading-orb" />
    </div>
  );
}

function EnvironmentSwitch({
  environment,
  role,
  compact = false,
}: {
  environment: Environment;
  role: PortalRole;
  compact?: boolean;
}) {
  return (
    <div className={`environment-context ${compact ? 'compact' : ''} ${roleCanManageServices(role) ? 'staff' : 'developer'}`}>
      <span>{roleCanManageServices(role) ? 'Control scope' : 'Access'}</span>
      <strong>
        {roleCanManageServices(role)
          ? 'General control'
          : 'Sandbox workspace'}
      </strong>
    </div>
  );
}

function Breadcrumb({ section }: { section: string }) {
  return (
    <div className="breadcrumb">
      <span>Developer Portal</span>
      <ChevronRight size={14} />
      <strong>{section}</strong>
    </div>
  );
}

function ConnectionBanner({
  config,
  state,
  role,
  onRefresh,
}: {
  config: PortalConfig;
  state: PortalState;
  role: PortalRole;
  onRefresh: () => void;
}) {
  const hasStaffSession = Boolean(config.sessionToken);
  const healthReady = Boolean(state.snapshot?.health || state.snapshot?.ready);
  const tone = healthReady ? 'success' : hasStaffSession ? 'warning' : 'danger';
  const isStaff = roleCanManageServices(role);

  return (
    <div className={`connection-banner ${tone}`}>
      <div>
        <strong>{healthReady ? 'Connected' : 'Loading workspace'}</strong>
        <span>
          {isStaff
            ? `Operations control · ${state.lastLoadedAt ? `loaded ${state.lastLoadedAt.toLocaleTimeString()}` : 'not loaded yet'}`
            : state.lastLoadedAt
              ? `Last refreshed ${state.lastLoadedAt.toLocaleTimeString()}`
              : 'Preparing your developer workspace'}
        </span>
      </div>
      {!hasStaffSession && isStaff && (
        <span className="credential-warning">Staff session is required for administration tools.</span>
      )}
      <button className="ghost-action" onClick={onRefresh} disabled={state.loading}>
        <RefreshCcw size={15} /> {state.loading ? 'Loading' : 'Refresh'}
      </button>
    </div>
  );
}

function EnterpriseCommandStrip({
  role,
  config,
  state,
  environment,
}: {
  role: PortalRole;
  config: PortalConfig;
  state: PortalState;
  environment: Environment;
}) {
  const services = state.snapshot?.services || [];
  const activeServices = services.filter((service) => String(service.status || '').toLowerCase() === 'active');
  const isStaff = roleCanManageServices(role);
  const credentialState = config.sessionToken
    ? 'Staff access ready'
    : 'Sign in to manage';

  return (
    <div className="command-strip" aria-label="Enterprise portal status">
      <div className="command-card">
        <span>Access</span>
        <strong>{roleMeta[role].label}</strong>
        <small>{roleMeta[role].subtitle}</small>
      </div>
      <div className="command-card">
        <span>{isStaff ? 'Scope' : 'Environment'}</span>
        <strong>{isStaff ? 'General control' : environment === 'live' ? 'Production' : 'Sandbox'}</strong>
        <small>{isStaff ? 'All approved operations areas' : environment === 'live' ? 'Real customer payments' : 'Safe test payments'}</small>
      </div>
      <div className="command-card">
        <span>{isStaff ? 'Management' : 'Next step'}</span>
        <strong>{credentialState}</strong>
        <small>
          {isStaff
            ? `${activeServices.length} active integration${activeServices.length === 1 ? '' : 's'}`
            : 'Create an account or request live access'}
        </small>
      </div>
    </div>
  );
}

function SectionRenderer({
  section,
  role,
  config,
  portalState,
  currentUser,
  refresh,
  openKeyModal,
}: {
  section: SectionId;
  role: PortalRole;
  config: PortalConfig;
  portalState: PortalState;
  currentUser?: PortalUser;
  refresh: () => void;
  openKeyModal: () => void;
}) {
  if (!isSectionVisibleForRole(section, role)) {
    return <AccessDenied role={role} section={section} />;
  }
  if (section === 'overview') return <Overview role={role} state={portalState} />;
  if (section === 'services') return <Services config={config} state={portalState} refresh={refresh} role={role} />;
  if (section === 'access') return <AccessRequests config={config} state={portalState} refresh={refresh} role={role} />;
  if (section === 'sandbox') return <SandboxSetup config={config} state={portalState} refresh={refresh} role={role} />;
  if (section === 'keys') return <KeysAndSecrets config={config} state={portalState} refresh={refresh} openKeyModal={openKeyModal} role={role} />;
  if (section === 'team') return <TeamAccess config={config} state={portalState} refresh={refresh} />;
  if (section === 'messages') return <DeveloperMessages config={config} state={portalState} refresh={refresh} role={role} currentUser={currentUser} />;
  if (section === 'scopes') return <ScopesAndConsent config={config} state={portalState} refresh={refresh} role={role} />;
  if (section === 'webhooks') return <Webhooks config={config} state={portalState} refresh={refresh} role={role} />;
  if (section === 'health') return <Health state={portalState} />;
  if (section === 'incidents') return <OperatorIncidents config={config} state={portalState} refresh={refresh} />;
  if (section === 'docs') return <Docs state={portalState} config={config} />;
  if (section === 'events') return <AuditEvents state={portalState} />;
  return <SdkApiReference state={portalState} config={config} role={role} />;
}

function AccessDenied({ role, section }: { role: PortalRole; section: SectionId }) {
  const detail = roleCanManageServices(role)
    ? `${roleMeta[role].label} cannot open ${titleFor[section]} with the current session permissions. Use an approved staff account with the required control scope.`
    : `${roleMeta[role].label} cannot open ${titleFor[section]}. Sign in with an approved ORBI developer account to continue.`;
  return (
    <div className="panel wide-panel">
      <EmptyState
        title="This area needs the right account access"
        detail={detail}
      />
    </div>
  );
}

function Overview({ role, state }: { role: PortalRole; state: PortalState }) {
  const snapshot = state.snapshot;
  const failedWebhooks = (snapshot?.webhookDeliveries || []).filter((item) => String(item.status || '').toLowerCase() === 'failed');
  const activeIncidents = (snapshot?.incidents || []).filter((item) => String(item.status || '').toLowerCase() !== 'resolved');
  const activeServices = (snapshot?.services || []).filter((service) => String(service.status || '').toLowerCase() === 'active');
  const pendingApplications = (snapshot?.applications || []).filter((app) =>
    ['pending_review', 'draft'].includes(String(app.status || '').toLowerCase()),
  );
  const isStaff = roleCanManageServices(role);

  return (
    <div className="stack">
      {!isStaff && (
        <div className="developer-landing">
          <div className="developer-landing-copy">
            <p className="eyebrow">ORBI Business Integration</p>
            <h2>Create accounts and start your development with ORBI.</h2>
            <p>
              Build payments, escrow, identity checks, payment profiles, and signed webhooks on top of ORBI Pay.
              Start safely in sandbox, then request production access when your service is ready for real customers.
            </p>
            <div className="landing-actions">
              <button className="button-primary inline-link" onClick={() => window.dispatchEvent(new CustomEvent('orbi-open-signup'))}>
                <ArrowRight size={17} />
                Create developer account
              </button>
              <span>Official SDKs for Node.js, Python, and PHP are ready for integration.</span>
            </div>
          </div>
          <div className="developer-benefits">
            {[
              ['Accept ORBI Pay', 'Let customers pay through secure hosted payment confirmation.'],
              ['Use PaySafe escrow', 'Hold money safely while both sides complete business actions.'],
              ['Receive payment updates', 'Get signed webhooks for success, refund, release, and dispute events.'],
              ['Scale with BaaS', 'Support merchants, marketplaces, SACCOS, agents, and business portals.'],
            ].map(([title, detail]) => (
              <div className="benefit-card" key={title}>
                <Check size={16} />
                <div>
                  <strong>{title}</strong>
                  <span>{detail}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="dashboard-grid">
        {isStaff ? (
          <>
            <MetricCard label="Approved services" value={String(activeServices.length)} tone="success" detail="Live or sandbox integrations under ORBI control" />
            <MetricCard label="Access reviews" value={String(pendingApplications.length)} tone="warning" detail="Developer requests waiting for a decision" />
            <MetricCard label="Webhook recovery" value={String(failedWebhooks.length)} tone={failedWebhooks.length ? 'warning' : 'success'} detail="Failed payment updates available for replay" />
            <MetricCard label="Risk queue" value={String(activeIncidents.length)} tone={activeIncidents.length ? 'danger' : 'success'} detail={activeIncidents.length ? 'Incident response required' : 'No active incidents'} />
          </>
        ) : (
          <>
            <MetricCard label="Start in sandbox" value="01" tone="success" detail="Build safely before live access" />
            <MetricCard label="Install SDK" value="02" tone="info" detail="Use official ORBI methods" />
            <MetricCard label="Request review" value="03" tone="warning" detail="Submit your production access request" />
            <MetricCard label="Go live" value="04" tone="success" detail="Use approved production credentials" />
          </>
        )}
      </div>

      <div className="panel split-panel">
        <div>
          <p className="eyebrow">{role.includes('developer') ? 'Developer journey' : role === 'operator' ? 'Operations desk' : 'BaaS command center'}</p>
          <h2>{role.includes('developer') ? 'Launch ORBI payments with confidence.' : 'Control developer access, credentials, webhooks, and risk from one place.'}</h2>
          <p>
            {role.includes('developer')
              ? 'Use ORBI SDKs, sandbox guides, hosted checkout, PaySafe escrow, and webhooks to build secure customer payments.'
              : 'This workspace is for ORBI staff. Use it to approve or reject integrations, issue production credentials, verify domains, rotate keys, replay payment updates, suspend services, and review audit evidence.'}
          </p>
        </div>
        <div className="readiness-mini">
          {isStaff ? (
            <>
              <div><Check size={16} /><span>Approve or reject access</span></div>
              <div><Check size={16} /><span>Issue and rotate credentials</span></div>
              <div><Check size={16} /><span>Replay failed webhooks</span></div>
              <div><Check size={16} /><span>Suspend risky services</span></div>
            </>
          ) : (
            <>
              <div><Check size={16} /><span>Integration onboarding</span></div>
              <div><Check size={16} /><span>Approved access</span></div>
              <div><Check size={16} /><span>Payment update replay</span></div>
              <div><Check size={16} /><span>Sandbox/live separation</span></div>
            </>
          )}
        </div>
      </div>

      <div className="panel wide-panel policy-panel">
        <div>
          <p className="eyebrow">{isStaff ? 'Operational authority' : 'What you can do'}</p>
          <h2>{roleMeta[role].label}</h2>
          <p>{roleMeta[role].policy}</p>
        </div>
        <StatusPill tone={roleCanManageServices(role) ? 'success' : role === 'developer' ? 'info' : 'warning'}>
          {roleCanManageServices(role) ? 'Staff controls' : role === 'developer' ? 'Sandbox builder' : 'Learn first'}
        </StatusPill>
      </div>

      {isStaff && (
        <div className="panel wide-panel">
          <PanelHeader title="BaaS Control Actions" />
          <div className="step-grid">
            {[
              'Review production access requests',
              'Provision integrations and service scopes',
              'Issue, rotate, or revoke API credentials',
              'Verify domains before live access',
              'Replay failed payment update webhooks',
              'Investigate incidents and audit events',
            ].map((step, index) => (
              <div className="step-card" key={step}>
                <span>{index + 1}</span>
                <strong>{step}</strong>
              </div>
            ))}
          </div>
        </div>
      )}

      <EndpointErrors errors={state.errors} role={role} />
      {isStaff ? (
        <>
          <OperationsOverview snapshot={snapshot} />
          <RecentEvents events={snapshot?.events || []} />
        </>
      ) : (
        <div className="panel wide-panel">
          <PanelHeader title="Your first ORBI integration" />
          <div className="step-grid">
            {[
              'Create a developer account',
              'Test with sandbox users',
              'Install an ORBI SDK',
              'Submit your live access request',
              'Launch with approved production keys',
            ].map((step, index) => (
              <div className="step-card" key={step}>
                <span>{index + 1}</span>
                <strong>{step}</strong>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Services({ config, state, refresh, role }: { config: PortalConfig; state: PortalState; refresh: () => void; role: PortalRole }) {
  const services = state.snapshot?.services || [];
  const applications = state.snapshot?.applications || [];

  return (
    <div className="stack">
      <div className="panel wide-panel">
        <PanelHeader title="Approved Integrations" action="Refresh" />
        {services.length ? (
          <div className="service-grid">
            {services.map((service, index) => (
              <ServiceCard config={config} service={service} refresh={refresh} role={role} key={String(service.serviceCode || service.code || index)} />
            ))}
          </div>
        ) : (
          <EmptyState title="No integrations yet" detail="Approve a developer application before it appears here." />
        )}
      </div>

      <div className="panel wide-panel">
        <PanelHeader title="Access Applications" />
        <DataTable
          columns={['Application', 'Business', 'Status', 'Requested access', 'Environment', 'Action']}
          rows={applications.map((app) => [
            String(app.serviceCode || app.applicationId || '-'),
            String(app.displayName || app.legalName || '-'),
            <StatusPill tone={toneFromStatus(app.status)}>{String(app.status || 'unknown')}</StatusPill>,
            (app.requestedScopes || []).join(', ') || '-',
            Array.isArray(app.requestedEnvironments) ? app.requestedEnvironments.join(', ') : '-',
            <ApplicationApproval config={config} application={app} refresh={refresh} />,
          ])}
          empty="No access applications yet."
        />
      </div>
    </div>
  );
}

function OperationsOverview({ snapshot }: { snapshot?: PortalSnapshot }) {
  const services = snapshot?.services || [];
  const applications = snapshot?.applications || [];
  const scopeRequests = snapshot?.scopeRequests || [];
  const events = snapshot?.events || [];
  const webhooks = snapshot?.webhookDeliveries || [];
  const messages = snapshot?.messagingDeliveries || [];
  const incidents = snapshot?.incidents || [];
  const users = snapshot?.portalUsers || [];
  const healthRows = Array.isArray(snapshot?.integrationHealth) ? (snapshot.integrationHealth as Array<Record<string, unknown>>) : [];
  const securitySummary = snapshot?.securitySummary;

  const now = Date.now();
  const last24h = (date?: string) => {
    const value = date ? new Date(date).getTime() : 0;
    return Number.isFinite(value) && value > now - 24 * 60 * 60 * 1000;
  };
  const apiEvents24h = events.filter((event) => last24h(String(event.occurredAt || event.createdAt || '')));
  const activeAccounts = users.filter((user) => user.enabled !== false);
  const pendingRequests = [
    ...applications.filter((app) => ['pending_review', 'draft'].includes(String(app.status || '').toLowerCase())),
    ...scopeRequests.filter((request) => String(request.status || '').toLowerCase() === 'pending_review'),
  ];
  const failedServices = services.filter((service) => ['failed', 'suspended', 'revoked'].includes(String(service.status || '').toLowerCase()));
  const failedWebhooks = webhooks.filter((delivery) => String(delivery.status || '').toLowerCase() === 'failed');
  const failedMessages = messages.filter((delivery) => String(delivery.status || '').toLowerCase() === 'failed');
  const servicesMissingKeys = services.filter((service) =>
    !String(valueOf(service, 'keyStatus', 'key_status') || '').toLowerCase().includes('active')
    || !String(valueOf(service, 'webhookSecretStatus', 'webhook_secret_status') || '').toLowerCase().includes('active'),
  );
  const liveServicesNeedingDomains = services.filter((service) =>
    arrayValue(service, 'environments').includes('live')
    && arrayValue(service, 'domainVerificationStatus', 'domain_verification_status', 'verifiedDomains', 'verified_domains').length === 0,
  );
  const abnormalHealth = healthRows.filter((row) => arrayValue(row, 'warnings').length > 0 || String(row.status || '').toLowerCase() === 'attention');
  const warnings = [
    ...abnormalHealth.flatMap((row) => arrayValue(row, 'warnings').map((warning) => ({
      source: String(row.serviceCode || row.displayName || 'Integration'),
      warning,
      tone: 'warning' as StatusTone,
    }))),
    ...incidents.filter((incident) => String(incident.status || '').toLowerCase() !== 'resolved').map((incident) => ({
      source: String(incident.incidentType || 'Incident'),
      warning: String(incident.title || incident.message || 'Operator review required'),
      tone: String(incident.severity || '').toLowerCase() === 'critical' ? 'danger' as StatusTone : 'warning' as StatusTone,
    })),
  ].slice(0, 8);

  const recentActivity = [...events]
    .sort((a, b) => new Date(String(b.occurredAt || b.createdAt || '')).getTime() - new Date(String(a.occurredAt || a.createdAt || '')).getTime())
    .slice(0, 8);

  return (
    <div className="operations-stack">
      {securitySummary && (
        <div className={`security-command ${String(securitySummary.health || 'healthy').toLowerCase()}`}>
          <div className="security-command-head">
            <div>
              <p className="eyebrow">Security command</p>
              <h2>{securityHealthTitle(securitySummary.health)}</h2>
              <p>
                Live controls for request integrity, domain trust, traffic pressure, recovery queue, and developer access.
              </p>
            </div>
            <StatusPill tone={securityHealthTone(securitySummary.health)}>
              {securityHealthLabel(securitySummary.health)}
            </StatusPill>
          </div>
          <div className="security-command-grid">
            <MetricCard label="API calls 24h" value={String(securitySummary.apiCalls24h || 0)} tone="info" detail="Recent controlled platform activity" />
            <MetricCard label="Blocked requests" value={String(securitySummary.blockedRequests || 0)} tone={(securitySummary.blockedRequests || 0) ? 'warning' : 'success'} detail="Denied by policy or runtime control" />
            <MetricCard label="Signature signals" value={String(securitySummary.signatureFailures || 0)} tone={(securitySummary.signatureFailures || 0) ? 'danger' : 'success'} detail="Invalid, stale, or replayed signed requests" />
            <MetricCard label="Idempotency" value={String(securitySummary.idempotencyFailures || 0)} tone={(securitySummary.idempotencyFailures || 0) ? 'warning' : 'success'} detail="Missing or unsafe mutation retry evidence" />
            <MetricCard label="Origin denials" value={String(securitySummary.originDenials || 0)} tone={(securitySummary.originDenials || 0) ? 'warning' : 'success'} detail="Website or callback domains rejected" />
            <MetricCard label="Rate limits" value={String(securitySummary.rateLimitEvents || 0)} tone={(securitySummary.rateLimitEvents || 0) ? 'warning' : 'success'} detail="Traffic pressure requiring review" />
          </div>
          <div className="security-control-list">
            {(securitySummary.controls || []).map((control) => (
              <div className={`security-control ${String(control.status || 'ok')}`} key={String(control.code || control.label)}>
                <StatusPill tone={String(control.status || '') === 'review' ? 'warning' : 'success'}>
                  {String(control.status || '') === 'review' ? 'Review' : 'OK'}
                </StatusPill>
                <strong>{String(control.label || 'Control')}</strong>
                <span>{String(control.detail || '')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="ops-metric-grid">
        <MetricCard label="API calls 24h" value={String(apiEvents24h.length)} tone="info" detail="Gateway activity recorded in the audit stream" />
        <MetricCard label="Active accounts" value={String(activeAccounts.length)} tone="success" detail="Enabled developer and staff portal accounts" />
        <MetricCard label="Requests waiting" value={String(pendingRequests.length)} tone={pendingRequests.length ? 'warning' : 'success'} detail="Access and permission requests requiring action" />
        <MetricCard label="Warnings" value={String(warnings.length)} tone={warnings.length ? 'warning' : 'success'} detail="Operational warnings and abnormal integration checks" />
        <MetricCard label="Failed integrations" value={String(failedServices.length)} tone={failedServices.length ? 'danger' : 'success'} detail="Suspended, revoked, or failed services" />
        <MetricCard label="Failed deliveries" value={String(failedWebhooks.length + failedMessages.length)} tone={(failedWebhooks.length + failedMessages.length) ? 'danger' : 'success'} detail="Webhook and message deliveries needing recovery" />
      </div>

      <div className="governance-strip">
        {[
          {
            label: 'Access review',
            value: `${pendingRequests.length} waiting`,
            detail: pendingRequests.length ? 'Approve, reject, or ask for more information.' : 'No developer access request is waiting.',
            tone: pendingRequests.length ? 'warning' as StatusTone : 'success' as StatusTone,
          },
          {
            label: 'Credential readiness',
            value: `${servicesMissingKeys.length} need action`,
            detail: servicesMissingKeys.length ? 'Issue or rotate API/payment update keys before launch.' : 'Approved integrations have usable credentials.',
            tone: servicesMissingKeys.length ? 'warning' as StatusTone : 'success' as StatusTone,
          },
          {
            label: 'Domain trust',
            value: `${liveServicesNeedingDomains.length} unverified`,
            detail: liveServicesNeedingDomains.length ? 'Verify live websites and callback URLs before production use.' : 'Live domains are verified.',
            tone: liveServicesNeedingDomains.length ? 'warning' as StatusTone : 'success' as StatusTone,
          },
          {
            label: 'Recovery queue',
            value: `${failedWebhooks.length + failedMessages.length} failed`,
            detail: failedWebhooks.length + failedMessages.length ? 'Replay or investigate failed webhooks/messages.' : 'No failed delivery needs action.',
            tone: failedWebhooks.length + failedMessages.length ? 'danger' as StatusTone : 'success' as StatusTone,
          },
        ].map((item) => (
          <div className={`governance-card ${item.tone}`} key={item.label}>
            <StatusPill tone={item.tone}>{item.label}</StatusPill>
            <strong>{item.value}</strong>
            <span>{item.detail}</span>
          </div>
        ))}
      </div>

      <div className="ops-grid">
        <div className="panel">
          <PanelHeader title="Warnings & Abnormal Activity" />
          <DataTable
            columns={['Source', 'Signal', 'Severity']}
            rows={warnings.map((item) => [
              item.source,
              item.warning,
              <StatusPill tone={item.tone}>{item.tone === 'danger' ? 'Critical' : 'Review'}</StatusPill>,
            ])}
            empty="No warnings or abnormal integration signals returned."
          />
        </div>

        <div className="panel">
          <PanelHeader title="Failed Integration Delivery" />
          <DataTable
            columns={['Type', 'Reference', 'Status']}
            rows={[
              ...failedWebhooks.slice(0, 5).map((delivery) => [
                String(delivery.eventType || 'Webhook'),
                String(delivery.deliveryId || delivery.id || delivery.resourceId || '-'),
                <StatusPill tone="danger">Failed</StatusPill>,
              ]),
              ...failedMessages.slice(0, 5).map((delivery) => [
                String(delivery.templateCode || delivery.channel || 'Message'),
                String(delivery.deliveryId || delivery.eventId || delivery.recipientIdentityRef || '-'),
                <StatusPill tone="danger">Failed</StatusPill>,
              ]),
            ]}
            empty="No failed webhook or message delivery returned."
          />
        </div>
      </div>

      <div className="panel wide-panel">
        <PanelHeader title="Recent Platform Activity" />
        <DataTable
          columns={['Time', 'Service', 'Activity']}
          rows={recentActivity.map((event) => [
            formatShortDate(String(event.occurredAt || event.createdAt || '')),
            String(event.serviceCode || '-'),
            String(event.eventType || event.action || '-'),
          ])}
          empty="No recent activity returned."
        />
      </div>
    </div>
  );
}

function ServiceCard({ config, service, refresh, role }: { config: PortalConfig; service: ServiceRecord; refresh: () => void; role: PortalRole }) {
  const code = String(service.serviceCode || service.code || 'unknown-service');
  const granted = arrayValue(service, 'scopesGranted', 'scopes_granted', 'scopesApproved', 'scopes_approved');
  const pending = arrayValue(service, 'scopesPending', 'scopes_pending');
  const browserOrigins = arrayValue(service, 'browserOrigins', 'browser_origins');
  const redirectUrls = arrayValue(service, 'redirectUrls', 'redirect_urls');
  const webhookUrls = arrayValue(service, 'webhookUrls', 'webhook_urls');
  const metadata = objectValue(service.metadata);
  const merchant = objectValue(metadata.merchant);
  const requiredDomains = uniqueStrings([
    ...browserOrigins.map(hostnameFromUrl),
    ...redirectUrls.map(hostnameFromUrl),
    ...webhookUrls.map(hostnameFromUrl),
  ].filter(Boolean));
  const verifiedDomains = arrayValue(objectValue(metadata.domainVerification), 'verifiedDomains', 'verified_domains')
    .map((item) => item.toLowerCase());
  const missingDomains = requiredDomains.filter((domain) => !verifiedDomains.includes(domain));
  const hasLive = arrayValue(service, 'environments').includes('live');

  return (
    <article className="service-card">
      <div className="service-card-head">
        <div>
          <p className="mono">{code}</p>
          <h3>{String(service.displayName || service.legalName || code)}</h3>
        </div>
        <StatusPill tone={toneFromStatus(service.status)}>{String(service.status || 'unknown')}</StatusPill>
      </div>
      <InfoLine label="Approved permissions" value={granted.join(', ') || 'None'} />
      <InfoLine label="Pending permissions" value={pending.join(', ') || 'None'} />
      <InfoLine label="Website origins" value={String(browserOrigins.length)} />
      <InfoLine label="Redirect URLs" value={String(redirectUrls.length)} />
      <InfoLine label="Payment update URLs" value={String(webhookUrls.length)} />
      <InfoLine label="Merchant profile" value={String(merchant.merchantIdEnv || 'Not configured')} />
      {hasLive && (
        <div className="domain-verification-box">
          <div>
            <strong>{missingDomains.length ? 'Domain verification needed' : 'Domains verified'}</strong>
            <span>{missingDomains.length ? missingDomains.join(', ') : verifiedDomains.join(', ') || 'No live domains supplied'}</span>
          </div>
          <StatusPill tone={missingDomains.length ? 'warning' : 'success'}>
            {missingDomains.length ? 'Before live keys' : 'Ready for live keys'}
          </StatusPill>
        </div>
      )}
      {hasLive && missingDomains.length > 0 && (
        <DomainVerificationAction
          config={config}
          serviceCode={code}
          domains={missingDomains}
          refresh={refresh}
        />
      )}
      {['operator', 'admin'].includes(role) && (
        <>
          <ServiceStatusActions config={config} serviceCode={code} status={String(service.status || '')} refresh={refresh} />
        </>
      )}
    </article>
  );
}

function DomainVerificationAction({
  config,
  serviceCode,
  domains,
  refresh,
}: {
  config: PortalConfig;
  serviceCode: string;
  domains: string[];
  refresh: () => void;
}) {
  const [message, setMessage] = useState<string>();
  const [working, setWorking] = useState(false);
  const [instructions, setInstructions] = useState<Record<string, unknown>>();

  const loadInstructions = async () => {
    setWorking(true);
    const result = await gatewayRequest<Record<string, unknown>>(
      config,
      `/v1/developer/services/${encodeURIComponent(serviceCode)}/domain-verification`,
      'operator',
    );
    setWorking(false);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setInstructions(result.data);
    setMessage('Add the DNS TXT record for each domain, wait for DNS propagation, then press Verify DNS.');
  };

  const verify = async () => {
    setWorking(true);
    const result = await gatewayRequest<Record<string, unknown>>(config, `/v1/developer/services/${encodeURIComponent(serviceCode)}/domain-verification`, 'operator', {
      method: 'POST',
      body: JSON.stringify({
        domains,
      }),
    });
    setWorking(false);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    const pending = Array.isArray((result.data as { pending?: unknown[] }).pending)
      ? (result.data as { pending?: unknown[] }).pending || []
      : [];
    setInstructions((result.data as { domainVerification?: Record<string, unknown> }).domainVerification);
    setMessage(pending.length ? 'DNS proof not found yet. Check the TXT name/value, wait a few minutes, and try again.' : 'Domains verified. Live keys can now be issued.');
    if (!pending.length) refresh();
  };

  const challenges = Array.isArray((instructions as { challenges?: unknown[] } | undefined)?.challenges)
    ? ((instructions as { challenges?: unknown[] }).challenges || []) as Array<Record<string, unknown>>
    : [];

  return (
    <div className="domain-verification-action">
      <div className="row-actions">
        <button className="ghost-action" disabled={working} onClick={loadInstructions}>
          <Globe size={14} /> Show DNS setup
        </button>
        <button className="ghost-action" disabled={working} onClick={verify}>
          <Check size={14} /> Verify DNS
        </button>
      </div>
      {challenges.length > 0 && (
        <div className="verification-steps">
          <div className="verification-intro">
            <strong>Verify ownership with DNS TXT</strong>
            <span>Add these TXT records where your domain DNS is managed, for example Cloudflare, cPanel, Namecheap, GoDaddy, or your hosting DNS panel.</span>
          </div>
          {challenges.map((challenge) => (
            <div key={String(challenge.domain)} className="verification-step">
              <strong>{String(challenge.domain)}</strong>
              <div className="verification-field">
                <span>TXT name</span>
                <code>{String(challenge.dnsRecordName)}</code>
                <button type="button" className="mini-copy" onClick={() => navigator.clipboard?.writeText(String(challenge.dnsRecordName))}>Copy</button>
              </div>
              <div className="verification-field">
                <span>TXT value</span>
                <code>{String(challenge.dnsRecordValue)}</code>
                <button type="button" className="mini-copy" onClick={() => navigator.clipboard?.writeText(String(challenge.dnsRecordValue))}>Copy</button>
              </div>
              <small>Cloudflare tip: if your domain is {String(challenge.domain)}, add the record name shown above. TTL can stay Auto. TXT records are DNS-only.</small>
              <details className="https-fallback">
                <summary>Alternative HTTPS file method</summary>
                <span>Publish this URL as plain text if DNS access is not available:</span>
                <code>{String(challenge.httpsUrl)}</code>
                <code>{String(challenge.token)}</code>
              </details>
            </div>
          ))}
        </div>
      )}
      {message && <small>{message}</small>}
    </div>
  );
}

const accessCapabilities = [
  {
    scope: 'identity:resolve',
    title: 'Find ORBI customers',
    detail: 'Look up a customer by approved ORBI ID, phone, or email before payment.',
  },
  {
    scope: 'business_registration:create',
    title: 'Register a business',
    detail: 'Submit merchant, SACCOS, organization, or platform access details.',
  },
  {
    scope: 'user:provision',
    title: 'Create linked users',
    detail: 'Create or link users under approved ORBI identity rules.',
  },
  {
    scope: 'payment_profile:create',
    title: 'Link payment profiles',
    detail: 'Connect your platform customer or seller to an ORBI payment identity.',
  },
  {
    scope: 'payment_profile:read',
    title: 'Read linked payment profiles',
    detail: 'Read approved payment profile details for your own integration.',
  },
  {
    scope: 'payments:create',
    title: 'Create payments',
    detail: 'Start ORBI checkout payments with customer approval.',
  },
  {
    scope: 'escrow:create',
    title: 'Create PaySafe holds',
    detail: 'Hold money safely until the buyer and seller flow is completed.',
  },
  {
    scope: 'escrow:read',
    title: 'Read PaySafe status',
    detail: 'Read the current status of PaySafe payments created by your integration.',
  },
  {
    scope: 'escrow:release:request',
    title: 'Request PaySafe release',
    detail: 'Request release while preserving PaySafe approval and dispute controls.',
  },
  {
    scope: 'escrow:refund:request',
    title: 'Request PaySafe refund',
    detail: 'Request a controlled refund without bypassing PaySafe lifecycle rules.',
  },
  {
    scope: 'escrow:dispute:create',
    title: 'Open PaySafe disputes',
    detail: 'Open a dispute for an eligible PaySafe payment.',
  },
  {
    scope: 'withdrawal:request',
    title: 'Request withdrawals',
    detail: 'Request a controlled withdrawal to an approved destination.',
  },
  {
    scope: 'balance:read',
    title: 'Read approved balances',
    detail: 'View balances only when the customer has granted permission.',
  },
  {
    scope: 'webhooks:receive',
    title: 'Receive payment updates',
    detail: 'Get secure payment status updates for orders and reconciliation.',
  },
];

function AccessRequests({
  config,
  state,
  refresh,
  role,
}: {
  config: PortalConfig;
  state: PortalState;
  refresh: () => void;
  role: PortalRole;
}) {
  const services = state.snapshot?.services || [];
  const [selectedCode, setSelectedCode] = useState('');
  const selectedService = services.find((service) =>
    String(service.serviceCode || service.code || '') === selectedCode,
  ) || services[0];
  const selectedServiceCode = String(selectedService?.serviceCode || selectedService?.code || '');
  const granted = selectedService ? arrayValue(selectedService, 'scopesGranted', 'scopes_granted', 'scopesApproved', 'scopes_approved') : [];
  const pending = selectedService ? arrayValue(selectedService, 'scopesPending', 'scopes_pending') : [];
  const environments = selectedService ? arrayValue(selectedService, 'environments') : [];
  const hasLive = environments.includes('live');
  const hasSandbox = environments.includes('sandbox');

  return (
    <div className="stack">
      <div className="panel wide-panel policy-panel">
        <div>
          <p className="eyebrow">Important business rule</p>
          <h2>Developer access is not a wallet.</h2>
          <p>
            Your developer account helps you build and test integrations. To receive real money, your merchant,
            seller, POS shop, SACCOS, or organization must link an approved ORBI financial profile.
          </p>
        </div>
        <StatusPill tone="info">Payment profile required</StatusPill>
      </div>
      <div className="detail-grid">
        <div className="detail-card">
          <h3>POS software builder</h3>
          <p>
            Build your POS in sandbox with ORBI SDKs. Each shop that receives money must connect its own ORBI
            merchant payment profile before live payments are allowed.
          </p>
        </div>
        <div className="detail-card">
          <h3>SACCOS or organization</h3>
          <p>
            Keep your own members and services in your platform. Use ORBI-approved scopes to link financial
            profiles, start payments, and receive signed payment updates.
          </p>
        </div>
      </div>
      <div className="panel wide-panel">
        <PanelHeader title="What This Account Can Use" />
        {services.length > 1 && (
          <label>
            Integration
            <select
              value={selectedServiceCode}
              onChange={(event) => setSelectedCode(event.target.value)}
            >
              {services.map((service) => {
                const code = String(service.serviceCode || service.code || '');
                return <option value={code} key={code}>{String(service.displayName || service.legalName || code)}</option>;
              })}
            </select>
          </label>
        )}
        {selectedService ? (
          <>
            <div className="profile-hero">
              <div>
                <p className="mono">{selectedServiceCode}</p>
                <h2>{String(selectedService.displayName || selectedService.legalName || selectedServiceCode)}</h2>
                <p>These permissions control which ORBI features your integration can use.</p>
              </div>
              <StatusPill tone={toneFromStatus(selectedService.status)}>{String(selectedService.status || 'unknown')}</StatusPill>
            </div>
            <div className="access-grid">
              {accessCapabilities.map((capability) => {
                const isGranted = granted.includes(capability.scope);
                const isPending = pending.includes(capability.scope);
                return (
                  <div className={`access-card ${isGranted ? 'granted' : isPending ? 'pending' : 'denied'}`} key={capability.scope}>
                    <StatusPill tone={isGranted ? 'success' : isPending ? 'warning' : 'neutral'}>
                      {isGranted ? 'Granted' : isPending ? 'Pending' : 'Access denied'}
                    </StatusPill>
                    <h3>{capability.title}</h3>
                    <p>{capability.detail}</p>
                    <small>{capability.scope}</small>
                  </div>
                );
              })}
            </div>
            <div className="environment-access">
              <InfoLine label="Sandbox access" value={hasSandbox ? 'Granted' : 'Access denied'} />
              <InfoLine label="Production access" value={hasLive ? 'Granted' : 'Needs ORBI review'} />
            </div>
          </>
        ) : (
          <EmptyState
            title="No integration access yet"
            detail="You can read the docs and follow the sandbox guide. Sign in as a developer to request ORBI features for your account."
          />
        )}
      </div>
      <AccessRequestPanel
        config={config}
        serviceCode={selectedServiceCode}
        granted={granted}
        pending={pending}
        role={role}
        refresh={refresh}
      />
    </div>
  );
}

function AccessRequestPanel({
  config,
  serviceCode,
  granted,
  pending,
  role,
  refresh,
}: {
  config: PortalConfig;
  serviceCode: string;
  granted: string[];
  pending: string[];
  role: PortalRole;
  refresh: () => void;
}) {
  const [requestedScopes, setRequestedScopes] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string>();
  const [working, setWorking] = useState(false);
  const canRequestScope = Boolean(serviceCode)
    && role !== 'public_developer'
    && requestedScopes.length > 0
    && reason.trim().length >= 10;

  const toggleScope = (scope: string) => {
    if (granted.includes(scope) || pending.includes(scope)) return;
    setRequestedScopes((current) =>
      current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope],
    );
  };

  const requestScope = async () => {
    setWorking(true);
    const result = await gatewayRequest(config, `/v1/developer/services/${encodeURIComponent(serviceCode)}/scope-requests`, 'operator', {
      method: 'POST',
      body: JSON.stringify({
        environment: config.environment,
        requestedScopes,
        reason: reason.trim(),
      }),
    });
    setMessage(result.ok ? `${requestedScopes.length} permission request${requestedScopes.length === 1 ? '' : 's'} submitted.` : result.error);
    setWorking(false);
    if (result.ok) {
      setRequestedScopes([]);
      setReason('');
      refresh();
    }
  };

  return (
    <div className="panel wide-panel">
      <PanelHeader title="Request Permission" />
      <p className="security-note">
        Choose the ORBI feature your integration needs. ORBI reviews sensitive payment features before enabling them.
      </p>
      <label>Integration code<input value={serviceCode || 'No integration assigned'} readOnly /></label>
      <div className="access-grid">
        {accessCapabilities.map((capability) => {
          const isGranted = granted.includes(capability.scope);
          const isPending = pending.includes(capability.scope);
          const selected = requestedScopes.includes(capability.scope);
          return (
            <label
              className={`access-card ${isGranted ? 'granted' : isPending ? 'pending' : selected ? 'selected' : 'denied'}`}
              key={capability.scope}
            >
              <input
                type="checkbox"
                checked={isGranted || isPending || selected}
                disabled={isGranted || isPending}
                onChange={() => toggleScope(capability.scope)}
              />
              <StatusPill tone={isGranted ? 'success' : isPending ? 'warning' : selected ? 'info' : 'neutral'}>
                {isGranted ? 'Granted' : isPending ? 'Pending review' : selected ? 'Selected' : 'Available'}
              </StatusPill>
              <strong>{capability.title}</strong>
              <span>{capability.detail}</span>
              <small>{capability.scope}</small>
            </label>
          );
        })}
      </div>
      <label>
        Why does your integration need these permissions?
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={1000}
          placeholder="Describe the exact feature and how customer data or money will be protected."
        />
      </label>
      <button className="button-primary inline-link" disabled={!canRequestScope || working} onClick={requestScope}>
        {working ? 'Submitting' : `Request ${requestedScopes.length || ''} permission${requestedScopes.length === 1 ? '' : 's'}`} <ArrowRight size={16} />
      </button>
      {role === 'public_developer' && (
        <div className="inline-message">Sign in as a developer before requesting access.</div>
      )}
      {message && <div className="inline-message">{message}</div>}
    </div>
  );
}

function ApplicationApproval({ config, application, refresh }: { config: PortalConfig; application: ServiceApplication; refresh: () => void }) {
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string>();
  const [oneTimeSecrets, setOneTimeSecrets] = useState<Record<string, unknown>>();
  const applicationId = String(application.applicationId || '');
  const canApprove = applicationId && String(application.status || '').toLowerCase() === 'pending_review';

  const approve = async () => {
    const requestedEnvironments = arrayValue(application, 'requestedEnvironments', 'requested_environments');
    const credentialEnvironment = requestedEnvironments.includes('live') ? 'live' : 'sandbox';
    const reason = `Approve developer application ${applicationId} and issue ${credentialEnvironment} credentials.`;
    if (!window.confirm(`${reason}\n\nContinue?`)) return;
    setWorking(true);
    setOneTimeSecrets(undefined);
    const result = await gatewayRequest<Record<string, unknown>>(config, `/v1/developer/service-applications/${encodeURIComponent(applicationId)}/approve`, 'operator', {
      method: 'POST',
      portalConfirmationAccepted: true,
      portalReason: reason,
      body: JSON.stringify({
        serviceCode: String(application.displayName || application.legalName || 'service'),
        initialStatus: config.environment === 'live' ? 'draft' : 'active',
        grantRequestedScopes: true,
        issueCredentials: true,
        credentialEnvironment,
        decidedBy: readStoredPortalSession()?.user.email || 'portal-operator',
        reason,
      }),
    });
    if (result.ok) {
      const credentials = (result.data as { credentials?: Record<string, unknown> })?.credentials;
      setOneTimeSecrets(credentials);
      setMessage('Approved. Copy any new credentials now.');
    } else {
      setMessage(result.error);
    }
    setWorking(false);
    if (result.ok) refresh();
  };

  const reject = async () => {
    const reason = window.prompt('Why is this production/sandbox access request being rejected?');
    if (!reason?.trim() || reason.trim().length < 10) {
      setMessage('Add a clear rejection reason with at least 10 characters.');
      return;
    }
    if (!window.confirm(`Reject this access request?\n\nReason: ${reason.trim()}`)) return;
    setWorking(true);
    setOneTimeSecrets(undefined);
    const result = await gatewayRequest<Record<string, unknown>>(config, `/v1/developer/service-applications/${encodeURIComponent(applicationId)}/reject`, 'operator', {
      method: 'POST',
      portalConfirmationAccepted: true,
      portalReason: reason.trim(),
      body: JSON.stringify({
        decidedBy: readStoredPortalSession()?.user.email || 'portal-operator',
        reason: reason.trim(),
      }),
    });
    setMessage(result.ok ? 'Request rejected and recorded.' : result.error);
    setWorking(false);
    if (result.ok) refresh();
  };

  return (
    <div className="row-actions">
      <button className="ghost-action" disabled={!canApprove || working} onClick={approve}>
        <Check size={14} /> Approve
      </button>
      <button className="ghost-action danger-action" disabled={!canApprove || working} onClick={reject}>
        <X size={14} /> Reject
      </button>
      {message && <small>{message}</small>}
      {oneTimeSecrets && (
        <SecretCodePanel
          compact
          title="One-time credentials"
          subtitle="Give these to the developer through your approved secure handover process."
          metadata={[
            { label: 'Environment', value: oneTimeSecrets.environment },
            { label: 'API key id', value: objectValue(oneTimeSecrets.apiKey).keyId, masked: true },
            { label: 'Webhook key id', value: objectValue(oneTimeSecrets.webhookSecret).secretId, masked: true },
          ]}
          rows={[
            { label: 'ORBI_PAY_SERVICE_KEY', value: oneTimeSecrets.apiKeySecret },
            { label: 'ORBI_PAY_WEBHOOK_SECRET', value: oneTimeSecrets.webhookSigningSecret },
          ]}
        />
      )}
    </div>
  );
}

function ServiceStatusActions({
  config,
  serviceCode,
  status,
  refresh,
}: {
  config: PortalConfig;
  serviceCode: string;
  status: string;
  refresh: () => void;
}) {
  const [message, setMessage] = useState<string>();
  const [working, setWorking] = useState(false);

  const updateStatus = async (nextStatus: 'active' | 'suspended' | 'archived') => {
    const reason = `Change ${serviceCode} status to ${nextStatus}.`;
    if (!window.confirm(`${reason}\n\nContinue?`)) return;
    setWorking(true);
    const result = await gatewayRequest(config, `/v1/developer/services/${encodeURIComponent(serviceCode)}/status`, 'operator', {
      method: 'POST',
      portalConfirmationAccepted: true,
      portalReason: reason,
      body: JSON.stringify({
        status: nextStatus,
        reason,
        decidedBy: 'portal-session',
      }),
    });
    setMessage(result.ok ? `Service ${nextStatus}.` : result.error);
    setWorking(false);
    if (result.ok) refresh();
  };

  return (
    <div className="service-actions">
      <button className="ghost-action" disabled={working || status === 'active'} onClick={() => updateStatus('active')}>
        Activate
      </button>
      <button className="ghost-action danger-action" disabled={working || status === 'suspended'} onClick={() => updateStatus('suspended')}>
        Suspend
      </button>
      <button className="ghost-action" disabled={working || status === 'archived'} onClick={() => updateStatus('archived')}>
        Archive
      </button>
      {message && <small>{message}</small>}
    </div>
  );
}

function SandboxSetup({ config, state, refresh, role }: { config: PortalConfig; state: PortalState; refresh: () => void; role: PortalRole }) {
  const [running, setRunning] = useState(false);
  const [actionMessage, setActionMessage] = useState<string>();
  const accounts = state.snapshot?.sandboxAccounts || [];

  const resetSandbox = async () => {
    const reason = 'Reset sandbox simulator test accounts.';
    if (!window.confirm(`${reason}\n\nContinue?`)) return;
    setRunning(true);
    const result = await gatewayRequest(config, '/v1/developer/sandbox-simulator/reset', 'operator', {
      method: 'POST',
      portalConfirmationAccepted: true,
      portalReason: reason,
      body: JSON.stringify({ reason }),
    });
    setActionMessage(result.ok ? 'Sandbox simulator reset completed.' : result.error);
    setRunning(false);
    if (result.ok) refresh();
  };

  return (
    <div className="stack">
      <DeveloperApplicationStatusPanel state={state} role={role} />

      <div className="sandbox-banner">
        <AlertTriangle size={20} />
        <div>
          <strong>Sandbox uses test money only.</strong>
          <span>Practice the full payment flow safely before using production.</span>
        </div>
      </div>

      <BaasLaunchPhases state={state} role={role} />
      <ProductionReadinessChecklist state={state} />

      <div className="panel wide-panel">
        <PanelHeader title="Sandbox Checklist" />
        <div className="step-grid">
          {[
            'Create developer account',
            'Register your integration',
            'Choose required permissions',
            'Add return URLs',
            'Create sandbox key',
            'Add payment update URL',
            'Create test payment',
            'Open customer approval page',
            'Confirm payment update',
            'Retry failed update',
          ].map((step, index) => (
            <div className="step-card" key={step}>
              <span>{index + 1}</span>
              <strong>{step}</strong>
            </div>
          ))}
        </div>
      </div>

      {role === 'developer' && <SandboxIntegrationWizard config={config} refresh={refresh} />}
      {role === 'developer' && <ProductionAccessRequest config={config} refresh={refresh} />}

      <div className="two-column">
        <div className="panel action-card">
          <Play size={36} />
          <h2>Sandbox Tools</h2>
          <p>Use test accounts to rehearse identity lookup, payment intent, hosted challenge, webhook delivery, and replay without real money.</p>
          <div className="simulator-script">
            <strong>Recommended test run</strong>
            <span>1. Create a sandbox app</span>
            <span>2. Copy keys to your server</span>
            <span>3. Create a payment intent</span>
            <span>4. Approve/decline the hosted challenge</span>
            <span>5. Verify webhook status in Payment Updates</span>
          </div>
          <button className="button-primary" onClick={resetSandbox} disabled={running}>
            {running ? 'Running' : 'Reset simulator'}
          </button>
          {actionMessage && <p className="action-message">{actionMessage}</p>}
        </div>
        <div className="panel">
          <PanelHeader title="Test Accounts" />
          <div className="account-list">
            {accounts.length ? accounts.map((account) => <SandboxAccountRow account={account} key={String(account.id)} />) : (
              <EmptyState title="No test accounts yet" detail="Sign in with a developer account to use sandbox test accounts." />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DeveloperApplicationStatusPanel({ state, role }: { state: PortalState; role: PortalRole }) {
  const applications = state.snapshot?.applications || [];
  const services = state.snapshot?.services || [];
  const sessionEmail = readStoredPortalSession()?.user.email?.toLowerCase();
  const visibleApplications = roleCanManageServices(role)
    ? applications
    : applications.filter((app) => !sessionEmail || String(app.contactEmail || app.ownerEmail || '').toLowerCase() === sessionEmail);
  const latest = [...visibleApplications].sort((a, b) =>
    String(b.submittedAt || b.updatedAt || '').localeCompare(String(a.submittedAt || a.updatedAt || '')),
  )[0];
  const liveServices = services.filter((service) => arrayValue(service, 'environments').includes('live'));
  const sandboxServices = services.filter((service) => arrayValue(service, 'environments').includes('sandbox'));

  if (!latest && !services.length) return null;

  const status = String(latest?.status || (services.length ? 'approved' : 'unknown')).toLowerCase();
  const reason = String(latest?.decisionReason || latest?.reason || '').trim();
  const nextAction = status === 'rejected'
    ? 'Fix the review note, then submit a new request.'
    : status === 'pending_review'
      ? 'ORBI is reviewing your request. Keep testing safely in sandbox while you wait.'
      : liveServices.length
        ? 'Production access is enabled. Complete the go-live checklist before launch.'
        : sandboxServices.length
          ? 'Sandbox is ready. Run tests, then request production access.'
          : 'Create a sandbox integration to begin.';

  return (
    <div className="panel wide-panel application-status-panel">
      <div>
        <p className="eyebrow">Your access status</p>
        <h2>{status === 'rejected' ? 'Request needs changes' : status === 'pending_review' ? 'Request under review' : 'Integration access ready'}</h2>
        <p>{nextAction}</p>
        {reason && <div className="rejection-reason"><strong>Review note</strong><span>{reason}</span></div>}
      </div>
      <div className="status-stack">
        <StatusPill tone={status === 'rejected' ? 'danger' : status === 'pending_review' ? 'warning' : 'success'}>
          {status.replace(/_/g, ' ')}
        </StatusPill>
        <small>{latest?.submittedAt ? `Submitted ${new Date(String(latest.submittedAt)).toLocaleString()}` : `${services.length} approved integration${services.length === 1 ? '' : 's'}`}</small>
      </div>
    </div>
  );
}

function BaasLaunchPhases({ state, role }: { state: PortalState; role: PortalRole }) {
  const services = state.snapshot?.services || [];
  const applications = state.snapshot?.applications || [];
  const scopeRequests = state.snapshot?.scopeRequests || [];
  const sandboxAccounts = state.snapshot?.sandboxAccounts || [];
  const webhookDeliveries = state.snapshot?.webhookDeliveries || [];
  const hasSandboxService = services.some((service) => arrayValue(service, 'environments').includes('sandbox'));
  const hasLiveService = services.some((service) => arrayValue(service, 'environments').includes('live'));
  const hasKey = services.some((service) => String(valueOf(service, 'keyStatus', 'key_status') || '').toLowerCase().includes('active'));
  const hasWebhookSecret = services.some((service) => String(valueOf(service, 'webhookSecretStatus', 'webhook_secret_status') || '').toLowerCase().includes('active'));
  const hasPendingLive = applications.some((app) => arrayValue(app, 'requestedEnvironments', 'requested_environments').includes('live') && String(app.status || '').toLowerCase() === 'pending_review');
  const hasPendingScopes = scopeRequests.some((request) => String(request.status || '').toLowerCase() === 'pending_review');
  const hasWebhookTest = webhookDeliveries.length > 0;
  const phases = [
    {
      number: '01',
      title: 'Create sandbox integration',
      detail: 'Register your app and get test credentials.',
      ready: hasSandboxService || applications.length > 0,
      next: role === 'public_developer' ? 'Create a developer account first.' : 'Use the sandbox app form below.',
    },
    {
      number: '02',
      title: 'Request permissions',
      detail: 'Ask only for the ORBI features your product needs.',
      ready: services.some((service) => arrayValue(service, 'scopesGranted', 'scopes_granted', 'scopesApproved', 'scopes_approved').length > 0),
      next: hasPendingScopes ? 'Permission review is pending.' : 'Open Get Access and request required scopes.',
    },
    {
      number: '03',
      title: 'Secure keys and webhooks',
      detail: 'Use server-side keys and signed payment updates.',
      ready: hasKey && hasWebhookSecret,
      next: 'Open Keys & Secrets after approval.',
    },
    {
      number: '04',
      title: 'Run sandbox tests',
      detail: 'Use test accounts, simulate payments, and verify callbacks.',
      ready: sandboxAccounts.length > 0 || hasWebhookTest,
      next: 'Reset simulator or run a test payment intent.',
    },
    {
      number: '05',
      title: 'Request production access',
      detail: 'Submit live URLs, verify domains, and wait for approval.',
      ready: hasLiveService,
      next: hasPendingLive ? 'Production review is pending.' : 'Submit the production request form.',
    },
  ];

  return (
    <div className="panel wide-panel baas-phase-panel">
      <div className="phase-panel-head">
        <div>
          <p className="eyebrow">BaaS launch path</p>
          <h2>Move from sandbox to production without guessing.</h2>
          <p>These phases use your real portal status so developers know exactly what is ready and what still needs action.</p>
        </div>
        <StatusPill tone={hasLiveService ? 'success' : hasPendingLive ? 'warning' : 'info'}>
          {hasLiveService ? 'Production enabled' : hasPendingLive ? 'Live review pending' : 'Sandbox track'}
        </StatusPill>
      </div>
      <div className="phase-grid">
        {phases.map((phase) => (
          <div className={`phase-card ${phase.ready ? 'ready' : 'todo'}`} key={phase.number}>
            <span>{phase.number}</span>
            <StatusPill tone={phase.ready ? 'success' : 'neutral'}>{phase.ready ? 'Ready' : 'Next'}</StatusPill>
            <h3>{phase.title}</h3>
            <p>{phase.detail}</p>
            <small>{phase.ready ? 'Completed for at least one integration.' : phase.next}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductionReadinessChecklist({ state }: { state: PortalState }) {
  const services = state.snapshot?.services || [];
  const applications = state.snapshot?.applications || [];
  const webhookDeliveries = state.snapshot?.webhookDeliveries || [];
  const liveServices = services.filter((service) => arrayValue(service, 'environments').includes('live'));
  const targetService = liveServices[0] || services[0];
  const browserOrigins = targetService ? arrayValue(targetService, 'browserOrigins', 'browser_origins') : [];
  const redirectUrls = targetService ? arrayValue(targetService, 'redirectUrls', 'redirect_urls') : [];
  const webhookUrls = targetService ? arrayValue(targetService, 'webhookUrls', 'webhook_urls') : [];
  const metadata = objectValue(targetService?.metadata);
  const verifiedDomains = arrayValue(objectValue(metadata.domainVerification), 'verifiedDomains', 'verified_domains')
    .map((item) => item.toLowerCase());
  const requiredDomains = uniqueStrings([
    ...browserOrigins.map(hostnameFromUrl),
    ...redirectUrls.map(hostnameFromUrl),
    ...webhookUrls.map(hostnameFromUrl),
  ].filter(Boolean));
  const liveRequest = applications.some((app) => arrayValue(app, 'requestedEnvironments', 'requested_environments').includes('live'));
  const checklist = [
    {
      title: 'Sandbox integration created',
      ready: services.some((service) => arrayValue(service, 'environments').includes('sandbox')) || applications.length > 0,
      detail: 'Create an app and test before live.',
    },
    {
      title: 'Production request submitted',
      ready: liveRequest || liveServices.length > 0,
      detail: 'Submit business name, domain, return URL, and payment update URL.',
    },
    {
      title: 'Domains verified',
      ready: requiredDomains.length > 0 && requiredDomains.every((domain) => verifiedDomains.includes(domain)),
      detail: requiredDomains.length ? requiredDomains.join(', ') : 'Add live website, return, and payment update domains.',
    },
    {
      title: 'Live keys active',
      ready: liveServices.some((service) => String(valueOf(service, 'keyStatus', 'key_status') || '').toLowerCase() === 'active'),
      detail: 'Keys are shown once. Store them server-side only.',
    },
    {
      title: 'Payment update tested',
      ready: webhookDeliveries.some((delivery) => String(delivery.status || '').toLowerCase() === 'delivered'),
      detail: 'Use verified webhooks as payment truth.',
    },
  ];

  return (
    <div className="panel wide-panel production-readiness">
      <div className="phase-panel-head">
        <div>
          <p className="eyebrow">Production readiness</p>
          <h2>Go live only when every safety check is green.</h2>
          <p>This checklist is based on your real integration state, not manual notes.</p>
        </div>
        <StatusPill tone={checklist.every((item) => item.ready) ? 'success' : 'warning'}>
          {checklist.every((item) => item.ready) ? 'Ready to launch' : 'Action needed'}
        </StatusPill>
      </div>
      <div className="readiness-list">
        {checklist.map((item) => (
          <div className={item.ready ? 'ready' : 'todo'} key={item.title}>
            {item.ready ? <Check size={18} /> : <AlertTriangle size={18} />}
            <div>
              <strong>{item.title}</strong>
              <span>{item.detail}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SandboxAccountRow({ account }: { account: SandboxAccount }) {
  const amount = Number(account.balance || 0);
  return (
    <div>
      <div>
        <strong>{String(account.name || account.id || 'Sandbox account')}</strong>
        <span>{String(account.id || '-')} · {String(account.role || 'test')}</span>
      </div>
      <b>{Number.isFinite(amount) ? money.format(amount) : String(account.balance || '-')}</b>
    </div>
  );
}

function SandboxIntegrationWizard({ config, refresh }: { config: PortalConfig; refresh: () => void }) {
  const [displayName, setDisplayName] = useState('');
  const [contactEmail, setContactEmail] = useState(readStoredPortalSession()?.user.email || '');
  const [businessType, setBusinessType] = useState('merchant');
  const [websiteOrigin, setWebsiteOrigin] = useState('http://localhost:3000');
  const [redirectUrl, setRedirectUrl] = useState('http://localhost:3000/orbi/return');
  const [webhookUrl, setWebhookUrl] = useState('http://localhost:3000/api/orbi/webhooks');
  const [useCase, setUseCase] = useState('Build and test ORBI Pay checkout in sandbox.');
  const [message, setMessage] = useState<string>();
  const [credentials, setCredentials] = useState<Record<string, unknown>>();
  const [working, setWorking] = useState(false);

  const createSandboxIntegration = async () => {
    if (!displayName.trim()) {
      setMessage('Enter your integration or business name.');
      return;
    }
    if (!contactEmail.includes('@')) {
      setMessage('Enter a working contact email.');
      return;
    }
    setWorking(true);
    setMessage(undefined);
    setCredentials(undefined);
    const result = await gatewayRequest<Record<string, unknown>>(config, '/v1/developer/service-applications', 'operator', {
      method: 'POST',
      body: JSON.stringify({
        legalName: displayName.trim(),
        displayName: displayName.trim(),
        contactEmail: contactEmail.trim(),
        businessType,
        countryCode: 'TZ',
        requestedEnvironments: ['sandbox'],
        requestedScopes: ['identity:resolve', 'payment_profile:create', 'payments:create', 'escrow:create', 'webhooks:receive'],
        browserOrigins: websiteOrigin.trim() ? [websiteOrigin.trim()] : [],
        redirectUrls: redirectUrl.trim() ? [redirectUrl.trim()] : [],
        webhookUrls: webhookUrl.trim() ? [webhookUrl.trim()] : [],
        useCases: [useCase.trim() || 'Sandbox ORBI Pay integration testing.'],
        termsAccepted: true,
        metadata: {
          requested_from: 'developer_portal_sandbox_wizard',
          onboarding_mode: 'sandbox_auto_provision',
        },
      }),
    });
    setWorking(false);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    const data = result.data || {};
    setCredentials((data as { credentials?: Record<string, unknown> }).credentials || {});
    setMessage('Sandbox integration created. Copy your keys now and store them safely.');
    refresh();
  };

  return (
    <div className="panel wide-panel production-request">
      <div>
        <p className="eyebrow">Sandbox onboarding</p>
        <h2>Create your first integration</h2>
        <p>
          Create a sandbox app, get test credentials, and start building with ORBI SDKs. Sandbox keys cannot process real customer money.
        </p>
      </div>
      <div className="form-grid">
        <label>Integration name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Tag POS Sandbox" /></label>
        <label>Contact email<input value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} placeholder="dev@company.com" /></label>
        <label>
          Business type
          <select value={businessType} onChange={(event) => setBusinessType(event.target.value)}>
            <option value="merchant">Merchant / POS</option>
            <option value="marketplace">Marketplace</option>
            <option value="saccos">SACCOS</option>
            <option value="organization">Organization</option>
            <option value="agent_network">Agent network</option>
            <option value="platform">Platform</option>
          </select>
        </label>
        <label>Website origin<input value={websiteOrigin} onChange={(event) => setWebsiteOrigin(event.target.value)} placeholder="http://localhost:3000" /></label>
        <label>Return URL<input value={redirectUrl} onChange={(event) => setRedirectUrl(event.target.value)} placeholder="http://localhost:3000/orbi/return" /></label>
        <label>Payment update URL<input value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="http://localhost:3000/api/orbi/webhooks" /></label>
      </div>
      <label>
        What are you testing?
        <textarea value={useCase} onChange={(event) => setUseCase(event.target.value)} rows={3} />
      </label>
      <button className="button-primary inline-link" onClick={createSandboxIntegration} disabled={working || !displayName.trim()}>
        {working ? 'Creating sandbox app' : 'Create sandbox app'} <ArrowRight size={16} />
      </button>
      {message && <div className="inline-message">{message}</div>}
      {credentials && (
        <SecretCodePanel
          title="Copy these sandbox keys now"
          subtitle="They will not be shown again after you leave this screen."
          metadata={[
            { label: 'Environment', value: credentials.environment || 'sandbox' },
            { label: 'API key id', value: objectValue(credentials.apiKey).keyId, masked: true },
            { label: 'Webhook key id', value: objectValue(credentials.webhookSecret).secretId, masked: true },
          ]}
          rows={[
            { label: 'ORBI_PAY_SERVICE_KEY', value: credentials.apiKeySecret },
            { label: 'ORBI_PAY_WEBHOOK_SECRET', value: credentials.webhookSigningSecret },
          ]}
        />
      )}
    </div>
  );
}

function ProductionAccessRequest({ config, refresh }: { config: PortalConfig; refresh: () => void }) {
  const [displayName, setDisplayName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [websiteOrigin, setWebsiteOrigin] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [redirectUrl, setRedirectUrl] = useState('');
  const [message, setMessage] = useState<string>();
  const [working, setWorking] = useState(false);

  const requestLiveAccess = async () => {
    const validationError = validateProductionRequest({
      displayName,
      contactEmail,
      websiteOrigin,
      redirectUrl,
      webhookUrl,
    });
    if (validationError) {
      setMessage(validationError);
      return;
    }

    setWorking(true);
    setMessage(undefined);
    const result = await gatewayRequest(config, '/v1/developer/service-applications', 'operator', {
      method: 'POST',
      body: JSON.stringify({
        legalName: displayName.trim(),
        displayName: displayName.trim(),
        contactEmail: contactEmail.trim(),
        businessType: 'merchant',
        countryCode: 'TZ',
        requestedEnvironments: ['live'],
        requestedScopes: ['identity:resolve', 'payments:create', 'escrow:create', 'webhooks:receive'],
        browserOrigins: websiteOrigin.trim() ? [websiteOrigin.trim()] : [],
        redirectUrls: redirectUrl.trim() ? [redirectUrl.trim()] : [],
        webhookUrls: webhookUrl.trim() ? [webhookUrl.trim()] : [],
        useCases: ['Production ORBI Pay integration request from Developer Portal.'],
        termsAccepted: true,
        metadata: {
          requested_from: 'developer_portal',
          requester_role: 'developer',
          live_readiness_note: 'Developer supplied trusted website, return URL, and payment update URL for review.',
        },
      }),
    });
    setMessage(result.ok ? 'Request sent. ORBI will review your business, domains, and requested payment features before live keys are issued.' : result.error);
    setWorking(false);
    if (result.ok) refresh();
  };

  return (
    <div className="panel wide-panel production-request">
      <div>
        <p className="eyebrow">Go live request</p>
        <h2>Request Production Access</h2>
        <p>
          Build safely in sandbox first. For live payments, tell ORBI where your website runs, where customers return
          after payment, and where payment updates should be sent.
        </p>
      </div>
      <div className="form-grid">
        <label>Business / integration name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Merchant Checkout" /></label>
        <label>Contact email<input value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} placeholder="ops@merchant.example" /></label>
        <label>Website domain<input value={websiteOrigin} onChange={(event) => setWebsiteOrigin(event.target.value)} placeholder="https://www.tag.co.tz" /></label>
        <label>Customer return URL<input value={redirectUrl} onChange={(event) => setRedirectUrl(event.target.value)} placeholder="https://merchant.example.com/orbi/return" /></label>
        <label>Payment update URL<input value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://merchant.example.com/api/orbi/updates" /></label>
      </div>
      <p className="security-note">
        Use public HTTPS URLs only. Localhost, private IPs, plain HTTP, and wildcard domains are allowed only in sandbox.
      </p>
      <button className="button-primary inline-link" onClick={requestLiveAccess} disabled={working || !displayName || !contactEmail || !websiteOrigin || !redirectUrl || !webhookUrl}>
        {working ? 'Submitting' : 'Submit production request'} <ArrowRight size={16} />
      </button>
      {message && <div className="inline-message">{message}</div>}
    </div>
  );
}

function validateProductionRequest(input: {
  displayName: string;
  contactEmail: string;
  websiteOrigin: string;
  redirectUrl: string;
  webhookUrl: string;
}): string | undefined {
  if (!input.displayName.trim()) return 'Enter your business or integration name.';
  if (!input.contactEmail.trim().includes('@')) return 'Enter a working contact email.';
  if (!isPublicHttpsUrl(input.websiteOrigin, true)) return 'Website domain must be a public HTTPS origin, for example https://www.tag.co.tz.';
  if (!isPublicHttpsUrl(input.redirectUrl)) return 'Customer return URL must be a public HTTPS URL.';
  if (!isPublicHttpsUrl(input.webhookUrl)) return 'Payment update URL must be a public HTTPS URL.';
  return undefined;
}

function isPublicHttpsUrl(value: string, originOnly = false): boolean {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:') return false;
    if (!url.hostname.includes('.')) return false;
    if (['localhost', '127.0.0.1', '0.0.0.0'].includes(url.hostname)) return false;
    if (/^(10|172\.(1[6-9]|2\d|3[0-1])|192\.168)\./.test(url.hostname)) return false;
    if (url.hostname.includes('*')) return false;
    if (originOnly && (url.pathname !== '/' || url.search || url.hash)) return false;
    return true;
  } catch {
    return false;
  }
}

function KeysAndSecrets({
  config,
  state,
  refresh,
  openKeyModal,
  role,
}: {
  config: PortalConfig;
  state: PortalState;
  refresh: () => void;
  openKeyModal: () => void;
  role: PortalRole;
}) {
  const services = state.snapshot?.services || [];
  const canCreateKeys = roleCanManageServices(role);
  const keyReady = services.filter((service) => String(valueOf(service, 'keyStatus', 'key_status') || '').toLowerCase().includes('active')).length;
  const updateKeyReady = services.filter((service) => String(valueOf(service, 'webhookSecretStatus', 'webhook_secret_status') || '').toLowerCase().includes('active')).length;
  const liveReady = services.filter((service) => arrayValue(service, 'environments').includes('live')).length;

  return (
    <div className="stack">
      <div className="panel wide-panel key-safety-panel">
        <div>
          <p className="eyebrow">Key lifecycle</p>
          <h2>Protect your integration credentials.</h2>
          <p>
            Keys are shown once only. Store them in a server secret manager, rotate them safely,
            and revoke exposed credentials immediately.
          </p>
        </div>
        <div className="key-rule-grid">
          <div><strong>Server-side only</strong><span>Never expose keys in browser or mobile apps.</span></div>
          <div><strong>One-time reveal</strong><span>Copy new secrets immediately after issue or rotation.</span></div>
          <div><strong>Audited rotation</strong><span>Every key action requires a reason and is logged.</span></div>
        </div>
      </div>
      <div className="credential-readiness-grid">
        <MetricCard label="API keys ready" value={`${keyReady}/${services.length || 0}`} tone={keyReady === services.length && services.length ? 'success' : 'warning'} detail="Integrations with an active server key" />
        <MetricCard label="Update keys ready" value={`${updateKeyReady}/${services.length || 0}`} tone={updateKeyReady === services.length && services.length ? 'success' : 'warning'} detail="Integrations with signed webhook updates" />
        <MetricCard label="Production enabled" value={String(liveReady)} tone={liveReady ? 'success' : 'info'} detail="Integrations allowed to use live credentials" />
      </div>
      <div className="panel wide-panel">
        <PanelHeader title="Integration Keys" action={canCreateKeys ? 'Create key' : undefined} onAction={canCreateKeys ? openKeyModal : undefined} />
        <DataTable
          columns={['Integration', 'Status', 'API key', 'Payment update key', 'Environments', 'Actions']}
          rows={services.map((service) => [
            String(service.serviceCode || service.code || '-'),
            <StatusPill tone={toneFromStatus(service.status)}>{String(service.status || 'unknown')}</StatusPill>,
            String(valueOf(service, 'keyStatus', 'key_status') || 'Not available'),
            String(valueOf(service, 'webhookSecretStatus', 'webhook_secret_status') || 'Not available'),
            arrayValue(service, 'environments').join(', ') || '-',
            <SecretActions config={config} serviceCode={String(service.serviceCode || service.code || '')} refresh={refresh} role={role} />,
          ])}
          empty="No integration keys yet."
        />
        <p className="security-note">
          Treat ORBI keys like bank credentials. They are shown once only. Store them in your server secret manager or protected
          environment variables, never in browser code, mobile apps, Git, logs, screenshots, chat messages, or shared documents.
          If a key is exposed, rotate it immediately.
        </p>
      </div>
    </div>
  );
}

function TeamAccess({ config, state, refresh }: { config: PortalConfig; state: PortalState; refresh: () => void }) {
  const users = state.snapshot?.portalUsers || [];
  const invitations = state.snapshot?.portalTeamInvitations || [];
  const audit = state.snapshot?.portalAudit || [];
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'developer' | 'operator' | 'admin'>('developer');
  const [password, setPassword] = useState('');
  const [serviceCodes, setServiceCodes] = useState('');
  const [inviteResult, setInviteResult] = useState<Record<string, unknown>>();
  const [mfaRequired, setMfaRequired] = useState(true);
  const [liveAccess, setLiveAccess] = useState(false);
  const [message, setMessage] = useState<string>();
  const [working, setWorking] = useState(false);

  const loadOwnMfa = async () => {
    setMessage(undefined);
    try {
      const response = await fetch(`${config.bffBaseUrl}/auth/mfa-action`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(config.sessionToken ? { Authorization: `Bearer ${config.sessionToken}` } : {}),
        },
        body: JSON.stringify({ action: 'status', environment: config.environment }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(String(body?.error || `MFA setup failed with HTTP ${response.status}`));
        return;
      }
      setMessage(`MFA status: ${String(body?.data?.status || 'not configured')}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load authenticator setup.');
    }
  };

  const inviteUser = async () => {
    setWorking(true);
    setMessage(undefined);
    setInviteResult(undefined);
    try {
      const url = new URL(`${config.bffBaseUrl}/team-invitations`, window.location.origin);
      url.searchParams.set('environment', config.environment);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(config.sessionToken ? { Authorization: `Bearer ${config.sessionToken}` } : {}),
          'x-orbi-portal-confirmation': 'true',
          'x-orbi-portal-reason': `Invite ${email} to Developer Portal team access.`,
        },
        body: JSON.stringify({
          email,
          name,
          role,
          mfaRequired,
          liveAccess,
          serviceCodes: serviceCodes.split(',').map((item) => item.trim()).filter(Boolean),
          inviteUrl: `${portalPublicOrigin()}/?invite_token={token}`,
        }),
      });
      const body = await response.json().catch(() => null);
      const data = body?.data || body;
      setMessage(response.ok ? 'Invitation created. The staff member should accept it and set their own password.' : String(body?.error || `Invite failed with HTTP ${response.status}`));
      if (response.ok) {
        setInviteResult(data);
        setEmail('');
        setName('');
        setPassword('');
        setServiceCodes('');
        refresh();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to invite portal staff.');
    } finally {
      setWorking(false);
    }
  };

  const revokeInvite = async (invite: PortalTeamInvitation) => {
    const invitationId = String(invite.invitationId || '');
    if (!invitationId) return;
    const reason = window.prompt(`Why are you revoking the invitation for ${invite.email}?`);
    if (!reason?.trim() || reason.trim().length < 10) {
      setMessage('Add a clear reason with at least 10 characters.');
      return;
    }
    setWorking(true);
    setMessage(undefined);
    try {
      const url = new URL(`${config.bffBaseUrl}/team-invitations/${encodeURIComponent(invitationId)}/revoke`, window.location.origin);
      url.searchParams.set('environment', config.environment);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(config.sessionToken ? { Authorization: `Bearer ${config.sessionToken}` } : {}),
          'x-orbi-portal-confirmation': 'true',
          'x-orbi-portal-reason': reason.trim(),
        },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const body = await response.json().catch(() => null);
      setMessage(response.ok ? 'Invitation revoked.' : String(body?.error || `Revoke failed with HTTP ${response.status}`));
      if (response.ok) refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to revoke invitation.');
    } finally {
      setWorking(false);
    }
  };

  const createUser = async () => {
    setWorking(true);
    setMessage(undefined);
    try {
      const url = new URL(`${config.bffBaseUrl}/users`, window.location.origin);
      url.searchParams.set('environment', config.environment);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(config.sessionToken ? { Authorization: `Bearer ${config.sessionToken}` } : {}),
        },
        body: JSON.stringify({
          email,
          name,
          role,
          password,
          mfaRequired,
          liveAccess,
          serviceCodes: serviceCodes.split(',').map((item) => item.trim()).filter(Boolean),
        }),
      });
      const body = await response.json().catch(() => null);
      setMessage(response.ok ? 'Portal account created.' : String(body?.error || `Request failed with HTTP ${response.status}`));
      if (response.ok) {
        setEmail('');
        setName('');
        setPassword('');
        setServiceCodes('');
        refresh();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create portal account.');
    } finally {
      setWorking(false);
    }
  };

  const updateUserStatus = async (user: PortalUser, enabled: boolean) => {
    if (!user.userId) return;
    const reason = window.prompt(
      enabled
        ? `Why are you restoring access for ${user.email}?`
        : `Why are you suspending access for ${user.email}?`,
    );
    if (!reason?.trim() || reason.trim().length < 10) {
      setMessage('Add a clear reason with at least 10 characters.');
      return;
    }
    if (!window.confirm(`${enabled ? 'Restore' : 'Suspend'} portal access for ${user.email}?\n\nThis action is audited.`)) return;
    setWorking(true);
    setMessage(undefined);
    try {
      const url = new URL(`${config.bffBaseUrl}/users/${encodeURIComponent(user.userId)}`, window.location.origin);
      url.searchParams.set('environment', config.environment);
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(config.sessionToken ? { Authorization: `Bearer ${config.sessionToken}` } : {}),
          'x-orbi-portal-confirmation': 'true',
          'x-orbi-portal-reason': reason.trim(),
        },
        body: JSON.stringify({
          name: user.name,
          role: user.role,
          permissions: user.permissions || [],
          liveAccess: Boolean(user.liveAccess),
          serviceCodes: user.serviceCodes || [],
          mfaRequired: Boolean(user.mfaRequired),
          enabled,
        }),
      });
      const body = await response.json().catch(() => null);
      const error = String(body?.error || `Update failed with HTTP ${response.status}`);
      if (response.status === 403 && /fresh mfa|required.*mfa|mfa.*required/i.test(error)) {
        window.dispatchEvent(new CustomEvent('orbi-mfa-step-up-required'));
        setMessage('Verify your authenticator code, then retry the access change.');
      } else {
        setMessage(response.ok ? `Portal access ${enabled ? 'restored' : 'suspended'} for ${user.email}.` : error);
      }
      if (response.ok) refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update portal access.');
    } finally {
      setWorking(false);
    }
  };

  const resetMfa = async (user: PortalUser) => {
    if (!user.userId) return;
    const reason = window.prompt(`Why are you resetting MFA for ${user.email}?`);
    if (!reason?.trim()) return;
    if (!window.confirm(`This will revoke every active session for ${user.email} and require a new authenticator setup.\n\nContinue?`)) return;
    setWorking(true);
    setMessage(undefined);
    try {
      const url = new URL(`${config.bffBaseUrl}/users/${encodeURIComponent(user.userId)}`, window.location.origin);
      url.searchParams.set('environment', config.environment);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(config.sessionToken ? { Authorization: `Bearer ${config.sessionToken}` } : {}),
        },
        body: JSON.stringify({
          action: 'reset_mfa',
          reason: reason.trim(),
          confirmationAccepted: true,
        }),
      });
      const body = await response.json().catch(() => null);
      const error = String(body?.error || `Reset failed with HTTP ${response.status}`);
      if (response.status === 403 && /fresh mfa|required.*mfa|mfa.*required/i.test(error)) {
        window.dispatchEvent(new CustomEvent('orbi-mfa-step-up-required'));
        setMessage('Verify your authenticator code, then retry the MFA reset.');
      } else {
        setMessage(response.ok ? `MFA reset completed for ${user.email}.` : error);
      }
      if (response.ok) refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to reset MFA.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="stack">
      <div className="panel wide-panel">
        <PanelHeader title="Portal Team Access" />
        <p className="security-note">
          Invite each staff member with their own login, role, integration codes, MFA, and audit trail. Do not share passwords across a team.
        </p>
        <div className="form-grid">
          <label>Name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Jane Operator" /></label>
          <label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="jane@company.com" /></label>
          <label>
            Role
            <select value={role} onChange={(event) => setRole(event.target.value as 'developer' | 'operator' | 'admin')}>
              <option value="developer">Developer</option>
              <option value="operator">Operator</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <PasswordField value={password} onChange={setPassword} label="Password" placeholder="Minimum 12 characters" autoComplete="new-password" />
          <label>
            Integration codes
            <input value={serviceCodes} onChange={(event) => setServiceCodes(event.target.value)} placeholder="service_a, service_b" />
          </label>
        </div>
        <div className="toggle-row">
          <label><input type="checkbox" checked={mfaRequired} onChange={(event) => setMfaRequired(event.target.checked)} /> Require MFA</label>
          <label><input type="checkbox" checked={liveAccess} onChange={(event) => setLiveAccess(event.target.checked)} /> Live access</label>
        </div>
        <div className="row-actions">
        <button className="button-primary inline-link" disabled={working || !email || !name || (role === 'developer' && !serviceCodes.trim())} onClick={inviteUser}>
          {working ? 'Inviting' : 'Invite staff'}
        </button>
        <button className="ghost-action inline-link" disabled={working || !email || !password || !name} onClick={createUser}>
          Create account directly
        </button>
        <button className="ghost-action inline-link" onClick={loadOwnMfa}>Check my MFA status</button>
        </div>
        {message && <div className="inline-message">{message}</div>}
        {inviteResult && (
          <SecretCodePanel
            compact
            title="Invitation link"
            subtitle="Send only through an approved secure channel if email delivery did not reach the staff member."
            metadata={[
              { label: 'Delivery', value: inviteResult.deliveryStatus || 'created' },
              { label: 'Expires', value: objectValue(inviteResult.invitation).expiresAt },
            ]}
            rows={[{ label: 'ORBI_PORTAL_INVITE_URL', value: inviteResult.inviteUrl }]}
          />
        )}
      </div>

      <div className="panel wide-panel">
        <PanelHeader title="Pending Team Invitations" />
        <DataTable
          columns={['Email', 'Role', 'Integrations', 'Status', 'Expires', 'Action']}
          rows={invitations.map((invite) => [
            String(invite.email || '-'),
            <StatusPill tone={invite.role === 'admin' ? 'danger' : invite.role === 'operator' ? 'warning' : 'info'}>{String(invite.role || 'developer')}</StatusPill>,
            arrayValue(invite, 'serviceCodes', 'service_codes').join(', ') || '-',
            <StatusPill tone={toneFromStatus(invite.status)}>{String(invite.status || 'pending')}</StatusPill>,
            invite.expiresAt ? new Date(String(invite.expiresAt)).toLocaleString() : '-',
            <button
              className="mini-link danger-link"
              disabled={working || String(invite.status || '') !== 'pending'}
              onClick={() => revokeInvite(invite)}
            >
              Revoke
            </button>,
          ])}
          empty="No team invitations yet."
        />
      </div>

      <div className="panel wide-panel">
        <PanelHeader title="Active Portal Users" />
        <DataTable
          columns={['Name', 'Email', 'Role', 'Integrations', 'MFA', 'Live', 'Status', 'Security']}
          rows={users.map((user) => [
            String(user.name || '-'),
            String(user.email || '-'),
            <StatusPill tone={user.role === 'admin' ? 'danger' : user.role === 'operator' ? 'warning' : 'info'}>{String(user.role || 'developer')}</StatusPill>,
            arrayValue(user, 'serviceCodes', 'service_codes').join(', ') || 'All allowed by role',
            user.mfaRequired ? 'Required' : 'Not required',
            user.liveAccess ? 'Enabled' : 'Sandbox only',
            user.enabled === false ? 'Disabled' : 'Enabled',
            <div className="row-actions">
              <button
                className="mini-link"
                disabled={working || !user.mfaRequired || user.email === readStoredPortalSession()?.user.email}
                onClick={() => resetMfa(user)}
              >
                Reset MFA
              </button>
              <button
                className={`mini-link ${user.enabled === false ? '' : 'danger-link'}`}
                disabled={working || user.email === readStoredPortalSession()?.user.email}
                onClick={() => updateUserStatus(user, user.enabled === false)}
              >
                {user.enabled === false ? 'Restore' : 'Suspend'}
              </button>
            </div>,
          ])}
          empty="No portal users returned. Team access is managed by approved ORBI administrators."
        />
      </div>

      <div className="panel wide-panel">
        <PanelHeader title="Admin Audit Trail" />
        <DataTable
          columns={['Time', 'Actor', 'Action', 'Target', 'Environment']}
          rows={audit.map((event) => [
            event.createdAt ? new Date(String(event.createdAt)).toLocaleString() : '-',
            String(event.actorEmail || '-'),
            String(event.action || '-'),
            String(event.target || '-'),
            String(event.environment || '-'),
          ])}
          empty="No admin audit events yet."
        />
      </div>
    </div>
  );
}

function AuthenticatorQr({ setup }: { setup: { otpauthUri: string; secret: string } }) {
  return (
    <div className="qr-setup">
      <div className="qr-box">
        <QRCodeSVG value={setup.otpauthUri} size={168} level="M" includeMargin />
      </div>
      <div>
        <h3>Scan with Authenticator</h3>
        <p>Open Google Authenticator, Microsoft Authenticator, Authy, 2FAS, or Aegis and scan this QR code.</p>
        <Copyable value={setup.secret} />
        <small>Use the manual key only if QR scan is not available.</small>
      </div>
    </div>
  );
}

function MfaEnrollmentModal({
  config,
  onCompleted,
  onSignOut,
}: {
  config: PortalConfig;
  onCompleted: (session: PortalSession) => void;
  onSignOut: () => void;
}) {
  const [setup, setSetup] = useState<MfaEnrollmentSetup>();
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>();
  const [verifiedSession, setVerifiedSession] = useState<PortalSession>();
  const [message, setMessage] = useState<string>();
  const [working, setWorking] = useState(false);

  const begin = async () => {
    setWorking(true);
    setMessage(undefined);
    const result = await startPortalMfaEnrollment(config);
    setWorking(false);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setSetup(result.data);
  };

  const verify = async () => {
    setWorking(true);
    setMessage(undefined);
    const result = await verifyPortalMfaEnrollment(config, code);
    setWorking(false);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setRecoveryCodes(result.data.recoveryCodes);
    setVerifiedSession({
      token: result.data.token,
      user: result.data.user,
      expiresAt: result.data.expiresAt,
    });
  };

  const downloadRecoveryCodes = () => {
    if (!recoveryCodes?.length) return;
    const content = [
      'ORBI Pay Developer Portal recovery codes',
      'Save these one-time recovery codes now. ORBI will not show them again.',
      '',
      ...recoveryCodes,
      '',
      'Keep this file in a password manager or encrypted offline storage.',
    ].join('\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'orbi-pay-recovery-codes.txt';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="modal-backdrop mfa-enrollment-backdrop" role="dialog" aria-modal="true" aria-labelledby="mfa-enrollment-title">
      <div className="modal-card mfa-enrollment-card">
        <p className="eyebrow">Account security</p>
        <h2 id="mfa-enrollment-title">Protect your ORBI account</h2>
        <p className="modal-copy">
          Your role requires multi-factor authentication. Set up an authenticator before accessing protected portal actions.
        </p>
        {recoveryCodes && verifiedSession ? (
          <div className="recovery-codes-panel">
            <div className="recovery-warning">
              <AlertTriangle size={18} />
              <p>Save these one-time recovery codes now to enable download as txt file. ORBI will not show them again.</p>
            </div>
            <div className="recovery-code-grid">
              {recoveryCodes.map((recoveryCode) => <code key={recoveryCode}>{recoveryCode}</code>)}
            </div>
            <Copyable value={recoveryCodes.join('\n')} />
            <button className="button-secondary full" onClick={downloadRecoveryCodes}>
              Download recovery codes (.txt)
            </button>
            <p className="security-note">Keep them in a password manager or encrypted offline storage. Never send them by email or chat.</p>
            <button className="button-primary full" onClick={() => onCompleted(verifiedSession)}>
              I saved my recovery codes
            </button>
          </div>
        ) : !setup ? (
          <div className="mfa-enrollment-intro">
            <div className="security-step"><span>1</span><p>Install Google Authenticator, Microsoft Authenticator, 2FAS, Authy, or Aegis.</p></div>
            <div className="security-step"><span>2</span><p>Scan the secure QR code generated for this account.</p></div>
            <div className="security-step"><span>3</span><p>Enter the current 6-digit code to activate MFA.</p></div>
            <button className="button-primary full" onClick={begin} disabled={working}>
              {working ? 'Preparing secure setup' : 'Set up authenticator'}
            </button>
          </div>
        ) : (
          <>
            <AuthenticatorQr setup={setup} />
            <label>
              6-digit authenticator code
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
              />
            </label>
            <button className="button-primary full" onClick={verify} disabled={working || code.length !== 6}>
              {working ? 'Verifying' : 'Verify and continue'}
            </button>
          </>
        )}
        {message && <div className="inline-message danger">{message}</div>}
        <button className="mini-link mfa-signout" onClick={onSignOut}>Sign out and finish later</button>
      </div>
    </div>
  );
}

function MfaStepUpModal({
  config,
  onClose,
  onVerified,
}: {
  config: PortalConfig;
  onClose: () => void;
  onVerified: (session: PortalSession) => void;
}) {
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string>();
  const [working, setWorking] = useState(false);

  const verify = async () => {
    setWorking(true);
    setMessage(undefined);
    const result = await stepUpPortalMfa(config, code);
    setWorking(false);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    onVerified(result.data);
  };

  return (
    <div className="modal-backdrop mfa-enrollment-backdrop" role="dialog" aria-modal="true" aria-labelledby="mfa-step-up-title">
      <div className="modal-card auth-card">
        <button className="icon-button modal-close" onClick={onClose} aria-label="Close verification">
          <X size={20} />
        </button>
        <p className="eyebrow">Security check</p>
        <h2 id="mfa-step-up-title">Verify this sensitive action</h2>
        <p className="modal-copy">Enter a new code from your authenticator. Each code can be used only once.</p>
        <label>
          6-digit authenticator code
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
          />
        </label>
        <button className="button-primary full" onClick={verify} disabled={working || code.length !== 6}>
          {working ? 'Verifying' : 'Verify'}
        </button>
        {message && <div className="inline-message danger">{message}</div>}
      </div>
    </div>
  );
}

function SecretActions({ config, serviceCode, refresh, role }: { config: PortalConfig; serviceCode: string; refresh: () => void; role: PortalRole }) {
  const [message, setMessage] = useState<string>();
  const [oneTimeSecret, setOneTimeSecret] = useState<string>();
  const [working, setWorking] = useState(false);
  const canIssueSecrets = roleCanManageServices(role);
  const sessionEmail = readStoredPortalSession()?.user.email || 'developer';

  const call = async (path: string, body: Record<string, unknown>, success: string) => {
    const reason = String(body.reason || body.rotationReason || 'Controlled key action from Developer Portal.');
    if (!window.confirm(`${reason}\n\nContinue?`)) return;
    setWorking(true);
    setOneTimeSecret(undefined);
    const result = await gatewayRequest<Record<string, unknown>>(config, path, 'operator', {
      method: 'POST',
      portalConfirmationAccepted: true,
      portalReason: reason,
      body: JSON.stringify(body),
    });
    if (result.ok) {
      const secret = String(result.data?.oneTimeSecret || '');
      if (secret) setOneTimeSecret(secret);
      setMessage(success);
    } else {
      setMessage(result.error);
    }
    setWorking(false);
    if (result.ok) refresh();
  };

  const emergencyRotate = () => {
    const reason = window.prompt(
      'Why do you need emergency rotation?',
      'Suspected API key exposure. Rotate the integration key now.',
    );
    if (!reason?.trim() || reason.trim().length < 10) {
      setMessage('Add a clear reason before emergency rotation.');
      return;
    }
    const revokeNow = window.confirm(
      'If this key is exposed, revoke the old active key immediately.\n\nChoose OK to revoke now. Choose Cancel for a short cutover window.',
    );
    void call(`/v1/developer/services/${encodeURIComponent(serviceCode)}/api-keys/emergency-rotate`, {
      environment: config.environment,
      requestedBy: sessionEmail,
      reason: reason.trim(),
      exposureType: revokeNow ? 'confirmed_exposure' : 'suspected_exposure',
      revokePreviousImmediately: revokeNow,
      overlapMinutes: revokeNow ? 0 : config.environment === 'live' ? 15 : 30,
      metadata: {
        requestedFrom: 'developer_portal',
        action: 'emergency_api_key_rotation',
      },
    }, revokeNow
      ? 'Emergency key rotated. Old active key was revoked.'
      : 'Emergency key rotated. Old active key is in short cutover.');
  };

  return (
    <div className="row-actions">
      <button
        className="ghost-action"
        disabled={!serviceCode || working}
        onClick={() => call(`/v1/developer/services/${encodeURIComponent(serviceCode)}/api-key-rotations`, {
          environment: config.environment,
          requestedBy: sessionEmail,
          rotationReason: 'Routine controlled API key rotation from Developer Portal.',
        }, 'API key rotation requested.')}
      >
        Rotate key
      </button>
      <button
        className="ghost-action danger-action"
        disabled={!serviceCode || working}
        onClick={emergencyRotate}
      >
        Emergency rotate
      </button>
      {canIssueSecrets && (
        <button
          className="ghost-action"
          disabled={!serviceCode || working}
          onClick={() => call(`/v1/developer/services/${encodeURIComponent(serviceCode)}/webhook-secrets/issue`, {
            environment: config.environment,
            requestedBy: sessionEmail,
            reason: 'Issue webhook signing secret from Developer Portal.',
          }, 'Payment update key created.')}
        >
          Create update key
        </button>
      )}
      {oneTimeSecret && (
        <SecretCodePanel
          compact
          title="Copy this new key now"
          subtitle="It will not be shown again after you leave this screen."
          metadata={[{ label: 'Environment', value: config.environment }]}
          rows={[{ label: 'NEW_ORBI_SECRET', value: oneTimeSecret }]}
        />
      )}
      {message && <small>{message}</small>}
    </div>
  );
}

function DeveloperMessages({
  config,
  state,
  refresh,
  role,
  currentUser,
}: {
  config: PortalConfig;
  state: PortalState;
  refresh: () => void;
  role: PortalRole;
  currentUser?: PortalUser;
}) {
  const isStaff = roleCanManageServices(role);
  const users = state.snapshot?.portalUsers || [];
  const services = state.snapshot?.services || [];
  const deliveries = state.snapshot?.messagingDeliveries || [];
  const developerUsers = users.filter((user) => user.role === 'developer');
  const [recipient, setRecipient] = useState(developerUsers[0]?.email || '');
  const [channel, setChannel] = useState<'email' | 'sms' | 'push' | 'whatsapp' | 'in_app'>('email');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [reason, setReason] = useState('');
  const [selectedThreadId, setSelectedThreadId] = useState('');
  const [status, setStatus] = useState<string>();
  const [working, setWorking] = useState(false);
  const viewerEmail = currentUser?.email || readStoredPortalSession()?.user.email || '';
  const threads = groupMessageThreads(deliveries);
  const activeThread = threads.find((thread) => thread.threadId === selectedThreadId) || threads[0];
  const activeMessages = activeThread?.deliveries || [];

  useEffect(() => {
    if (!selectedThreadId && threads[0]?.threadId) setSelectedThreadId(threads[0].threadId);
  }, [selectedThreadId, threads]);

  useEffect(() => {
    if (!activeThread?.threadId || !viewerEmail) return;
    if (!activeThread.deliveries.some((delivery) => isUnreadMessageFor(delivery, viewerEmail))) return;
    void gatewayRequest(config, `/v1/developer/message-threads/${encodeURIComponent(activeThread.threadId)}/read`, isStaff ? 'operator' : 'none', {
      method: 'POST',
      body: JSON.stringify({ readBy: viewerEmail }),
    });
  }, [activeThread?.threadId, config.baseUrl, config.bffBaseUrl, config.environment, config.sessionToken, isStaff, viewerEmail]);

  const appendTag = (tag: string) => {
    const clean = tag.startsWith('@') ? tag : `@${tag}`;
    setBody((current) => `${current}${current && !current.endsWith(' ') ? ' ' : ''}${clean} `);
  };

  const sendMessage = async () => {
    setWorking(true);
    setStatus(undefined);
    const result = await gatewayRequest<Record<string, unknown>>(config, '/v1/developer/messages', isStaff ? 'operator' : 'none', {
      method: 'POST',
      portalReason: reason,
      body: JSON.stringify({
        recipientIdentityRef: isStaff ? recipient : 'orbi.developers@gmail.com',
        threadId: activeThread?.threadId,
        channel: isStaff ? channel : 'email',
        language: 'en',
        subject: subject.trim() || undefined,
        message: body,
        serviceCode: serviceCodeFromMessage(body, services),
        endpointTags: tagsFromDraft(body),
        reason,
      }),
    });
    setWorking(false);
    if (!result.ok) {
      setStatus(result.error);
      return;
    }
    setStatus(isStaff ? 'Message sent to developer.' : 'Message sent to ORBI IT/Admin.');
    setSubject('');
    setBody('');
    setReason('');
    refresh();
  };

  const canSend = body.trim().length >= 8 && reason.trim().length >= 10 && (!isStaff || recipient.trim().length >= 3);
  const endpointSuggestions = ['/v1/payment-intents', '/v1/paysafe/escrows', '/v1/developer/webhooks', '/v1/identity/resolve'];

  return (
    <div className="stack">
      <div className="panel wide-panel">
        <PanelHeader title={isStaff ? 'Developer Messaging Center' : 'ORBI Support Messages'} />
        <p className="section-copy">
          <StatusPill tone="info">{isStaff ? 'Staff controlled' : 'Support channel'}</StatusPill>{' '}
          {isStaff
            ? 'Send direct operational messages, reply inside threads, and tag integrations or endpoints with @context.'
            : 'Ask ORBI support about your integration, keys, payment updates, sandbox, or live access request.'}
        </p>

        <div className="message-center-grid">
          <div className="thread-list" aria-label="Message threads">
            {threads.length ? threads.map((thread) => {
              const latest = thread.deliveries[0];
              const unread = thread.deliveries.some((delivery) => isUnreadMessageFor(delivery, viewerEmail));
              return (
                <button
                  className={`thread-item ${thread.threadId === activeThread?.threadId ? 'active' : ''}`}
                  key={thread.threadId}
                  onClick={() => setSelectedThreadId(thread.threadId)}
                >
                  <span>{messageTitle(latest)}</span>
                  <small>{messageBody(latest) || String(latest.recipientIdentityRef || 'No preview')}</small>
                  <b>{formatShortDate(String(latest.createdAt || ''))}</b>
                  {unread ? <em>Unread</em> : null}
                </button>
              );
            }) : (
              <EmptyState title="No messages yet" detail="Start a thread when you need to contact a developer or ORBI support." />
            )}
          </div>

          <div className="conversation-panel">
            <div className="conversation-stream">
              {activeMessages.length ? activeMessages.slice().reverse().map((delivery) => {
                const sentBy = String(delivery.safeMetadata?.sentBy || 'ORBI').toLowerCase();
                const mine = viewerEmail && sentBy === viewerEmail.toLowerCase();
                return (
                  <div className={`message-bubble ${mine ? 'mine' : ''}`} key={delivery.deliveryId || delivery.eventId}>
                    <div className="message-meta">
                      <strong>{mine ? 'You' : String(delivery.safeMetadata?.sentBy || delivery.recipientIdentityRef || 'ORBI')}</strong>
                      <span>{formatShortDate(String(delivery.createdAt || ''))}</span>
                    </div>
                    {messageTitle(delivery) && <h4>{messageTitle(delivery)}</h4>}
                    <p>{messageBody(delivery) || 'Message body unavailable.'}</p>
                    <div className="message-foot">
                      <StatusPill tone={String(delivery.status || '').toLowerCase() === 'failed' ? 'danger' : 'success'}>{String(delivery.status || '-')}</StatusPill>
                      {delivery.serviceCode ? <small>@{String(delivery.serviceCode)}</small> : null}
                    </div>
                  </div>
                );
              }) : (
                <EmptyState title="Select a conversation" detail="Thread replies and delivery status will appear here." />
              )}
            </div>

            <div className="message-composer compact-composer">
              {isStaff ? (
                <label>
                  Developer
                  <select value={recipient} onChange={(event) => setRecipient(event.target.value)}>
                    <option value="">Select developer</option>
                    {developerUsers.map((user) => (
                      <option key={user.email} value={user.email}>
                        {user.name} - {user.email}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label>
                Channel
                <select value={channel} onChange={(event) => setChannel(event.target.value as typeof channel)} disabled={!isStaff}>
                  <option value="email">Email</option>
                  <option value="push">Push</option>
                  <option value="in_app">In-app</option>
                  <option value="sms">SMS</option>
                  <option value="whatsapp">WhatsApp</option>
                </select>
              </label>
              <label>
                Subject
                <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder={activeThread ? 'Reply subject' : 'Short, clear subject'} />
              </label>
              <label className="span-2">
                Message
                <textarea
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  rows={5}
                  placeholder={isStaff ? 'Write a helpful operational message. Example: Please review @orbi-shop webhook failures on @/v1/payment-intents.' : 'Explain what you need help with. Example: I need support with @/v1/payment-intents for @orbi-shop.'}
                />
              </label>
              <label className="span-2">
                Audit reason
                <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why this message is being sent" />
              </label>
            </div>

            <div className="tag-strip">
              {services.slice(0, 10).map((service) => {
                const code = String(service.serviceCode || service.code || '');
                return code ? <button key={code} type="button" onClick={() => appendTag(code)}>@{code}</button> : null;
              })}
              {endpointSuggestions.map((endpoint) => (
                <button key={endpoint} type="button" onClick={() => appendTag(endpoint)}>@{endpoint}</button>
              ))}
            </div>

            {status ? <p className="inline-status">{status}</p> : null}
            <div className="actions-row">
              <button className="primary-button" disabled={!canSend || working} onClick={sendMessage}>
                {working ? 'Sending...' : activeThread ? 'Reply' : isStaff ? 'Send message' : 'Send to ORBI support'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function groupMessageThreads(deliveries: MessagingDelivery[]) {
  const groups = new Map<string, MessagingDelivery[]>();
  for (const delivery of deliveries) {
    const threadId = messageThreadId(delivery);
    groups.set(threadId, [...(groups.get(threadId) || []), delivery]);
  }
  return [...groups.entries()].map(([threadId, items]) => ({
    threadId,
    deliveries: items.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))),
  })).sort((a, b) => String(b.deliveries[0]?.createdAt || '').localeCompare(String(a.deliveries[0]?.createdAt || '')));
}

function tagsFromDraft(value: string) {
  const matches = value.match(/@[A-Za-z0-9_.:/-]{2,120}/g) || [];
  return [...new Set(matches.map((tag) => tag.slice(1)))];
}

function serviceCodeFromMessage(value: string, services: ServiceRecord[]) {
  const tags = new Set(tagsFromDraft(value).map((tag) => tag.toLowerCase()));
  const match = services.find((service) => {
    const code = String(service.serviceCode || service.code || '').toLowerCase();
    return code && tags.has(code);
  });
  return match ? String(match.serviceCode || match.code) : undefined;
}

function ScopesAndConsent({ config, state, refresh, role }: { config: PortalConfig; state: PortalState; refresh: () => void; role: PortalRole }) {
  const scopes = state.snapshot?.consentScopes || [];
  return (
    <div className="panel wide-panel">
      <PanelHeader title="Customer Permissions" action="Request permission" />
      {scopes.length ? (
        <div className="scope-list">
          {scopes.map((scope, index) => {
            const title = objectValue(scope.title);
            const description = objectValue(scope.description);
            return (
              <div className="scope-card" key={String(scope.scope || index)}>
                <StatusPill tone={scope.riskLevel === 'high' ? 'danger' : 'info'}>
                  {scope.riskLevel === 'high' ? 'Approval required' : 'Standard'}
                </StatusPill>
                <div>
                  <h3>{String(title.en || scope.scope || 'Untitled permission')}</h3>
                  <p>{String(description.en || scope.description || 'Description not available.')}</p>
                  <small>{String(description.sw || 'Swahili description not available.')}</small>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState title="No permissions available" detail="Permissions will appear after ORBI publishes the approved catalog." />
      )}
      {['operator', 'admin'].includes(role) && (
        <ScopeDecisionQueue
          config={config}
          requests={state.snapshot?.scopeRequests || []}
          refresh={refresh}
        />
      )}
    </div>
  );
}

function ScopeDecisionQueue({
  config,
  requests,
  refresh,
}: {
  config: PortalConfig;
  requests: ScopeRequest[];
  refresh: () => void;
}) {
  const [message, setMessage] = useState<string>();
  const [working, setWorking] = useState<string>();
  const pendingRequests = requests.filter((request) => request.status === 'pending_review');

  const decide = async (request: ScopeRequest, decision: 'approve' | 'reject') => {
    const requestId = String(request.requestId || '');
    const reason = window.prompt(
      decision === 'approve' ? 'Why should these permissions be approved?' : 'Why should this request be rejected?',
    );
    if (!requestId || !reason?.trim() || reason.trim().length < 10) {
      setMessage('Add a clear review reason with at least 10 characters.');
      return;
    }
    const action = decision === 'approve' ? 'approve' : 'reject';
    if (!window.confirm(`You are about to ${action} this permission request. This action is audited.\n\nContinue?`)) return;
    setWorking(requestId);
    const result = await gatewayRequest(config, `/v1/developer/scope-requests/${encodeURIComponent(requestId)}/decision`, 'operator', {
      method: 'POST',
      portalConfirmationAccepted: true,
      portalReason: reason.trim(),
      body: JSON.stringify({
        decision,
        reason: reason.trim(),
      }),
    });
    setMessage(result.ok ? `Permission request ${decision === 'approve' ? 'approved' : 'rejected'}.` : result.error);
    setWorking(undefined);
    if (result.ok) refresh();
  };

  return (
    <div className="operator-form">
      <h3>Permission requests awaiting review</h3>
      <p className="security-note">
        Review only the requested capability, require a clear business reason, and reject anything that asks for more access than the integration needs.
      </p>
      {pendingRequests.length ? pendingRequests.map((request) => {
        const requestId = String(request.requestId || '');
        return (
          <div className="detail-card" key={requestId}>
            <div className="service-card-head">
              <div>
                <p className="mono">{String(request.serviceCode || '-')}</p>
                <h3>{(request.requestedScopes || []).join(', ')}</h3>
              </div>
              <StatusPill tone="warning">{String(request.environment || 'sandbox')}</StatusPill>
            </div>
            <p>{String(request.reason || 'No reason supplied.')}</p>
            <small>{request.submittedAt ? new Date(request.submittedAt).toLocaleString() : 'Time unavailable'}</small>
            <div className="row-actions">
              <button
                className="button-primary inline-link"
                disabled={working === requestId}
                onClick={() => void decide(request, 'approve')}
              >
                Approve
              </button>
              <button
                className="ghost-action danger-action"
                disabled={working === requestId}
                onClick={() => void decide(request, 'reject')}
              >
                Reject
              </button>
            </div>
          </div>
        );
      }) : (
        <EmptyState title="No permission requests awaiting review" detail="New developer requests will appear here." />
      )}
      {message && <div className="inline-message">{message}</div>}
    </div>
  );
}

function Webhooks({ config, state, refresh, role }: { config: PortalConfig; state: PortalState; refresh: () => void; role: PortalRole }) {
  const [replaying, setReplaying] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [statusFilter, setStatusFilter] = useState('all');
  const deliveries = state.snapshot?.webhookDeliveries || [];
  const messageDeliveries = state.snapshot?.messagingDeliveries || [];
  const filteredDeliveries = statusFilter === 'all'
    ? deliveries
    : deliveries.filter((delivery) => String(delivery.status || '').toLowerCase() === statusFilter);
  const failedCount = deliveries.filter((delivery) => String(delivery.status || '').toLowerCase() === 'failed').length;
  const deliveredCount = deliveries.filter((delivery) => String(delivery.status || '').toLowerCase() === 'delivered').length;

  const replay = async (deliveryId: string) => {
    const reason = `Replay webhook delivery ${deliveryId}.`;
    if (!window.confirm(`${reason}\n\nContinue?`)) return;
    setReplaying(deliveryId);
    const result = await gatewayRequest(config, `/v1/developer/webhook-deliveries/${encodeURIComponent(deliveryId)}/replay`, 'operator', {
      method: 'POST',
      portalConfirmationAccepted: true,
      portalReason: reason,
      body: JSON.stringify({ requestId: `portal-replay-${deliveryId}-${Date.now()}`, reason }),
    });
    setMessage(result.ok ? `Replay queued for ${deliveryId}.` : result.error);
    setReplaying(undefined);
    if (result.ok) refresh();
  };

  return (
    <div className="stack">
      <div className="panel wide-panel">
        <PanelHeader title="Payment Update Delivery" action="Refresh" onAction={refresh} />
        <div className="webhook-toolbar">
          <div>
            <strong>Verified payment updates</strong>
            <span>{deliveredCount} delivered · {failedCount} need attention</span>
          </div>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All updates</option>
            <option value="delivered">Delivered</option>
            <option value="failed">Failed</option>
            <option value="pending">Pending</option>
          </select>
        </div>
        {message && <div className="inline-message">{message}</div>}
        <DataTable
          columns={['Update ID', 'Type', 'Payment', 'Status', 'HTTP', 'Attempts', 'Action']}
          rows={filteredDeliveries.map((delivery) => {
            const deliveryId = String(delivery.deliveryId || delivery.id || '-');
            const status = String(delivery.status || '').toLowerCase();
            return [
              <Copyable value={deliveryId} />,
              String(delivery.eventType || '-'),
              String(delivery.resourceId || delivery.intentId || '-'),
              <StatusPill tone={toneFromStatus(delivery.status)}>{String(delivery.status || 'unknown')}</StatusPill>,
              String(delivery.httpStatus || delivery.statusCode || '-'),
              String(delivery.attempts || delivery.attempt || 0),
              <button className="ghost-action" disabled={deliveryId === '-' || status === 'delivered' || replaying === deliveryId} onClick={() => replay(deliveryId)}>
                <RotateCcw size={15} /> Replay
              </button>,
            ];
          })}
          empty={statusFilter === 'all' ? 'No payment updates yet.' : `No ${statusFilter} payment updates.`}
        />
      </div>

      {roleCanManageServices(role) && (
      <div className="panel wide-panel">
        <PanelHeader title="Security Message Delivery" action="Refresh" onAction={refresh} />
        <p className="security-note">
          Shows delivery evidence for safe ORBI Talk messages such as OTP, email confirmation, key rotation, PaySafe action,
          and webhook incident notices. Secrets and OTP values are never displayed here.
        </p>
        <DataTable
          columns={['Message ID', 'Template', 'Channel', 'Recipient', 'Status', 'Attempts']}
          rows={messageDeliveries.map((delivery) => [
            <Copyable value={String(delivery.deliveryId || '-')} />,
            String(delivery.templateCode || '-'),
            `${String(delivery.channel || '-')} · ${String(delivery.language || '-')}`,
            String(delivery.recipientIdentityRef || '-'),
            <StatusPill tone={toneFromStatus(delivery.status)}>{String(delivery.status || 'unknown')}</StatusPill>,
            String(delivery.attempt || 0),
          ])}
          empty="No security messages yet."
        />
      </div>
      )}
    </div>
  );
}

function Health({ state }: { state: PortalState }) {
  const health = state.snapshot?.integrationHealth;
  const items = Array.isArray(health) ? health : health ? [health] : [];
  return (
    <div className="panel wide-panel">
      <PanelHeader title="Integration Health" />
      {items.length ? (
        <div className="health-grid">
          {items.map((item, index) => {
            const record = objectValue(item);
            const warnings = arrayValue(record, 'warnings');
            return (
              <div className={`health-card ${warnings.length ? 'attention' : 'ready'}`} key={String(record.serviceCode || index)}>
                <div>
                  {warnings.length ? <AlertTriangle size={18} /> : <Check size={18} />}
                  <strong>{String(record.displayName || record.serviceCode || 'Gateway health')}</strong>
                </div>
                <p>{warnings.length ? warnings.join(', ') : 'No warnings returned.'}</p>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState title="No integration health returned" detail="Connect operator access to /v1/developer/integration-health." />
      )}
    </div>
  );
}

function OperatorIncidents({ config, state, refresh }: { config: PortalConfig; state: PortalState; refresh: () => void }) {
  const incidents = state.snapshot?.incidents || [];
  const openCount = incidents.filter((incident) => String(incident.status || '').toLowerCase() !== 'resolved').length;
  const highPriorityCount = incidents.filter((incident) => String(incident.severity || '').toLowerCase() === 'critical' && String(incident.status || '').toLowerCase() !== 'resolved').length;
  const escalatedCount = incidents.filter((incident) => Boolean(incident.escalatedAt) && String(incident.status || '').toLowerCase() !== 'resolved').length;

  return (
    <div className="stack">
      <div className="dashboard-grid">
        <MetricCard label="Needs attention" value={String(openCount)} tone={openCount ? 'danger' : 'success'} detail={openCount ? 'Review these before customers are affected.' : 'Everything is clear.'} />
        <MetricCard label="High priority" value={String(highPriorityCount)} tone={highPriorityCount ? 'danger' : 'success'} detail="Payment or account checks that need fast review." />
        <MetricCard label="Past target time" value={String(escalatedCount)} tone={escalatedCount ? 'warning' : 'success'} detail="Items that waited longer than the response target." />
        <MetricCard label="Fixed" value={String(incidents.length - openCount)} tone="info" detail="Closed by the support or operations team." />
      </div>

      <div className="panel wide-panel">
        <PanelHeader title="Service issues" action="Refresh" onAction={refresh} />
        {incidents.length ? (
          <div className="incident-list">
            {incidents.map((incident) => (
              <IncidentCard config={config} incident={incident} refresh={refresh} key={String(incident.incidentId)} />
            ))}
          </div>
        ) : (
          <EmptyState title="No service issues" detail="If a payment update, account check, or integration needs help, it will appear here." />
        )}
      </div>
    </div>
  );
}

function IncidentCard({ config, incident, refresh }: { config: PortalConfig; incident: OperatorIncident; refresh: () => void }) {
  const [message, setMessage] = useState<string>();
  const [working, setWorking] = useState<string>();
  const incidentId = String(incident.incidentId || '');
  const status = String(incident.status || 'open').toLowerCase();
  const severity = String(incident.severity || 'warning').toLowerCase();
  const resource = objectValue(incident.resource);
  const metadata = objectValue(incident.metadata);
  const runbook = incident.runbook || {};
  const runbookSteps = Array.isArray(runbook.steps) ? runbook.steps : [];
  const actorEmail = readStoredPortalSession()?.user.email || 'portal-operator';
  const statusLabel = incidentStatusLabel(status);
  const severityLabel = incidentSeverityLabel(severity);
  const incidentTitle = incidentTitleLabel(incident);
  const incidentMessage = incidentMessageLabel(incident);
  const responseTarget = incident.escalatedAt ? `Past target: ${new Date(String(incident.escalatedAt)).toLocaleString()}` : 'Within response target';

  const callIncidentAction = async (
    action: 'acknowledge' | 'assign' | 'resolve',
    label: string,
    body: Record<string, unknown>,
  ) => {
    const reason = `${label} service issue ${incidentId}.`;
    if (!window.confirm(`${reason}\n\nContinue?`)) return;
    setWorking(action);
    setMessage(undefined);
    const result = await gatewayRequest(config, `/v1/operator/incidents/${encodeURIComponent(incidentId)}/${action}`, 'operator', {
      method: 'POST',
      portalConfirmationAccepted: true,
      portalReason: reason,
      body: JSON.stringify(body),
    });
    setWorking(undefined);
    setMessage(result.ok ? `${label} done.` : result.error);
    if (result.ok) refresh();
  };

  const acknowledge = () => callIncidentAction('acknowledge', 'Start review', {
    acknowledgedBy: actorEmail,
    note: 'Service issue review started from Developer Portal.',
  });

  const assign = () => {
    const assignedTo = window.prompt('Who should handle this?', 'support@orbifinancial.com');
    if (!assignedTo?.trim()) return;
    void callIncidentAction('assign', 'Assign owner', {
      assignedTo: assignedTo.trim(),
      assignedBy: actorEmail,
      note: 'Owner assigned from Developer Portal.',
    });
  };

  const resolve = () => {
    const resolution = window.prompt('What fixed it?');
    if (!resolution?.trim()) return;
    void callIncidentAction('resolve', 'Mark fixed', {
      resolvedBy: actorEmail,
      resolution: resolution.trim(),
    });
  };

  return (
    <div className={`incident-card ${severity} ${status}`}>
      <div className="incident-main">
        <div className="incident-title-row">
          <StatusPill tone={severity === 'critical' ? 'danger' : 'warning'}>{severityLabel}</StatusPill>
          <StatusPill tone={toneFromStatus(status)}>{statusLabel}</StatusPill>
          {incident.escalatedAt && <StatusPill tone="warning">Past target time</StatusPill>}
          <span>{incident.createdAt ? new Date(String(incident.createdAt)).toLocaleString() : 'Time unavailable'}</span>
        </div>
        <h3>{incidentTitle}</h3>
        <p>{incidentMessage}</p>
        <div className="incident-meta-grid">
          <InfoLine label="Issue ID" value={incidentId || '-'} />
          <InfoLine label="Area" value={incidentAreaLabel(incident)} />
          <InfoLine label="Related item" value={String(resource.id || resource.type || '-')} />
          <InfoLine label="Response target" value={responseTarget} />
        </div>
        {runbookSteps.length > 0 && (
          <div className="runbook-box">
            <strong>What to check</strong>
            {runbookSteps.slice(0, 5).map((step, index) => (
              <span key={`${incidentId}-step-${index}`}>{index + 1}. {step}</span>
            ))}
          </div>
        )}
        {message && <div className="inline-message">{message}</div>}
      </div>
      <div className="incident-actions">
        <Copyable value={incidentId || '-'} />
        <button className="ghost-action" disabled={!incidentId || status === 'resolved' || working === 'acknowledge'} onClick={acknowledge}>
          Start review
        </button>
        <button className="ghost-action" disabled={!incidentId || status === 'resolved' || working === 'assign'} onClick={assign}>
          Assign owner
        </button>
        <button className="button-primary inline-link" disabled={!incidentId || status === 'resolved' || working === 'resolve'} onClick={resolve}>
          Mark fixed
        </button>
      </div>
    </div>
  );
}

function DocsStandaloneShell({
  state,
  config,
  routeDocId,
  onCreateAccount,
  authModal,
}: {
  state: PortalState;
  config: PortalConfig;
  routeDocId?: string;
  onCreateAccount: () => void;
  authModal: ReactNode;
}) {
  return (
    <div className="docs-page-shell">
      <header className="docs-page-header">
        <a className="docs-page-brand" href="/">
          <div className="orbi-mark">O</div>
          <div>
            <strong>ORBI Pay Docs</strong>
            <span>Developer documentation</span>
          </div>
        </a>
        <nav className="docs-page-links" aria-label="Documentation navigation">
          <a href="/docs">Guides</a>
          <a href="/?section=runtime">SDKs</a>
          <a href="/?section=access">Developer access</a>
        </nav>
        <button className="button-primary" onClick={onCreateAccount}>
          Create account
        </button>
      </header>
      <main className="docs-page-content">
        <Docs state={state} config={config} routeDocId={routeDocId} standalone />
      </main>
      <footer className="docs-page-footer">
        <span>ORBI Pay Developer Documentation</span>
        <span>Use official SDKs, signed webhooks, and approved production credentials.</span>
      </footer>
      {authModal}
    </div>
  );
}

function Docs({ state, config, routeDocId, standalone = false }: { state: PortalState; config: PortalConfig; routeDocId?: string; standalone?: boolean }) {
  const docs = state.snapshot?.docs || [];
  const sdks = state.snapshot?.sdks || [];
  const selectedDoc = (routeDocId ? docs.find((doc) => String(doc.id || '') === routeDocId) : docs[0]) || undefined;
  const selectedSections = Array.isArray(selectedDoc?.sections) ? selectedDoc.sections as Array<Record<string, unknown>> : [];
  const docsHomeHref = `${portalPublicOrigin()}/docs`;
  return (
    <div className={`docs-portal ${standalone ? 'standalone' : ''}`}>
      <section className="docs-hero">
        <div>
          <p className="eyebrow">ORBI Pay Developer Docs</p>
          <h2>Build with ORBI Pay using official integration guides.</h2>
          <p>
            Follow the official SDK-first guides for payment profiles, hosted challenges, PaySafe escrow,
            webhooks, integration testing, and production readiness.
          </p>
        </div>
        <div className="docs-hero-actions">
          <a className="button-primary" href={docsHomeHref}>
            Docs home
          </a>
          <a className="ghost-action" href="/?section=runtime">
            SDK setup <ArrowRight size={14} />
          </a>
        </div>
      </section>

      <div className="docs-workspace">
        <aside className="docs-sidebar">
          <div className="docs-sidebar-head">
            <strong>Guides</strong>
            <span>{docs.length || 0} resources</span>
          </div>
          <div className="docs-nav-list">
            {docs.length ? docs.map((doc, index) => (
              <DocNavLink item={doc} active={String(doc.id || '') === String(selectedDoc?.id || '')} key={String(doc.id || index)} />
            )) : (
              <EmptyState title="Docs unavailable" detail="Refresh shortly." />
            )}
          </div>
        </aside>

        <main className="docs-main">
          {selectedDoc ? (
            <DocReader item={selectedDoc} docsHomeHref={docsHomeHref} />
          ) : (
            <div className="panel wide-panel">
              <EmptyState title="Documentation is temporarily unavailable" detail="Refresh the page or try again shortly." />
            </div>
          )}
        </main>

        <aside className="docs-context">
          <div className="docs-context-note docs-toc">
            <h3>On this page</h3>
            <div className="docs-toc-list">
              {selectedSections.length ? selectedSections.map((section, index) => (
                <a href={`#section-${index + 1}`} key={`${String(selectedDoc?.id || 'doc')}-toc-${index}`}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  {String(section.heading || `Step ${index + 1}`)}
                </a>
              )) : <p>Select a guide to view its sections.</p>}
            </div>
          </div>

          <div className="docs-context-note">
            <StatusPill tone="success">SDK first</StatusPill>
            <h3>Use official SDKs</h3>
            <p>Build with `orbi.transfers.send`, hosted payment intents, and verified webhook handlers instead of raw HTTP where possible.</p>
            <a className="ghost-action" href="/?section=runtime">Open SDK setup</a>
          </div>

          <div className="docs-context-note">
            <h3>Terms of use</h3>
            <p>Keep secret keys server-side, verify every webhook signature, use idempotency keys, and never expose customer financial data without consent.</p>
          </div>

          <div className="docs-context-note">
            <h3>SDK catalog</h3>
            <div className="docs-sdk-list">
              {sdks.length ? sdks.slice(0, 6).map((sdk, index) => (
                <a key={String(sdk.id || sdk.language || index)} href={sdkDocsHref(config.baseUrl, String(sdk.docsPath || ''))} target="_blank" rel="noreferrer">
                  <span>{String(sdk.language || sdk.id || 'SDK')}</span>
                  <StatusPill tone={sdkStatusTone(sdk.status)}>{sdkStatusLabel(sdk.status)}</StatusPill>
                </a>
              )) : <p>SDK catalog is temporarily unavailable.</p>}
            </div>
          </div>

          <div className="docs-context-note code-panel">
            <h3>Quick example</h3>
            <pre>{`const orbi = createOrbi({
  baseUrl: process.env.ORBI_PAY_GATEWAY_BASE_URL!,
  serviceKey: process.env.ORBI_PAY_SERVICE_KEY!,
  environment: process.env.ORBI_PAY_ENVIRONMENT === 'Production' ? 'Production' : 'Demo',
});

await orbi.transfers.send({
  reference: 'ORDER-10001',
  amount: 125000,
  currency: 'TZS',
  customer: { phone: '+255700000000' },
}, {
  idempotencyKey: 'payment-intent:merchant:ORDER-10001',
});`}</pre>
          </div>
        </aside>
      </div>
    </div>
  );
}

function AuditEvents({ state }: { state: PortalState }) {
  const events = state.snapshot?.events || [];
  return (
    <div className="panel wide-panel">
      <PanelHeader title="Developer Portal Audit Events" />
      <DataTable
        columns={['Event ID', 'Type', 'Service', 'Environment', 'Occurred At']}
        rows={events.map((event: DeveloperEvent) => [
          String(event.eventId || event.id || '-'),
          String(event.eventType || '-'),
          String(event.serviceCode || '-'),
          String(event.environment || '-'),
          String(event.occurredAt || event.createdAt || '-'),
        ])}
        empty="No developer events returned."
      />
    </div>
  );
}

function SdkApiReference({ state, config, role }: { state: PortalState; config: PortalConfig; role: PortalRole }) {
  const serviceProfile = state.snapshot?.serviceProfile;
  const canViewLowLevelReference = roleCanManageServices(role);
  const [selectedLanguage, setSelectedLanguage] = useState(languageExamples[0].language);
  const selectedExample = languageExamples.find((example) => example.language === selectedLanguage) || languageExamples[0];
  return (
    <div className="stack">
      <div className="panel wide-panel">
        <PanelHeader title="Choose Your Server Language" />
        <LanguageExamplePicker selectedLanguage={selectedLanguage} setSelectedLanguage={setSelectedLanguage} />
      </div>

      <div className="panel wide-panel">
        <PanelHeader title="Use the ORBI SDK" />
        <div className="sdk-hero">
          <div>
            <p className="eyebrow">Recommended setup</p>
            <h2>Build payments with guided SDK methods.</h2>
            <p>
              The SDK keeps payment requests consistent across sandbox and production, including safe retries,
              customer approval, and payment update verification.
            </p>
          </div>
          <StatusPill tone="success">Recommended</StatusPill>
        </div>
        <div className="method-grid">
          {sdkMethods.map((method) => (
            <div className="method-card" key={method.name}>
              <StatusPill tone={method.risk === 'high' ? 'danger' : method.risk === 'medium' ? 'warning' : 'info'}>
                {method.risk === 'high' ? 'Needs approval' : method.risk === 'medium' ? 'Review needed' : 'Standard'}
              </StatusPill>
              <strong>{method.name}</strong>
              <span>{method.detail}</span>
              <code>Permission: {method.scope}</code>
            </div>
          ))}
        </div>
      </div>

      <div className="panel wide-panel">
        <PanelHeader title="Step-by-Step SDK Setup" />
        <div className="setup-steps">
          {selectedExample.setupSteps.map((step) => (
            <div className="setup-step" key={step.number}>
              <span>{step.number}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.detail}</p>
                <pre>{step.snippet}</pre>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel wide-panel">
        <PanelHeader title="Your Integration Profile" />
        {serviceProfile ? (
          <div className="profile-hero">
            <div>
              <p className="mono">{String(serviceProfile.serviceCode || serviceProfile.code || 'service')}</p>
              <h2>{String(serviceProfile.displayName || serviceProfile.legalName || 'Service profile')}</h2>
              <p>Your approved integration settings for trusted server-side testing.</p>
            </div>
            <StatusPill tone={toneFromStatus(serviceProfile.status)}>{String(serviceProfile.status || 'unknown')}</StatusPill>
          </div>
        ) : (
          <EmptyState title="No integration profile connected" detail="Sign in with an approved developer account to view your integration profile." />
        )}
      </div>

      <div className="panel wide-panel code-panel">
        <PanelHeader title={`${selectedExample.language} Payment Example`} />
        <pre>{selectedExample.paymentSnippet}</pre>
      </div>

      <div className="panel wide-panel code-panel">
        <PanelHeader title={`${selectedExample.language} Payment Updates`} />
        <pre>{selectedExample.updateSnippet}</pre>
        <p className="security-note">
          Return URLs help the customer experience. Your order should be updated only after ORBI sends a verified payment update.
        </p>
      </div>

      {canViewLowLevelReference ? (
      <div className="panel wide-panel">
        <PanelHeader title="Advanced API Reference" />
        <p className="security-note">
          Use this only for staff review, generated clients, and advanced debugging. New integrations should start with SDK methods above.
        </p>
        <div className="endpoint-grid">
          {[
            ['POST', '/v1/identity/resolve', 'Resolve ORBI identity before payment profile or financial request.'],
            ['POST', '/v1/business/registrations', 'Submit business access registration.'],
            ['POST', '/v1/payment-profiles', 'Link external platform customer to ORBI financial identity.'],
            ['POST', '/v1/payment-intents', 'Create hosted checkout payment intent.'],
            ['GET', '/v1/payment-intents/:intentId', 'Read intent status as payment truth with webhook.'],
            ['POST', '/v1/paysafe/escrows', 'Create protected PaySafe escrow hold.'],
            ['POST', '/v1/paysafe/escrows/:escrowId/release', 'Request release through ORBI PaySafe rules.'],
            ['POST', '/v1/paysafe/escrows/:escrowId/refund', 'Request refund through ORBI PaySafe rules.'],
            ['POST', '/v1/paysafe/escrows/:escrowId/dispute', 'Open a PaySafe dispute for review.'],
          ].map(([method, path, detail]) => (
            <div className="endpoint-card" key={path}>
              <StatusPill tone={method === 'GET' ? 'info' : 'warning'}>{method}</StatusPill>
              <strong>{path}</strong>
              <span>{detail}</span>
            </div>
          ))}
        </div>
        <p className="security-note">Financial actions must run from a trusted server with approved keys, request signing, environment, and a stable idempotency key.</p>
        <a className="button-primary inline-link" href={`${config.baseUrl}/ready`} target="_blank" rel="noreferrer">
          Open readiness check <ExternalLink size={15} />
        </a>
      </div>
      ) : (
        <div className="panel wide-panel">
          <PanelHeader title="Need advanced API access?" />
          <p className="security-note">
            Create a developer account and request production access. ORBI shows advanced references only after your integration is approved.
          </p>
        </div>
      )}
    </div>
  );
}

const sdkMethods = [
  {
    name: 'orbi.identity.resolve({...})',
    scope: 'identity:resolve',
    risk: 'low',
    detail: 'Resolve ORBI ID, phone, or email before linking a profile or starting a payment.',
  },
  {
    name: 'orbi.businessRegistrations.create({...})',
    scope: 'business_registration:create',
    risk: 'high',
    detail: 'Submit merchant, SACCOS, organization, or platform access for ORBI review.',
  },
  {
    name: 'orbi.paymentProfiles.create({...})',
    scope: 'payment_profile:create',
    risk: 'medium',
    detail: 'Link merchant user/member/seller profile to ORBI financial identity with consent.',
  },
  {
    name: 'orbi.transfers.send({...})',
    scope: 'payments:create',
    risk: 'high',
    detail: 'Create checkout payment intent and receive next action or hosted challenge URL.',
  },
  {
    name: 'orbi.paysafe.escrows.create({...})',
    scope: 'escrow:create',
    risk: 'high',
    detail: 'Create a protected PaySafe hold under ORBI escrow rules.',
  },
  {
    name: 'orbi.paysafe.escrows.release/refund/dispute({...})',
    scope: 'escrow:*:request',
    risk: 'high',
    detail: 'Request PaySafe actions such as release, refund, or dispute.',
  },
  {
    name: 'orbi.webhooks.parse(...)',
    scope: 'webhooks:receive',
    risk: 'low',
    detail: 'Verify signed webhook payload before mutating merchant order/account state.',
  },
  {
    name: 'orbi.developer.webhooks.replay(...)',
    scope: 'operator',
    risk: 'medium',
    detail: 'Replay failed webhooks through audited operator/developer tooling.',
  },
];

const languageExamples = [
  {
    language: 'Node.js / Express',
    detail: 'Best starting point for ORBI Pay. Keep all ORBI keys on your Express server, never inside browser JavaScript.',
    snippet: `npm i @orbifinancial/pay-gateway express`,
    setupSteps: [
      {
        number: '01',
        title: 'Install the SDK',
        detail: 'Install ORBI Pay on your server project.',
        snippet: `npm i @orbifinancial/pay-gateway express`,
      },
      {
        number: '02',
        title: 'Add server environment values',
        detail: 'Use Demo for sandbox. Switch to Production only after ORBI approves your integration.',
        snippet: `ORBI_PAY_GATEWAY_BASE_URL=https://sandbox-pay.orbifinancial.com
ORBI_PAY_ENVIRONMENT=Demo
ORBI_PAY_SERVICE_KEY=orbi_sandbox_xxx
ORBI_PAY_WEBHOOK_SECRET=orbi_whsec_sandbox_xxx
ORBI_PAY_RETURN_URL=https://merchant.example.com/orbi/return
ORBI_PAY_CANCEL_URL=https://merchant.example.com/orbi/cancel
ORBI_PAY_WEBHOOK_URL=https://merchant.example.com/api/orbi/updates`,
      },
      {
        number: '03',
        title: 'Create the ORBI client',
        detail: 'Use one client instance from your trusted server code.',
        snippet: `import { createOrbi } from '@orbifinancial/pay-gateway';

export const orbi = createOrbi({
  baseUrl: process.env.ORBI_PAY_GATEWAY_BASE_URL,
  serviceKey: process.env.ORBI_PAY_SERVICE_KEY,
  authMode: 'access_token',
  environment: process.env.ORBI_PAY_ENVIRONMENT,
});`,
      },
      {
        number: '04',
        title: 'Create payment from checkout',
        detail: 'Use one stable idempotency key per order. Reuse it if the customer network times out.',
        snippet: `app.post('/checkout/orbi', async (req, res) => {
  const intent = await orbi.transfers.send({
    reference: req.body.orderId,
    amount: req.body.amount,
    currency: 'TZS',
    description: 'Protected checkout',
    customer: { phone: req.body.phone },
    returnUrl: process.env.ORBI_PAY_RETURN_URL,
    cancelUrl: process.env.ORBI_PAY_CANCEL_URL,
    callbackUrl: process.env.ORBI_PAY_WEBHOOK_URL,
  }, {
    idempotencyKey: \`payment-intent:\${req.body.orderId}\`,
  });

  res.json(intent);
});`,
      },
      {
        number: '05',
        title: 'Redirect customer when approval is needed',
        detail: 'If ORBI returns a hosted approval URL, send the customer there.',
        snippet: `const action = orbi.getPaymentIntentNextAction(intent);

if (action.type === 'redirect_to_hosted_challenge') {
  return res.redirect(303, action.url);
}`,
      },
      {
        number: '06',
        title: 'Update orders from verified payment updates',
        detail: 'Do not mark an order paid from the browser return URL alone.',
        snippet: `app.post('/api/orbi/updates', express.raw({ type: 'application/json' }), async (req, res) => {
  const event = orbi.webhooks.parse({
    rawBody: req.body,
    signatureHeader: req.header('x-orbi-pay-signature') || '',
    timestampHeader: req.header('x-orbi-pay-timestamp') || '',
    secret: process.env.ORBI_PAY_WEBHOOK_SECRET,
  });

  await updateOrderFromOrbiEvent(event);
  res.sendStatus(200);
});`,
      },
    ],
    paymentSnippet: `app.post('/checkout/orbi', async (req, res) => {
  const intent = await orbi.transfers.send({
    reference: req.body.orderId,
    amount: req.body.amount,
    currency: 'TZS',
    description: 'Protected checkout',
    customer: { phone: req.body.phone },
    returnUrl: process.env.ORBI_PAY_RETURN_URL,
    cancelUrl: process.env.ORBI_PAY_CANCEL_URL,
    callbackUrl: process.env.ORBI_PAY_WEBHOOK_URL,
  }, {
    idempotencyKey: \`payment-intent:\${req.body.orderId}\`,
  });

  const action = orbi.getPaymentIntentNextAction(intent);
  if (action.type === 'redirect_to_hosted_challenge') {
    return res.redirect(303, action.url);
  }

  res.json(intent);
});`,
    updateSnippet: `app.post('/api/orbi/updates', express.raw({ type: 'application/json' }), async (req, res) => {
  const event = orbi.webhooks.parse({
    rawBody: req.body,
    signatureHeader: req.header('x-orbi-pay-signature') || '',
    timestampHeader: req.header('x-orbi-pay-timestamp') || '',
    secret: process.env.ORBI_PAY_WEBHOOK_SECRET,
  });

  await updateOrderFromOrbiEvent(event);
  res.sendStatus(200);
});`,
  },
  {
    language: 'Python',
    detail: 'Python SDK is live on PyPI. Use the same ORBI payment contract from your Python backend.',
    snippet: `pip install orbi-pay-gateway

from orbi_pay_gateway import Orbi

orbi = Orbi(
  base_url=os.environ["ORBI_PAY_GATEWAY_BASE_URL"],
  service_key=os.environ["ORBI_PAY_SERVICE_KEY"],
  auth_mode="access_token",
  environment="Demo",
)

intent = orbi.transfers.send({
  "reference": "ORDER-10001",
  "amount": 125000,
  "currency": "TZS",
  "customer": {"phone": "+255700000000"},
}, idempotency_key="payment-intent:merchant:ORDER-10001")`,
    setupSteps: [
      {
        number: '01',
        title: 'Install the SDK',
        detail: 'Install the ORBI Pay Python package from PyPI.',
        snippet: `pip install orbi-pay-gateway`,
      },
      {
        number: '02',
        title: 'Add server environment values',
        detail: 'Keep keys in your server secret storage.',
        snippet: `ORBI_PAY_GATEWAY_BASE_URL=https://sandbox-pay.orbifinancial.com
ORBI_PAY_ENVIRONMENT=Demo
ORBI_PAY_SERVICE_KEY=orbi_sandbox_xxx
ORBI_PAY_WEBHOOK_SECRET=orbi_whsec_sandbox_xxx`,
      },
      {
        number: '03',
        title: 'Create the ORBI client',
        detail: 'Use the client from your backend route or service.',
        snippet: `from orbi_pay_gateway import Orbi

orbi = Orbi(
  base_url=os.environ["ORBI_PAY_GATEWAY_BASE_URL"],
  service_key=os.environ["ORBI_PAY_SERVICE_KEY"],
  auth_mode="access_token",
  environment=os.environ.get("ORBI_PAY_ENVIRONMENT", "Demo"),
)`,
      },
      {
        number: '04',
        title: 'Create payment from checkout',
        detail: 'Use a stable idempotency key for every order.',
        snippet: `intent = orbi.transfers.send({
  "reference": order.id,
  "amount": order.amount,
  "currency": "TZS",
  "customer": {"phone": customer.phone},
}, idempotency_key=f"payment-intent:{order.id}")`,
      },
    ],
    paymentSnippet: `intent = orbi.transfers.send({
  "reference": "ORDER-10001",
  "amount": 125000,
  "currency": "TZS",
  "description": "Protected checkout",
  "customer": {"phone": "+255700000000"},
}, idempotency_key="payment-intent:merchant:ORDER-10001")`,
    updateSnippet: `event = orbi.webhooks.parse(
  raw_body=request.data,
  signature_header=request.headers.get("x-orbi-pay-signature", ""),
  timestamp_header=request.headers.get("x-orbi-pay-timestamp", ""),
  secret=os.environ["ORBI_PAY_WEBHOOK_SECRET"],
)

update_order_from_orbi_event(event)`,
  },
  {
    language: 'PHP / Laravel',
    detail: 'PHP SDK is live on Packagist. Secrets must stay in server env/config, never browser JavaScript.',
    snippet: `composer require orbifinancial/pay-gateway

$orbi = Orbi::create([
  'baseUrl' => env('ORBI_PAY_GATEWAY_BASE_URL'),
  'serviceKey' => env('ORBI_PAY_SERVICE_KEY'),
  'authMode' => 'access_token',
  'environment' => 'Demo',
]);

$intent = $orbi->transfers()->send([
  'reference' => 'ORDER-10001',
  'amount' => 125000,
  'currency' => 'TZS',
  'customer' => ['phone' => '+255700000000'],
], [
  'idempotencyKey' => 'payment-intent:merchant:ORDER-10001',
]);`,
    setupSteps: [
      {
        number: '01',
        title: 'Install the SDK',
        detail: 'Install ORBI Pay in your Laravel backend from Packagist.',
        snippet: `composer require orbifinancial/pay-gateway`,
      },
      {
        number: '02',
        title: 'Add server environment values',
        detail: 'Keep ORBI keys in Laravel env/config only.',
        snippet: `ORBI_PAY_GATEWAY_BASE_URL=https://sandbox-pay.orbifinancial.com
ORBI_PAY_ENVIRONMENT=Demo
ORBI_PAY_SERVICE_KEY=orbi_sandbox_xxx
ORBI_PAY_WEBHOOK_SECRET=orbi_whsec_sandbox_xxx`,
      },
      {
        number: '03',
        title: 'Create the ORBI client',
        detail: 'Create the client in a backend service class.',
        snippet: `$orbi = Orbi::create([
  'baseUrl' => env('ORBI_PAY_GATEWAY_BASE_URL'),
  'serviceKey' => env('ORBI_PAY_SERVICE_KEY'),
  'authMode' => 'access_token',
  'environment' => env('ORBI_PAY_ENVIRONMENT', 'Demo'),
]);`,
      },
      {
        number: '04',
        title: 'Create payment from checkout',
        detail: 'Use a stable idempotency key for each order.',
        snippet: `$intent = $orbi->transfers()->send([
  'reference' => $order->id,
  'amount' => $order->amount,
  'currency' => 'TZS',
  'customer' => ['phone' => $customer->phone],
], [
  'idempotencyKey' => 'payment-intent:' . $order->id,
]);`,
      },
    ],
    paymentSnippet: `$intent = $orbi->transfers()->send([
  'reference' => 'ORDER-10001',
  'amount' => 125000,
  'currency' => 'TZS',
  'description' => 'Protected checkout',
  'customer' => ['phone' => '+255700000000'],
], [
  'idempotencyKey' => 'payment-intent:merchant:ORDER-10001',
]);`,
    updateSnippet: `use Orbi\\PayGateway\\Webhooks;

$result = Webhooks::verifyAndParse([
  'rawBody' => $request->getContent(),
  'signatureHeader' => $request->header('x-orbi-pay-signature', ''),
  'timestampHeader' => $request->header('x-orbi-pay-timestamp', ''),
  'secret' => env('ORBI_PAY_WEBHOOK_SECRET'),
]);

if (!($result['ok'] ?? false)) {
  abort(400, 'Invalid ORBI webhook');
}

updateOrderFromOrbiEvent($result['event']);`,
  },
  {
    language: 'cURL Smoke Test',
    detail: 'Use only for diagnostics. Production integrations should use SDK wrappers.',
    snippet: `curl -X POST "$ORBI_PAY_GATEWAY_BASE_URL/v1/payment-intents" \\
  -H "x-orbi-pay-service-key: $ORBI_PAY_SERVICE_KEY" \\
  -H "idempotency-key: payment-intent:merchant:ORDER-10001" \\
  -H "content-type: application/json" \\
  -d '{"reference":"ORDER-10001","amount":125000,"currency":"TZS","customer":{"phone":"+255700000000"},"confirm":true}'`,
    setupSteps: [
      {
        number: '01',
        title: 'Set environment values',
        detail: 'Use cURL only to test connectivity from a secure machine.',
        snippet: `export ORBI_PAY_GATEWAY_BASE_URL=https://sandbox-pay.orbifinancial.com
export ORBI_PAY_SERVICE_KEY=orbi_sandbox_xxx`,
      },
      {
        number: '02',
        title: 'Send a test payment request',
        detail: 'Use one idempotency key per test order.',
        snippet: `curl -X POST "$ORBI_PAY_GATEWAY_BASE_URL/v1/payment-intents" \\
  -H "x-orbi-pay-service-key: $ORBI_PAY_SERVICE_KEY" \\
  -H "idempotency-key: payment-intent:merchant:ORDER-10001" \\
  -H "content-type: application/json" \\
  -d '{"reference":"ORDER-10001","amount":125000,"currency":"TZS"}'`,
      },
    ],
    paymentSnippet: `curl -X POST "$ORBI_PAY_GATEWAY_BASE_URL/v1/payment-intents" \\
  -H "x-orbi-pay-service-key: $ORBI_PAY_SERVICE_KEY" \\
  -H "idempotency-key: payment-intent:merchant:ORDER-10001" \\
  -H "content-type: application/json" \\
  -d '{"reference":"ORDER-10001","amount":125000,"currency":"TZS","customer":{"phone":"+255700000000"},"confirm":true}'`,
    updateSnippet: `# Webhook verification should be implemented in your server language.
# Use cURL only for diagnostics, not for production payment update handling.`,
  },
];

function LanguageExamplePicker({
  selectedLanguage,
  setSelectedLanguage,
}: {
  selectedLanguage: string;
  setSelectedLanguage: (language: string) => void;
}) {
  const selected = languageExamples.find((example) => example.language === selectedLanguage) || languageExamples[0];

  return (
    <div className="language-picker">
      <div className="language-tabs" role="tablist" aria-label="Language examples">
        {languageExamples.map((example) => (
          <button
            className={selected.language === example.language ? 'active' : ''}
            key={example.language}
            onClick={() => setSelectedLanguage(example.language)}
            role="tab"
            aria-selected={selected.language === example.language}
          >
            {example.language}
          </button>
        ))}
      </div>

      <div className="language-focus-card">
        <div>
          <h3>{selected.language}</h3>
          <p>{selected.detail}</p>
        </div>
        <pre>{selected.snippet}</pre>
      </div>
    </div>
  );
}

function RecentEvents({ events }: { events: DeveloperEvent[] }) {
  return (
    <div className="panel">
      <PanelHeader title="Recent Developer Events" />
      {events.length ? (
        <div className="event-list">
          {events.slice(0, 6).map((event, index) => (
            <div className="event-row" key={String(event.eventId || index)}>
              <div className="event-icon info"><Check size={18} /></div>
              <div>
                <strong>{String(event.eventType || 'developer.event')}</strong>
                <span>{String(event.serviceCode || 'global')} · {String(event.environment || 'environment')}</span>
              </div>
              <small>{String(event.occurredAt || event.createdAt || '')}</small>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="No events returned" detail="Audit events will appear after service, key, scope, allowlist, consent, or webhook actions." />
      )}
    </div>
  );
}

function EndpointErrors({ errors, role }: { errors: Array<{ name: string; error: string }>; role: PortalRole }) {
  if (!errors.length) return null;
  if (!roleCanManageServices(role)) {
    return null;
  }

  return (
    <div className="panel error-panel">
      <PanelHeader title="Operational Notices" />
      <div className="notice-list">
        {errors.map((error) => (
          <div className="notice-row" key={error.name}>
            <AlertTriangle size={17} />
            <strong>{error.name}</strong>
            <span>{error.error}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DocCard({ item }: { item: Record<string, unknown> }) {
  const id = String(item.id || '');
  const href = `${portalPublicOrigin()}/docs/${encodeURIComponent(id)}`;
  return (
    <a className="doc-card" href={href} target="_blank" rel="noreferrer">
      <ChevronRight size={22} />
      <div>
        <strong>{String(item.title || item.id || 'Developer resource')}</strong>
        <span>{String(item.description || item.category || item.status || 'ORBI Pay resource')}</span>
      </div>
      <ArrowRight size={15} />
    </a>
  );
}

function DocNavLink({ item, active }: { item: Record<string, unknown>; active: boolean }) {
  const id = String(item.id || '');
  const href = `${portalPublicOrigin()}/docs/${encodeURIComponent(id)}`;
  return (
    <a className={`docs-nav-link ${active ? 'active' : ''}`} href={href}>
      <span>{String(item.category || 'Guide')}</span>
      <strong>{String(item.title || item.id || 'Developer resource')}</strong>
      <small>{String(item.description || 'Open guide')}</small>
    </a>
  );
}

function DocReader({ item, docsHomeHref }: { item: Record<string, unknown>; docsHomeHref?: string }) {
  const sections = Array.isArray(item.sections) ? item.sections as Array<Record<string, unknown>> : [];
  return (
    <article className="doc-reader">
      <div className="doc-reader-head">
        <div>
          <StatusPill tone="info">{String(item.category || 'Guide')}</StatusPill>
          <h2>{String(item.title || 'Developer guide')}</h2>
          <p>{String(item.description || '')}</p>
        </div>
        <a className="ghost-action" href={docsHomeHref || `${portalPublicOrigin()}/docs`}>
          <ArrowLeft size={14} /> All docs
        </a>
      </div>
      <div className="doc-section-list">
        {sections.map((section, index) => (
          <section className="doc-section" id={`section-${index + 1}`} key={`${String(item.id || 'doc')}-${index}`}>
            <h3>{String(section.heading || `Step ${index + 1}`)}</h3>
            <p>{String(section.body || '')}</p>
            {section.code ? <CopyCodeBlock code={String(section.code)} /> : null}
          </section>
        ))}
      </div>
    </article>
  );
}

function CopyCodeBlock({ code }: { code: string }) {
  return (
    <div className="copy-code-block">
      <button type="button" onClick={() => void navigator.clipboard?.writeText(code)}>
        <Copy size={13} /> Copy
      </button>
      <pre>{code}</pre>
    </div>
  );
}

function sdkDocsHref(baseUrl: string, path: string) {
  if (!path) return '#';
  return path.startsWith('http') ? path : `${baseUrl}${path}`;
}

function portalPublicOrigin() {
  const configured = String(import.meta.env.VITE_ORBI_PORTAL_PUBLIC_URL || '').replace(/\/+$/, '');
  if (configured) return configured;
  const current = window.location.origin.replace(/\/+$/, '');
  if (/^https:\/\/(sandbox-)?pay\.orbifinancial\.com$/i.test(current)) {
    return 'https://orbi-pay-developer-portal-ui.vercel.app';
  }
  return current;
}

function docIdFromPath(pathname: string) {
  const match = pathname.match(/^\/docs\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function MetricCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: StatusTone }) {
  return (
    <div className="metric-card">
      <div className="metric-top">
        <span>{label}</span>
        <i className={`dot ${tone}`} />
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function PanelHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="panel-header">
      <h2>{title}</h2>
      {action && <button onClick={onAction} className="ghost-action"><RefreshCcw size={15} /> {action}</button>}
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: StatusTone | string }) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

function DataTable({ columns, rows, empty }: { columns: string[]; rows: ReactNode[][]; empty?: string }) {
  if (!rows.length) {
    return <EmptyState title="No records" detail={empty || 'No records available yet.'} />;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <AlertTriangle size={18} />
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
    </div>
  );
}

function Copyable({ value }: { value: string }) {
  return (
    <button className="copyable" onClick={() => void navigator.clipboard?.writeText(value)}>
      <Copy size={14} />
      <span>{value}</span>
    </button>
  );
}

function PasswordField({
  value,
  onChange,
  label,
  placeholder,
  autoComplete,
  hideLabel = false,
  onEnter,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  autoComplete?: string;
  hideLabel?: boolean;
  onEnter?: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const field = (
    <div className="password-field">
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onEnter?.();
        }}
      />
      <button type="button" onClick={() => setVisible((current) => !current)} aria-label={visible ? 'Hide password' : 'Show password'}>
        {visible ? 'Hide' : 'Show'}
      </button>
    </div>
  );
  if (hideLabel) return field;
  return (
    <label>
      {label || 'Password'}
      {field}
    </label>
  );
}

function maskSecret(value: unknown): string {
  const text = String(value || '').trim();
  if (!text) return '-';
  if (text.length <= 12) return `${text.slice(0, 3)}******${text.slice(-2)}`;
  return `${text.slice(0, 10)}****************${text.slice(-6)}`;
}

function SecretCodePanel({
  title,
  subtitle,
  rows,
  metadata,
  compact = false,
}: {
  title: string;
  subtitle: string;
  rows: Array<{ label: string; value?: unknown }>;
  metadata?: Array<{ label: string; value?: unknown; masked?: boolean }>;
  compact?: boolean;
}) {
  const visibleRows = rows.filter((row) => String(row.value || '').trim());
  const visibleMetadata = (metadata || []).filter((row) => String(row.value || '').trim());
  const copyAll = () => {
    const text = visibleRows.map((row) => `${row.label}=${String(row.value)}`).join('\n');
    if (text) void navigator.clipboard?.writeText(text);
  };
  return (
    <div className={`secret-code-panel ${compact ? 'compact' : ''}`}>
      <div className="secret-code-toolbar">
        <div>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
        <div className="row-actions">
          <button className="mini-copy" type="button" onClick={copyAll}>Copy all</button>
          <StatusPill tone="warning">Shown once</StatusPill>
        </div>
      </div>
      {visibleMetadata.length > 0 && (
        <div className="secret-code-meta">
          {visibleMetadata.map((item) => (
            <div key={item.label}>
              <span>{item.label}</span>
              <code>{item.masked ? maskSecret(item.value) : String(item.value)}</code>
            </div>
          ))}
        </div>
      )}
      <div className="secret-code-lines">
        {visibleRows.map((row) => (
          <div className="secret-code-line" key={row.label}>
            <span>{row.label}</span>
            <Copyable value={String(row.value)} />
          </div>
        ))}
      </div>
      <p>Store these keys in your server secret manager. Do not put them in browser code, Git, screenshots, or chats.</p>
    </div>
  );
}

function AuthModal({
  config,
  initialMode,
  onClose,
  onSignedIn,
}: {
  config: PortalConfig;
  initialMode: AuthMode;
  onClose: () => void;
  onSignedIn: (session: PortalSession) => void;
}) {
  const initialInviteToken = new URLSearchParams(window.location.search).get('invite_token') || '';
  const initialResetToken = new URLSearchParams(window.location.search).get('resetToken') || '';
  const [mode, setMode] = useState<AuthMode>(initialResetToken ? 'reset' : initialInviteToken ? 'signup' : initialMode);
  const [inviteToken, setInviteToken] = useState(initialInviteToken);
  const [resetToken, setResetToken] = useState(initialResetToken);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [countryCode, setCountryCode] = useState('TZ');
  const [useCase, setUseCase] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [signupStep, setSignupStep] = useState(1);
  const [emailVerificationRequired, setEmailVerificationRequired] = useState(false);
  const [emailVerificationCode, setEmailVerificationCode] = useState('');
  const [message, setMessage] = useState<string>();
  const [working, setWorking] = useState(false);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    if (nextMode === 'signin') setInviteToken('');
    if (nextMode !== 'reset') setResetToken('');
    setSignupStep(1);
    setEmailVerificationRequired(false);
    setEmailVerificationCode('');
    setMessage(undefined);
  };

  const acceptInvite = async () => {
    setWorking(true);
    setMessage(undefined);
    try {
      const response = await fetch(`${config.bffBaseUrl}/auth/signup`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'accept_invite',
          token: inviteToken,
          username,
          password,
          environment: config.environment,
        }),
      });
      const body = await response.json().catch(() => null);
      const data = body?.data || body;
      setWorking(false);
      if (!response.ok || body?.success === false) {
        setMessage(String(body?.error || `Invitation failed with HTTP ${response.status}`));
        return;
      }
      setMessage(String(data?.nextStep || 'Invitation accepted. Sign in with your new staff account.'));
      setInviteToken('');
      setMode('signin');
      setSignupStep(1);
      window.history.replaceState({}, '', window.location.pathname);
    } catch (error) {
      setWorking(false);
      setMessage(error instanceof Error ? error.message : 'Unable to accept invitation.');
    }
  };

  const signupStepIsValid =
    signupStep === 1
      ? Boolean(name.trim() && username.trim() && email.trim() && password.length >= 12)
      : signupStep === 2
        ? Boolean(companyName.trim() && countryCode.trim().length === 2 && useCase.trim())
        : termsAccepted;

  const moveSignup = (direction: -1 | 1) => {
    setMessage(undefined);
    if (direction === 1 && !signupStepIsValid) {
      setMessage(
        signupStep === 1
          ? 'Complete your account details and use a password with at least 12 characters.'
          : 'Add your business or project, country, and a short description of what you are building.',
      );
      return;
    }
    setSignupStep((current) => Math.min(3, Math.max(1, current + direction)));
  };

  const submitLogin = async () => {
    setWorking(true);
    setMessage(undefined);
    const result = await loginPortalWithOtp(
      config,
      email,
      password,
      useRecoveryCode ? undefined : otp,
      useRecoveryCode ? recoveryCode : undefined,
    );
    setWorking(false);
    if (!result.ok) {
      setMessage(result.error);
      if (/verify your email/i.test(result.error)) setEmailVerificationRequired(true);
      return;
    }
    onSignedIn(result.data);
  };

  const submitSignup = async () => {
    setWorking(true);
    setMessage(undefined);
    const result = await signupPortalDeveloper(config, {
      name,
      username,
      email,
      password,
      companyName,
      countryCode,
      useCase,
      termsAccepted,
    });
    setWorking(false);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setMessage(result.data.nextStep || 'Enter the verification code sent to your email.');
    setEmailVerificationRequired(Boolean(result.data.verificationRequired));
    if (!result.data.verificationRequired) {
      setMode('signin');
      setSignupStep(1);
      setOtp('');
    }
  };

  const submitEmailVerification = async () => {
    setWorking(true);
    setMessage(undefined);
    const result = await verifyPortalDeveloperEmail(config, email, emailVerificationCode);
    setWorking(false);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setEmailVerificationRequired(false);
    setEmailVerificationCode('');
    setMode('signin');
    setSignupStep(1);
    setMessage('Email verified. Sign in to start building in sandbox.');
  };

  const resendEmailVerification = async () => {
    setWorking(true);
    setMessage(undefined);
    const result = await resendPortalDeveloperEmail(config, email);
    setWorking(false);
    setMessage(result.ok ? (result.data.nextStep || 'A new verification code has been requested.') : result.error);
  };

  const requestPasswordReset = async () => {
    setWorking(true);
    setMessage(undefined);
    const result = await requestPortalPasswordReset(config, email);
    setWorking(false);
    setMessage(result.ok ? (result.data.nextStep || 'If the account exists, password reset instructions will be sent.') : result.error);
  };

  const completePasswordReset = async () => {
    setWorking(true);
    setMessage(undefined);
    const result = await completePortalPasswordReset(config, resetToken, password);
    setWorking(false);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setPassword('');
    setResetToken('');
    setMode('signin');
    window.history.replaceState({}, '', window.location.pathname);
    setMessage(result.data.nextStep || 'Password changed. Sign in with your new password.');
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card auth-card">
        {working && (
          <div className="modal-loading-overlay" role="status" aria-live="polite">
            <div className="loading-orb" />
            <strong>
              {mode === 'signin'
                ? 'Signing in securely...'
                : mode === 'forgot'
                  ? 'Preparing recovery...'
                  : mode === 'reset'
                    ? 'Changing password...'
                : emailVerificationRequired
                  ? 'Verifying your email...'
                  : inviteToken
                    ? 'Accepting invitation...'
                    : 'Creating your sandbox account...'}
            </strong>
            <span>Please wait...</span>
          </div>
        )}
        <button className="icon-button modal-close" onClick={onClose} aria-label="Close login">
          <X size={20} />
        </button>
        <p className="eyebrow">ORBI Developer Access</p>
        <h2>
          {inviteToken
            ? 'Accept team invitation'
            : emailVerificationRequired
              ? 'Verify your email'
              : mode === 'signup'
                ? 'Create your developer account'
                : mode === 'forgot'
                  ? 'Recover your account'
                  : mode === 'reset'
                    ? 'Choose a new password'
                    : 'Sign in to ORBI Pay'}
        </h2>
        <p className="modal-copy">
          {inviteToken
            ? 'Create your own staff login. Your role and integration access are controlled by the invitation.'
            : emailVerificationRequired
            ? `Enter the 6-digit code sent to ${email}. The code expires in 15 minutes.`
            : mode === 'signup'
            ? 'Start in sandbox, test real ORBI payment flows safely, then request production access when your business is ready.'
            : mode === 'forgot'
            ? 'Enter your portal email. If the account exists and is verified, we will send secure reset instructions.'
            : mode === 'reset'
            ? 'Use a strong password. Existing portal sessions will be signed out after the password is changed.'
            : 'Use your developer, operator, or admin account to continue your ORBI integration work.'}
        </p>
        {!emailVerificationRequired && !inviteToken && (mode === 'signin' || mode === 'signup') && <div className="auth-tabs">
          <button className={mode === 'signup' ? 'active' : ''} onClick={() => switchMode('signup')}>Create account</button>
          <button className={mode === 'signin' ? 'active' : ''} onClick={() => switchMode('signin')}>Sign in</button>
        </div>}

        <div className="auth-form-body">
          {emailVerificationRequired ? (
            <div className="auth-step email-verification-step">
              <label>
                Verification code
                <input
                  value={emailVerificationCode}
                  onChange={(event) => setEmailVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && emailVerificationCode.length === 6) void submitEmailVerification();
                  }}
                />
              </label>
              <button className="mini-link" type="button" disabled={working} onClick={resendEmailVerification}>
                Resend verification code
              </button>
            </div>
          ) : !inviteToken && mode === 'signup' && (
            <div className="signup-progress" aria-label={`Signup step ${signupStep} of 3`}>
              <div className="signup-progress-copy">
                <span>Step {signupStep} of 3</span>
                <strong>{signupStep === 1 ? 'Your account' : signupStep === 2 ? 'Your project' : 'Review & agree'}</strong>
              </div>
              <div className="signup-progress-track" aria-hidden="true">
                {[1, 2, 3].map((step) => <i key={step} className={step <= signupStep ? 'active' : ''} />)}
              </div>
            </div>
          )}

          {!emailVerificationRequired && inviteToken && (
            <div className="auth-step">
              <label>
                Staff username
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32))}
                  placeholder="jane_it"
                  autoComplete="username"
                />
              </label>
              <label>
                New password
                <PasswordField
                  value={password}
                  onChange={setPassword}
                  placeholder="At least 12 characters"
                  autoComplete="new-password"
                  hideLabel
                />
              </label>
              <p className="signup-review-note">Do not use a shared team password. Every ORBI portal staff member must use their own login.</p>
            </div>
          )}

          {!emailVerificationRequired && !inviteToken && mode === 'signup' && signupStep === 1 && (
            <div className="auth-step">
              <label>
                Full name
                <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" autoComplete="name" />
              </label>
              <label>
                Developer username
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32))}
                  placeholder="example_team"
                  autoComplete="username"
                />
              </label>
              <label>
                Email
                <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@business.com" autoComplete="email" />
              </label>
              <label>
                Password
                <PasswordField
                  value={password}
                  onChange={setPassword}
                  placeholder="At least 12 characters"
                  autoComplete="new-password"
                  hideLabel
                />
              </label>
            </div>
          )}

          {!emailVerificationRequired && !inviteToken && mode === 'signup' && signupStep === 2 && (
            <div className="auth-step">
              <label>
                Business or project
                <input value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="Example: Tag Commerce, SACCOS portal" autoComplete="organization" />
              </label>
              <label>
                Country
                <input value={countryCode} onChange={(event) => setCountryCode(event.target.value.toUpperCase().slice(0, 2))} placeholder="TZ" />
              </label>
              <label>
                What are you building?
                <textarea
                  value={useCase}
                  onChange={(event) => setUseCase(event.target.value)}
                  placeholder="Example: I want to accept ORBI Pay in my marketplace and receive signed payment updates."
                  rows={4}
                />
              </label>
            </div>
          )}

          {!emailVerificationRequired && !inviteToken && mode === 'signup' && signupStep === 3 && (
            <div className="auth-step">
              <div className="signup-review">
                <div><span>Developer</span><strong>{name}</strong><small>@{username}</small></div>
                <div><span>Project</span><strong>{companyName}</strong><small>{countryCode}</small></div>
                <div><span>Email</span><strong>{email}</strong></div>
              </div>
              <p className="signup-review-note">Your account starts in sandbox. Production access is requested separately after your integration is ready.</p>
            <label className="checkbox-line">
              <input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} />
              <span>I agree to use sandbox safely and request approval before live customer payments.</span>
            </label>
            </div>
          )}

          {!emailVerificationRequired && !inviteToken && mode === 'forgot' && (
            <div className="auth-step">
              <label>
                Email
                <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@business.com" autoComplete="email" />
              </label>
              <p className="signup-review-note">For security, we show the same confirmation whether or not the email exists.</p>
            </div>
          )}

          {!emailVerificationRequired && !inviteToken && mode === 'reset' && (
            <div className="auth-step">
              <label>
                New password
                <PasswordField
                  value={password}
                  onChange={setPassword}
                  placeholder="At least 12 characters"
                  autoComplete="new-password"
                  hideLabel
                />
              </label>
              <p className="signup-review-note">After reset, sign in again. If MFA is enabled, your authenticator or recovery code is still required.</p>
            </div>
          )}

          {!emailVerificationRequired && !inviteToken && mode === 'signin' && (
            <div className="auth-step">
              <label>
                Email
                <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@business.com" autoComplete="email" />
              </label>
              <label>
                Password
                <PasswordField
                  value={password}
                  onChange={setPassword}
                  placeholder="Your portal password"
                  autoComplete="current-password"
                  hideLabel
                  onEnter={() => void submitLogin()}
                />
              </label>
              {useRecoveryCode ? (
                <label>
                  Recovery code
                  <input
                    value={recoveryCode}
                    onChange={(event) => setRecoveryCode(event.target.value.toUpperCase().slice(0, 24))}
                    placeholder="ORBI-XXXX-XXXX-XXXX-XXXX"
                    autoComplete="off"
                  />
                </label>
              ) : (
                <label>
                  Authenticator code
                  <input
                    value={otp}
                    onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="Optional unless MFA is enabled"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                  />
                </label>
              )}
              <button
                className="mini-link auth-method-switch"
                type="button"
                onClick={() => {
                  setUseRecoveryCode((current) => !current);
                  setMessage(undefined);
                }}
              >
                {useRecoveryCode ? 'Use authenticator code' : 'Use a recovery code'}
              </button>
              <button
                className="mini-link auth-method-switch"
                type="button"
                onClick={() => switchMode('forgot')}
              >
                Forgot password?
              </button>
            </div>
          )}

          {message && <div className={`inline-message ${mode === 'signin' && message.toLowerCase().includes('invalid') ? 'danger' : 'info'}`}>{message}</div>}
        </div>

        {emailVerificationRequired ? (
          <div className="auth-actions">
            <button className="ghost-action" onClick={() => setEmailVerificationRequired(false)} disabled={working}>
              Back to sign in
            </button>
            <button className="button-primary" onClick={submitEmailVerification} disabled={working || emailVerificationCode.length !== 6}>
              {working ? 'Verifying' : 'Verify email'}
            </button>
          </div>
        ) : inviteToken ? (
          <button className="button-primary full" onClick={acceptInvite} disabled={working || !username.trim() || password.length < 12}>
            {working ? 'Accepting invite' : 'Accept invitation'}
          </button>
        ) : mode === 'forgot' ? (
          <div className="auth-actions">
            <button className="ghost-action" onClick={() => switchMode('signin')} disabled={working}>
              <ArrowLeft size={16} /> Back
            </button>
            <button className="button-primary" onClick={requestPasswordReset} disabled={working || !email.trim()}>
              {working ? 'Sending' : 'Send reset link'}
            </button>
          </div>
        ) : mode === 'reset' ? (
          <div className="auth-actions">
            <button className="ghost-action" onClick={() => switchMode('signin')} disabled={working}>
              Back to sign in
            </button>
            <button className="button-primary" onClick={completePasswordReset} disabled={working || !resetToken || password.length < 12}>
              {working ? 'Changing password' : 'Change password'}
            </button>
          </div>
        ) : mode === 'signup' ? (
          <div className="auth-actions">
            {signupStep > 1 && (
              <button className="ghost-action" onClick={() => moveSignup(-1)} disabled={working}>
                <ArrowLeft size={16} /> Back
              </button>
            )}
            {signupStep < 3 ? (
              <button className="button-primary" onClick={() => moveSignup(1)}>
                Next <ArrowRight size={16} />
              </button>
            ) : (
              <button className="button-primary" onClick={submitSignup} disabled={working || !termsAccepted}>
                {working ? 'Creating account' : 'Create sandbox account'}
              </button>
            )}
          </div>
        ) : (
          <button className="button-primary full" onClick={submitLogin} disabled={working || !email.trim() || !password}>
            {working ? 'Signing in' : 'Sign in'}
          </button>
        )}
      </div>
    </div>
  );
}

function PortalModal({
  type,
  config,
  onClose,
  refresh,
}: {
  type: 'service' | 'key';
  config: PortalConfig;
  onClose: () => void;
  refresh: () => void;
}) {
  const [message, setMessage] = useState<string>();
  const [working, setWorking] = useState(false);
  const [serviceCode, setServiceCode] = useState('');
  const [issuedSecret, setIssuedSecret] = useState<Record<string, unknown>>();

  const submitApplication = async () => {
    setWorking(true);
    const result = await gatewayRequest(config, '/v1/developer/service-applications', 'operator', {
      method: 'POST',
      body: JSON.stringify({
        legalName: 'Merchant Limited',
        displayName: 'Merchant Checkout',
        contactEmail: 'ops@merchant.example',
        businessType: 'merchant',
        countryCode: 'TZ',
        requestedEnvironments: [config.environment],
        requestedScopes: ['payments:create', 'webhooks:receive'],
        browserOrigins: ['https://merchant.example.com'],
        redirectUrls: ['https://merchant.example.com/orbi/return'],
        webhookUrls: ['https://merchant.example.com/api/orbi/webhooks'],
        useCases: ['Protected checkout'],
        termsAccepted: true,
      }),
    });
    setMessage(result.ok ? 'Service application submitted.' : result.error);
    setWorking(false);
    if (result.ok) refresh();
  };

  const issueKey = async () => {
    if (!serviceCode.trim()) {
      setMessage('Enter service code first.');
      return;
    }
    const reason = `Issue ${config.environment} API key for ${serviceCode.trim()}.`;
    if (!window.confirm(`${reason}\n\nContinue?`)) return;
    setWorking(true);
    setIssuedSecret(undefined);
    const result = await gatewayRequest<Record<string, unknown>>(config, `/v1/developer/services/${encodeURIComponent(serviceCode.trim())}/api-keys/issue`, 'operator', {
      method: 'POST',
      portalConfirmationAccepted: true,
      portalReason: reason,
      body: JSON.stringify({
        environment: config.environment,
        requestedBy: 'portal-session',
        reason,
      }),
    });
    if (result.ok) {
      setIssuedSecret(result.data || {});
      setMessage('API key issued. Copy it now and store it securely.');
    } else {
      setMessage(result.error);
    }
    setWorking(false);
    if (result.ok) refresh();
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card">
        <button className="icon-button modal-close" onClick={onClose} aria-label="Close modal">
          <X size={20} />
        </button>
        {type === 'service' ? (
          <>
            <p className="eyebrow">Developer onboarding</p>
            <h2>Submit Integration Application</h2>
            <p className="modal-copy">Create a new integration request for ORBI review.</p>
            <button className="button-primary full" onClick={submitApplication} disabled={working}>
              {working ? 'Submitting' : 'Submit sample application'}
            </button>
          </>
        ) : (
          <>
            <p className="eyebrow">One-time secret</p>
            <h2>Issue API Key</h2>
            <p className="modal-copy">
              This secret will be shown once only. Put it directly into secure server storage. Do not paste it into frontend
              code, Git, logs, screenshots, or chat. If it is exposed, rotate it before accepting live payments.
            </p>
            <label>
              Integration code
              <input value={serviceCode} onChange={(event) => setServiceCode(event.target.value)} placeholder="orbi-shop" />
            </label>
            <button className="button-primary full" onClick={issueKey} disabled={working}>
              <Copy size={17} /> {working ? 'Issuing' : 'Issue key'}
            </button>
            {issuedSecret && (
              <SecretCodePanel
                title="Copy this key now"
                subtitle="This secret is shown once only. Store it in server secret storage before closing."
                metadata={[
                  { label: 'Environment', value: issuedSecret.environment || config.environment },
                  { label: 'API key id', value: objectValue(issuedSecret.apiKey).keyId, masked: true },
                ]}
                rows={[
                  { label: 'ORBI_PAY_SERVICE_KEY', value: issuedSecret.oneTimeSecret || issuedSecret.apiKeySecret },
                ]}
              />
            )}
          </>
        )}
        {message && <div className="inline-message">{message}</div>}
      </div>
    </div>
  );
}

function incidentStatusLabel(status: unknown): string {
  const value = String(status || '').toLowerCase();
  if (value === 'open') return 'Needs attention';
  if (value === 'acknowledged') return 'Being reviewed';
  if (value === 'assigned') return 'Owner assigned';
  if (value === 'resolved') return 'Fixed';
  return readableLabel(value || 'needs_attention');
}

function incidentSeverityLabel(severity: unknown): string {
  const value = String(severity || '').toLowerCase();
  if (value === 'critical') return 'High priority';
  if (value === 'warning') return 'Review';
  return readableLabel(value || 'review');
}

function incidentAreaLabel(incident: OperatorIncident): string {
  const type = String(incident.incidentType || '').toLowerCase();
  if (type.includes('webhook')) return 'Payment update delivery';
  if (type.includes('reconciliation')) return 'Balance matching';
  if (type.includes('settlement')) return 'Payment settlement';
  if (type.includes('auth')) return 'Login or access';
  if (type.includes('risk')) return 'Safety review';
  if (type.includes('runtime')) return 'Service availability';
  return readableLabel(type || 'service_check');
}

function incidentTitleLabel(incident: OperatorIncident): string {
  const title = String(incident.title || '').trim();
  if (title && !title.includes('_')) return title;

  const type = String(incident.incidentType || '').toLowerCase();
  if (type.includes('webhook')) return 'Payment update needs attention';
  if (type.includes('reconciliation')) return 'Balance check needs attention';
  if (type.includes('settlement')) return 'Payment settlement needs attention';
  if (type.includes('auth')) return 'Access check needs attention';
  if (type.includes('risk')) return 'Safety review needs attention';
  return 'Service issue needs attention';
}

function incidentMessageLabel(incident: OperatorIncident): string {
  const message = String(incident.message || '').trim();
  if (message && !message.includes('_')) return message;

  const type = String(incident.incidentType || '').toLowerCase();
  if (type.includes('webhook')) return 'A merchant payment update did not finish cleanly. Check the delivery and replay it if needed.';
  if (type.includes('reconciliation')) return 'A balance or payment record needs review before it is marked complete.';
  if (type.includes('settlement')) return 'A payment step needs review before the merchant or customer sees a final result.';
  if (type.includes('auth')) return 'A login or permission check needs review.';
  if (type.includes('risk')) return 'A safety rule asked for human review before continuing.';
  return 'This item needs review from the support or operations team.';
}

function readableLabel(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toneFromStatus(status: unknown): StatusTone {
  const value = String(status || '').toLowerCase();
  if (['live_npm', 'live_pypi', 'live_packagist', 'live', 'published'].includes(value)) return 'success';
  if (['release_ready', 'source_ready', 'bootstrap_available'].includes(value)) return 'info';
  if (['active', 'ready', 'delivered', 'completed', 'approved', 'resolved'].includes(value)) return 'success';
  if (['pending', 'pending_review', 'requires_action', 'draft', 'processing', 'open', 'acknowledged', 'assigned'].includes(value)) return 'warning';
  if (['failed', 'rejected', 'suspended', 'revoked'].includes(value)) return 'danger';
  if (['sandbox', 'live'].includes(value)) return 'info';
  return 'neutral';
}

function sdkStatusTone(status: unknown): StatusTone {
  return toneFromStatus(status);
}

function sdkStatusLabel(status: unknown): string {
  const value = String(status || '').toLowerCase();
  if (value === 'live_npm') return 'Live on npm';
  if (value === 'live_pypi') return 'Live on PyPI';
  if (value === 'live_packagist') return 'Live on Packagist';
  if (value === 'release_ready') return 'Ready to publish';
  if (value === 'source_ready') return 'Source ready';
  if (value === 'bootstrap_available') return 'Available';
  if (value === 'planned') return 'Planned';
  return String(status || 'Planned').replace(/_/g, ' ');
}

function securityHealthTone(health: unknown): StatusTone {
  const value = String(health || '').toLowerCase();
  if (value === 'critical') return 'danger';
  if (value === 'attention') return 'warning';
  return 'success';
}

function securityHealthLabel(health: unknown): string {
  const value = String(health || '').toLowerCase();
  if (value === 'critical') return 'Critical review';
  if (value === 'attention') return 'Needs attention';
  return 'Healthy';
}

function securityHealthTitle(health: unknown): string {
  const value = String(health || '').toLowerCase();
  if (value === 'critical') return 'Security controls need immediate review.';
  if (value === 'attention') return 'Security controls are watching active issues.';
  return 'Security controls are healthy.';
}

function valueOf(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function arrayValue(record: Record<string, unknown>, ...keys: string[]) {
  const value = valueOf(record, ...keys);
  return Array.isArray(value) ? value.map(String) : [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function hostnameFromUrl(value: string) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
