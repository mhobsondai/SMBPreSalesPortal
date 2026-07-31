# Architecture decisions

## AD-01 — Azure Static Web Apps with platform-managed auth

**Decision.** Use the SWA built-in Entra ID provider rather than MSAL.js in
the browser.

**Why.** The browser never holds a token. SWA terminates the OIDC flow at the
edge, sets an encrypted HTTP-only session cookie, and injects the validated
identity into the API as `x-ms-client-principal`. Nothing in `localStorage`
to steal; no token-refresh code to get wrong; the client cannot forge the
header because SWA strips any inbound copy.

**Cost.** Locked to the SWA platform, and we only get the ID-token claims —
no downstream Graph or Fabric access token. When the portal needs to call
Fabric *as the user*, this decision gets revisited (see AD-04).

## AD-02 — Defence in depth on the API

Route-level `allowedRoles: ["authenticated"]` in `staticwebapp.config.json`
is the first gate. Every endpoint additionally runs `@require_auth`, which
decodes and validates the principal itself. Config drift is a real failure
mode; a route rule quietly weakened in a merge should not silently expose
data.

## AD-03 — Navigation as data

`frontend/src/config/practices.ts` is the single source of truth for areas
and tiles. One `PracticeAreaPage` component renders all three areas. Adding
a tool is a config change, not a code change — which matters because tools
will be added far more often than the shell changes.

## AD-04 — Fabric and Claude deferred

The API is a two-endpoint shell. Database and AI concerns land later as
`shared/db.py` and `shared/ai.py`; `function_app.py` stays routing-only.
Deferring them keeps the first deploy small enough to debug in one sitting.

## AD-05 — Tenant: Codestone directory, daicodestone domain

**Decision.** The portal authenticates against the Codestone directory,
tenant `2e99fe9c-8eeb-485a-83e3-6c4179eded6d`. `daicodestone.onmicrosoft.com`
is a domain within that directory, not a separate tenant — but it is
sufficient to register and own this application independently.

**Consequences.**

- Every Codestone account can sign in with no guest-invite process.
  Existing Conditional Access, MFA and device policy apply automatically.
- Single-tenant registration is correct and sufficient.
- App registration and secret rotation are self-service — no Systems
  dependency for day-to-day iteration.

**Open item.** Because the whole directory can authenticate, the portal is
open to every Codestone account, not just pre-sales. If that audience is
too wide once tools hold client data, add Entra app-role gating
(`allowedRoles` per route in `staticwebapp.config.json`). Cheap now,
awkward later.

## AD-06 — SUPERSEDED by AD-07 (Free SKU workaround)

*Retained for context. The app was briefly on the Free SKU, where custom
authentication is unavailable and the service-defined `aad` provider
accepts any Microsoft account from any tenant. The organisational
boundary was enforced solely in `api/shared/auth.py`. That constraint no
longer applies — see AD-07.*

## AD-07 — Standard SKU with custom Entra authentication

**Date:** 31 July 2026.

**Decision.** Upgraded to the Standard SWA SKU and restored the `auth`
block, pinning authentication to the Codestone tenant
(`2e99fe9c-8eeb-485a-83e3-6c4179eded6d`) via a dedicated app
registration.

**Effect.** Adding a custom registration disables all service-defined
providers, so `authenticated` now means "signed in against our tenant".
The AD-06 residual risks are resolved or resolvable:

| AD-06 risk | Status |
|---|---|
| 1. Static assets served to any signed-in Microsoft account | Resolved once `/*` is restricted — see "Outstanding" below |
| 2. Domain fallback weaker than tenant pinning | Resolvable — drop the fallback after verifying the `tid` claim arrives |
| 3. Public Codestone-branded login page | Resolved — outsiders are stopped at the Microsoft login |
| 4. No SLA | Resolved |

**The tenant check in `api/shared/auth.py` stays.** It is now belt and
braces rather than the only defence, and that is the point: platform auth
is configuration, and configuration drifts. A merge that drops the `auth`
block would silently reopen the app while the route rules still read
`allowedRoles: ["authenticated"]` and still look correct. The code check
fails closed and is covered by tests.

### Outstanding — two follow-ups, deliberately deferred

Both were held back from the deploy that introduced the `auth` block, so
that a single change could be verified in isolation. Changing auth
configuration and access rules simultaneously makes a failure impossible
to diagnose, and a redirect loop on a portal you're locked out of is an
unpleasant place to start debugging.

1. ~~**Restrict `/*` to `["authenticated"]`.**~~ **Done** — 31 July 2026,
   after login was confirmed working end to end. The static bundle is
   now tenant-gated; AD-06 residual risk 1 is closed.
2. **Drop the email-domain fallback** in `check_organisation`. Only
   after `/health` panel 2 shows a `tenant:` reason on the live site.

### Root cause of the deployment difficulty (for the record)

Sign-in looped silently for some hours. Cause: the client ID and client
secret came from **two different app registrations**. Entra accepted the
authorize request because the client ID was valid, issued a token, and
SWA's callback then failed the exchange against a secret belonging to a
different client — producing a 302 back to `/.auth/login/aad` with
`Set-Cookie: Nonce=deleted` and no error message anywhere.

Compounding it, the loop is self-sustaining: each restart issues a fresh
nonce, so the returning token is always bound to a stale one. Retrying
without clearing cookies fails regardless of what has been fixed.

Both are now documented in `docs/upgrade-to-standard.md` as traps 4 and
5, with a symptom→cause table.
