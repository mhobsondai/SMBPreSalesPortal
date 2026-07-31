# Runbook — upgrading to the Standard SKU

Reverses AD-06. Restores single-tenant Entra authentication and closes
the "static assets are public to any signed-in Microsoft account" gap.

**Effort:** ~30 minutes. **Application code changes: none.**
**Cost:** ~$9/app/month, billed per second and metered hourly — so a
part-month costs a part-month. Confirm the GBP figure in the portal.

---

## Why it's this cheap to do

The tenant policy in `api/shared/auth.py` is correct on **both** SKUs. On
Free it is the only line of defence; on Standard it becomes belt and
braces behind the platform. Nothing has to be unpicked — you are adding
a layer, not swapping one out.

---

## Steps

### 1 — Upgrade the SKU (5 min)

Azure Portal → your Static Web App → **Hosting plan** → **Standard** →
Save. In-place change: same resource, same hostname, same deployment
token. The GitHub workflow needs no edit.

### 2 — Create the Entra app registration (15 min)

Get the hostname first: Portal → your Static Web App → **Overview** →
**URL**. You need it for the redirect URI.

Entra admin centre (`entra.microsoft.com`) → **Applications** →
**App registrations** → **New registration**.

- Name: `SMB Pre-Sales Portal`
- Supported account types: **Accounts in this organizational directory only**
- Redirect URI: platform **Web**, value
  `https://<swa-hostname>/.auth/login/aad/callback`

Then **Certificates & secrets** → **New client secret**. Set the expiry
deliberately (24 months is the maximum) and **diarise it now**.

Copy the **Value** column immediately. Not the Secret ID — the Value, and
only once: navigate away and it is masked forever, and you have to issue
a new secret.

No API permissions are required. The default delegated `User.Read` is
harmless; SWA only needs OIDC sign-in, not Graph. No admin consent needed.

Optionally, **Token configuration** → add optional claims `email` and
`preferred_username` to the ID token — improves the display name without
a Graph call.

#### Enable ID tokens — required, and off by default

Still on **Authentication**, scroll to **Implicit grant and hybrid
flows** and tick **ID tokens (used for implicit and hybrid flows)**.
Save.

SWA's built-in auth uses the hybrid flow and requests an `id_token` in
the response. New app registrations have this disabled by default, so
sign-in fails with:

```
AADSTS700054: response_type 'id_token' is not enabled for the application.
```

Leave **Access tokens** unticked. SWA does not need it, and enabling it
needlessly widens what the registration can issue.

Note that this section only appears for a **Web** platform — if you
can't see it, the redirect URI is under the wrong platform type (see
trap 1 below).

#### Five traps

1. **Platform must be "Web", not "Single-page application".** SWA runs
   the OAuth exchange server-side using the client secret. The SPA
   platform type forbids secrets and expects PKCE, so choosing it
   produces an authentication failure that looks like a misconfigured
   redirect URI. This is the most common way to lose an hour here.

2. **Redirect URI must match exactly** — `https`, correct hostname, the
   full `/.auth/login/aad/callback` path, no trailing slash. Use the
   custom domain here too if you add one later; both can be listed.

3. **Secret Value ≠ Secret ID.** Pasting the ID into
   `AAD_CLIENT_SECRET` yields an authentication failure with no useful
   error text — typically an endless MFA loop, because SWA silently
   restarts the flow when the token exchange fails.

4. **ID tokens disabled** — see above. Distinctive because it produces a
   named error (`AADSTS700054`) rather than a silent loop.

5. **Client ID and secret from different app registrations.** The
   nastiest of the five, because nothing errors cleanly. Entra accepts
   the authorize request (the client ID is valid) and issues a token;
   SWA's callback then fails the exchange because the secret belongs to
   a different client. Result: a 302 back to `/.auth/login/aad` with
   `Set-Cookie: Nonce=deleted`, and an endless loop with no error
   message anywhere.

   Easy to cause if you create a registration, lose track of it, and
   make another. **Always copy the client ID and generate the secret in
   the same sitting, from the same registration's blades.**

#### Diagnosing sign-in failures

Symptoms overlap, so work from evidence rather than guesswork:

| Symptom | Likely cause |
|---|---|
| Repeating MFA prompt, no error shown | Token exchange failing — wrong secret value, or SPA platform type |
| `AADSTS700054` | ID tokens not enabled |
| `AADSTS50011` | Redirect URI mismatch |
| Straight back to the app, no Microsoft page | `auth` block not deployed — check `config_file_location` |

**Beware: the login loop is self-sustaining.** Each restart issues a
fresh `Nonce` cookie, so the token arriving from Entra is bound to an
older nonce that no longer matches. Once looping, it can never recover
on its own — retrying without clearing cookies always fails, whatever
you have fixed in between.

**Always clear cookies for the SWA hostname and for
`login.microsoftonline.com` before each test**, via DevTools →
Application → Storage → Cookies. Then close the browser and make exactly
one attempt. One clean attempt per hypothesis.

Anyone who signed in during a previous auth configuration will hit this
once. The fix is clearing their cookies for the site, not a change on
the server.

