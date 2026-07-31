# SMB Pre-Sales Portal — Development Game Plan

**Status:** v0.1 scaffold complete and compiling. Tenant issuer wired in.
Static Web App created and linked to the GitHub repo.
**Blocker:** Entra app registration + deployment-workflow reconciliation.

---

## Phase 0 — Get it live (≈ 2–3 hours)

Nothing else matters until a signed-in page renders on a real URL. Do this
end to end before writing another line of feature code.

| # | Task | Effort |
|---|------|--------|
| 0.1 | ~~Create GitHub repo~~ — done. Push this folder into it | 10 min |
| 0.2 | Entra app registration (self-service, daicodestone) | 20 min |
| 0.3 | Fix `app_location`/`api_location`/`output_location` in Azure's workflow | 10 min |
| 0.4 | Add client ID/secret to SWA settings, push, deploy | 30 min |
| 0.5 | Verify `/health` returns green | 15 min |

### 0.2 — Entra app registration

Self-service under `daicodestone.onmicrosoft.com`.

1. Entra admin centre → **App registrations** → New registration
   - Name: `SMB Pre-Sales Portal`
   - Supported account types: **Accounts in this organizational directory only**
   - Redirect URI (Web): `https://<swa-hostname>/.auth/login/aad/callback`
     — the SWA already exists, so take the hostname from
     Azure Portal → your Static Web App → Overview → URL.
2. Record the **Application (client) ID**. The tenant ID is already
   wired into `staticwebapp.config.json`
   (`2e99fe9c-8eeb-485a-83e3-6c4179eded6d`).
3. **Certificates & secrets** → New client secret → record the *value*
   (not the ID). Set a calendar reminder for expiry.
4. **Token configuration** → add optional claim `email` and `preferred_username`
   to the ID token. Improves the display name without a Graph call.

### 0.3 — Fix Azure's generated workflow

Our duplicate workflow file has been removed — Azure's generated one is
the single deploy path. It needs three path corrections before it will
build this repo. Full detail in **`docs/workflow-settings.md`**; the short
version:

```yaml
          app_location: "frontend"
          api_location: "api"
          output_location: "dist"
```

### 0.4 — Wiring

- `staticwebapp.config.json`: tenant issuer already set — no change needed.
- SWA → Configuration → Application settings: add `AAD_CLIENT_ID` and
  `AAD_CLIENT_SECRET`.
- GitHub deployment token: handled in 0.3 above.
- Add the real redirect URI to the app registration once the hostname exists.

### 0.5 — Verification checklist

- [ ] Anonymous visit to `/` shows the sign-in screen, not a blank page
- [ ] Sign-in redirects to the Codestone login, returns to `/`
- [ ] Landing shows your first name
- [ ] `/area/data-ai` renders the placeholder tile
- [ ] `/health` shows a green API response with your UPN
- [ ] Direct hit on `/api/me` in an incognito window returns 401/redirect
- [ ] Deep link `/area/erp` works on hard refresh (navigationFallback)

**Gotcha:** run locally with `swa start` on port **4280**, not `vite` on
5173. Vite alone cannot serve `/.auth/me`, so AuthGate will show
"Authentication unavailable".

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
| App registration is under Codestone tenant governance (AD-05) | Slows every auth change | Get Application Developer role, or agree an SLA with Craig Stevens |
| Client secret expiry | Total outage, hard to diagnose | Calendar reminder at 11 months; or move to certificate auth |
| Every Codestone account can sign in | Wider audience than intended | Add Entra app-role gating if the portal should be pre-sales only |
| Free SWA tier limits (100 MB body, 0.5 GB storage, no SLA) | Tool failures under load | Standard tier is ~£7/month — budget for it at Phase 2 |
| Functions 230 s timeout | Long AI generations fail | Durable Functions or async job pattern |

---

## Immediate next action

Create the Entra app registration (single-tenant, redirect URI
`https://<swa-hostname>/.auth/login/aad/callback`), then add
`AAD_CLIENT_ID` and `AAD_CLIENT_SECRET` to the SWA's Application settings.
**≈ 20 minutes.**
