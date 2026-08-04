# SMB Pre-Sales Portal — orientation for a new session

Read this first. It records decisions that are expensive to rediscover and
easy to break.

**What this is:** an internal Codestone portal giving SMB pre-sales staff a
single authenticated entry point to practice-area tooling. React 18 +
TypeScript + Vite frontend, Python Azure Functions API, deployed as an
Azure Static Web App (Standard SKU) with Entra authentication pinned to
the Codestone tenant.

**Status:** deployed and working. Three tools live. See `docs/game-plan.md`
for phase status and `docs/decisions.md` for the full decision record
(AD-01 to AD-13) — that file is the reasoning behind everything below.

---

## Working rules

### 1. Copy `frontend/src` wholesale, never file-by-file

The repo is maintained by copying from this folder. Cherry-picking changed
files has broken the build three times: TypeScript reports only the first
missing symbol, so each CI run reveals one more gap. Delete the repo's
`frontend/src` and copy the whole directory.

Stale files are the dangerous case — they compile fine and quietly do
nothing.

### 2. Build and test locally before pushing

```bash
cd frontend && npm ci && npm test && npm run build
```

`npm run build` is the same `tsc -b && vite build` the pipeline runs. Thirty
seconds versus a CI round trip.

`npm test` is vitest, added at the third tool — see AD-10. It is **not** in
the CI workflow, because Azure owns that file (rule 3). Running it is
therefore a local discipline, not something the pipeline will catch for you.

### 3. Don't touch `.github/workflows/`

Azure generated that workflow and owns it. It builds the frontend on the
Actions runner (`skip_app_build: true`) because the Oryx container's glibc
is too old for Rollup 4. **Do not revert to Oryx builds.** Details and a
symptom→cause table: `docs/workflow-settings.md`.

---

## Invariants — breaking these has real consequences

### Scoring and estimating data is published methodology

`config/assessmentModel.ts` (weights, bands, keyword mappings) and
`config/fabricEstimatorModel.ts` (day factors) determine numbers that go
into client documents and quotes.

- The same inputs must produce the same output next month
- Two consultants must get the same answer
- `lib/scoring/__fixtures__/` and `lib/estimating/__fixtures__/` pin
  reference outputs taken from the original prototypes

If a change makes a fixture wrong, that is a methodology change:
regenerate the fixture **in the same commit** and say why in the message.
Never adjust a fixture to make a test pass.

`config/sapInstallAssessmentModel.ts` is **not** in this category: the
install assessment captures figures and derives nothing, so nothing in it
can make a quote wrong. Its fixture pins a different thing — which fields
get asked, and the export shape the Quote Generator reads. See AD-11.

### Document generation stays in the browser

The install assessment builds its `.docx` client-side with `docx`, imported
dynamically so it stays out of the main bundle. A Functions endpoint will
keep looking like the natural home for this. It isn't: a server round trip
means POSTing the client name and contact details, which is the footprint
AD-08 exists to avoid, for nothing the browser cannot do. See AD-12.

The Word output deliberately keeps the **source document's** section order
and row labels, not the tool's tab order — and marks inapplicable rows
`n/a` rather than dropping them, so two assessments are structurally the
same document.

`lib/assessments/templates/install-assessment.styles.xml` is the styles part
of the real `Blank Install Assessment.docx`, imported with `?raw` and passed
to `docx` as `externalStyles`. **Replacing that file rebrands the output** —
that is the intended way to follow a template change.

Table and page formatting cannot live in a styles part, so it is transcribed
into `LAYOUT` in `sapInstallAssessmentDocx.ts` and pinned by test. Do not
tidy it: the headings are green even though `CTHeading1` says navy, the
Platform Overview table shades only its header row, and two of the four
column grids are ten twips wider than the others. All three are what the
source file does. AD-13 explains each.

After changing anything in there, **render the output and look at it** —
converting with LibreOffice and comparing against the original is how the
navy-heading mistake was caught. The XML tests would not have found it.

### The install assessment stores contact details in the browser

It is the only tool that writes to `localStorage`, and what it writes
includes a client name, two contact names and two email addresses. Nothing
reaches a server, but the AD-08 line about closing the tab discarding
everything does not hold here.

The page carries a notice saying so and a **Clear assessment** control.
Both have to stay, and the notice has to stay accurate. Read AD-11 before
changing how that tool persists anything.

### The Assessment Scoring Engine must stay client-side

Its input contains a named person, employer, job title and email address.
Scoring runs in the browser so personal data never reaches a server, a
log, or a retention policy. The UI tells the user this, so the claim has
to stay true.

Adding history, persistence or AI enrichment to that tool means deciding
what happens to the personal data first — and a word with Natasha Keskin
(General Counsel) about retention. See AD-08.

The Fabric Data Calculator takes no personal data, so this constraint is
about that one tool's inputs, not a blanket rule.

