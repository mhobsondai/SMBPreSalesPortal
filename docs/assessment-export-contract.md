# Install Assessment export — contract reference

The input contract for the SAP Quote Generator. Hand this, and
`sap-install-assessment.v2.schema.json`, to whoever is building it.

- **Producer:** `toExport()` in
  `frontend/src/lib/assessments/sapInstallAssessment.ts`
- **Schema:** `docs/sap-install-assessment.v2.schema.json` (JSON Schema
  2020-12) — generated from the model and validated against all four pinned
  scenarios in `frontend/src/lib/assessments/__fixtures__/reference.json`
- **Current version:** `schemaVersion: 2`
- **Live examples:** the `export` block of each scenario in that fixture is
  real output, not illustration. Read all four — between them they cover
  blank, complete, Crystal Server, and multi-environment.

---

## 1. The three states — read this before anything else

| In the export | Means | Do |
|---|---|---|
| **key absent** | Not applicable — the platform does not have this | Treat as structurally absent. Do not default it |
| **`null`** | Applicable, but not answered yet | Prompt, or mark the quote provisional |
| **a value** | Answered, **or implied by another answer** | Use it |

Collapsing absent and `null` will eventually price zero universes for an
estate that has eighty. A Crystal Server assessment has **no** `unvCount` key
at all; a BusinessObjects assessment where nobody has counted yet has
`"unvCount": null`.

**Implied values are facts, not guesses.** If there is no separate Tomcat, the
tool never asks about a separate web server — but the answer is known, so the
export carries `"separateWebServer": "no"`. The consumer does not re-derive
that rule.

Keys absent on a **Crystal Server** assessment:

- client: `universeModifiers`, `trainingWebi`,
  `trainingInformationDesignTool`, `trainingUniverseConversion`
- environment: `universeCountMode`, `unvCount`, `unxCount`,
  `combinedUniverseCount`, `webiDocuments`

Keys absent because a **dependent question was not reached** (either platform):
`testEnvironmentCount`, `devEnvironmentCount`, `webServerName`,
`destinationChangesNarrative`, `successfulInstancesNarrative`, and whichever
of `unvCount`/`unxCount`/`combinedUniverseCount` the counting mode excluded.

---

## 2. Top-level shape

```json
{
  "schemaVersion": 2,
  "tool": "sap-install-assessment",
  "installationType": "businessobjects" | "crystal-server",
  "client":       { ... },
  "environments": [ { "id": "env-1", "label": "PROD01", "answers": { ... } } ],
  "completeness": { "required": 53, "answered": 53, "isComplete": true },
  "advisories":   [ { "id": "...", "scope": "PROD01", "text": "..." } ]
}
```

**Reject an unexpected `schemaVersion` rather than guessing.** It is bumped on
any breaking change; v1 → v2 removed three fields and replaced four booleans
with one enum.

`completeness.isComplete === false` means the assessment has gaps. Any quote
built from it is provisional and should say so on its face.

`advisories` are conversation prompts, not calculations — disabled auditing,
instances not all required, an unnamed web server, out-of-hours go-live,
Crystal Server scope. Surface them; they are things that cost money if not
raised before the quote goes out.

---

## 3. Client object

Answered once for the engagement.

| Key | Type | Notes |
|---|---|---|
| `client` | string | Client / organisation name |
| `conversationDate` | string `YYYY-MM-DD` | |
| `signOffName`, `signOffEmail` | string | **Personal data** — see §6 |
| `technicalContactName`, `technicalContactEmail` | string | **Personal data** — see §6 |
| `consumers` | number | People who log in directly or receive scheduled output |
| `universeModifiers` | number | BusinessObjects only |
| `reportModifiers` | number | |
| `futureDirection` | string | Free text. Transition to another toolset, e.g. moving to Power BI |
| `adjacentWork` | string | Free text. Parallel programmes, freezes, reorganisations |
| `installationType` | enum | `businessobjects` \| `crystal-server` |
| `productionEnvironmentCount` | number | Should equal `environments.length` |
| `hasTestEnvironments` | `yes`/`no` | |
| `testEnvironmentCount` | number | Only when `hasTestEnvironments` is `yes` |
| `hasDevEnvironments` | `yes`/`no` | |
| `devEnvironmentCount` | number | Only when `hasDevEnvironments` is `yes` |
| `trainingBiLaunchpad` | `yes`/`no` | Guide |
| `trainingCms` | `yes`/`no` | 1 day |
| `trainingWebi` | `yes`/`no` | 1 day. BusinessObjects only |
| `trainingCrystalReports` | `yes`/`no` | 3 days |
| `trainingInformationDesignTool` | `yes`/`no` | 1 day. BusinessObjects only |
| `trainingUniverseConversion` | `yes`/`no` | Guide. BusinessObjects only |
| `goLiveTiming` | enum | `core-hours` \| `specific-weekday` \| `overnight` \| `weekend`. **Single select** — these are rate categories |
| `goLiveWeekday` | enum | `monday`…`sunday`. Only when `goLiveTiming` is `specific-weekday` |

