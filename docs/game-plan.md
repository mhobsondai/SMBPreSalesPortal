# SMB Pre-Sales Portal — Development Game Plan

**Status:** v0.1 scaffold complete and compiling. **Standard** SKU, custom
Entra authentication pinned to the Codestone tenant. App registration
created, client ID and secret in place.
**Phase 0 complete — 31 July 2026.** Standard SKU, custom Entra
authentication pinned to the Codestone tenant, static bundle gated to
authenticated users, API enforcing the tenant policy independently.
Anonymous visitors are redirected to the Microsoft login without
receiving the JS bundle. Both AD-07 follow-ups closed.

**Phase 2 in progress.** Four tools shipped:

- Assessment Scoring Engine (Assessments) — client-side only, AD-08
- Fabric Data Calculator (Fabric Platform) — AD-09
- SAP Pre-Sales Install Assessment (SAP BI Platform) — AD-11
- SAP Quote Generator (SAP BI Platform) — AD-14, AD-15, AD-16, AD-17

The first two were converted from standalone HTML prototypes with their
arithmetic pinned against reference fixtures. The third had no prototype:
it is built from `Blank Install Assessment.docx`, captures rather than
calculates, and pins its field-visibility rules and export contract
instead.

The fourth is a rebuild of `bobj_generator.html`, a standalone browser app
already in use. Its arithmetic is reproduced deliberately, pinned against both
a fixture and an independent transcription of the prototype's formulas. The
`sap-bia-labmat` skill was **not** used: it solves a different problem and
disagrees on PM tiering. AD-14 has the detail and the £140.40 consequence.

`styles/tool.css` now also holds the vertical tab rail, the form/guidance
split and the shared form vocabulary — the Quote Generator reused all of it
and added nothing, which is the first time the shared layer has covered a new
tool outright.

The Quote Generator also imports the install assessment's JSON export and
pre-fills itself from it, which brought **the portal's first AI call** with
it — `POST /api/tools/sap-quote/interpret`, reading the free-text operating
system and authentication fields. Only three technical strings are sent; the
client name and contact details never leave the browser, so AD-08 stands
unchanged. See AD-15.

**That local seeding is being replaced — AD-17.** A new skill,
`sap-bia-quote-plan`, reads the whole assessment and returns a
`sap-quote-plan` v1 document over `POST /api/tools/sap-quote/plan`; the app
keeps every calculation involving money. The gain is the four phases the
transcribed rules could never reach, Training first among them. The skill is
built, validated and pinned across six parity cases. **The endpoint is not,
and the round trip against the ~45s gateway is not yet measured** — that
number gates the design, so nothing downstream should start before it.

Building it also exposed three pricing corrections, all recorded in AD-17:
training is now priced as one line, universe conversion is asked rather than
inferred, and the migration band takes the **input** file repository instead
of the total. The last two are live defects in `sapQuoteImport.ts` today.

`npm test` is now 414 tests. `exceljs` was added and `jszip` promoted to a
runtime dependency, and `anthropic` added to `api/requirements.txt` — so
**`package.json`, `package-lock.json` and `api/requirements.txt` must ship
with that change** or CI fails.

**`ANTHROPIC_API_KEY` must be set in SWA Application Settings** before the
import can use AI. Without it the import still works, on the deterministic
reading alone; `/api/health` reports `ai_configured`.

The install assessment has had its first review pass — AD-12, schema v2.
Word export delivered (client-side, dynamically imported), five model
corrections, and implied answers added to the export contract. AD-13 then
matched the Word output to `Blank Install Assessment.docx` visually, using
that file's own styles part.

Open items:

| Item | Effort |
|---|---|
| **Measure the plan round trip against the ~45s SWA gateway.** Blocked on `ANTHROPIC_API_KEY` and an uploaded `skill_id`. If it does not fit, submit-and-poll is a bigger change than the rest of AD-17 combined — do not discover this at the end | 1 h once unblocked |
| **Build `POST /api/tools/sap-quote/plan`** — `config/sapQuotePlanModel.ts` with the contract and validators, a second function in `ai.py` (leave `complete_structured()` alone), graceful degradation. AD-17 | ~1 day, after the timing number |
| **Strip personal data before the POST — build the payload from an allowlist, not a denylist.** ~19 export fields are never read by the skill, including all four free-text narratives and `serverName`. Do this and AD-08's position holds with no retention decision. AD-17 | ~1 h |
| **Build quote button** on the install assessment, navigating to the quote page with the export in router state. No screen between the two — AD-17 explains why | ~2 h |
| **Project Brief step** — still missing, so every CheckList has an empty Introduction. The Claude API and `briefXml()` both exist now, so this is a page change and one prompt | ~2–3 h |
| Set `ANTHROPIC_API_KEY` in SWA Application Settings, and check `/api/health` reports `ai_configured: true` | 10 min |
| **Fix the two conversion defects and the band in `sapQuoteImport.ts`** if AD-17 slips — they mis-seed live quotes today. A `> 0` check on the `combined` branch, universe gaps out of `sizing-not-used`, band on input FRS | ~1 h |
| Add `SCOPE_CATEGORIES` ids for CMS training, 3-day Crystal Reports training and the two guides, so training stops arriving as custom scope. `pbi_1`/`pbi_3` already set the naming | 30 min |
| **Decide the conversion profile** — Pre-Installation Documentation and UAT still run light when conversion is in scope (Bromley Conversion: 2h / 2h / 15h against 1h / 1h / 3.75h). The 15h conversion line itself is moot under AD-17, since it is no longer seeded. AD-16 has the numbers | 15 min to decide, 30 min to build |
| Decide whether a multi-environment estate should band its migration per environment rather than once on the combined total (AD-15) | 15 min to decide |
| Decide whether a quote in progress should survive a refresh. Code is written and tested but deliberately not called — see AD-14 | 15 min to decide |
| Decide whether PM should tier off contingency-inclusive cost, which would align with the reference LabMats and move some quotes up by ~£140 | 15 min to decide |
| Guidance copy and screenshots — 16 declared slots, see below | ~1–2 h |
| Confirm with Natasha Keskin whether contact details in `localStorage` on a synced browser profile needs anything recorded | 15 min |
| Go-live cannot express "Saturday overnight" — revisit only if it comes up | — |

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

