# SMB Pre-Sales Portal — Development Game Plan

**Status:** v0.1 scaffold complete and compiling. **Standard** SKU, custom
Entra authentication pinned to the Codestone tenant. App registration
created, client ID and secret in place.
**Phase 0 complete** — deployed, login verified end to end, static bundle
tenant-gated. One follow-up open: dropping the email-domain fallback,
pending confirmation that the `tid` claim arrives (AD-07).

---

## Phase 0 — Get it live (≈ 2–3 hours)

Nothing else matters until a signed-in page renders on a real URL. Do this
end to end before writing another line of feature code.

| # | Task | Effort |
|---|------|--------|
| 0.1 | ~~Create GitHub repo~~ — done. Push this folder into it | 10 min |
| 0.2 | ~~Entra app registration~~ — not needed on Free SKU | — |
| 0.3 | Replace Azure's workflow with `docs/workflow-reference.yml` | 10 min |
| 0.4 | Push and deploy | 15 min |
| 0.5 | Verify `/health` returns green | 15 min |

### 0.2 — No app registration required (Free SKU)

The service-defined `aad` provider uses Microsoft's own registration, so
there is nothing to create and no client ID or secret to configure.

**The trade:** that provider accepts any Microsoft account from any
tenant. The organisational boundary is enforced in
`api/shared/auth.py` instead — read AD-06 in `decisions.md` before
putting anything sensitive in this app.

Optionally tighten the policy without a redeploy via SWA →
Configuration → Application settings:

| Setting | Default |
|---|---|
| `ALLOWED_TENANT_IDS` | `2e99fe9c-8eeb-485a-83e3-6c4179eded6d` |
| `ALLOWED_EMAIL_DOMAINS` | `codestone.com,daicodestone.onmicrosoft.com` |

### 0.3 — Replace Azure's generated workflow

Azure's default workflow cannot build this repo: wrong paths, and the
Oryx container's glibc is too old for Rollup 4 (Vite 5's bundler).

Copy `docs/workflow-reference.yml` over
`.github/workflows/azure-static-web-apps-<name>.yml`, substituting the
real hostname-suffixed secret name. It builds the frontend on the Actions
runner and hands the SWA action a finished `dist/`.

Full explanation and a symptom→cause table in
**`docs/workflow-settings.md`**.

Commit `frontend/package-lock.json` — `npm ci` requires it.

### 0.4 — Wiring

Nothing to configure. No `auth` block, no client secret, no tenant
issuer. Commit `frontend/package-lock.json` and the replaced workflow,
push to `main`.

### 0.5 — Verification checklist

- [ ] Anonymous visit to `/` shows the sign-in screen, not a blank page
- [ ] Sign-in with your Codestone account returns to `/` and shows your name
- [ ] `/area/data-ai` renders the placeholder tile
- [ ] `/health` shows all three panels green
- [ ] Deep link `/area/erp` works on hard refresh (navigationFallback)

**The one that matters most — test the 403 path:**

- [ ] Sign in with a personal Microsoft account (or any non-Codestone
      address) in a private window. You must land on the **Access denied**
      screen, not the portal.

If that test lets you through, the API is not enforcing the policy —
check that `/api/me` is reachable at all (a missing API returns a network
error, and `AuthGate` correctly fails closed rather than admitting you,
but the symptom looks similar). `/health` panel 3 distinguishes the two.

---

## Phase 1 — Shell polish (≈ 4–6 hours)

Only after Phase 0 is green.

| # | Task | Effort |
|---|------|--------|
| 1.1 | Replace the placeholder brand mark with the real Codestone asset | 30 min |
| 1.2 | Error boundary around the router (a thrown render currently white-screens) | 45 min |
| 1.3 | Session-expiry handling — 401 from `/api/*` should redirect to login, not surface a raw error | 1 h |
| 1.4 | Favicon, `robots.txt` (disallow all), `noindex` meta | 20 min |
| 1.5 | Mobile pass on Landing and PracticeAreaPage | 1 h |
| 1.6 | Application Insights on the SWA + a `logEvent` helper | 1 h |

