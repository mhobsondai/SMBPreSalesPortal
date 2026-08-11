# Handoff prompt — SAP Quote Generator

Paste everything below the line into a new chat that has this folder mounted.

---

I'm continuing work on the **SMB Pre-Sales Portal** — an internal Codestone
portal for SMB pre-sales tooling. It's built, deployed and working, with three
tools live. I'm adding the fourth: the **SAP Quote Generator**, which turns a
completed install assessment into an effort estimate, a costed quote and a
scope document.

You have the whole codebase. Read before you write.

## Read these first, in this order

1. `SMB-PreSales-Portal/CLAUDE.md` — orientation, working rules, and the
   invariants that must not be broken
2. `SMB-PreSales-Portal/docs/decisions.md` — the decision record, AD-01 to
   AD-13. This is the reasoning behind everything in CLAUDE.md. **AD-08,
   AD-10, AD-11, AD-12 and AD-13 are the ones that will shape this tool.**
3. `SMB-PreSales-Portal/docs/game-plan.md` — phase status and open items
4. `frontend/src/config/navigation.ts` — the whole navigation tree. My tile is
   `sap-quote-generator`, currently `status: 'development'`, under
   `data-ai / sap-bi-platform`
5. **The established tool pattern**, most recently and most completely in:
   - `frontend/src/config/sapInstallAssessmentModel.ts` — declarative model
   - `frontend/src/lib/assessments/sapInstallAssessment.ts` — pure logic
   - `frontend/src/lib/assessments/sapInstallAssessmentDocx.ts` — document output
   - `frontend/src/pages/tools/SapInstallAssessment.tsx` — the page
   - `frontend/src/lib/assessments/*.test.ts` — the standard of testing expected
   - `frontend/src/styles/tool.css` — shared chrome. Use it, don't reinvent it
6. `frontend/src/pages/tools/FabricDataCalculator.tsx` and
   `frontend/src/lib/estimating/fabricEstimator.ts` — the other, simpler
   calculator, and the day-factor model pattern

## The stack

React 18 + TypeScript + Vite frontend. Python Azure Functions API. Azure
Static Web App on Standard SKU, Entra auth pinned to the Codestone tenant.
`npm test` is vitest, 154 tests. All three existing tools run entirely
client-side.

## The critical thing to read before designing anything

**A deterministic pricing engine for exactly this job already exists**, as a
skill, and it is authoritative:

```
skills/sap-bia-labmat/
  SKILL.md                              read this first
  scripts/labmat_engine.py              the pricing engine — plan + render
  scripts/verify_examples.py            regression test vs four reference quotes
  reference/SAP_BIA_Products.json       product-code catalogue
  reference/scoping_content_sap_bia.json  checklist content library
  schema/assessment.schema.json          the engine's input contract
  templates/Blank BIA LabMat.xlsx        house-style quote template
  templates/Blank CheckList.docx         house-style scope template
```

(If that path doesn't resolve, it is an installed skill — find it by searching
for `labmat_engine.py`, or ask me for it.)

It already encodes: route selection (in-place upgrade vs install + migration,
with the OS hard rule), product-code mapping, migration bands, 20%
per-phase contingency, PM tiering off contingency-inclusive delivery cost,
£1,200/day at 7.5h, and both renderers. **It reproduces four reference quotes
to the penny.**

**Do not invent or re-derive any pricing rule.** Everything numeric comes from
that engine or is pinned against its output.

## The first decision, and I want you to raise it with me before you build

The engine is Python. The portal's API is Python Azure Functions. So the
obvious design is: browser collects the inputs → `POST /api/tools/sap-quote-generator`
→ engine runs server-side → returns the `.xlsx` and `.docx`.

**That collides with AD-08 and AD-11.** The assessment carries a client name,
a sign-off contact and a technical contact with email addresses — and
`SKILL.md` explicitly says to populate `contact_name` / `contact_email` into
the CheckList. Every tool in this portal so far has kept personal data in the
browser, and AD-11 records that the Word export was deliberately built
client-side to avoid exactly this. A server round trip gives this tool a data
protection footprint the others don't have, and per AD-08 that needs a
decision about retention and a word with Natasha Keskin (General Counsel)
first.

Three routes. Put them to me with `AskUserQuestion` and let me choose — don't
assume:

**A. Port the engine to TypeScript, stay client-side.** Squarely in pattern:
CLAUDE.md's conversion rule says run the original's logic, pin its actual
output as a fixture, then prove the port matches. `verify_examples.py`'s four
reference quotes become the fixture. No personal data leaves the browser.
`.xlsx` via ExcelJS loading `Blank BIA LabMat.xlsx` as a template so house
style survives; `.docx` the same way the install assessment already does it.
**Cost:** two copies of the pricing rules, which will diverge unless we decide
which is authoritative. Name that risk to me and propose a mitigation.

**B. Server-side Python, reuse the engine unchanged.** One pricing
implementation, already verified. **Cost:** personal data is POSTed; needs a
retention decision and Natasha Keskin; also a new AD superseding part of
AD-11's reasoning.

**C. Split.** Strip contacts client-side, POST only the commercial inputs,
merge the contact details into the documents in the browser. Keeps one pricing
engine and no personal data on the wire. **Cost:** the most moving parts, and
two document-assembly paths.

My instinct is A, because it keeps every existing invariant intact and the
verification story is one the repo already uses twice. But argue the case if
you disagree — I'd rather be told than agreed with.

## The input contract

Eventually a link will deep-link into this tool and default-populate it from
the install assessment's JSON export. **Design for that now, but don't wire it
in this pass** — build the tool so it can be hydrated from that object, then
we add the entry point.

**Read `docs/assessment-export-contract.md` and
`docs/sap-install-assessment.v2.schema.json`.** Between them they are the full
contract: every key, the mapping to the LabMat engine's input, which fields
are free text and need AI normalisation, which of those moves the price, and
a worked example. The schema is generated from the model and validated against
all four pinned scenarios.

The export is produced by `toExport()` in
`frontend/src/lib/assessments/sapInstallAssessment.ts`, pinned in
`frontend/src/lib/assessments/__fixtures__/reference.json` (four scenarios —
read them, they are real output). Currently `schemaVersion: 2`. Shape:

```
{
  schemaVersion: 2,
  tool: 'sap-install-assessment',
  installationType: 'businessobjects' | 'crystal-server',
  client:       { ...client-level answers },
  environments: [ { id, label, answers: { ...per-environment answers } } ],
  completeness: { required, answered, isComplete },
  advisories:   [ { id, scope?, text } ]
}
```

**Three states, and the difference is load-bearing:**

| In the export | Means |
|---|---|
| key absent | Not applicable — the platform does not have this |
| `null` | Applicable, not yet answered |
| a value | Answered, **or implied by another answer** |

Collapsing absent and `null` would eventually price zero universes for an
estate that has eighty. Honour the distinction.

Fields that map onto the engine's `schema/assessment.schema.json`:

- `installationType` → `product` (`BOBJ` / `CRY`)
- `operatingSystem` → `operating_system` and `os_pre_ws2022`. **The engine
  hard-rules install+migration when the OS is pre-Windows Server 2022, so
  this parse matters commercially.** Don't guess it from a free-text string
  silently — surface what you inferred and let the consultant confirm
- `authentication` → `auth` (`Enterprise` / `Windows AD` / `SAML`), also free text today
- `inputFileRepositoryGb` + `outputFileRepositoryGb` → `frs_gb` (combined)
- universes + publications + reports → `content_count`
- `externallyFacing`, `separateTomcat` → drive Tomcat lines
- `environments.length` → `environments` (duplicates install/config effort)
- BOBJ + universes present → `convert_universes`
- `client`, `signOffName`, `signOffEmail`, `technicalContactName`,
  `technicalContactEmail` → `client_name`, `contact_name`, `contact_email`

Note the assessment is **per-environment** and the engine takes a single
environment count. Decide and record how multi-environment estates aggregate
— and tell me if that loses something that should be priced.

## How I need you to work

**Follow the tool pattern.** Data model in `config/`, pure logic in `lib/`
(no DOM, no network, testable without React), page in `pages/tools/`, shared
chrome from `styles/tool.css`, route in `main.tsx`, tile flipped to `live` in
`config/navigation.ts`.