### Don't remove the email-domain fallback in `api/shared/auth.py`

It looks redundant next to the `tid` check. It isn't: the SWA
client-principal header carries no claims collection, so `tid` never
arrives and the domain branch is the only one that fires. Removing it
returns 403 to every user including whoever is fixing it, and the only
recovery is a redeploy. Verified live — `/health` panel 2 shows which
branch is active. See AD-07.

### Navigation is data, and renders flat

`config/navigation.ts` is the whole tree. Top-level sections are cards on
the landing page; **everything below renders inline** as headed lists on
the practice-area page. One click from landing reaches any tool.

An earlier design gave each sub-section its own page — three clicks to a
tool and a lot of near-empty pages. Don't reintroduce that.

- Tile ids are **globally unique** (two groups both have a "Quote
  Generator"). Ids are React keys and will become analytics identifiers.
- A `live` tile must have `to` or `href`.
- `resolvePath` returns `undefined` for an unknown segment, never the
  nearest match — a stale bookmark should 404, not land somewhere
  plausible.

---

## Adding a tool

The pattern, established by the two existing tools:

1. **Model** → `config/<tool>Model.ts`. Data only. Document that changing
   it changes a published number.
2. **Logic** → `lib/<domain>/<tool>.ts`. Pure functions, no DOM, no
   network. Testable without React.
3. **Fixture** → `lib/<domain>/__fixtures__/`. If converting a prototype,
   run the original's logic in Node first and pin its output, then assert
   the port matches. This is how both conversions were verified.

   **If there is no prototype**, this rule has nothing to bite on — don't
   pin a fixture generated by the code under test and call it verified.
   Pin the contract instead: what the tool asks, and what it emits for a
   downstream consumer. Say in the fixture which of the two kinds it is.
   AD-11 does this for the install assessment.
4. **Page** → `pages/tools/<Tool>.tsx` + `.css`. Import
   `styles/tool.css` for shared chrome; keep only tool-specific rules in
   its own stylesheet.
5. **Route** → `/tools/<slug>` in `main.tsx`.
6. **Tile** → set `status: 'live'` with `to` in `config/navigation.ts`.

`styles/tool.css` holds the header, horizontal tabs, a vertical tab rail
with one level of nesting, the form/guidance split, the form vocabulary
(labels, hints, inputs, segmented yes/no), panels, buttons, output block
and notices. Anything another tool would also need belongs there.

Use the horizontal `.tool-tabs` for up to about five views and the vertical
`.tool-rail` beyond that. The rail nests **one** level, for repeated groups
such as an environment — deeper nesting is the multi-page navigation AD-03
removed, wearing a different hat.

Tools that produce copy-ready output use `.output-panel` / `.output-block`
with a "Copy all" button — both existing tools feed a downstream
document, and that is the recurring shape.

---

## Verification expectations

`npm test` runs 154 vitest tests covering navigation invariants, the Fabric
estimator's pinned prototype cases, the install assessment's visibility
rules and export contract, and the generated Word document's structure and
formatting. Match that standard:

- Converting a prototype → diff the port against the original's actual
  output, not against expectations
- Navigation changes → assert tile-id uniqueness, live tiles have
  destinations, unknown paths resolve to `undefined`
- Auth changes → the test that matters is signing in with a
  non-Codestone Microsoft account and confirming rejection

`npm run fixtures:update` regenerates the assessment fixture. It exists so
regenerating is one deliberate command rather than hand-edited JSON — the
rule is unchanged: same commit as the change, and say why.

Two known gaps, both recorded in AD-10: the estimating fixture stores
outputs without inputs, so the test reconstructs the quantities from the
recorded summary lines; and the scoring fixture cannot be replayed at all
because the questionnaire text that produced it is not in the repo.

If a test expectation and the code disagree, work out which is wrong
before changing either. Twice during the build the test was wrong and the
disagreement revealed something worth knowing.

---

## Current tree

```
infrastructure-365          placeholder
erp                         placeholder
data-ai
  ├── Assessments
  │     Client Link (live, external)
  │     Assessment Scoring Engine (live)
  │     Insight Spark Engine · Data and AI Clinic
  ├── SAP BI Platform
  │     Pre-Sales Install Assessment (live) · Quote Generator
  └── Fabric Platform
        Data Calculator (live) · Quote Generator
```

Both Quote Generators consume the output of a tool above them. For the SAP
one that handoff is now **decided**: the install assessment emits versioned
JSON (`ASSESSMENT_SCHEMA_VERSION`, currently **2**) alongside a `.docx` and
copy-ready text, and the Quote Generator reads the JSON. Three states, and
the difference matters — absent means not applicable, `null` means not yet
answered, a value means answered *or implied by another answer*. See AD-11
and AD-12.

The Fabric handoff is still undecided.
