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