~~Upgrade to Standard SKU first.~~ **Done in Phase 0** — the security
prerequisite is already met, so Phase 2 can start on content rather than
infrastructure.

**Still applies for Phase 3:** key user records on **UPN**, not
`userId`. The SWA `userId` is derived from the provider registration, so
re-issuing the app registration would orphan any rows keyed on it.


Pick **one** tool and build it all the way through. The second tool is
cheap; the first one is where the patterns get set.

**Recommendation: Data & AI → SAP BIA LabMat generator.** You already have
the skill and the domain rules encoded, the inputs are a document upload,
and the output is a file — so it exercises upload, processing and download
without needing a database first.

Sequence:

1. **Route + tile** — add the tile to `config/navigation.ts` with
   `status: 'live'` and a `to`, add `/tools/<slug>` to `main.tsx`. (1 h)
2. ~~**Input form** — establish the shared form component vocabulary~~ —
   **done** with the install assessment. Labels, hints, inputs, the
   GB-suffixed number field and the segmented yes/no control are in
   `styles/tool.css`; `FieldControl` in `SapInstallAssessment.tsx` renders a
   declarative field model against them. Reuse both.
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

**Set `ANTHROPIC_API_KEY`, upload the `sap-bia-quote-plan` skill, and measure
the plan round trip against the ~45s gateway.** Everything in AD-17 waits on
that number.

The key goes in SWA Application Settings — never the frontend bundle — and
`/api/health` will report `ai_configured: true` once it is there. Until then
the import works on its deterministic reading alone, so nothing is blocked.

The measurement is not a formality. An agentic code-execution loop on Opus 5
may not fit inside the gateway window. Not rendering documents helps a great
deal — the skill is 52 KB of standard library with no `openpyxl` and no
`python-docx` — but if it still does not fit, the answer is submit-and-poll,
which is a bigger change than the rest of AD-17 put together. Find out first.

Then build the endpoint, then the Project Brief step.

The brief is the last visible gap: the CheckList's Introduction is a green
heading band with nothing under it. `briefXml()` is built and tested, and
`api/shared/ai.py` is in place, so it is a page change plus one prompt.

**One thing to decide before writing that prompt.** Unlike the import, a
brief prompt genuinely needs the client name and the scope list — three
technical strings will not write it. That is a wider payload than anything
the portal sends today, so Phase 3's GDPR line applies: decide what is
logged and retained *before* it ships, and talk to Natasha Keskin (General
Counsel) if any prompt or completion is going to be stored. AD-15's
three-string payload was cheap precisely because it avoided this; the brief
will not get the same free pass.

---

## Also outstanding

Supply the guidance copy and screenshots for the install assessment. Every
slot is declared and renders a labelled placeholder at its intended size —
drop a PNG into `frontend/public/guidance/sap-install/` and set `src` (plus
`caption` and `steps`) on the matching slot in
`config/sapInstallAssessmentModel.ts`. No code change needed.

Slots awaiting an image, by tab:

| Tab | Slots |
|---|---|
| Central Configuration Manager | `ccm-launch`, `ccm-server-list`, `ccm-tomcat`, `ccm-cluster`, `ccm-install-folder`, `filestore-input-size`, `filestore-output-size` |
| CMC Settings | `cmc-settings-nav`, `cmc-cms-database` |
| CMC Universes | `cmc-universes-nav`, `cmc-universes-count` |
| CMC Contents | `cmc-folders-nav`, `cmc-folders-count` |
| CMC Schedules | `cmc-instance-manager-nav`, `cmc-pending-instances`, `cmc-successful-instances` |

The three conversation-only tabs (Overview, Usage, Landscape) and Training
and Go Live are marked self-evident and show an explanatory line instead.