**Entra admin centre → Monitoring → Sign-in logs** is the definitive
source. Repeated *successes* there mean authentication is fine and the
failure is downstream in SWA. A *failure* with a Conditional Access
reason means corporate policy is blocking and Systems need to be
involved.

Always clear the session (`/.auth/logout`) and retry in a private window
after any change — a half-formed auth cookie will reproduce the old
symptom and make a working fix look broken.

### 3 — Add the app settings (5 min)

SWA → **Configuration** → Application settings:

| Name | Value |
|---|---|
| `AAD_CLIENT_ID` | Application (client) ID from step 2 |
| `AAD_CLIENT_SECRET` | The secret *value* from step 2 |

### 4 — Restore the `auth` block (5 min)

Add this to `staticwebapp.config.json`, as a sibling of `routes`, and
delete the `"//"` note explaining its absence:

```json
  "auth": {
    "identityProviders": {
      "azureActiveDirectory": {
        "registration": {
          "openIdIssuer": "https://login.microsoftonline.com/2e99fe9c-8eeb-485a-83e3-6c4179eded6d/v2.0",
          "clientIdSettingName": "AAD_CLIENT_ID",
          "clientSecretSettingName": "AAD_CLIENT_SECRET"
        }
      }
    }
  },
```

Push to `main`. Adding any custom registration disables **all**
service-defined providers automatically, so the `/.auth/login/github`
et al. 404 routes become redundant — harmless to leave, tidier to remove.

### 5 — Verify

- [ ] Sign in with a Codestone account — works as before
- [ ] Sign in with a personal Microsoft account in a private window —
      **rejected at the Microsoft login page**, before reaching the app.
      On Free it got as far as our Access denied screen; now it should
      not get in at all. That difference is the whole point of the upgrade.
- [ ] `/health` panel 2 shows a `tenant:` reason, not a `domain:` one
- [ ] Deep link works on hard refresh

---

## The one thing that could bite you

**User IDs may change.** The SWA `userId` is derived from the identity
provider registration. Switching from Microsoft's shared registration to
our own may produce different `userId` values for the same people.

That is harmless today — nothing is stored. It stops being harmless once
Phase 3 lands a database, because rows keyed on `userId` would orphan.

**Cheap insurance: key user records on the UPN (email), not `userId`,
from the very first table.** Keep `userId` as a non-authoritative column
if useful. This sidesteps the question entirely and costs nothing to do
up front.

Better still: **do the upgrade before Phase 3**, so the question never
arises. The game plan already puts it before Phase 2.

---

## Once on Standard

- Drop the email-domain fallback in `check_organisation` — the `tid`
  claim becomes reliable, and the domain check is the weaker of the two
  (see AD-06 residual risk 2).
- Static assets are now tenant-restricted, so AD-06 residual risk 1
  clears: commercial logic in the frontend becomes acceptable.
- You also gain: an SLA, 2 GB storage (up from 0.5 GB), 5 custom domains,
  bandwidth overage instead of the site simply stopping, and the option
  of bring-your-own Functions.
- Update AD-06 in `decisions.md` to record the date and that the exit
  condition was met.

## Downgrading again

Possible, but it re-opens every gap in AD-06 and would change user IDs a
second time. Treat Standard as one-way.

---

# Post-upgrade follow-ups

Two changes were deliberately held back from the deploy that introduced
the `auth` block. Do them **one at a time, in this order**, verifying
between each.

## Follow-up 1 — gate the static bundle

This is the change that actually delivers the security benefit of the
Standard SKU. Until it lands, the frontend is still served to anyone who
signs in.

In `staticwebapp.config.json`, change the last route:

```json
    { "route": "/*", "allowedRoles": ["authenticated"] }
```

Delete the `"//"` note above it. Push.

**Effect:** an unauthenticated visitor gets a 401, which
`responseOverrides` turns into a redirect to the Microsoft login. They
never receive the bundle.

**Side effect:** our branded `SignIn` screen becomes unreachable —
visitors go straight to Microsoft. `SignIn.tsx` stays in the tree because
the SWA CLI emulator still exercises that path locally, and reverting is
a one-line change. `AccessDenied` remains reachable and still matters.

**Verify:** in a private window, load the site without signing in. You
should be bounced to `login.microsoftonline.com` immediately, and the
Network tab should show no JS bundle delivered.

## Follow-up 2 — drop the email-domain fallback

**Only after** `/health` panel 2 shows a reason beginning `tenant:` on
the live site. If it shows `domain:`, the `tid` claim is not arriving and
removing the fallback will 403 every user including you.

In `api/shared/auth.py`, `check_organisation` becomes:

```python
    tid = principal.tenant_id
    if tid and tid in ALLOWED_TENANT_IDS:
        return AuthzResult(True, f"tenant:{tid}")
    return AuthzResult(False, f"tenant_not_allowed:{tid or 'no_claim'}")
```

Update the module docstring and the tests to match, then push.

**If you lock yourself out:** revert the commit and redeploy. The
deployment is the only recovery path — there is no portal override for
application logic. This is why follow-up 2 comes last and alone.
