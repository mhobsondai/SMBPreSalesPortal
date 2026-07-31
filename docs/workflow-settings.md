# Deployment workflow — required edits

The Static Web App was created against the GitHub repo, so **Azure has
already committed a workflow file** to `.github/workflows/`. Its name
follows the SWA's generated hostname, e.g.
`azure-static-web-apps-lively-dune-0a2a9271.yml`.

Our duplicate has been removed. Azure's file is the one that deploys.

## The problem

Azure guesses the build configuration when it generates that file. For a
repo laid out like this one it guesses wrong — typically:

```yaml
app_location: "/"
api_location: ""
output_location: ""
```

That builds nothing useful and deploys an empty site, or fails outright.

## The fix

Open Azure's workflow file and set the three build paths in the
`build_and_deploy_job` step:

```yaml
          app_location: "frontend"      # folder containing package.json
          api_location: "api"           # Python Functions app
          output_location: "dist"       # relative to app_location
```

Leave everything else — the token secret name Azure generated is correct
and already exists in the repo's Actions secrets.

## Verify

After pushing, check the Actions run log for:

- `Looking for event info` → resolves `frontend` as the app folder
- an `npm install` / `vite build` step that produces `dist/`
- `Detected api language python` and a dependency install
- `Finished building app with Oryx` followed by an upload

If the run succeeds but the site 404s, `output_location` is wrong.
If the API 404s but the site loads, `api_location` is wrong.

## Note on the token secret name

Azure's secret is hostname-suffixed, e.g.
`AZURE_STATIC_WEB_APPS_API_TOKEN_LIVELY_DUNE_0A2A9271`. That name is tied
to the SWA instance — if the resource is ever deleted and recreated, both
the secret and the workflow file must be regenerated. Acceptable for now;
worth remembering if the SWA is rebuilt.
