# SMB Pre-Sales Portal

Internal Codestone portal giving SMB pre-sales staff a single, authenticated
entry point to practice-area tooling.

**Stack:** React 18 + TypeScript + Vite frontend, Python Azure Functions API,
deployed as an Azure Static Web App (**Standard** SKU) with custom Entra
authentication pinned to the Codestone tenant.

> **Security note.** Authentication is enforced by the SWA platform via a
> dedicated Entra app registration; `api/shared/auth.py` independently
> re-checks the tenant on every request. Two follow-ups remain open —
> `/*` is not yet restricted to authenticated users, so **do not put
> commercial logic or client data in the frontend bundle** until it is.
> See `docs/decisions.md` AD-07.

---

## Structure

```
SMB-PreSales-Portal/
├── staticwebapp.config.json   # auth, routing, security headers — the security boundary
├── swa-cli.config.json        # local emulator config
├── api/                       # Python Functions API
│   ├── function_app.py        # routing only — /api/health, /api/me
│   └── shared/
│       ├── auth.py            # principal decoding + tenant policy + require_auth
│       └── display_name.py
└── frontend/
    └── src/
        ├── config/practices.ts    # ← the navigation tree lives here
        ├── components/            # AuthGate, TopBar, TileGrid
        ├── lib/                   # auth, api client, hooks
        ├── pages/                 # SignIn, AccessDenied, Landing, PracticeAreaPage, HealthCheck
        └── styles/                # tokens.css, base.css
```

## Routes

| Route              | Page                                   |
| ------------------ | -------------------------------------- |
| `/`                | Landing — three practice-area cards    |
| `/area/:slug`      | Practice area — tile grid              |
| `/health`          | Diagnostics (auth + API round trip)    |
| `/login`, `/logout`| SWA platform auth redirects            |

Slugs: `infrastructure-365`, `erp`, `data-ai`.

## Adding a tool

Append a `Tile` to the relevant area in `frontend/src/config/practices.ts`.
No new route, component or CSS required.

```ts
{
  id: 'fabric-sizing',
  title: 'Fabric Capacity Sizing',
  description: 'Estimate F-SKU requirements from workload inputs.',
  status: 'live',
  to: '/tools/fabric-sizing'   // or href: 'https://…' for an external app
}
```

## Local development

```bash
npm install -g @azure/static-web-apps-cli
cd frontend && npm install && cd ..
cp api/local.settings.example.json api/local.settings.json
swa start
```

Open <http://localhost:4280> (**not** 5173 — the SWA CLI is what emulates
`/.auth/*` and proxies the API). The emulator serves a mock login page;
whatever identity you enter appears as the client principal.

## Deployment

Push to `main`. Azure's generated workflow in `.github/workflows/` builds
and deploys. It needs its build paths corrected on first setup — see
`docs/workflow-settings.md`.

## Configuration required before first deploy

The tenant issuer is already set. Remaining:

| Setting                      | Where                          |
| ---------------------------- | ------------------------------ |
| Workflow build paths | `.github/workflows/azure-static-web-apps-*.yml` — see `docs/workflow-settings.md` |
| `AAD_CLIENT_ID` | SWA → Settings → Environment variables |
| `AAD_CLIENT_SECRET` | SWA → Settings → Environment variables |
| `ALLOWED_TENANT_IDS` *(optional)* | SWA → Settings → Environment variables |
| `ALLOWED_EMAIL_DOMAINS` *(optional)* | SWA → Settings → Environment variables |

Redirect URI on the app registration must be
`https://<swa-hostname>/.auth/login/aad/callback`, platform **Web**.

See `docs/game-plan.md` for the full sequence.
