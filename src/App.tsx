import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
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
  loginPortalWithOtp,
  logoutPortal,
  readStoredPortalSession,
  signupPortalDeveloper,
  validatePortalSession,
  type DeveloperEvent,
  type PortalConfig,
  type PortalSession,
  type PortalUser,
  type PortalSnapshot,
  type OperatorIncident,
  type SandboxAccount,
  type ServiceApplication,
  type ServiceRecord,
  type WebhookDelivery,
} from './api';
import { Environment, navItems, SectionId, StatusTone } from './data';

type PortalRole = 'public_developer' | 'developer' | 'operator' | 'admin';

const titleFor: Record<SectionId, string> = {
  overview: 'Overview',
  services: 'Integrations',
  access: 'Get Access',
  sandbox: 'Sandbox',
  keys: 'Keys & Secrets',
  team: 'Team Access',
  scopes: 'Permissions',
  webhooks: 'Payment Updates',
  health: 'System Checks',
  incidents: 'Service Issues',
  docs: 'Docs & SDKs',
  events: 'Activity Logs',
  runtime: 'SDK Setup',
};

type PortalState = {
  loading: boolean;
  snapshot?: PortalSnapshot;
  errors: Array<{ name: string; error: string }>;
  lastLoadedAt?: Date;
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
    subtitle: 'Access and service control',
    initials: 'OP',
    policy: 'Operators can approve integrations, manage permissions, rotate keys, replay payment updates, and suspend risky accounts.',
  },
  admin: {
    label: 'Admin / Risk',
    subtitle: 'Governance console',
    initials: 'AR',
    policy: 'Admins review system checks, activity logs, payment update delivery, and high-risk integration states.',
  },
};

const money = new Intl.NumberFormat('en-TZ', {
  style: 'currency',
  currency: 'TZS',
  maximumFractionDigits: 0,
});