**Pricing data is published methodology.** Per AD-09 and CLAUDE.md: same
inputs must give the same answer next month, two consultants must agree, and
fixtures pin it. If a change makes a fixture wrong, that's a pricing decision
— regenerate the fixture **in the same commit** and say why. Never adjust a
fixture to make a test pass.

**Fixtures must store their own inputs.** AD-10 records that the two older
fixtures recorded outputs without inputs, so they can't be replayed. Don't
repeat that. `npm run fixtures:update` is the regeneration path.

**Build and test before telling me it's done:**
```
cd frontend && npm ci && npm test && npm run build
```
`npm run build` is the same `tsc -b && vite build` CI runs. **CI does not run
the tests** — Azure owns that workflow and we don't touch it, so `npm test` is
a local discipline.

**Do not run `npm ci` in this folder.** It's OneDrive-synced and ~130 packages
of `node_modules` will trigger a sync storm. Copy `frontend/` to a scratch
directory, install and build there, and copy back only the files you changed
(`package-lock.json` and any regenerated fixture).

**Record every significant decision** in `docs/decisions.md` as a new AD entry
(next is AD-14). Explain the reasoning and the cost, not just the choice — and
if you reject an approach, say why, because the next person will consider it
again.

**Tell me plainly if something I ask for conflicts with an invariant in
CLAUDE.md.** That's more useful to me than compliance.

## Things this project learned the hard way — inherit them

- **Ask before building.** Last tool, I revised five model decisions after
  seeing it. Use `AskUserQuestion` on anything genuinely ambiguous — output
  format, persistence, whether to derive numbers, layout — before writing code,
  not after.
- **Render document output and look at it.** AD-13: the heading bands came out
  navy because the code trusted the `CTHeading1` style, while the source
  document overrides it with a direct green fill on every heading. XML
  assertions passed. Only converting to PDF and viewing it caught the mistake.
  If LibreOffice is available, use it.
- **`templates/install-assessment.styles.xml`** in
  `frontend/src/lib/assessments/` is the styles part lifted out of the real
  Codestone document, imported with Vite's `?raw` and passed to `docx` as
  `externalStyles`. Reuse it. Replacing that file rebrands the output.
- **Match the source template exactly, including its inconsistencies.** Two of
  its column grids are 10 twips wider than the others. Reproduced deliberately
  rather than tidied. Same discipline applies to the LabMat and CheckList
  templates — they are house style and people file them.
- **Lazy-load heavy dependencies.** `docx` is 400 kB and imported inside the
  click handler so it code-splits; the main bundle grew 2 kB, not 400. Do the
  same for ExcelJS or anything comparable.
- **Bump the schema version when the export shape changes**, and keep the
  `localStorage` key scoped to it — a bump then discards half-finished work
  instead of silently misreading it.
- **Distinguish "not applicable" from "unanswered"** in anything you emit.
- **`as const` on a constants object narrows to literal types** and will break
  default parameters typed from it. Annotate the parameter `: number`.
- **Adding a dependency changes `package.json`**, which means a `src`-only
  deploy will fail CI. Say so when it happens.

## Persistence and personal data

If this tool holds anything across a refresh, read AD-11 first. The install
assessment does use `localStorage`, deliberately, and carries a notice saying
so plus a **Clear assessment** control — both of which have to stay true. A
quote in progress is at least as long a sitting, so the same reasoning
probably applies, but state the position rather than inheriting it silently.

## What done looks like

1. `AskUserQuestion` on the architecture decision above and anything else
   materially ambiguous — before code
2. `config/` model, `lib/` pure logic, fixtures pinned against
   `labmat_engine.py`'s actual output for the four reference quotes
3. Page at `/tools/sap-quote-generator`, route in `main.tsx`, tile flipped to
   `live`
4. LabMat `.xlsx` and CheckList `.docx` output in house style, from the blank
   templates
5. Tests to the standard of `sapInstallAssessment.test.ts` — including a
   parity test against the Python engine
6. AD-14 (and any others) in `docs/decisions.md`; CLAUDE.md and
   `docs/game-plan.md` updated
7. `npm ci && npm test && npm run build` green from a clean copy, and the
   generated documents rendered and eyeballed
8. Tell me exactly which paths to copy into the repo

Answer-first, one concrete next action at the end, and keep it concise.

**Start by reading everything above, then confirm you're up to speed and put
the architecture question to me. Don't write code yet.**