---

## Phase 2 — First real tool (≈ 1–2 weeks)

**Upgrade to Standard SKU first (~$9/app/month).** Restore the `auth`
block with the tenant issuer. Everything in Phase 2 involves commercial
logic or client inputs, and AD-06 residual risk 1 says that must not sit
on the Free tier. Runbook: `docs/upgrade-to-standard.md` — ~30 minutes,
no application code changes.

**Do it before Phase 3 regardless**, or key user records on UPN rather
than `userId` — the upgrade may change `userId` values, which would
orphan rows in any table keyed on them.


Pick **one** tool and build it all the way through. The second tool is
cheap; the first one is where the patterns get set.

**Recommendation: Data & AI → SAP BIA LabMat generator.** You already have
the skill and the domain rules encoded, the inputs are a document upload,
and the output is a file — so it exercises upload, processing and download
without needing a database first.

Sequence:

1. **Route + tile** — add the tile to `practices.ts` with `status: 'live'`,
   add `/tools/<slug>` to `main.tsx`. (1 h)
2. **Input form** — establish the shared form component vocabulary now;
   every subsequent tool reuses it. (1 day)
3. **API endpoint** — `POST /api/tools/<slug>`, add `shared/tools/<slug>.py`.
   Keep `function_app.py` as routing only. (1 day)
4. **File handling** — decide upload strategy before writing code:
   Blob Storage with a SAS URL, or in-memory for small files. The free SWA
   tier caps request bodies at **~100 MB**, and Functions consumption plan
   has a **230 s** timeout. Long jobs need a queue, not a request. (0.5 day)
5. **Download** — generate to Blob, return a time-limited SAS link. (0.5 day)

**Decision needed at step 4:** is any tool likely to exceed 230 s? If yes,
plan for Durable Functions now rather than retrofitting.

---

## Phase 3 — Persistence (≈ 1 week)

Reintroduce the Fabric database when there is something worth saving —
saved estimates, run history, audit trail. Not before.

- `shared/db.py` — connection via managed identity, not a connection string
- Just-in-time user provisioning on first `/api/me` call
- Audit table: who ran what, when, against which client
- **GDPR:** if tool inputs contain client data, define retention up front.
  Talk to Natasha Keskin (General Counsel) before storing anything
  client-identifiable.

---

## Phase 4 — Claude integration (≈ 1 week)

- `shared/ai.py`, API key in SWA app settings (never in the frontend bundle)
- Server-side only — the browser must never see the key
- Prompt templates in `api/prompts/*.md`, versioned with the code
- Per-user rate limiting, and a token-spend log from day one

---

## Risks worth tracking

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Free SKU: static assets served to any signed-in Microsoft account** (AD-06) | Frontend bundle is effectively public | Keep all logic and data server-side behind `/api/*`. Upgrade to Standard before Phase 2 |
| Domain fallback weaker than tenant pinning (AD-06) | Ex-employee with a personal MSA on a `@codestone.com` address could pass | Upgrade to Standard; `tid` becomes reliable and the fallback can be dropped |
| No SLA on Free tier | Unannounced downtime | Acceptable for a scaffold; not for a tool in a live bid |
| Free tier quotas: 100 GB bandwidth, 0.5 GB storage | Site stops being served when exceeded | Monitor; Standard raises both |
| Functions 230 s timeout | Long AI generations fail | Durable Functions or async job pattern |
| Oryx/glibc breakage recurs on dependency bumps | Build fails | Frontend is built on the Actions runner — insulated. Don't revert to Oryx builds |

## Immediate next action

Commit and push: the updated `staticwebapp.config.json` (no `auth`
block), `api/shared/auth.py`, the frontend changes, and
`frontend/package-lock.json`. Then run the 403 test in step 0.5 —
sign in with a non-Codestone Microsoft account and confirm you're
turned away. **≈ 15 minutes.**