export function App() {
  const [section, setSection] = useState<SectionId>('overview');
  const [session, setSession] = useState<PortalSession | undefined>(() => readStoredPortalSession());
  const role = session?.user.role || 'public_developer';
  const currentRole = roleMeta[role];
  const [environment, setEnvironment] = useState<Environment>(
    roleCanSwitchEnvironment(role)
      ? ((import.meta.env.VITE_ORBI_PORTAL_ENVIRONMENT === 'live' ? 'live' : 'sandbox') as Environment)
      : 'sandbox',
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modal, setModal] = useState<'service' | 'key' | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [portalState, setPortalState] = useState<PortalState>({ loading: true, errors: [] });

  const config = useMemo(() => ({ ...getPortalConfig(environment), sessionToken: session?.token }), [environment, session?.token]);

  const loadPortal = async () => {
    setPortalState((current) => ({ ...current, loading: true }));
    const { snapshot, errors } = await fetchPortalSnapshot(config, roleToAccessLevel(role));
    setPortalState({ loading: false, snapshot, errors, lastLoadedAt: new Date() });
  };

  useEffect(() => {
    void loadPortal();
  }, [config.baseUrl, config.bffBaseUrl, config.environment, config.sessionToken]);

  useEffect(() => {
    const openSignup = () => {
      setAuthMode('signup');
      setAuthOpen(true);
    };
    window.addEventListener('orbi-open-signup', openSignup);
    return () => window.removeEventListener('orbi-open-signup', openSignup);
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
  };

  const signOut = async () => {
    await logoutPortal(config);
    setSession(undefined);
    setEnvironment('sandbox');
    setSection('overview');
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="orbi-mark">O</div>
          <div>
            <div className="brand-name">ORBI Pay</div>
            <div className="brand-subtitle">Developer Portal</div>
          </div>
          <button className="icon-button mobile-only" onClick={() => setSidebarOpen(false)} aria-label="Close menu">
            <X size={20} />
          </button>
        </div>

        <EnvironmentSwitch environment={environment} setEnvironment={setEnvironment} role={role} snapshot={portalState.snapshot} compact />
        <RoleBadge role={role} />

        <nav className="nav-list">
          {navItems.filter((item) => isSectionVisibleForRole(item.id, role)).map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={`nav-item ${section === item.id ? 'active' : ''}`}
                key={item.id}
                onClick={() => navigate(item.id)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-user">
          <div className="avatar">{currentRole.initials}</div>
          <div>
            <strong>{session?.user.name || currentRole.label}</strong>
            <small>{currentRole.subtitle}</small>
            <span>{config.baseUrl.replace(/^https?:\/\//, '')}</span>
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
            <input placeholder="Search integrations, permissions, activity..." />
          </div>
          <h1>{titleFor[section]}</h1>
          <EnvironmentSwitch environment={environment} setEnvironment={setEnvironment} role={role} snapshot={portalState.snapshot} />
          {roleCanManageServices(role) ? (
            <button className="primary-action" onClick={() => setModal('service')}>
              <Plus size={18} />
              <span>New Integration</span>
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
          <Breadcrumb section={titleFor[section]} />
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
          <SectionRenderer
            section={section}
            role={role}
            config={config}
            portalState={portalState}
            refresh={loadPortal}
            openKeyModal={() => setModal('key')}
          />
        </div>
      </main>

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

function isSectionVisibleForRole(section: SectionId, role: PortalRole) {
  if (role === 'public_developer') return ['overview', 'access', 'sandbox', 'docs', 'runtime'].includes(section);
  if (role === 'developer') return ['overview', 'access', 'sandbox', 'docs', 'runtime', 'keys', 'scopes', 'webhooks', 'health'].includes(section);
  if (role === 'operator') return ['overview', 'services', 'access', 'keys', 'scopes', 'webhooks', 'health', 'incidents', 'events'].includes(section);
  return ['overview', 'services', 'access', 'keys', 'team', 'scopes', 'webhooks', 'health', 'incidents', 'events', 'runtime'].includes(section);
}

function roleCanSwitchEnvironment(role: PortalRole, snapshot?: PortalSnapshot) {
  if (role === 'operator' || role === 'admin') return true;
  if (role !== 'developer') return false;
  return (snapshot?.services || []).some((service) => {
    const environments = arrayValue(service, 'environments');
    return String(service.status || '').toLowerCase() === 'active' && environments.includes('sandbox') && environments.includes('live');
  });
}

function roleCanManageServices(role: PortalRole) {
  return role === 'operator' || role === 'admin';
}

function EnvironmentSwitch({
  environment,
  setEnvironment,
  role,
  snapshot,
  compact = false,
}: {
  environment: Environment;
  setEnvironment: (environment: Environment) => void;
  role: PortalRole;
  snapshot?: PortalSnapshot;
  compact?: boolean;
}) {
  if (!roleCanSwitchEnvironment(role, snapshot)) {
    return (
      <div className={`environment-lock ${compact ? 'compact' : ''}`}>
        <span>Sandbox only</span>
        <strong>Request live access</strong>
      </div>
    );
  }

  return (
    <div className={`environment-switch ${compact ? 'compact' : ''}`}>
      <button className={environment === 'sandbox' ? 'active' : ''} onClick={() => setEnvironment('sandbox')}>
        Sandbox
      </button>
      <button className={environment === 'live' ? 'active live' : ''} onClick={() => setEnvironment('live')}>
        Live
      </button>
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
            ? `${config.baseUrl} · ${config.environment} · ${state.lastLoadedAt ? `loaded ${state.lastLoadedAt.toLocaleTimeString()}` : 'not loaded yet'}`
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
        <span>Environment</span>
        <strong>{environment === 'live' ? 'Production' : 'Sandbox'}</strong>
        <small>{environment === 'live' ? 'Real customer payments' : 'Safe test payments'}</small>
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
  refresh,
  openKeyModal,
}: {
  section: SectionId;
  role: PortalRole;
  config: PortalConfig;
  portalState: PortalState;
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
  if (section === 'scopes') return <ScopesAndConsent config={config} state={portalState} refresh={refresh} role={role} />;
  if (section === 'webhooks') return <Webhooks config={config} state={portalState} refresh={refresh} role={role} />;
  if (section === 'health') return <Health state={portalState} />;
  if (section === 'incidents') return <OperatorIncidents config={config} state={portalState} refresh={refresh} />;
  if (section === 'docs') return <Docs state={portalState} config={config} />;
  if (section === 'events') return <AuditEvents state={portalState} />;
  return <SdkApiReference state={portalState} config={config} role={role} />;
}

function AccessDenied({ role, section }: { role: PortalRole; section: SectionId }) {
  return (
    <div className="panel wide-panel">
      <EmptyState
        title="This area needs the right account access"
        detail={`${roleMeta[role].label} cannot open ${titleFor[section]}. Sign in with an approved ORBI developer account to continue.`}
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
            <MetricCard label="Active integrations" value={String(activeServices.length)} tone="success" detail="Approved services ready for use" />
            <MetricCard label="Pending reviews" value={String(pendingApplications.length)} tone="warning" detail="Applications waiting for review" />
            <MetricCard label="Payment updates" value={String(failedWebhooks.length)} tone={failedWebhooks.length ? 'warning' : 'success'} detail="Updates that may need retry" />
            <MetricCard label="Open incidents" value={String(activeIncidents.length)} tone={activeIncidents.length ? 'danger' : 'success'} detail={activeIncidents.length ? 'Operator action required' : 'No active incidents'} />
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
          <p className="eyebrow">{role.includes('developer') ? 'Developer journey' : role === 'operator' ? 'Team console' : 'Admin view'}</p>
          <h2>{role.includes('developer') ? 'Launch ORBI payments with confidence.' : 'Run BaaS access with auditable controls.'}</h2>
          <p>
            {role.includes('developer')
              ? 'Use ORBI SDKs, sandbox guides, hosted checkout, PaySafe escrow, and webhooks to build secure customer payments.'
              : 'Your team can approve integrations, manage permissions, rotate keys, replay payment updates, and suspend risky accounts.'}
          </p>
        </div>
        <div className="readiness-mini">
          <div><Check size={16} /><span>Integration onboarding</span></div>
          <div><Check size={16} /><span>Approved access</span></div>
          <div><Check size={16} /><span>Payment update replay</span></div>
          <div><Check size={16} /><span>Sandbox/live separation</span></div>
        </div>
      </div>

      <div className="panel wide-panel policy-panel">
        <div>
          <p className="eyebrow">What you can do</p>
          <h2>{roleMeta[role].label}</h2>
          <p>{roleMeta[role].policy}</p>
        </div>
        <StatusPill tone={roleCanManageServices(role) ? 'success' : role === 'developer' ? 'info' : 'warning'}>
          {roleCanManageServices(role) ? 'Team controls' : role === 'developer' ? 'Sandbox builder' : 'Learn first'}
        </StatusPill>
      </div>

      <EndpointErrors errors={state.errors} role={role} />
      {isStaff ? (
        <RecentEvents events={snapshot?.events || []} />
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

function ServiceCard({ config, service, refresh, role }: { config: PortalConfig; service: ServiceRecord; refresh: () => void; role: PortalRole }) {
  const code = String(service.serviceCode || service.code || 'unknown-service');
  const granted = arrayValue(service, 'scopesGranted', 'scopes_granted', 'scopesApproved', 'scopes_approved');
  const pending = arrayValue(service, 'scopesPending', 'scopes_pending');
  const browserOrigins = arrayValue(service, 'browserOrigins', 'browser_origins');
  const redirectUrls = arrayValue(service, 'redirectUrls', 'redirect_urls');
  const webhookUrls = arrayValue(service, 'webhookUrls', 'webhook_urls');
  const metadata = objectValue(service.metadata);
  const merchant = objectValue(metadata.merchant);

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
      {['operator', 'admin'].includes(role) && <ServiceStatusActions config={config} serviceCode={code} status={String(service.status || '')} refresh={refresh} />}
    </article>
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
  const selectedService = services[0];
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
      <AccessRequestPanel config={config} serviceCode={selectedServiceCode} role={role} refresh={refresh} />
    </div>
  );
}

function AccessRequestPanel({
  config,
  serviceCode,
  role,
  refresh,
}: {
  config: PortalConfig;
  serviceCode: string;
  role: PortalRole;
  refresh: () => void;
}) {
  const [requestedScope, setRequestedScope] = useState('escrow:create');
  const [message, setMessage] = useState<string>();
  const [working, setWorking] = useState(false);
  const canRequestScope = Boolean(serviceCode) && role !== 'public_developer';

  const requestScope = async () => {
    setWorking(true);
    const result = await gatewayRequest(config, `/v1/developer/services/${encodeURIComponent(serviceCode)}/scope-requests`, 'operator', {
      method: 'POST',
      body: JSON.stringify({
        environment: config.environment,
        requestedScopes: [requestedScope],
        reason: `Developer requested ${requestedScope} capability from Access & Requests control panel.`,
      }),
    });
    setMessage(result.ok ? `${requestedScope} request submitted.` : result.error);
    setWorking(false);
    if (result.ok) refresh();
  };

  return (
    <div className="panel wide-panel">
      <PanelHeader title="Request Permission" />
      <p className="security-note">
        Choose the ORBI feature your integration needs. ORBI reviews sensitive payment features before enabling them.
      </p>
      <div className="form-grid">
        <label>Integration code<input value={serviceCode || 'No integration assigned'} readOnly /></label>
        <label>
          Permission
          <select value={requestedScope} onChange={(event) => setRequestedScope(event.target.value)}>
            {accessCapabilities.map((capability) => (
              <option value={capability.scope} key={capability.scope}>{capability.title}</option>
            ))}
          </select>
        </label>
      </div>
      <button className="button-primary inline-link" disabled={!canRequestScope || working} onClick={requestScope}>
        {working ? 'Submitting' : 'Submit request'} <ArrowRight size={16} />
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

  return (
    <div className="row-actions">
      <button className="ghost-action" disabled={!canApprove || working} onClick={approve}>
        <Check size={14} /> Approve
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
      <div className="sandbox-banner">
        <AlertTriangle size={20} />
        <div>
          <strong>Sandbox uses test money only.</strong>
          <span>Practice the full payment flow safely before using production.</span>
        </div>
      </div>

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
          <p>Reset test accounts and start again when you want a clean demo run.</p>
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

  return (
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
  );
}

function TeamAccess({ config, state, refresh }: { config: PortalConfig; state: PortalState; refresh: () => void }) {
  const users = state.snapshot?.portalUsers || [];
  const audit = state.snapshot?.portalAudit || [];
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'developer' | 'operator' | 'admin'>('developer');
  const [password, setPassword] = useState('');
  const [mfaRequired, setMfaRequired] = useState(true);
  const [liveAccess, setLiveAccess] = useState(false);
  const [message, setMessage] = useState<string>();
  const [mfaSetup, setMfaSetup] = useState<{ otpauthUri: string; secret: string }>();
  const [working, setWorking] = useState(false);

  const loadOwnMfa = async () => {
    setMessage(undefined);
    try {
      const url = new URL(`${config.bffBaseUrl}/auth/mfa`, window.location.origin);
      url.searchParams.set('environment', config.environment);
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          ...(config.sessionToken ? { Authorization: `Bearer ${config.sessionToken}` } : {}),
        },
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(String(body?.error || `MFA setup failed with HTTP ${response.status}`));
        return;
      }
      setMfaSetup(body.data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load authenticator setup.');
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
        body: JSON.stringify({ email, name, role, password, mfaRequired, liveAccess }),
      });
      const body = await response.json().catch(() => null);
      setMessage(response.ok ? 'Portal account created.' : String(body?.error || `Request failed with HTTP ${response.status}`));
      if (response.ok) {
        if (body?.data?.mfaSetup?.otpauthUri) setMfaSetup(body.data.mfaSetup);
        setEmail('');
        setName('');
        setPassword('');
        refresh();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create portal account.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="stack">
      <div className="panel wide-panel">
        <PanelHeader title="Portal Team Access" />
        <p className="security-note">
          Create controlled developer, operator, and admin access. Store passwords securely and enable MFA for production users.
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
          <label>Password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="Minimum 12 characters" /></label>
        </div>
        <div className="toggle-row">
          <label><input type="checkbox" checked={mfaRequired} onChange={(event) => setMfaRequired(event.target.checked)} /> Require MFA</label>
          <label><input type="checkbox" checked={liveAccess} onChange={(event) => setLiveAccess(event.target.checked)} /> Live access</label>
        </div>
        <button className="button-primary inline-link" disabled={working || !email || !password || !name} onClick={createUser}>
          {working ? 'Creating' : 'Create account'}
        </button>
        <button className="ghost-action inline-link" onClick={loadOwnMfa}>Show my QR setup</button>
        {message && <div className="inline-message">{message}</div>}
        {mfaSetup && <AuthenticatorQr setup={mfaSetup} />}
      </div>

      <div className="panel wide-panel">
        <PanelHeader title="Active Portal Users" />
        <DataTable
          columns={['Name', 'Email', 'Role', 'MFA', 'Live', 'Status']}
          rows={users.map((user) => [
            String(user.name || '-'),
            String(user.email || '-'),
            <StatusPill tone={user.role === 'admin' ? 'danger' : user.role === 'operator' ? 'warning' : 'info'}>{String(user.role || 'developer')}</StatusPill>,
            user.mfaRequired ? 'Required' : 'Not required',
            user.liveAccess ? 'Enabled' : 'Sandbox only',
            user.enabled === false ? 'Disabled' : 'Enabled',
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
      {['operator', 'admin'].includes(role) && <ScopeRequestPanel config={config} refresh={refresh} />}
    </div>
  );
}

function ScopeRequestPanel({ config, refresh }: { config: PortalConfig; refresh: () => void }) {
  const [serviceCode, setServiceCode] = useState('');
  const [scope, setScope] = useState('payments:create');
  const [message, setMessage] = useState<string>();

  const submit = async () => {
    const result = await gatewayRequest(config, `/v1/developer/services/${encodeURIComponent(serviceCode.trim())}/scope-requests`, 'operator', {
      method: 'POST',
      body: JSON.stringify({
        environment: config.environment,
        requestedScopes: [scope],
        reason: `Request ${scope} from Developer Portal for controlled integration access.`,
      }),
    });
    setMessage(result.ok ? 'Permission request submitted.' : result.error);
    if (result.ok) refresh();
  };

  return (
    <div className="operator-form">
      <h3>Request Permission</h3>
      <label>Integration code<input value={serviceCode} onChange={(event) => setServiceCode(event.target.value)} placeholder="orbi-shop" /></label>
      <label>Permission<input value={scope} onChange={(event) => setScope(event.target.value)} placeholder="payments:create" /></label>
      <button className="button-primary inline-link" onClick={submit}>Submit permission request</button>
      {message && <div className="inline-message">{message}</div>}
    </div>
  );
}

function Webhooks({ config, state, refresh, role }: { config: PortalConfig; state: PortalState; refresh: () => void; role: PortalRole }) {
  const [replaying, setReplaying] = useState<string>();
  const [message, setMessage] = useState<string>();
  const deliveries = state.snapshot?.webhookDeliveries || [];
  const messageDeliveries = state.snapshot?.messagingDeliveries || [];

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
        {message && <div className="inline-message">{message}</div>}
        <DataTable
          columns={['Update ID', 'Type', 'Payment', 'Status', 'HTTP', 'Attempts', 'Action']}
          rows={deliveries.map((delivery) => {
            const deliveryId = String(delivery.deliveryId || delivery.id || '-');
            return [
              <Copyable value={deliveryId} />,
              String(delivery.eventType || '-'),
              String(delivery.resourceId || delivery.intentId || '-'),
              <StatusPill tone={toneFromStatus(delivery.status)}>{String(delivery.status || 'unknown')}</StatusPill>,
              String(delivery.httpStatus || delivery.statusCode || '-'),
              String(delivery.attempts || delivery.attempt || 0),
              <button className="ghost-action" disabled={deliveryId === '-' || replaying === deliveryId} onClick={() => replay(deliveryId)}>
                <RotateCcw size={15} /> Replay
              </button>,
            ];
          })}
          empty="No payment updates yet."
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

function Docs({ state, config }: { state: PortalState; config: PortalConfig }) {
  const docs = state.snapshot?.docs || [];
  const sdks = state.snapshot?.sdks || [];
  return (
    <div className="stack">
      <div className="panel wide-panel">
        <PanelHeader title="Maintained Docs Catalog" />
        <div className="docs-grid">
          {docs.length ? docs.map((doc, index) => <DocCard item={doc} baseUrl={config.baseUrl} key={String(doc.id || index)} />) : (
            <EmptyState title="No docs catalog returned" detail="Requires /v1/developer/docs-catalog." />
          )}
        </div>
      </div>
      <div className="panel wide-panel">
        <PanelHeader title="SDK Catalog" />
        <DataTable
          columns={['Language', 'Package', 'Status', 'Docs']}
          rows={sdks.map((sdk) => [
            String(sdk.language || sdk.id || '-'),
            String(sdk.packageName || sdk.package || '-'),
            <StatusPill tone={sdkStatusTone(sdk.status)}>{sdkStatusLabel(sdk.status)}</StatusPill>,
            <a className="ghost-action" href={`${config.baseUrl}${String(sdk.docsPath || '')}`} target="_blank" rel="noreferrer">
              Open <ExternalLink size={14} />
            </a>,
          ])}
          empty="No SDK catalog returned."
        />
      </div>
      <div className="panel code-panel">
      <PanelHeader title="Quick SDK Example" />
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

function DocCard({ item, baseUrl }: { item: Record<string, unknown>; baseUrl: string }) {
  const path = String(item.path || item.docsPath || '#');
  const href = path.startsWith('http') ? path : `${baseUrl}${path}`;
  return (
    <a className="doc-card" href={href} target="_blank" rel="noreferrer">
      <ExternalLink size={22} />
      <div>
        <strong>{String(item.title || item.id || 'Developer resource')}</strong>
        <span>{String(item.category || item.status || item.description || 'ORBI Pay resource')}</span>
      </div>
      <ArrowRight size={15} />
    </a>
  );
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
  return (
    <div className={`secret-code-panel ${compact ? 'compact' : ''}`}>
      <div className="secret-code-toolbar">
        <div>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
        <StatusPill tone="warning">Shown once</StatusPill>
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
  initialMode: 'signin' | 'signup';
  onClose: () => void;
  onSignedIn: (session: PortalSession) => void;
}) {
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [countryCode, setCountryCode] = useState('TZ');
  const [useCase, setUseCase] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [message, setMessage] = useState<string>();
  const [working, setWorking] = useState(false);

  const submitLogin = async () => {
    setWorking(true);
    setMessage(undefined);
    const result = await loginPortalWithOtp(config, email, password, otp);
    setWorking(false);
    if (!result.ok) {
      setMessage(result.error);
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
    setMessage(result.data.nextStep || 'Account created. Sign in to start building in sandbox.');
    setMode('signin');
    setOtp('');
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card auth-card">
        <button className="icon-button modal-close" onClick={onClose} aria-label="Close login">
          <X size={20} />
        </button>
        <p className="eyebrow">ORBI Developer Access</p>
        <h2>{mode === 'signup' ? 'Create your developer account' : 'Sign in to ORBI Pay'}</h2>
        <p className="modal-copy">
          {mode === 'signup'
            ? 'Start in sandbox, test real ORBI payment flows safely, then request production access when your business is ready.'
            : 'Use your developer, operator, or admin account to continue your ORBI integration work.'}
        </p>
        <div className="auth-tabs">
          <button className={mode === 'signup' ? 'active' : ''} onClick={() => { setMode('signup'); setMessage(undefined); }}>Create account</button>
          <button className={mode === 'signin' ? 'active' : ''} onClick={() => { setMode('signin'); setMessage(undefined); }}>Sign in</button>
        </div>
        {mode === 'signup' && (
          <>
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
              Business or project
              <input value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="Example: Tag Commerce, SACCOS portal" autoComplete="organization" />
            </label>
          </>
        )}
        <label>
          Email
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@business.com" autoComplete="email" />
        </label>
        <label>
          Password
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={mode === 'signup' ? 'At least 12 characters' : 'Your portal password'}
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void (mode === 'signup' ? submitSignup() : submitLogin());
            }}
          />
        </label>
        {mode === 'signup' ? (
          <>
            <div className="form-row">
              <label>
                Country
                <input value={countryCode} onChange={(event) => setCountryCode(event.target.value.toUpperCase().slice(0, 2))} placeholder="TZ" />
              </label>
            </div>
            <label>
              What are you building?
              <textarea
                value={useCase}
                onChange={(event) => setUseCase(event.target.value)}
                placeholder="Example: I want to accept ORBI Pay in my marketplace and receive signed payment updates."
                rows={4}
              />
            </label>
            <label className="checkbox-line">
              <input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} />
              <span>I agree to use sandbox safely and request approval before live customer payments.</span>
            </label>
          </>
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
          className="button-primary full"
          onClick={mode === 'signup' ? submitSignup : submitLogin}
          disabled={working || !email.trim() || !password || (mode === 'signup' && (!name.trim() || !username.trim() || !companyName.trim() || !useCase.trim() || !termsAccepted))}
        >
          {working ? (mode === 'signup' ? 'Creating account' : 'Signing in') : mode === 'signup' ? 'Create sandbox account' : 'Sign in'}
        </button>
        {message && <div className={`inline-message ${mode === 'signin' && message.toLowerCase().includes('invalid') ? 'danger' : 'info'}`}>{message}</div>}
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
    const result = await gatewayRequest(config, `/v1/developer/services/${encodeURIComponent(serviceCode.trim())}/api-keys/issue`, 'operator', {
      method: 'POST',
      portalConfirmationAccepted: true,
      portalReason: reason,
      body: JSON.stringify({
        environment: config.environment,
        requestedBy: 'portal-session',
        reason,
      }),
    });
    setMessage(result.ok ? 'API key issued. Copy the one-time secret from the response in secure operator flow.' : result.error);
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

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
