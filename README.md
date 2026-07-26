# ORBI Pay Developer Portal UI

Developer Portal frontend for ORBI Pay Gateway.

This UI is built from the `index-2.html` prototype and structured as a Vite +
React application so it can be connected to the Pay Gateway developer endpoints.

## Run

```bash
npm i
npm run dev
```

Create `.env.local` from `.env.example`:

```env
VITE_ORBI_PAY_GATEWAY_BASE_URL=https://sandbox-pay.orbifinancial.com
VITE_ORBI_PORTAL_BFF_BASE_URL=/api/portal
VITE_ORBI_PORTAL_ENVIRONMENT=sandbox
```

Production browser bundles must not expose operator keys, service keys, webhook
secrets, OTP evidence, wallet authority fields, or provider credentials. The
Vercel BFF reads server-only variables without the `VITE_` prefix.

Server-only Vercel variables:

```env
ORBI_PAY_GATEWAY_SANDBOX_BASE_URL=https://sandbox-pay.orbifinancial.com
ORBI_PAY_GATEWAY_LIVE_BASE_URL=https://pay.orbifinancial.com
ORBI_PORTAL_SANDBOX_OPERATOR_KEY=<server-only-sandbox-operator-key>
ORBI_PORTAL_LIVE_OPERATOR_KEY=<server-only-live-operator-key>
ORBI_PORTAL_DATABASE_URL=<postgres-url-for-portal-users-and-audit>
ORBI_PORTAL_AUTH_SECRET=<server-only-session-signing-secret>
ORBI_PORTAL_SESSION_TTL_SECONDS=28800
ORBI_PORTAL_ADMIN_EMAIL=<admin-email>
ORBI_PORTAL_ADMIN_NAME=ORBI Admin
ORBI_PORTAL_ADMIN_ROLE=admin
ORBI_PORTAL_ADMIN_PASSWORD_SALT=<password-salt>
ORBI_PORTAL_ADMIN_PASSWORD_HASH=<pbkdf2-sha256-base64url-hash>
ORBI_PORTAL_ADMIN_PASSWORD_ITERATIONS=210000
ORBI_PORTAL_ADMIN_TOTP_SECRET=<base32-authenticator-secret>
ORBI_PORTAL_ADMIN_MFA_REQUIRED=true
ORBI_PORTAL_TOTP_ISSUER=ORBI Pay Developer Portal
```

Role control must come from login/session claims:

```text
public_developer -> public docs, SDKs, runtime contract, sandbox guide
developer        -> own service docs, sandbox, own health/webhook visibility
operator         -> service approval, scopes, keys, secrets, webhook replay
admin            -> operator access plus risk, account, and audit oversight
```

Roles now come from `/api/portal/auth/login` session claims. The browser never
receives operator keys. Operator actions are proxied through `/api/portal/gateway`
and require a signed BFF session token issued after login.

For production, set `ORBI_PORTAL_DATABASE_URL`. The BFF creates
`orbi_portal_users` and `orbi_portal_audit_events` if they do not exist. Without
the database URL, the portal can only use the bootstrap admin from environment
variables and cannot persist team users or admin audit events.

MFA QR setup is generated inside the browser from the server-provided
`otpauth://` URI. The portal does not call third-party QR services.

To generate a password hash for a bootstrap admin:

```bash
node -e "const crypto=require('node:crypto');const p=process.argv[1];const salt=crypto.randomBytes(16).toString('base64url');const i=210000;const h=crypto.pbkdf2Sync(p,salt,i,32,'sha256').toString('base64url');console.log({salt,hash:h,iterations:i})" "replace-with-strong-password"
```

Public and registered developers do not get a Live environment switch. They use
sandbox by default, then submit a production access request. ORBI operator/admin
reviews the request, grants scopes, checks allowlists/merchant readiness, and
issues unique production API keys and webhook secrets after approval.

Access is backend driven:

```text
Environment switch visibility comes from authenticated role plus service environments.
Capabilities come from service scopesGranted/scopesPending.
Denied capabilities remain visible as denied/request required, never silently enabled.
If an account/identity lacks backend authority, Gateway returns access denied.
```

## Build

```bash
npm run check
```

## Developer SDK Setup Flow

Node.js SDK is live on npm:

```bash
npm i @orbifinancial/pay-gateway
```

1. Store server env vars:

```env
ORBI_PAY_GATEWAY_BASE_URL=https://sandbox-pay.orbifinancial.com
ORBI_PAY_ENVIRONMENT=Demo
ORBI_PAY_SERVICE_KEY=orbi_sandbox_xxx
ORBI_PAY_WEBHOOK_SECRET=orbi_whsec_sandbox_xxx
ORBI_PAY_RETURN_URL=https://merchant.example.com/orbi/return
ORBI_PAY_CANCEL_URL=https://merchant.example.com/orbi/cancel
ORBI_PAY_WEBHOOK_URL=https://merchant.example.com/api/orbi/webhooks
```

2. Create SDK client:

```ts
import { createOrbi } from '@orbifinancial/pay-gateway';

const orbi = createOrbi({
  baseUrl: process.env.ORBI_PAY_GATEWAY_BASE_URL!,
  serviceKey: process.env.ORBI_PAY_SERVICE_KEY!,
  environment: process.env.ORBI_PAY_ENVIRONMENT === 'Production' ? 'Production' : 'Demo',
});
```

3. Send payment with a stable idempotency key:

```ts
await orbi.transfers.send({
  reference: 'ORDER-10001',
  amount: 125000,
  currency: 'TZS',
  customer: { phone: '+255700000000' },
  returnUrl: process.env.ORBI_PAY_RETURN_URL!,
  cancelUrl: process.env.ORBI_PAY_CANCEL_URL!,
  callbackUrl: process.env.ORBI_PAY_WEBHOOK_URL!,
}, {
  idempotencyKey: 'payment-intent:merchant:ORDER-10001',
});
```

4. Redirect when `challengeUrl` is returned, then trust signed webhook plus intent read as payment truth.

Python SDK is live on PyPI:

```bash
pip install orbi-pay-gateway
```

PHP SDK is live on Packagist:

```bash
composer require orbifinancial/pay-gateway
```

## Current Scope

- Real Gateway connection status from `/health` and `/ready`.
- Overview from `/v1/developer/services`, `/v1/developer/service-applications`, `/v1/developer/events`, `/v1/developer/webhook-deliveries`, and `/v1/developer/integration-health`.
- Services, applications, scopes, consent catalog, docs, SDK catalog, sandbox accounts, webhook deliveries, replay actions, and SDK-first API reference.
- Runtime developer instruction is SDK-first. Raw `/v1/...` endpoints are shown only as low-level HTTP reference for advanced debugging and generated clients.
- Login-role segmented portal surfaces for public developers, developers, operators, and admin/risk staff.
- Explicit empty/error states when credentials are missing or Gateway endpoints fail.
- No mock operational service, payment, webhook, or financial data is displayed as real data.

The portal must never move money directly. It configures services and shows
operational visibility. Real financial movement stays in ORBI Pay Gateway and
ORBI Core.
