# Deployment workflow — setup and troubleshooting

The Static Web App was created against the GitHub repo, so **Azure
committed its own workflow file** to `.github/workflows/`, named after the
generated hostname (e.g. `azure-static-web-apps-lively-dune-0a2a9271.yml`).
That file is the single deploy path — our duplicate was removed.

It needs replacing wholesale. Copy the contents of
**`docs/workflow-reference.yml`** over it, then substitute the real
secret name (`AZURE_STATIC_WEB_APPS_API_TOKEN_XXXX` → whatever Azure
generated — it's in the file you're replacing).

---

## Why the default workflow doesn't work

### 1. Wrong build paths

Azure guesses `app_location: "/"`. Oryx then looks at the repo root, finds
no `package.json`, and reports:

```
Error: Could not detect the language from repo.
Failed to find a default file in the app artifacts folder (/).
```

### 2. Oryx's glibc is too old for Rollup 4

Even with the paths corrected, the Oryx build container fails:

```
Error: Cannot find module @rollup/rollup-linux-x64-gnu
  [cause]: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.32' not found
           ERR_DLOPEN_FAILED
```

The npm message about optional dependencies is **a red herring** — the
module installed correctly. Read the `[cause]` block instead: Rollup 4
(which Vite 5 depends on) ships a native `.node` binary requiring
GLIBC 2.32, and the Oryx image predates it. Reinstalling, clearing
`node_modules`, or deleting `package-lock.json` cannot fix a glibc
version mismatch.

**Resolution:** build on the GitHub Actions runner (`ubuntu-latest`,
glibc 2.39) and pass the finished `dist/` to the SWA action with
`skip_app_build: true`. The Python API is still built by Oryx, which
handles it without issue.

This is also the better long-term shape: you control the Node version,
`npm ci` gives reproducible installs from the lockfile, and build logs
are readable.

---

## Key settings and their gotchas

| Setting | Value | Why |
|---|---|---|
| `app_location` | `frontend/dist` | With `skip_app_build`, this points at the **built output**, not the source |
| `output_location` | `""` | Must be empty — otherwise the action looks for `dist/dist` |
| `api_location` | `api` | Relative to repo root. Oryx builds this |
| `skip_app_build` | `true` | Stops Oryx touching the frontend |
| `config_file_location` | `/` | `staticwebapp.config.json` is at the repo root, not inside `dist` |

That last one matters: miss it and the app deploys but **authentication
silently does not apply** — no login redirect, no route protection.

---

## Verifying a good run

- `Install and build frontend` step shows `vite build` and a `dist/` summary
- SWA step shows `Detected api language python`
- `Zipping App Artifacts` then `Deployment Complete`

Reading failures:

| Symptom | Cause |
|---|---|
| "Could not detect the language" | `app_location` wrong |
| Site 404s but deploy succeeded | `output_location` wrong (likely not empty) |
| Site loads, `/api/health` 404s | `api_location` wrong |
| Site loads, **no login prompt** | `config_file_location` missing |
| `npm ci` fails: lockfile out of sync | `package-lock.json` not committed, or `package.json` edited without regenerating it |

---

## Note on the token secret name

Azure's secret is hostname-suffixed and tied to the SWA instance. If the
resource is ever deleted and recreated, both the secret and the workflow
file must be regenerated.