`overnight` and `weekend` attract a different rate.

---

## 4. Environment object

One entry per **production** environment, 1 to 8. Test and development
environments are counted on the client object and never detailed — they are
rebuilt as a copy of the new production, so their current configuration does
not size the work.

| Key | Type | Notes |
|---|---|---|
| `serverName` | string | Current server |
| `operatingSystem` | string | **Free text.** See §5 — this one moves the price |
| `platformSoftware` | string | **Free text.** e.g. `SAP BusinessObjects BI 4.2 SP7` |
| `authentication` | string | **Free text.** e.g. `Windows AD`, `Enterprise`, `LDAP` |
| `separateTomcat` | `yes`/`no` | |
| `clustered` | `yes`/`no` | |
| `externallyFacing` | `yes`/`no` | |
| `httpsConfigured` | `yes`/`no` | |
| `separateWebServer` | `yes`/`no` | Only asked when `separateTomcat` is `yes`; otherwise **implied `no`** |
| `webServerName` | string | Only when `separateWebServer` is `yes` |
| `inputFileRepositoryGb` | number | GB |
| `outputFileRepositoryGb` | number | GB |
| `cmsDatabaseSoftware` | string | **Free text.** Covers CMS *and* audit — they always share software |
| `auditingEnabled` | `yes`/`no` | |
| `universeCountMode` | enum | `separate` \| `combined`. BusinessObjects only |
| `unvCount`, `unxCount` | number | When mode is `separate` |
| `combinedUniverseCount` | number | When mode is `combined` |
| `crystalDocuments` | number | |
| `webiDocuments` | number | BusinessObjects only |
| `publications` | number | Publications and program objects |
| `pendingInstances` | number | |
| `successfulInstances` | number | |
| `destinationChangesRequired` | `yes`/`no` | |
| `destinationChangesNarrative` | string | Free text, when the above is `yes` |
| `successfulInstancesRequired` | enum | `yes` \| `some` \| `no` |
| `successfulInstancesNarrative` | string | Free text, when the above is `some` |

---

## 5. Mapping to the LabMat engine, and where AI comes in

The pricing engine lives in the `sap-bia-labmat` skill
(`scripts/labmat_engine.py`, contract at `schema/assessment.schema.json`). Its
input is one flat object per quote. Most of the mapping is mechanical:

| Engine field | From the export |
|---|---|
| `product` | `installationType` → `BOBJ` / `CRY` |
| `client_name` | `client.client` |
| `contact_name`, `contact_email` | `client.signOffName` / `signOffEmail`, else technical contact |
| `frs_gb` | `inputFileRepositoryGb + outputFileRepositoryGb` |
| `content_count` | universes + `crystalDocuments` + `webiDocuments` + `publications` |
| `externally_facing` | `externallyFacing` |
| `separate_tomcat` | `separateTomcat` |
| `environments` | `environments.length` |
| `convert_universes` | BusinessObjects **and** a universe count above zero |
| `operating_system`, `os_pre_ws2022` | `operatingSystem` — **needs interpretation** |
| `auth` | `authentication` — **needs interpretation** |

### The four free-text fields

`operatingSystem`, `authentication`, `platformSoftware` and
`cmsDatabaseSoftware` are captured as the consultant typed them, because a
dropdown of every OS build would have made the call slower and the answers
worse. They need normalising before the engine sees them, and that is the
sensible place to use AI.

### One of them changes the price

**`os_pre_ws2022` is a hard rule: anything earlier than Windows Server 2022
forces install + migration and rules out an in-place upgrade.** So an
inference from free text decides the route, and the route decides the number
on the quote.

Two consequences for the build:

1. **AI proposes, the consultant confirms.** Never let an inferred value set a
   price without being shown and accepted. Show what was inferred, from what
   text, and how confident.
2. **Store what was confirmed, not what was inferred.** The quote's provenance
   should say a human agreed, so a re-run next month produces the same number.

### Suggested interpretation payload

Have the AI return something checkable rather than prose:

```json
{
  "interpretations": [
    {
      "field": "os_pre_ws2022",
      "value": true,
      "confidence": "high",
      "evidence": "operatingSystem: \"Windows Server 2016\"",
      "reasoning": "2016 is earlier than Windows Server 2022",
      "priceAffecting": true
    },
    {
      "field": "auth",
      "value": "Windows AD",
      "confidence": "high",
      "evidence": "authentication: \"Windows AD\"",
      "priceAffecting": true
    }
  ],
  "unresolved": ["cmsDatabaseSoftware: \"SQLA\" — SQL Anywhere assumed, please confirm"]
}
```

Anything `priceAffecting` with confidence below high should block the quote
until answered. Anything `unresolved` should be visible, not silently
defaulted.

### Multi-environment estates

