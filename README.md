# SMB Pre-Sales Portal

Internal Codestone portal giving SMB pre-sales staff a single, authenticated
entry point to practice-area tooling.

**Stack:** React 18 + TypeScript + Vite frontend, Python Azure Functions API,
deployed as an Azure Static Web App (free tier) with Entra ID authentication
against the Codestone directory (tenant `2e99fe9c-…eded6d`).

---

## Structure

```
SMB-PreSales-Portal/
├── staticwebapp.config.json   # auth, routing, security headers — the security boundary
├── swa-cli.config.json        # local emulator config
├── api/                       # Python Functions API
│   ├── function_app.py        # routing only — /api/health, /api/me
│   └── shared/
│       ├── auth.py            # client-principal decoding + require_auth
│       └── display_name.py
└── frontend/
    └── src/
        ├── config/practices.ts    # ← the navigation tree lives here
        ├── components/            # AuthGate, TopBar, TileGrid
        ├── lib/                   # auth, api client, hooks
        ├── pages/                 # SignIn, Landing, PracticeAreaPage, HealthCheck
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
| `AAD_CLIENT_ID`              | SWA → Configuration → Application settings |
| `AAD_CLIENT_SECRET`          | SWA → Configuration → Application settings |
| Redirect URI                 | Entra app registration → Authentication |
| Workflow build paths         | `.github/workflows/azure-static-web-apps-*.yml` |

See `docs/game-plan.md` for the full sequence.