The export is per-environment; the engine takes a single `environments` count
and one set of figures. Decide deliberately how they aggregate — sum the
filestore and content counts, take the worst-case OS, and so on — and record
it. If two environments differ enough that one number misprices them, say so
rather than averaging quietly.

---

## 6. Before any of this text goes to an AI service

`client`, `signOffName`, `signOffEmail`, `technicalContactName` and
`technicalContactEmail` are personal data, and the plain-text summary the tool
produces contains all of them.

**The pricing interpretation does not need any of it.** Strip those five
fields — and the free-text narratives, which can name people — before sending
anything to a model, and merge the contact details back in locally when the
documents are assembled.

This matters because the assessment tool currently makes a specific promise:
nothing is uploaded, and no server holds a copy (AD-08, AD-11). Sending the
text to a hosted model breaks that promise unless the personal data is
removed first. If the design needs to send it anyway, that is a data
protection decision, not an engineering one — take it to **Natasha Keskin
(General Counsel)** before building it, and record the outcome as an AD.

---

## 7. Worked example

Real output from the `businessobjects complete` fixture scenario — one
production environment, fully answered.

```json
{
  "schemaVersion": 2,
  "tool": "sap-install-assessment",
  "installationType": "businessobjects",
  "client": {
    "client": "Acme Manufacturing Ltd",
    "conversationDate": "2026-08-03",
    "technicalContactName": "A Technical Contact",
    "technicalContactEmail": "tech@example.invalid",
    "signOffName": "A Sign-off Contact",
    "signOffEmail": "signoff@example.invalid",
    "consumers": 240,
    "universeModifiers": 3,
    "reportModifiers": 12,
    "futureDirection": "Evaluating Power BI for new reporting; BI 4.3 to remain for Crystal.",
    "adjacentWork": "ERP upgrade running in parallel through Q4.",
    "installationType": "businessobjects",
    "productionEnvironmentCount": 1,
    "hasTestEnvironments": "yes",
    "testEnvironmentCount": 1,
    "hasDevEnvironments": "no",
    "trainingBiLaunchpad": "yes",
    "trainingCms": "yes",
    "trainingWebi": "yes",
    "trainingCrystalReports": "no",
    "trainingInformationDesignTool": "yes",
    "trainingUniverseConversion": "yes",
    "goLiveTiming": "weekend"
  },
  "environments": [
    {
      "id": "env-1",
      "label": "PROD01",
      "answers": {
        "serverName": "ACME-BOBJ-P01",
        "operatingSystem": "Windows Server 2016",
        "platformSoftware": "SAP BusinessObjects BI 4.2 SP7",
        "authentication": "Windows AD",
        "separateTomcat": "yes",
        "clustered": "no",
        "externallyFacing": "yes",
        "httpsConfigured": "yes",
        "separateWebServer": "yes",
        "webServerName": "ACME-WEB-P01",
        "inputFileRepositoryGb": 42.5,
        "outputFileRepositoryGb": 118,
        "cmsDatabaseSoftware": "SQL Server 2016",
        "auditingEnabled": "yes",
        "universeCountMode": "separate",
        "unvCount": 64,
        "unxCount": 18,
        "crystalDocuments": 820,
        "webiDocuments": 460,
        "publications": 35,
        "pendingInstances": 12,
        "successfulInstances": 48210,
        "destinationChangesRequired": "yes",
        "destinationChangesNarrative": "Moving from file shares to SFTP for the finance pack.",
        "successfulInstancesRequired": "some",
        "successfulInstancesNarrative": "Last 12 months of the statutory reports only."
      }
    }
  ],
  "completeness": { "required": 53, "answered": 53, "isComplete": true },
  "advisories": [
    {
      "id": "env-1-instances",
      "scope": "PROD01",
      "text": "Not all successful instances are required. Recommend the client raises a support ticket for instructions on cleaning them up before migration — it reduces the volume to move."
    },
    {
      "id": "go-live-rate",
      "text": "Go-live is outside core hours. That attracts a different rate — make sure the quote reflects it."
    }
  ]
}
```

Worked through to the engine, this example gives: `product: BOBJ`,
`os_pre_ws2022: true` (2016 → **install + migration, not an upgrade**),
`auth: "Windows AD"`, `frs_gb: 160.5`, `content_count: 1397`
(64 + 18 + 820 + 460 + 35), `environments: 1`, `convert_universes: true`,
`separate_tomcat: true`, `externally_facing: true` — plus a weekend go-live
premium. Confirm those against `labmat_engine.py` rather than taking them
from here.

---

## 8. If you change the export

It is a contract with a downstream consumer. Additive changes are safe;
renaming or removing a key is breaking. Bump `ASSESSMENT_SCHEMA_VERSION` in
`frontend/src/config/sapInstallAssessmentModel.ts`, regenerate the fixture
with `npm run fixtures:update` in the same commit, say why in the message,
regenerate this schema, and tell the Quote Generator.
