# Architecture decisions

## AD-01 — Azure Static Web Apps with platform-managed auth

**Decision.** Use the SWA built-in Entra ID provider rather than MSAL.js in
the browser.

**Why.** The browser never holds a token. SWA terminates the OIDC flow at the
edge, sets an encrypted HTTP-only session cookie, and injects the validated
identity into the API as `x-ms-client-principal`. Nothing in `localStorage`
to steal; no token-refresh code to get wrong; the client cannot forge the
header because SWA strips any inbound copy.

**Cost.** Locked to the SWA platform, and we only get the ID-token claims —
no downstream Graph or Fabric access token. When the portal needs to call
Fabric *as the user*, this decision gets revisited (see AD-04).

## AD-02 — Defence in depth on the API

Route-level `allowedRoles: ["authenticated"]` in `staticwebapp.config.json`
is the first gate. Every endpoint additionally runs `@require_auth`, which
decodes and validates the principal itself. Config drift is a real failure
mode; a route rule quietly weakened in a merge should not silently expose
data.

## AD-03 — Navigation as data, rendered flat (revised twice, 31 July 2026)

`frontend/src/config/navigation.ts` is the single source of truth for the
entire navigation tree. Two components render it: `SectionGrid` (landing
page cards) and `ToolList` (everything below).

### The data model

A recursive `Section` may hold `children` (sub-sections), `tiles`
(tools), or both. Depth is unlimited in the data.

### The rendering decision

**Sub-sections do not get their own pages.** A practice area renders all
of its groups inline, side by side on wide screens, each as a headed list
of compact rows.

The first attempt gave every sub-section a card that linked to its own
page. With three groups and eight tools in Data & AI alone — and the
other two practices still to be filled in — that meant three clicks to
reach a tool and a proliferation of near-empty pages. The navigation cost
would have exceeded the organisational benefit almost immediately.

**Now: one click from the landing page reaches any tool.** A practice
area fits on one screen.

### Why keep the recursive model if it renders flat

Three reasons:

1. Groups are still real. They give tools a heading, a summary, and an
   order — the structure is meaningful even when it isn't clickable.
2. Sub-sections remain addressable (`/area/data-ai/assessments`) because
   the resolver walks the tree. Nothing links there today, but if a group
   grows to twenty tools it can be given its own page without a data
   migration.
3. A section with no children renders as a single group, so Infrastructure
   and ERP look identical to Data & AI without special-casing.

### Invariants worth preserving

- **Tile ids are globally unique.** Two groups both have a "Quote
  Generator"; their ids differ (`sap-quote-generator`,
  `fabric-quote-generator`). Ids are React keys and will become
  analytics identifiers.
- **`resolvePath` returns `undefined` for any unknown segment**, never
  the nearest match — a stale bookmark 404s rather than silently landing
  somewhere plausible.
- **A `live` tile must have `to` or `href`.** Covered by test.
- External links use `target="_blank" rel="noopener noreferrer"` and are
  marked with an icon, so it's clear when the user is leaving the portal.

## AD-04 — Fabric and Claude deferred

The API is a two-endpoint shell. Database and AI concerns land later as
`shared/db.py` and `shared/ai.py`; `function_app.py` stays routing-only.
Deferring them keeps the first deploy small enough to debug in one sitting.

## AD-05 — Tenant: Codestone directory, daicodestone domain

**Decision.** The portal authenticates against the Codestone directory,
tenant `2e99fe9c-8eeb-485a-83e3-6c4179eded6d`. `daicodestone.onmicrosoft.com`
is a domain within that directory, not a separate tenant — but it is
sufficient to register and own this application independently.

**Consequences.**

- Every Codestone account can sign in with no guest-invite process.
  Existing Conditional Access, MFA and device policy apply automatically.
- Single-tenant registration is correct and sufficient.
- App registration and secret rotation are self-service — no Systems
  dependency for day-to-day iteration.

**Open item.** Because the whole directory can authenticate, the portal is
open to every Codestone account, not just pre-sales. If that audience is
too wide once tools hold client data, add Entra app-role gating
(`allowedRoles` per route in `staticwebapp.config.json`). Cheap now,
awkward later.

## AD-06 — SUPERSEDED by AD-07 (Free SKU workaround)

*Retained for context. The app was briefly on the Free SKU, where custom
authentication is unavailable and the service-defined `aad` provider
accepts any Microsoft account from any tenant. The organisational
boundary was enforced solely in `api/shared/auth.py`. That constraint no
longer applies — see AD-07.*

## AD-07 — Standard SKU with custom Entra authentication

**Date:** 31 July 2026.

**Decision.** Upgraded to the Standard SWA SKU and restored the `auth`
block, pinning authentication to the Codestone tenant
(`2e99fe9c-8eeb-485a-83e3-6c4179eded6d`) via a dedicated app
registration.

**Effect.** Adding a custom registration disables all service-defined
providers, so `authenticated` now means "signed in against our tenant".
The AD-06 residual risks are resolved or resolvable:

| AD-06 risk | Status |
|---|---|
| 1. Static assets served to any signed-in Microsoft account | Resolved once `/*` is restricted — see "Outstanding" below |
| 2. Domain fallback weaker than tenant pinning | Resolvable — drop the fallback after verifying the `tid` claim arrives |
| 3. Public Codestone-branded login page | Resolved — outsiders are stopped at the Microsoft login |
| 4. No SLA | Resolved |

**The tenant check in `api/shared/auth.py` stays.** It is now belt and
braces rather than the only defence, and that is the point: platform auth
is configuration, and configuration drifts. A merge that drops the `auth`
block would silently reopen the app while the route rules still read
`allowedRoles: ["authenticated"]` and still look correct. The code check
fails closed and is covered by tests.

### Follow-ups — both now closed

Both were held back from the deploy that introduced the `auth` block, so
that a single change could be verified in isolation. Changing auth
configuration and access rules simultaneously makes a failure impossible
to diagnose, and a redirect loop on a portal you're locked out of is an
unpleasant place to start debugging. That sequencing proved its worth.

1. ~~**Restrict `/*` to `["authenticated"]`.**~~ **Done** — 31 July 2026,
   after login was confirmed working end to end. The static bundle is
   now tenant-gated; AD-06 residual risk 1 is closed.
2. ~~**Drop the email-domain fallback**~~ — **closed as not applicable**,
   31 July 2026. Verified on the live site: the `tid` claim does not
   arrive. The SWA client-principal header carries only
   `identityProvider`, `userId`, `userDetails` and `userRoles` — no
   claims collection — so the domain branch is the only one that fires.
   `/health` panel 2 reads `domain:codestone.com`.

   **The fallback is therefore permanent, and that is fine.** It is only
   ever reached by a caller who has already completed tenant-pinned
   authentication against our app registration, so it cannot be used to
   gain access — it is a second assertion about someone the platform has
   already vouched for. AD-06 residual risk 2 is moot: a personal
   Microsoft account on a verified `@codestone.com` address cannot pass
   the tenant-pinned sign-in, so it never reaches this code.

   The `tid` branch stays — it costs nothing and future SWA versions may
   populate claims.

### Root cause of the deployment difficulty (for the record)

Sign-in looped silently for some hours. Cause: the client ID and client
secret came from **two different app registrations**. Entra accepted the
authorize request because the client ID was valid, issued a token, and
SWA's callback then failed the exchange against a secret belonging to a
different client — producing a 302 back to `/.auth/login/aad` with
`Set-Cookie: Nonce=deleted` and no error message anywhere.

Compounding it, the loop is self-sustaining: each restart issues a fresh
nonce, so the returning token is always bound to a stale one. Retrying
without clearing cookies fails regardless of what has been fixed.

Both are now documented in `docs/upgrade-to-standard.md` as traps 4 and
5, with a symptom→cause table.

## AD-08 — Assessment Scoring Engine: client-side only

**Date:** 31 July 2026. First real tool in the portal.

### Personal data stays in the browser

The pasted questionnaire response contains a named individual, their
employer, job title and email address. Scoring runs **entirely in the
browser** — there is no API call in this feature.

That is a deliberate GDPR position, not an implementation shortcut:

- client personal data never reaches a Codestone server
- it never enters an application log or Application Insights trace
- there is no stored copy, so no retention policy is required
- closing the tab discards it

**Do not add a server round trip to this tool** — for persistence,
history, or AI enrichment — without first deciding what happens to the
personal data, and speaking to Natasha Keskin (General Counsel) about
retention. The moment a response is POSTed, this tool acquires a data
protection footprint it currently does not have.

The UI states this to the user, so the claim is visible and has to stay
true.

### The methodology is data, and it is pinned

`config/assessmentModel.ts` holds section weights, question weights,
keyword mappings, influencer points and penalty tiers. That data **is**
the published methodology — a score produced today must be reproducible
tomorrow, and two consultants scoring the same response must get the same
number.

`lib/scoring/__fixtures__/kermit.json` pins the reference output taken
from the original standalone prototype. The TypeScript port reproduces
all 13 question scores, all four section scores and the overall figure to
six decimal places. If a methodology change makes the fixture wrong,
regenerate it in the same commit and say why in the message.

### One inherited bug, fixed at the presentation layer

The tool-penalty question scores even when nothing is pasted: an absent
estate reads as "no legacy dependency" and lands at 50. With every other
question unmatched, Data Foundations averaged to 50 and the overall score
came out at **50% — "Proactive Performer" — from an empty input box.**

A flattering, plausible-looking number produced from no data is more
dangerous than a visible error, because nothing about it invites a second
look before it reaches a client document.

`assessConfidence()` now gates the output:

| Scored (of 12 substantive) | Behaviour |
|---|---|
| 0, or fewer than half | **No score shown.** Explains what to check |
| Some, but not all | Score shown with a prominent warning listing what failed |
| All 12 | Score shown clean |

The arithmetic is untouched, so parity with the prototype holds. The gate
sits above it.

### Conversion notes

- Dark teal prototype restyled to the portal's light theme. Four section
  accents were added to `tokens.css`, chosen to stay distinguishable in
  greyscale — assessment output is often printed.
- Scoring extracted to `lib/scoring/assessmentScoring.ts`: pure
  functions, no DOM, unit tested independently of React.
- `Breadcrumbs` gained an optional `tail` for pages that sit below a
  section without being one.
- Tool routes live at `/tools/<slug>`, referenced from a `Tile` in
  `config/navigation.ts`.

## AD-09 — Fabric Data Calculator, and the shared tool layer

**Date:** 31 July 2026. Second tool.

### Estimating factors are commercial data

`config/fabricEstimatorModel.ts` holds the day factors, mirrored from the
source `Fabric calculator.xlsx`. **They feed quotes.** Same treatment as
the assessment methodology in AD-08: the same inputs must produce the
same estimate next month, two consultants estimating the same scope must
agree, and `lib/estimating/__fixtures__/reference.json` pins reference
outputs taken from the original prototype.

The port was verified against seven cases — empty, single line, mixed,
all-ones, non-default hours-per-day, zero hours-per-day, and fractional
factors — matching total days, total hours, per-category days and
formatted output exactly.

Changing a factor is a pricing decision. Regenerate the fixture in the
same commit and say why.

### Shared tool chrome extracted

`styles/tool.css` now holds the header, tabs, panels, buttons, output
block and notice styles. Both tools import it.

Extracted at the second tool rather than the first — one tool gives no
evidence about what is genuinely shared, three means unpicking
divergence that has already set in. The rule going forward: anything a
third tool would also need belongs in `tool.css`; anything specific to
one tool stays in its own stylesheet.

This is also why the copy-to-clipboard block is now the generic
`.output-panel` / `.output-block` rather than the scoring engine's
`.template-*`. Both tools produce copy-ready text for a downstream
document, and that is likely to be the common shape.

### Two behaviours preserved deliberately, and one flagged

- **Blank, negative and non-numeric quantities all coerce to 0** rather
  than propagating `NaN`. A single bad keystroke should not blank the
  whole estimate.
- **Category bars scale to the largest category, not to the total.**
  They are a comparison between categories, so the largest always reads
  100%. In a single-category estimate the one populated bar appears
  full, which can mislead — the UI now carries a one-line note saying
  what the bars mean.
- **Quantities are not persisted.** A refresh clears the form. Acceptable
  for a short estimating session; if consultants start losing work, the
  fix is `localStorage`, not a server round trip.

### No personal data here

Unlike the scoring engine, this tool takes no personal data — just
quantities. It still runs client-side, but the AD-08 constraint is about
that tool's inputs specifically, not a blanket rule. A future server call
from *this* tool would not carry the same objection.

## AD-10 — A test runner, three tools late

**Date:** 3 August 2026.

**Decision.** Added `vitest` and `@types/node`, with `npm test`, and wrote
the tests that AD-03, AD-08 and AD-09 already claimed existed.

### What the situation actually was

Before this, `package.json` had no test runner and the repo had no test
files. The fixtures in `lib/estimating/__fixtures__` and
`lib/scoring/__fixtures__` were real reference outputs, and the ports were
genuinely checked against them — but **by hand, once**. Nothing re-checked
them afterwards.

So the invariants in CLAUDE.md were accurate as intentions and false as
descriptions. "Covered by test" was aspirational. A day-factor edit would
have shipped silently, which is precisely the failure the fixtures were
introduced to prevent.

111 tests now cover:

| Area | What is asserted |
|---|---|
| `config/navigation` | Tile-id uniqueness, live tiles have a destination, sibling slug uniqueness, `resolvePath` returns `undefined` for unknown segments |
| `lib/estimating` | All seven pinned prototype cases replayed — totals, category subtotals, formatted values, summary lines — plus the NaN-coercion and bar-scaling behaviours AD-09 preserved deliberately |
| `lib/assessments` | Field visibility, completeness, advisories, export shape, persistence guard, model integrity |

### The existing fixtures record outputs but not inputs

`estimating/reference.json` stores days, hours and summary lines — not the
quantities that produced them. A fixture that cannot be replayed is a
record, not a test.

The estimator test therefore **reconstructs the quantities from the
recorded summary lines**, each of which states its own quantity, and feeds
them back through the port. That is not circular: the quantities come from
the line text, and the days, hours, subtotals and formatting are then
recomputed and compared. A changed day factor still fails it.

It is nonetheless a workaround. Storing the inputs alongside the outputs
would remove it — but that means regenerating a pinned fixture, which this
project rightly treats as a deliberate act, so it is left for a commit of
its own. **Open follow-up.**

`scoring/kermit.json` cannot be replayed at all: it records the output of
the prototype without the questionnaire text that produced it, and that
text is not in the repo. Until the source response is recovered, that
fixture stays a record. Its supporting logic is tested directly instead.

### Regenerating a fixture

`npm run fixtures:update` rewrites the assessment fixture from the
scenarios in the test file. It exists so that regenerating is one
deliberate command rather than hand-editing JSON — the rule in CLAUDE.md
is unchanged: regenerate in the same commit as the change, and say why.

## AD-11 — SAP Pre-Sales Install Assessment

**Date:** 3 August 2026. Third tool, and the first that is capture rather
than calculation.

### Built from a document, but not as a form

The source is `Blank Install Assessment.docx`. The tool deliberately does
**not** mirror it.

The document groups fields by subject. This tool groups them by **where the
consultant gets the answer from** — one CMC screen per tab — because the
tool is filled in live during a technical conversation, and reordering to
match the screens the client is sharing removes most of the back-and-forth.
Half of every tab is reserved for a screenshot showing where to look, since
the person completing it may not know the platform well.

Mapping back to the document, for anyone reconciling the two:

| Document section | Tabs |
|---|---|
| Overview (contacts) | Overview information |
| Overview (user landscape, narrative, adjacent work) | Usage and future plans |
| Platform Overview (per environment) | Landscape overview · Server Technical Information · Central Configuration Manager · CMC Settings |
| Content Migration | Central Configuration Manager (filestore) · CMC Universes · CMC Contents · CMC Schedules |
| Training Requirements | Training requirements |
| Go Live Requirements | Go Live requirements |

Two consequences worth knowing:

- **Content Migration becomes per-environment.** The document has one
  table; a two-environment estate needs two sets of counts, so the tool
  captures them per environment and the export nests them.
- **Test and development environments are counted, never detailed.** They
  are rebuilt as a copy of the new production once it is ready, so their
  current configuration does not size the work. Only the count matters.

### Capture only — no derived figures

Deliberately decided: this tool applies no day factors and produces no
effort estimate. Every number in its output is a figure the client stated.

That keeps `config/sapInstallAssessmentModel.ts` outside the
published-methodology burden of AD-08 and AD-09 — there is nothing in it
that could make a quote wrong next month. Pricing stays where it already
lives, in the Quote Generator and the SAP BIA LabMat skill.

The one thing the tool does add on its own initiative is **advisories**:
prompts triggered by an answer, such as auditing being disabled or
instances not all being required. They are conversation reminders, not
calculations, and none of them touches a number.

### What is pinned, given there was no prototype

CLAUDE.md's conversion rule — run the original's logic, pin its output,
prove the port matches — does not apply. There was no prototype and there
is no arithmetic. Following the rule literally would have produced a
fixture asserting nothing.

`lib/assessments/__fixtures__/reference.json` pins the two things that can
actually break something downstream, across four scenarios (blank,
BusinessObjects complete, Crystal Server, two environments partial):

1. **Which fields get asked.** Choosing Crystal Server removes the CMC
   Universes tab, the Web Intelligence document count, the universe
   modifier count and three training items. A field that silently stops
   being asked becomes a quote that silently stops pricing it.
2. **The export shape**, which the SAP Quote Generator will read.

Unlike the other two fixtures this one is **not** independent evidence of
correctness — nothing outside the code says these values are right. It is
a change detector. A failure means the contract moved, which is sometimes
the intention. It stores its own inputs, so it can always be replayed.

### Inapplicable is not the same as unanswered

In the export, a field that does not apply to the chosen installation type
is **absent**; a field that applies but has not been answered is `null`.
The Quote Generator can therefore distinguish "Crystal Server, so there are
no universes" from "BusinessObjects, universes not counted yet". Collapsing
those two into one value would eventually produce a quote that priced zero
universes for an estate that has eighty.

`ASSESSMENT_SCHEMA_VERSION` is exported for consumers. Additive changes are
safe; renaming a key is breaking and bumps the version.

### localStorage — a change of posture from AD-08 and AD-09

**This tool saves to `localStorage`. The other two do not.**

AD-09 said that if consultants started losing work the fix would be
`localStorage`, not a server round trip. That point arrives here: a
multi-environment assessment runs to fifteen-plus tabs and seventy-plus
fields, gathered live on a call. Losing it to an accidental refresh was not
defensible.

But the Overview tab holds a client name, two contact names and two email
addresses. AD-08's position for the scoring engine is that personal data
lives in the browser and *"closing the tab discards it"*. That is no longer
true here, so the position has to be stated accurately rather than
inherited:

- **Still true:** no API call, no server copy, no application log, no
  Application Insights trace, nothing to define a retention policy for on
  Codestone infrastructure.
- **Newly true:** contact details persist in the consultant's browser
  profile until cleared — which on a synced browser profile may mean more
  than one device.

Mitigations, all of which have to stay:

1. A notice at the top of the page states plainly that the assessment is
   saved in this browser on this device, includes the contact details
   entered, and should be cleared once written up.
2. A **Clear assessment** control that removes the stored copy, behind a
   confirmation naming what is being deleted.
3. The storage key is version-scoped, so a schema change starts clean
   rather than migrating a half-finished assessment.
4. `deserialise()` refuses anything it does not fully recognise rather than
   attempting a repair. A partially-restored assessment is worse than an
   empty one, because the consultant would not know which answers survived.

**Still to settle:** whether contact details on a synced browser profile
needs a word with Natasha Keskin (General Counsel). It is a weaker case
than a server-side store — the data never leaves the consultant's own
device and machines are already managed — but it is not nothing, and the
answer should be recorded here rather than assumed. **Open item.**

### Word export deferred, and it will stay client-side

The intended second output is a `.docx` matching the source document. It
will be generated **in the browser**, not by the Functions API.

Generating it server-side would mean POSTing the contact details, which
would give this tool a data-protection footprint it currently does not
have — the exact thing AD-08 warns against — in exchange for nothing the
browser cannot do. The cost of the client-side route is one dependency and
some bundle weight, which is the cheaper trade.

Held back from this commit so the form and its contract could be verified
before a dependency landed on top of them. **Open item.**

### Shared chrome, second extraction

`styles/tool.css` gained a vertical tab rail with one level of nesting, a
form/guidance split, and the form vocabulary that Phase 2 step 2 of the
game plan called for — labels, hints, inputs, a GB-suffixed number field
and a segmented yes/no control.

Horizontal `.tool-tabs` stops working past about five tabs, and a flat rail
of `PROD01 · CMC Settings` entries stops working past about two
environments. Nesting one level, and no more, keeps the rail readable at
eight environments without reintroducing the multi-page navigation AD-03
removed.

All of it went into `tool.css` rather than the page stylesheet on the AD-09
rule: the SAP Quote Generator is next, it consumes this tool's output, and
it will need every one of these controls.

## AD-12 — Install assessment, first review pass

**Date:** 4 August 2026. Changes from the first read-through of the built
tool. Schema **v1 → v2**.

### Word export, delivered and client-side

The `.docx` deferred in AD-11 is now built, by the `docx` package running
**in the browser**. The decision not to generate it server-side stands and
is worth restating, because a Functions endpoint will keep looking like the
obvious home for it: generating it server-side means POSTing the client
name and two sets of contact details to a Codestone server, which hands
this tool a data-protection footprint it does not currently have, in
exchange for nothing the browser cannot already do.

`lib/assessments/sapInstallAssessmentDocx.ts` returns a `Document` and
touches no DOM. The page calls `Packer.toBlob()`; the tests call
`Packer.toBuffer()`, unzip the result and assert against the real XML — so
what is tested is what Word will show, not what the builder intended.

**Dynamically imported.** `docx` is 358 kB, comparable to the whole rest of
the app, and most page loads never click the button. The import is inside
the click handler so Vite emits it as a separate chunk; the main bundle grew
by 2 kB, not 360.

### The document keeps its own shape

The tool reorders questions to suit the conversation. The **document does
not** — it keeps the source file's five sections in the source file's order,
with the source file's row labels ("Date of Conversation", not the tool's
"Date of conversation"). What gets filed should read like the document
people already know.

Three consequences, all deliberate:

- **Rows are never dropped, only marked `n/a`.** A Crystal Server
  assessment still has "Number of UNVs" and "Web Intelligence training"
  rows. Two documents produced from the same template should be
  structurally the same document, whichever platform they describe —
  otherwise whoever files them cannot compare them.
- **Go-live writes four rows from one answer.** See below.
- **Advisories become a "Points to Raise" section**, passed in from
  `advisories()` rather than recomputed, so the Word output and the
  on-screen record cannot disagree.

### Five model corrections

| Change | Reason |
|---|---|
| `proposedServerName` removed | Not needed at assessment time. The source document's "Proposed Server" column goes with it, leaving a two-column table. |
| `installationFolder` removed | It was never the answer — it is the *route* to the filestore sizes. It belongs in the guidance pane, not as a captured field. |
| `auditDatabaseSoftware` removed | The audit database always runs on the same software as the CMS, so asking twice invites a contradiction. One field, relabelled "CMS / audit database software", plus "Auditing currently enabled?". |
| `separateWebServer` gated on `separateTomcat` | Without a separate Tomcat there cannot be a separate web server. Asking was noise. |
| Four `goLive*` booleans → one `goLiveTiming` | They are rate categories, and a cutover falls into exactly one. |

### Implied answers: a third export state

Gating `separateWebServer` created a case the export could not represent.

The field is hidden, but its answer is **known** — No. AD-11's rule was
"hidden means absent, absent means not applicable", which would have made
the Quote Generator re-derive the Tomcat rule to fill the gap. Two copies of
one rule, in different languages, is how they diverge.

So `Field.impliedWhenHidden` now carries the value a field takes when its
dependency hides it, and the export writes it as a value:

| In the export | Means |
|---|---|
| absent | Not applicable — the platform does not have this |
| `null` | Applicable, not yet answered |
| a value | Answered, **or implied by another answer** |

Used sparingly, and only where hiding *determines* the answer. `webServerName`
deliberately has no implied value: not asking for the name means we do not
know it, not that there isn't one. The on-screen record marks implied
answers `(implied)` so nobody wonders why a question is missing.

### Go-live: one question, four document rows

Single select. The Word export writes the source document's four Yes/No rows
with the chosen timing as Yes and the other three as No — and all four blank
when nothing has been chosen, so an unanswered form does not read as four
explicit Nos.

**Known limitation, accepted for now.** "Specific day of the week" is
arguably orthogonal to the other three: a client wanting a Saturday
overnight cutover cannot record both. Treating the four as rate categories
is the right commercial model and the wrong logical one. If that
combination comes up in practice, the fix is a timing answer plus an
optional weekday, not four booleans again. **Open item.**

### Schema v2 discards assessments in progress

`STORAGE_KEY` is scoped to `ASSESSMENT_SCHEMA_VERSION`, so the bump means
anything half-finished in a browser is not migrated — it starts clean. That
is the intended behaviour of the AD-11 versioning decision and costs nothing
today, since the tool has not yet been used on a live call. It will cost
something once it has: a future schema change needs either a migration or a
deliberate choice to lose work, and this is the moment to notice that rather
than the moment it happens.

### Tests

142 now, up from 111. New coverage for the implied-value rule, the removed
fields (asserted absent, so reinstating one is a conscious act rather than a
merge), the single-select go-live behaviour, and twenty tests reading the
generated Word XML.

## AD-13 — Matching the source document's look and feel

**Date:** 4 August 2026.

**Decision.** The Word output reproduces `Blank Install Assessment.docx`
visually: the styles part is lifted out of the real file, and the table and
page formatting is transcribed from it.

### Generated, not patched — and why that was the harder question

`docx` offers `patchDocument`, which fills `{{placeholder}}` tokens in an
existing file. That is the obvious way to "populate a specific template", and
it was rejected for a structural reason rather than a preference:

- The document repeats **two whole tables per production environment**.
  Patching does not repeat table rows or tables, so the template would need a
  fixed maximum number of environments, each with a blank fallback.
- Several rows are **conditional**: universes collapse to a single combined
  row, Crystal Server rows read `n/a`, narrative rows appear only when there
  is narrative. Patching cannot omit a row.

So the template would have had to carry every combination, and the code would
still have decided which to fill. The layout would have looked like it lived
in Word while actually living in the code — the worst of both.

**What is taken from the real file** is
`lib/assessments/templates/install-assessment.styles.xml` — the styles part,
verbatim, imported with Vite's `?raw` and handed to `docx` as
`externalStyles`. So `CTHeading1` in the output *is* the Codestone heading
style. A rebrand is replacing that one file.

### What the styles part cannot carry

Table and page formatting are properties of each table and section, not named
styles, so they are transcribed into `LAYOUT` and asserted against the
generated XML by test. Measured from the source document:

| | |
|---|---|
| Label fill | `#3FBD02` Codestone green |
| Label text | Arial 9pt, bold, white |
| Borders | **All off.** Structure reads from the green cells, not from rules |
| Row height | 397 twips minimum, vertically centred |
| Page | A4, margins 568 / 849 / 709 / 709 twips |

### Three things that look like bugs and are faithful

1. **Headings are green, not navy.** `CTHeading1` defines a navy `#364580`
   band — and the source document overrides it with a direct green fill on
   every single heading paragraph. The first attempt trusted the style and
   produced navy bands. The document wins over its own stylesheet.

2. **Platform Overview shades only its header row.** Its body labels are
   plain, unbolded Arial. Every other table shades its whole label column.
   Four tables, four different column grids: `2547/2597/2597/2597`,
   `3446/3446`, `10338`, `4111/6237`, `4678/5670`. There is no single table
   style to extract — each shape is transcribed.

3. **Two of those grids sum to 10348, not 10338.** Ten twips over the text
   width, almost certainly someone dragging a column border in Word years ago.
   Reproduced rather than tidied: ten twips is 0.18 mm, invisible, and each
   table takes its width from its own grid so nothing stretches. The test
   allows 0–10 twips of slack and says why, rather than asserting a
   consistency the source file does not have.

### Two structural departures, both deliberate

- **The Overview "Narrative" row is gone.** The document has both a generic
  "Narrative" row and a standalone "Transition to another toolset?" table.
  The tool captures one forward-looking narrative, and the transition table is
  its natural home, so `futureDirection` goes there and the generic row —
  which nothing could ever populate — is dropped rather than left permanently
  empty.
- **Platform Overview lost its "Proposed Server" column**, following
  `proposedServerName` out in AD-12. Two columns, not three.

### Verified by rendering, not just by XML

The generated file was converted with LibreOffice and compared against the
original page for page. Worth doing again after any change here: the XML tests
catch a fill or a width changing, but only looking at it catches a heading
band coming out the wrong colour because a style was trusted over the
document.

## AD-14 — SAP Quote Generator, rebuilt from the standalone prototype

**Date:** 5 August 2026. Fourth tool.

**Decision.** `bobj_generator.html` — a self-contained browser app Mike had
already built and used — is rebuilt in the portal's pattern:
`config/sapQuoteGeneratorModel.ts` for the data, `lib/quoting/` for the
arithmetic and both document writers, `pages/tools/SapQuoteGenerator.tsx` for
the page. Its behaviour is reproduced rather than redesigned.

Populating it from the install assessment's JSON export is a **later pass**,
and so is the Claude API. Neither is wired here.

### The prototype is the pricing authority, and the LabMat skill is not

There are two implementations of SAP BIA pricing in reach: this prototype, and
`labmat_engine.py` in the `sap-bia-labmat` skill. They are not the same model,
and the difference is not cosmetic.

| | `labmat_engine.py` | `bobj_generator.html` |
|---|---|---|
| Hours | derived from assessment inputs (migration bands, auth, environments) | typed by the consultant |
| Route | forced by the OS rule | a manual toggle |
| Phases | Design · Build · UA-Testing · Transition | plus System Testing · Training · Transition-Operations · Universe Development |
| Contingency | 20% per phase always | 20% Fixed, **0% Target** |
| PM tier basis | contingency-**inclusive** cost | contingency-**exclusive** value |
| PM thresholds | `<=` | `<` |
| Gold | refuses to price, quote manually | priced at 25% |
| PM codes | one per tier | `-TM` variants for Target |

**Decision: the skill is out of scope for this tool and is not consulted.**
Mike's instruction, and the right call — the engine solves a different problem
(deriving effort from an assessment) from the one this tool solves (costing
effort a consultant has estimated).

**What that costs, stated plainly.** On the Broder Crystal Server install —
one of the four reference LabMats the engine reproduces to the penny — the two
disagree:

```
base delivery 29.25h  →  £4,680 ex-contingency  /  £5,616 inc-contingency
engine:  tiers on £5,616 → Bronze L1 @ 12.5% → £6,318.00  ← the filed LabMat
this tool: tiers on £4,680 → Bronze L2 @ 10%   → £6,177.60
```

**£140.40 low, and only for quotes whose base delivery cost falls between
£4,167 and £5,000** (where adding contingency crosses a threshold the base
figure does not). The same gap exists at the £10k and £50k boundaries.

This is recorded rather than fixed because reproducing the prototype was the
instruction, and because quotes have already been issued from it — changing
the basis now would make this tool disagree with work already out. If it
should be changed, it is a one-line change in
`autoSelectedPmLevel()`'s caller plus a fixture regeneration, and it is a
pricing decision, not a bug fix. **Open item.**

### Two behaviours that look like bugs and are the prototype's

Both are pinned by fixture and commented at the point of use, because both
will look like mistakes to whoever reads the code next:

1. **PM tiers off contingency-exclusive value.** `autoSelectPm()` was called
   from `render()` with a total that excluded contingency rows, while the
   figure on screen beside it included them.
2. **Strictly-less-than thresholds.** A base value of exactly £5,000 is
   `coord`, not `admin`.

### Gold is priced, and warned about

The prototype prices Gold at 25%. Kept — a tier that silently produces a
number is worse than one that produces a number and says so, and the skill's
"quote manually" behaviour is not available here. `warnings()` raises
`pm-gold` above £50k so the figure is never issued without being seen.

### What was merged, and what deliberately was not

Instructed: merge the prototype's scope/dependency/assumption/exclusion text
with the skill's `scoping_content_sap_bia.json`, prototype wins on conflict.

The merge turned out near-empty, because both sets were derived from the same
three CheckLists. Across 49 bullets there was **one** genuine difference — "by
client" against "by the client" in an install assumption, where the
prototype's wording stands per the instruction. Nothing else needed adding.

What the skill did contribute is **universe conversion**, which the prototype
had no concept of:

- three new in-scope items in "Other Technical Services", off by default for
  both routes, because conversion is a decision about the engagement and not
  something either route implies
- `CONVERSION_EXTRAS`, a route-specific assumption and exclusion offered as a
  one-click insert on the Dependencies & Assumptions step

The extras are **offered, not substituted**. The skill keeps whole parallel
`*_conversion` lists; swapping one in would silently rewrite every bullet the
moment a consultant ticked a conversion item. A visible, reversible insert is
the safer shape, and `warnings()` raises `conversion-extras` when conversion
is in scope and the clauses are missing.

**PM deliverables were not merged.** Six of the skill's Silver entries and six
of its Gold entries restate entries the prototype already has — "Change
control management." against "Change control support.", "Detailed project plan
and roadmap." against "Detailed project plan." plus "High-level project
roadmap." — and one Gold entry ("Full project management to be quoted
manually") is an artefact of the engine refusing to price Gold at all, which
this tool does not do. Merging would have put visible duplication into a
client-facing scope document. The prototype's lists stand alone. Reversing
this is one array in `config/`.

### Hours are keyed by product code, not by row position

The prototype rebuilt a flat `rows` array on every product-type switch, which
zeroed every hour already entered. Keying by code means BusinessObjects →
Crystal Server → BusinessObjects leaves the original figures intact, and a
catalogue reordering cannot move an hour from one product to another.

No figure changes: hours recorded against codes outside the selected stack are
in no total. Covered by test.

### Templates are bundled, with an override

`lib/quoting/templates/` holds `blank-bia-labmat.xlsx` and
`blank-checklist.docx`, imported as Vite asset URLs and fetched on demand.
**Replacing either file rebrands the corresponding output** — the same posture
AD-13 takes for `install-assessment.styles.xml`.

The prototype made the consultant pick both files off disk every run, which
meant two consultants could produce differently-styled quotes from the same
tool. The Review step keeps a per-session override for when house style
changes before the repo catches up; it is marked clearly when active.

### The LabMat is filled, not built

The template carries no formulas, no conditional formatting, no data
validation and no charts — 316 merged cells, forty cell styles, forty-five
pre-styled rows. So writing values into it preserves the look exactly.

Verified: after filling, all 316 merges survive and the currency format on the
value column and the header total are intact. `exceljs` drops the same
`customXml` parts `openpyxl` already drops, plus `docProps/custom.xml`, so
there is no fidelity loss against the Python renderer's own output.

Rows 9–80 are cleared before writing, so a shorter quote than the last one
cannot leave a stale line behind that still foots into a printed total.

### AD-13's "generated, not patched" is scoped, not general

AD-13 rejected `docx`'s `patchDocument` for the install assessment because
that document repeats whole tables per environment and conditionally omits
rows. **That reasoning does not apply to the CheckList**, which is a fixed
document with eleven single-paragraph placeholders — the shape patching suits.

The CheckList writer nonetheless edits `word/document.xml` directly, for a
different and narrower reason: each expanded bullet must inherit the template
paragraph's own `w:pPr`, including its `w:numPr` list binding and indent
level, so the bullets come out as the template's list style rather than a
reconstruction of it. Cloning the properties out of the file is the most
direct guarantee of that. Asserted by test — the expanded paragraphs are
checked to carry the template's `numId` and run properties.

Anyone reaching for `patchDocument` on a future fixed-layout document should
read this rather than inheriting AD-13's conclusion wholesale.

### Five defects fixed rather than reproduced

Faithfulness stops at things that are simply wrong:

| Defect | Fix |
|---|---|
| `In-place upgrade of the SAP Business Objects server software.` was hardcoded, so a **Crystal Server** upgrade quote claimed to upgrade BusinessObjects | `{product}` token, substituted from the selected stack |
| A non-numeric PM rate override propagated `NaN` through every total, blanking the quote on one stray keystroke | falls back to the tier rate — the position AD-09 already took for the Fabric calculator |
| `JSZip` stores uncompressed by default and the prototype took that default, turning a 33 kB template into a **298 kB** document | `compression: 'DEFLATE'` — output is now 30 kB |
| Nothing stopped a quote costing both an in-place upgrade and an installation | `routeConflict()` reports it; a second warning catches products contradicting the selected project type |
| `isTM`, `isRowVisible()` and `clearHiddenRows()` could never fire — `buildRows()` walked `primaryStacks` only, so no `-TM` product ever entered the row array, and PM was handled separately | dropped, and recorded here so it is not reinstated as a missing feature |

The route guard **reports rather than blocks**. A tool that silently refuses a
figure is worse than one that asks about it, and the consultant is sometimes
quoting something genuinely unusual.

### One defect only rendering could have found

AD-13's instruction to render the output and look at it earned its place
again. The generated CheckList priced 3.75 hours of Tomcat upgrade while its
exclusions still read *"Configuring a separate Apache Tomcat installation."* —
a quote that charges for work its own scope document rules out.

Every XML assertion passed. Nothing in the arithmetic was wrong. It was
visible only by reading the rendered page.

`warnings()` now raises `tomcat-contradiction`. **Reported, not auto-removed**:
deleting a line from an exclusions list on the tool's own initiative is
exactly the sort of invisible edit that gets quoted back at you in a dispute.

The skill has a rule for this case (`if tomcat: excl = [e for e in excl if
"separate Apache Tomcat" not in e]`), which is where the check came from even
though its pricing is not used.

### Contact details, and where personal data sits

The Overview table of the CheckList has Contact Name and Contact Email rows.
The prototype hardwired both to empty strings, so every filed CheckList had
two blank rows.

**Decision: prefilled and editable.** Two fields on the Project Details step,
written into the document. Once the assessment handoff lands they will be
hydrated from `signOffName` / `signOffEmail` / `technicalContactName` /
`technicalContactEmail` and the consultant will confirm them before
generating.

This is safe because **both documents are assembled in the browser**. Nothing
here reaches a Codestone server, a log, or Application Insights, so the AD-08
position holds unchanged and no retention decision is required. Note that the
skill's `assessment.schema.json` says the opposite ("Leave blank — personal
data entered manually at validation"); that comment predates a client-side
generator and is stale.

A server-side generator would have needed a retention decision and a word with
Natasha Keskin (General Counsel) first. It was never necessary: the prototype
already proved the browser can do this, with `exceljs` and `jszip`.

### Persistence is deliberately not wired

`STORAGE_KEY`, `serialise()` and `deserialise()` exist and are tested. **They
are not called.** Whether a quote in progress should survive a refresh is an
open question Mike has not yet answered, and `localStorage` holding a client
name and two contact details is the AD-11 conversation, not a default.

Today a refresh clears the quote, and the page says so. Turning it on is two
calls plus the AD-11 mitigations — a notice naming what is stored, and a Clear
control behind a confirmation. **Open item.**

### The project brief step is omitted

The prototype's seventh step generates the brief with Claude. The portal has
no Claude API yet, so the step is not built and `<<project_brief>>` resolves
to empty.

**Consequence, confirmed by rendering:** the CheckList has a green
"Introduction" heading band with nothing under it. The consultant writes it in
Word. That is a visible gap in a document people file, and it is the strongest
argument for doing the API next.

`briefXml()` is built and tested, including multi-line handling, so wiring the
step is a page change and an API call rather than a document change. The
`Base example` folder alongside this repo (`PDD_Generator-main`) already has
the plumbing — `api/shared/ai.py`, `api/prompts/house_style.md`,
`api/shared/audit.py` — and is the pattern to copy rather than invent.

### The fixture, and why it was regenerated in this commit

`lib/quoting/__fixtures__/reference.json` pins eight scenarios. **Each stores
its own inputs**, closing the AD-10 gap rather than repeating it — a test
asserts they replay.

Two kinds of evidence, deliberately, because the fixture alone would only be
the code agreeing with itself:

1. **An independent statement of the prototype's arithmetic** in the test
   file, transcribed from `recalcContingency()`, `tots()` and
   `autoSelectPm()` rather than from the port, run against every scenario.
2. **Hand-computed anchors**, including the £3,696 upgrade and the £6,177.60
   Crystal install that demonstrates the tier boundary.

Plus catalogue-integrity tests. The contingency prefix convention —
`<phase>-CONTINGENCY` minus its suffix must prefix every sibling in that phase
and nothing outside it — is what makes contingency derivable at all, so a
future product code that broke it would silently mis-cost a phase. Asserted
across both stacks.

**The fixture was regenerated in this commit**, and the reason is the Tomcat
warning above: adding it changed `warningIds` and `summary` on the
`BOBJ upgrade with a manual tier and rate override` scenario, which costs
Tomcat hours. Diffed before and after to confirm **no `totals`, no
`costedLines` and no `scope` value moved** — the change is a new warning, not a
new price.

### Dependencies, and a deployment consequence

- **`exceljs` added** as a runtime dependency
- **`jszip` moved** from `devDependencies` to `dependencies` — it was already
  present, used by the install assessment's tests to unzip generated `.docx`,
  and is now shipped code

**`package.json` and `package-lock.json` have changed, so a `src`-only deploy
will fail CI.** Both files have to go with this change.

Bundle cost, measured rather than assumed:

| | before | after |
|---|---|---|
| main JS | 288.66 kB | 333.27 kB |
| main CSS | 33.27 kB | 40.00 kB |

**+44 kB of JS**, which is the tool itself — a six-step page, the product
catalogue and about fifty bullets of scope text. Both heavy writers and both
templates code-split correctly: `exceljs` (938 kB), `jszip` (97 kB) and the two
templates are separate chunks fetched only when someone clicks Generate.

The 44 kB is honest new application code, not a library leaking in. Worth
stating because AD-12's "the main bundle grew 2 kB, not 360" is about *keeping
a dependency out*, and that test still passes here.

### Tests

299 now, up from 154. 145 are new: the pinned pricing scenarios, prototype
parity, tier boundaries, contingency derivation and phase isolation, hours
coercion, route validation, the scope and content libraries, formatting,
filenames, the persistence guard, the LabMat row plan and generated workbook,
and the CheckList XML.

One test failed on first run and **the test was wrong**: re-zipping adds
explicit directory entries (`word/`) the original does not have, so comparing
raw archive entries pinned a JSZip implementation detail. It now compares
document parts. That is the third time on this project that a disagreement
between a test and the code was worth reading rather than silencing.

## AD-15 — Pre-populating a quote from an assessment, and the portal's first AI call

**Date:** 7 August 2026.

**Decision.** The Quote Generator accepts a pasted install assessment export
and pre-fills the client, contacts, route, effort and scope from it. A
Functions endpoint reads the assessment's free-text technical fields with
Claude. Nothing is applied without being shown first.

### The skill comes back, for effort only

AD-14 recorded that `labmat_engine.py` is not the pricing authority for this
tool. That still holds, and this narrows rather than reverses it:

```
the skill proposes EFFORT   →   the Quote Generator prices it
```

`config/sapQuoteImportModel.ts` transcribes `resolve_route()`,
`build_default_lines()` and `migration_band_hours()`: the OS hard rule,
platform hours per environment, authentication configuration hours, Tomcat
per instance, migration bands, and universe conversion.

**PM tier selection, PM percentages, contingency and every total stay where
AD-14 put them** and an import cannot touch them. So the £140.40 Broder
divergence is unaffected — the two models still disagree about tiering, and
this feature does not bring that disagreement back in.

Four phases the skill has no opinion about — System Testing, Training,
Universe Development, Transition – Operations — are **never seeded**, and a
test asserts it. Their absence is a decision, not a gap in the mapping.

### Nothing personal leaves the browser

The assessment carries a client name, two contact names and two email
addresses. The obvious implementation POSTs the lot and asks Claude to pull
out what it needs. That would have handed this tool the data-protection
footprint AD-08 exists to avoid, and required a retention decision and a
conversation with Natasha Keskin (General Counsel) before it could ship.

It was never necessary. Reading a Windows version does not need a client
name. **The entire payload is three strings:**

```json
{
  "operatingSystem":  "Windows Server 2016",
  "authentication":   "Windows AD",
  "platformSoftware": "SAP BusinessObjects BI 4.2 SP7"
}
```

Verified end to end, and asserted by a test that takes each of the five
personal fields out of the assessment fixture and checks none appears in the
serialised payload.

Everything else — client, contacts, counts, sizes — is parsed in the browser
and goes straight into the form. **AD-08's position therefore holds
unchanged, and no retention decision is required**, because there is nothing
to retain.

Three defences, not one:

1. The payload is built from three named fields, so there is no path by
   which anything else could be included.
2. `containsPersonalData()` checks for an `@` before the request goes out and
   aborts if it finds one.
3. `validate_payload()` on the server **rejects** — does not clean — any
   unknown key, any non-string, anything over 200 characters, and anything
   containing an `@`. A cleaned payload would hide a bug in the caller. This
   is the AD-02 defence-in-depth posture applied to data rather than authz.

### Deterministic first, Claude second

Most estates answer "Windows Server 2016" and "Windows AD", which needs no
model. `interpretLocally()` handles those, and the API is called **only when
something is still uncertain**.

That is not an optimisation, it is the failure mode. If the key is unset, the
service is down, or the request times out, the import proceeds on the local
reading and says which fields it could not work out. An AI outage degrades
the feature; it never blocks a quote.

It also keeps the pricing reproducible in the ordinary case, which matters
given CLAUDE.md's rule that two consultants must get the same answer.

**The model is never trusted with the decision.** It returns a fact, a
confidence and a one-line reason, all three shown to the consultant, and
`null` is an explicitly permitted and encouraged answer. Forced tool use
means the reply is a schema-shaped dict rather than prose to parse, and every
field is re-validated against the permitted values on the way out — a schema
is a request, not a guarantee.

### Three things the interpreter deliberately refuses to guess

| Input | Answer | Why |
|---|---|---|
| `Red Hat Enterprise Linux 8` | `null`, not `false` | The pre-2022 rule is about Windows Server editions. Answering `false` would quietly authorise an in-place upgrade on a platform the rule says nothing about. |
| `LDAP` | `null`, not `Windows AD` | The assessment invites LDAP — its placeholder literally says so — but the effort model prices only Enterprise, Windows AD and SAML. Filing it under AD would price 7.5 hours on a guess. The consultant is told the mode is not in the model and asked to choose. **Open item:** if LDAP is common in practice, it needs a fourth configuration figure rather than a prompt. |
| anything unreadable | `null` | An unread OS leaves the route unconfirmed and says so, rather than defaulting silently to upgrade and hiding it. |

### Multi-environment estates — the question AD-14 left open

The assessment is per production environment; the effort model takes one
count. Decided:

- **Production environments multiply** platform install and configuration
  effort.
- **Filestore sizes and content counts are summed**, and the migration is
  banded **once** from those totals.
- **Test and development environments are scoped, never costed.** They tick
  `install_test` / `mig_test` / `install_dev` / `mig_dev` and raise a note.

The third needs justifying, because AD-11 says test and development
environments are "counted, never detailed" and that "only the count matters",
which reads like an argument for folding them into the multiplier. They are
excluded because the assessment records *nothing* that sizes them — they are
rebuilt as a copy of the new production, so there is no filestore, no content
count and no configuration to price from. Ticking the scope item and warning
is honest. Multiplying would invent effort.

**What the summing loses, stated plainly:** two 8 GB environments band as one
16 GB migration — Large, 30 hours — rather than two Medium ones at 15 hours
each. That under-prices two genuinely separate cutovers. Flagged as a note on
every multi-environment import rather than modelled, because changing the
band arithmetic is a pricing decision and not one to make inside an import
feature. **Open item.**

Heterogeneous operating systems across production environments are detected
and warned about; the route is taken from the first.

### The three export states, honoured

AD-11 and AD-12 made absent, `null` and a value mean three different things.
The importer reads all three:

| State | Reading |
|---|---|
| key absent | Not applicable. A genuine zero — Crystal Server has no universes, so it contributes nothing and nothing is flagged. |
| `null` | Applicable, not answered. Contributes nothing **and is named** in an "incomplete sizing" note. |
| a value | Answered, or implied. |

This is the difference between "this estate has no universes" and "nobody
counted the universes", and it is why a partial assessment produces a quote
marked provisional rather than a confidently wrong one. Tested directly
against all four scenarios in the assessment's own fixture.

### Preview, then apply

Every change is offered individually — old value against new, with the
derivation of each pre-filled hour ("30h — Large migration band, 160.5 GB
filestore, 1,397 content items"). Rows that would overwrite something already
typed are marked as conflicts. `planImport()` computes the diff and changes
nothing; `applyImport()` is the only function that touches state.

Project type is handled separately and first, because accepting it resets the
scope, dependencies, assumptions and exclusions to that route's defaults —
a change the diff cannot show, since it rewrites lists rather than fields. It
gets its own confirmation, and refusing it leaves the route alone while
everything else still applies.

This matters most for the operating-system inference: pre-Windows Server 2022
turns an in-place upgrade into a full install and migration, which is a
different engagement at a different price. It is never allowed to happen
silently.

### The API

`api/shared/ai.py` is adapted from the PDD Generator's module rather than
written fresh — that pattern is in production, and a second way of getting
retries and error mapping wrong helps nobody. `api/shared/interpretation.py`
holds the prompt and schema. `function_app.py` stays routing only.

- `POST /api/tools/sap-quote/interpret` — already gated by the existing
  `/api/*` rule, so `staticwebapp.config.json` is unchanged.
- `GET /api/health` now reports `ai_configured` and `ai_model`. Configuration
  only, never the key.
- 503 when unconfigured, 502 on failure, 400 on a payload that should not
  have been sent. All three are non-fatal to the caller.
- `anthropic==0.105.2` added to `api/requirements.txt`. Imported lazily, so
  `/health` and `/me` work whether or not it is installed — verified.

`ANTHROPIC_API_KEY` goes in SWA Application Settings and must never reach the
frontend bundle. `CLAUDE_MODEL` defaults to a fast model: this is a small
task that has to return inside the Static Web Apps gateway window.

**This is the portal's first outbound call to anything.** Phase 3's GDPR line
in the game plan is what made the three-string payload worth the extra work.

### Three defects found while building

1. **`W2K12R2` read as no version at all.** The pattern required a word
   boundary after the year, and `12R2` has none. Two patterns now, and the
   shorthand one does not require a trailing boundary. That abbreviation is
   exactly what gets typed on a call.

2. **A fixture that could not replay itself.** `MIGRATION_BANDS` uses
   `Infinity` for the open-ended top band, which is the honest value —
   and `JSON.stringify` turns it into `null`, so the pinned band never
   equalled the computed one. Caught by the replay test, which is precisely
   the AD-10 failure this project has already paid for once. The band's *id*
   is pinned instead, and a test now asserts every fixture entry survives a
   JSON round trip.

3. **A test that was wrong about its own scenario.** It asserted a blank
   assessment raises `auth-unknown`. It does not, and should not: an
   undetermined route defaults to an in-place upgrade, which has no
   configuration line to warn about. The install case is now covered
   separately, by blanking the authentication field on a Crystal scenario.
   Fourth time on this project that reading the disagreement beat silencing
   it.

### Tests

402, up from 299. 103 are new and every one of them replays against
`lib/assessments/__fixtures__/reference.json` — the real export, not
hand-written JSON — so if `toExport()` moves, this fails here rather than in
a client's quote.

`lib/quoting/__fixtures__/import.json` pins interpretation, seed, derivations
and resulting price for all four scenarios, and **stores its own inputs**.

Structural guarantees asserted across every scenario: a seed never mixes
routes, never emits a contingency code, never emits a code outside the chosen
route, and never seeds the four unopinionated phases.

The Python guard is verified separately: eight rejection cases, including a
client name, a contact name and an email address.

### Cost

Main bundle 333.27 → 351.99 kB. `exceljs` and `jszip` still code-split.

### Still open

- **The project brief step is still not built**, so the CheckList's
  Introduction is still an empty heading band. There is now a Claude API to
  build it on, and `briefXml()` is already written and tested — this is the
  cheapest remaining win.
- Whether a quote in progress should survive a refresh. Code written and
  tested, deliberately not called.
- Whether PM should tier off contingency-inclusive cost (AD-14).
- Whether LDAP needs a fourth configuration figure.
- Whether a multi-environment estate should band its migration per
  environment rather than once on the combined total.

## AD-16 — LDAP is priced as Windows AD

**Date:** 7 August 2026.

**Decision.** The assessment importer maps an LDAP authentication answer to
**Windows AD**, at the same 7.5 hours of configuration effort.

AD-15 returned `null` for LDAP and asked the consultant to choose, on the
grounds that the effort model prices three modes and LDAP is not one of them.
That was over-cautious. Both are directory integrations against something the
client already runs, and both take the same time to configure, so the
equivalence is a commercial fact rather than a convenient assumption.
Confirmed by Mike, 7 August 2026.

### It says so rather than hiding it

The interpretation reads *"LDAP — priced as Windows AD, which carries the same
configuration effort"*, not *"Reads as Windows AD"*. The LDAP branch is tested
**before** the generic Active Directory branch specifically so the reason stays
specific: a silent mapping would bury a pricing decision inside a regular
expression, where the next person to read the quote would have no way to know
a substitution had happened.

The server prompt carries the same instruction, so Claude behaves identically
on the strings the deterministic parser cannot read.

`AUTH_CONFIG_HOURS` gains no LDAP entry. There are still three priced modes;
LDAP resolves to one of them.

### Two defects found while measuring the upgrade route

Neither is related to LDAP. Both were exposed by comparing the same estate on
both routes, which is worth doing after any change to the seeding rules.

1. **An in-place upgrade warned about a migration band it does not have.**
   Filestore size and content count drive exactly one line — content
   migration — which only exists on the install route. On an upgrade the
   importer was still raising `incomplete-sizing` ("the migration band is
   derived from figures the assessment does not have yet") about figures that
   cannot affect the quote. It now raises `sizing-not-used` as *information*,
   saying the figures are missing and that an upgrade has no content
   migration. `multi-environment-band` is suppressed on upgrades for the same
   reason.

   Noise in a warnings panel is not harmless: it trains people to skip the
   panel, and the panel is where the route conflict and the Tomcat
   contradiction live.

2. **`OpenLDAP` did not match the LDAP pattern.** `\bldap\b` needs a word
   boundary the acronym does not have. The leading boundary is gone.

### The import tests had no real upgrade coverage

All four scenarios in the install assessment's fixture run a pre-2022
operating system, so **every one of them forced the install route**. Half the
tool was untested by the import suite.

There is now a fifth scenario — the `businessobjects complete` estate moved to
Windows Server 2022, changing nothing else — pinned in `import.json` alongside
the others. Same estate, same content, different route, so the two can be
compared line for line.

What that comparison shows, pinned as a number so a change to either route's
line list is visible:

```
Windows Server 2016 → install    10 lines   71.0h
Windows Server 2022 → upgrade     8 lines   33.5h
```

An upgrade fills every line its route has, but only three inputs drive it:
production environment count, Tomcat instances, and whether universes need
converting. The filestore size, the content count and the authentication mode
are all read and displayed, and none of them is priced — there is no migration
line and no configuration line on that route.

### Still open, and now measured

The upgrade defaults were checked against the two Bromley reference LabMats.
The **non-conversion** upgrade matches almost exactly; the only gap is
Transition, 3.75h in the filed quote against a 1h default.

The **conversion** upgrade does not match:

| Line | Filed LabMat | Auto-fill |
|---|---|---|
| Pre-Installation Documentation | 2.0h | 1.0h |
| Software Downloads | 2.0h | 1.0h |
| UAT | 15.0h | 3.75h |
| **Total** | **£9,288.00** | **£6,283.20** |

**32% under.** The seeding rules add the 15h conversion line and leave
everything else at the standard allowance, so nothing else responds to
conversion being in scope — although testing converted universes is plainly
more work than validating a version bump.

`SKILL.md` names exactly these lines as the ones commonly adjusted:
Pre-Installation Documentation, Software Downloads, UAT, Content Migration and
Transition. The skill knows they get adjusted and does not adjust them.

**Not changed here.** Scaling those three lines is a pricing decision that
would move real quotes, and it is Mike's to make. The candidate change is a
conversion profile seeding 2h / 2h / 15h when universe conversion is in scope,
pinned against the Bromley Conversion LabMat — derived from a filed quote
rather than invented. **Open item.**

### Tests

414, up from 402. Twelve new: the LDAP mapping across three spellings, the
Windows AD rate it resolves to, and the upgrade-route scenario — route
selection, the absence of migration and configuration lines, Tomcat and
conversion still landing, the seeded-hours comparison against install, sizing
figures read but not priced, and the absence of the two warnings that no
longer apply.

The fixture was regenerated in this commit, for the note changes. Diffed
before and after: no `totals`, no `costedLines` and no `scope` value moved.

### Still not verified — the AI path has never run

Worth stating plainly next to a passing suite, because 414 green tests invite
the wrong conclusion.

`validate_payload()` is tested across eight rejection cases, and `ai.py` is
confirmed to import cleanly without the `anthropic` SDK present. Beyond that:

- `complete_structured()` has never executed. The SDK is not installed in the
  build environment
- `interpret()` — which normalises the model's reply, coerces confidence and
  rejects an out-of-enum auth mode — has never seen a response to parse
- the system prompt has never been near a model
- the endpoint has never been called. The API is not deployed and
  `ANTHROPIC_API_KEY` is not set

And the reason none of that surfaced: in every test and every end-to-end run,
the deterministic reader was confident on all three fields, so
`needsInterpretation()` returned `false` and **the AI branch was never
entered.** Not one of the 414 tests goes down it.

`AssessmentImportPanel.tsx` has no tests at all either — `vitest.config.ts` is
`environment: 'node'` with `include: ['src/**/*.test.ts']`, so no `.tsx` file
is ever collected. The 503 branch, the failure messaging and the conflict
display are all unexercised.

**Treat the AI path as the least-proven code in this repo.** It is also, by
design, the part a failure degrades rather than blocks (AD-15) — which is why
the tool is usable today with no key set, and why this gap has not bitten.

**Open item.** `interpret()` can be tested against stubbed responses with no
key and no network: a missing field, a non-boolean where a boolean belongs, an
auth mode outside the enum, and a reply carrying no `tool_use` block. That is
the code most likely to fail in production. The panel needs a DOM environment
and `@testing-library/react`, which is a new dev dependency and a bigger
decision.

## AD-17 — The quote plan comes from a skill, and three pricing corrections it exposed

**Date:** 11 August 2026.

**Decision.** The Quote Generator stops seeding itself from rules transcribed
out of `labmat_engine.py` and asks a skill instead. `POST
/api/tools/sap-quote/plan` sends the install assessment and receives a
`sap-quote-plan` v1 document: route, effort lines with hours and derivations,
scope ids, brief, dependencies, assumptions and exclusions. The app still does
every piece of arithmetic that involves money.

This supersedes the seeding half of AD-15. The rest of AD-15 stands — the
preview/apply machinery, the three answer states, the multi-environment
rules and the reasoning about what an import is allowed to touch.

**Nothing has been removed yet.** The endpoint is not built, the round trip
is not measured, and `config/sapQuoteImportModel.ts` is still what runs in
production. This records the decisions taken; the code follows once the
timing number exists.

### Why replace seeding that works

The transcribed rules could never touch System Testing, Training, Universe
Development or Transition – Operations. AD-15 recorded their absence as
deliberate, and it was — the engine has no opinion on them, so seeding them
would have been invention.

But the assessment does have opinions. It asks six training questions, counts
universe modifiers, and records whether destination changes are required.
None of that reached the quote, because the seeding rules were a transcription
of an engine that predates the assessment.

A skill reading the whole export can use all of it. That is the gain, and it
is the only gain — the deterministic lines come out identical, which the
parity test below proves case by case.

### The skill is new, and the old one is untouched

`sap-bia-quote-plan`, derived from `sap-bia-labmat`. The original still
renders LabMat .xlsx and CheckList .docx for standalone quotes and is
unchanged.

The new one carries no templates, no `openpyxl` and no `python-docx` — 52 KB
packaged, Python standard library only. That matters: the SWA gateway is
about 45 seconds and an agentic code-execution loop has to fit inside it.
Not rendering documents is most of how it might.

Three scripts, and the second is not optional:

- `plan_engine.py` — assessment in, plan out. Deterministic.
- `validate_plan.py` — the contract, enforced before the plan is returned.
  Rejection cases verified: unknown code, contingency code, PM code, mixed
  route, unknown scope id, totals present, missing derivation, zero hours, a
  substituted client name, an `@` anywhere, a mismatched product stack, a
  money value on a line.
- `verify_parity.py` — pins the arithmetic across six cases.

### Two additions to the contract, and why they exist

The contract as specified carries `code`, `hours`, `activity` and
`derivation` per line. Mike's decision was that **the model may adjust any
line**, including the engine's own. That buys capability and spends
reproducibility, and CLAUDE.md requires that two consultants get the same
answer.

So every line also carries:

- `source` — `"engine"` (produced by a rule, reproducible) or `"model"`
  (judgement, not reproducible)
- `engineHours` — required when `source` is `"model"`. The engine's own
  figure, or `null` if it proposed no such line

The preview should render the two differently. A consultant needs to see at a
glance which numbers came from a rule and which from a model, and what moved.
Without this, "the model may adjust any line" means an unmarked number in a
list of marked ones, which is worse than either extreme.

**One carve-out:** the model must never propose the universe-conversion line.
`SKILL.md` says so explicitly, because otherwise the permission above would
let it put back exactly what the decision below takes out.

### Three pricing decisions

All three move real quotes. All three were regenerated in this change, diffed
before and after.

#### Training is priced, as one line

Codestone rarely delivers training and almost never a full package, so
training is a single `-TRAINING` line rather than one per course. The engine
totals it and writes a derivation itemising what is in the number.

| Assessment question | Hours | Scope |
|---|---|---|
| `trainingBiLaunchpad` — BI Launchpad guide | 1 | custom scope |
| `trainingCms` — CMS training, 1 day | 7.5 | custom scope |
| `trainingWebi` — Web Intelligence, 1 day | 7.5 | `webi_s` |
| `trainingInformationDesignTool` — IDT, 1 day | 7.5 | `idt_s` |
| `trainingCrystalReports` — Crystal Reports, **3 days** | 22.5 | custom scope |
| `trainingUniverseConversion` — repointing guide | **0** | custom scope + `warn` |

Maximum 46 hours. Every "yes" is named individually in the scope section even
though they share one line. The universe conversion and report repointing
guide adds no delivery hours — it is a pre-sales action, and the plan raises a
warning so it is picked up before the quote goes out rather than delivered
for nothing.

Only two of the six have ids in `SCOPE_CATEGORIES`; the rest arrive as
`customScope.training` free text. **Open item:** adding `cms_s`, `crystal_3`
and the two guides would make the whole training path structured. The app
already distinguishes `pbi_1` from `pbi_3`, so a three-day Crystal course
fits the naming that exists.

#### Universe conversion is asked, never assumed

The old rule inferred conversion from a universe count. Probing every path
found it wrong in both directions:

- **`universeCountMode: "combined"` priced 15 hours with no count check at
  all.** An estate reporting zero universes still got a conversion line,
  because the `combined` branch tested only the mode.
- **`"separate"` with a null `unvCount` priced zero and said the gap did not
  matter.** The `sizing-not-used` note AD-16 introduced reads "an in-place
  upgrade has no content migration, so they do not affect this quote". On an
  upgrade that was false: the UNV count was the only thing deciding the
  conversion line. A silent zero plus an explicit reassurance is the exact
  "not counted versus none" collapse AD-15 warns about, landing in the one
  place AD-16 did not anticipate.

**Both defects are in `sapQuoteImport.ts` today** and will keep mis-seeding
quotes until the local seeding retires.

The plan now seeds no conversion line, ticks no `conv_universe`,
`conv_repoint` or `conv_config`, and sends the **standard** intro,
assumptions and exclusions rather than the conversion variants. An unpriced
scope tick is a commitment to work for free, and a CheckList promising
conversion the LabMat does not carry is worse than one that stays quiet.

Instead every BusinessObjects estate gets a `confirm-universe-conversion`
warning, worded from what was actually recorded — UNV count, combined total,
or not counted at all — and then says the same thing in each case: 2025
requires the conversion, whether this engagement delivers it is commercial,
and if it does, add `DI-BIA-SAP-BOBJ-BLD-DEV-REPORTS` at typically 15 hours,
tick the three scope items, and change the wording. Crystal Server has no
universes and raises nothing.

Withdrawing the line also resolved the second defect by removing it: on an
upgrade the universe counts now genuinely affect nothing priced, so
`sizing-not-used` became true.

#### The migration band uses the input filestore, not the total

A real assessment reported **2.82 GB input file repository against 183 GB
output** — 98.5% of the filestore was scheduled instance history, and the
client had said only *some* of it was required. The assessment's own advisory
already recommends cleaning it up before migration.

Banding on the combined figure forced Large, 30 hours, on an estate that
plainly wanted one day for the initial migration and one for go-live. And it
was not a one-off: **any estate with years of scheduling history lands Large
regardless of how little content it holds.** The boundary makes it worse —
15.0 GB is Medium, 15.1 GB is Large, and the line doubles.

The input file repository is the content: reports, universes, the things that
migrate and get validated. The output repository is history, moved in bulk
after a clean-up the assessment already recommends.

So the band takes `inputFileRepositoryGb` plus the content count. On that
assessment it comes out Medium, 15 hours, which is the answer a consultant
gives unprompted.

The exclusion is disclosed rather than silent:

| Condition | Warning |
|---|---|
| Output history would have raised the band, and `successfulInstancesRequired` is `some`, `no` or unrecorded | `output-filestore-excluded`, info. States both bands and says revisit the hours if the history migrates wholesale |
| Output history would have raised the band, and the client requires **all** instances | `output-filestore-all-required`, **warn**. Nothing gets pruned, the full volume moves, consider the higher band |
| Output filestore not recorded | `output-filestore-not-recorded`, info. Does not affect the hours |

No warning when the two bands agree — there is nothing to disclose.

The change is targeted rather than a blanket reduction. Both BusinessObjects
fixtures carry a 42.5 GB *input* filestore and stay Large; genuinely large
estates are untouched.

### What the three decisions do to a quote

Base delivery hours, the app's current local seeding against this plan:

| Case | App seeding | AD-17 | Delta |
|---|---|---|---|
| blank | 14.75 | 14.75 | — |
| businessobjects complete | 71.0 | 79.5 | +8.5 |
| crystal server | 33.5 | 49.5 | +16.0 |
| two environments partial | 86.0 | 94.5 | +8.5 |
| businessobjects on WS2022 | 33.5 | 42.0 | +8.5 |
| output heavy estate | 63.5 | 33.5 | **−30.0** |

The +8.5 pattern is training added (+23.5) and conversion withdrawn (−15) on
the same estate. Crystal is +23.5 training against −7.5 band. The output-heavy
estate loses 30 hours because both the conversion inference and the total-FRS
band were wrong on it at once — which is why it is now a pinned case.

Route and scope have not moved on any pre-existing case.

### How the arithmetic stays pinned

Section 4 of the handoff asked how to hold this steady when the extraction
cannot be. `verify_parity.py` is the answer: six fixed assessment exports in,
fixed engine lines out, asserting route, lines, base hours, scope and `env`.

It runs against the portal's own fixtures rather than a synthetic `env`, so
the reading and the arithmetic are pinned in the same pass. Model-sourced
lines are excluded, because they are not reproducible by construction — that
is what `source` is for.

`--write` regenerates the expectations and prints a reminder that doing so is
a pricing change. All three decisions above went through it and were diffed.

The sixth case, `output_heavy_estate`, is the assessment that exposed the band
problem, scrubbed of client name, contacts, hostname and free-text detail. The
original five had no example of a small input filestore against a huge output
one, which is why this went unnoticed for so long.

### The handoff: a Build quote button, and no screen between

The assessment gains **Build quote** alongside Download JSON. It navigates to
the quote page with the export in router state — in memory, never over the
network — and the quote page mounts with its import panel already open and
waiting on the endpoint.

**A third screen was considered and rejected.** It does not remove a code
path: it would receive the plan and hand it to the quote page, so the quote
page needs the "arrived with a plan" path either way. The unique content of
the middle screen is a spinner, and a spinner does not need a URL.

The stronger argument is refresh. Router state is in memory, so a refresh on a
dedicated waiting route has nothing to render and no coherent fallback. A
refresh on the quote page leaves the consultant on a normal blank quote —
degraded but sensible, which is the same posture AD-15 set for an AI outage.

It also keeps the tool pattern intact: `pages/tools/<slug>`, one page per
tool, each referenced from a Tile in `config/navigation.ts`. A screen that is
not a tool has no home in that tree.

Download JSON stays. It is the path for someone returning to an assessment a
week later, and the fallback when the endpoint is down.

### GDPR — AD-08's position survives, if the payload is built rather than cleaned

AD-15 could say "nothing personal leaves the browser" because the payload was
three strings. This sends the assessment, which changes the question.

Mike's decision on 11 August was that **the skill does not need the client
name or the contacts.** It reads neither: `derive_env()` never touches
`client.client`, `technicalContactName`, `technicalContactEmail`,
`signOffName` or `signOffEmail`, and `validate_plan.py` fails on a single `@`
anywhere in the output. `intro` returns with `{client}` unsubstituted for the
app to fill, exactly as `fillProduct()` handles `{product}`.

Demonstrated rather than asserted: every bundled parity assessment has the
personal fields nulled, and the engine output is byte-identical to the run
against the originals.

**But retention applies to what is sent, not to what is used.** The strip has
to happen in the browser, before the POST.

**Build the payload from an allowlist, do not clean a denylist.** Nulling five
named fields is not enough. `futureDirection` and `adjacentWork` are free text
and in the assessment that prompted this carried a colleague's name and a
direct quote about her; `serverName` carried a live hostname. Around nineteen
fields in the export are never read by the engine at all — the five personal
ones, all four free-text narratives, `serverName`, `webServerName`,
`cmsDatabaseSoftware`, `consumers`, `reportModifiers` and the rest. An
allowlist drops them by construction, which is AD-15's "no path by which
anything else could be included" applied at the right scale.

Do that, and **AD-08's position holds unchanged and no retention decision is
required**, because there is still nothing client-identifiable to retain.

Two controls regardless:

1. **The endpoint logs no payload.** Caller and outcome only. Nothing into
   Application Insights carrying a name or an address.
2. **The import panel states the position**, as AD-08's pattern requires — the
   claim is visible and therefore has to stay true.

`validate_payload()` inverts. Rejecting any payload containing an `@` was
right when the payload was three strings; it becomes a schema check on the
assessment shape plus a size cap.

**Separately, and not created by this change:** the install assessment already
persists to `localStorage` via `serialise()`, including the client name and
both contacts. That data is at rest on the consultant's machine today, which
is a different position from AD-08's "closing the tab discards it". It is
already on the game plan as a question for Natasha Keskin and this change does
not alter it — but it does mean the tempting shortcut of having the quote page
read the assessment out of the other tool's storage key should be avoided.
Router state is explicit about what was handed over; a shared storage key
means the quote page silently picks up whatever assessment happens to be
saved.

### What this rejects

**Engine-only JSON.** A skill that just runs the engine and returns its output
produces exactly what `sapQuoteImportModel.ts` already produces locally, at
the cost of a network round trip, a data-protection question and a 45-second
gateway risk. The whole justification is the four phases the engine cannot
reach.

**A conversion profile baked in now.** AD-16 left 2h / 2h / 15h as a candidate
for Pre-Installation Documentation, Software Downloads and UAT when conversion
is in scope, pinned against the Bromley Conversion LabMat. `SKILL.md` names it
as a case to check rather than a rule to apply. The 15h conversion line itself
is now moot — it is no longer seeded — but Pre-Installation Documentation and
UAT still run light when conversion is in play. **Open item, unchanged.**

**Scaling conversion by universe count.** Three universes and three hundred
carried the same 15h, and `universeModifiers` was read but never used. Not
addressed here, because the line is no longer seeded at all.

### Still open

- **The round trip has not been measured.** No `ANTHROPIC_API_KEY` and no
  uploaded `skill_id`, so the 45-second question is untested. If it does not
  fit, submit-and-poll is a bigger change than everything above put together.
  Nothing downstream should be designed before that number exists.
- **The endpoint is not built** and the local seeding is not removed.
  `sapQuoteImport.test.ts:694` asserts the four phases are never seeded and
  `NEVER_SEEDED_NOTE` says so on screen; both invert when this ships.
- **The two conversion defects and the total-FRS band are live in the app.**
  If this work slips, they are worth fixing in place: a `> 0` check on the
  `combined` branch, universe gaps out of the `sizing-not-used` bucket, and
  banding on the input filestore.
- Whether `scope` should carry the route defaults or only the ticks beyond
  them. The plan sends the full list, matching the contract's own example.
  Needs confirming against `applyImport()`.
- `SCOPE_CATEGORIES` has no ids for CMS training, three-day Crystal Reports
  training or either guide.
- The AI path remains the least-proven code in the repo (AD-16). This change
  makes it load-bearing rather than a fallback for three uncertain fields,
  which raises the cost of it being wrong.

## AD-18 — Decision Constellation: a prototype ported, and a dark stage inside a light portal

**Date:** 14 August 2026.

**Decision.** `DecisionConstellation.html` — a self-contained d3 prototype
with 179 decisions, 240 nodes and 863 links embedded in it — becomes a portal
tool at `/tools/decision-constellation`, tiled under **Data & AI →
Assessments**. It is a full port to the CLAUDE.md "adding a tool" pattern, not
a static file dropped into `public/` and linked with `href`.

### Why port rather than link

A file in `public/` would have been an hour's work against most of a day. It
would also have been the only thing in the portal that opens outside the SPA:
no breadcrumbs, no top bar, its own type and colour, and a second place to
maintain when the palette moves. The tool is meant to be opened in front of a
client — arriving somewhere that looks like a different product is the wrong
first frame.

The port also buys the thing the prototype could not have: the filtering is
now pure functions with no DOM, tested.

### The layers, and where the dataset sits

`config/decisionConstellationData.json` is the worked example — 172 kB of
hypothetical distributor. `config/decisionConstellationModel.ts` holds colour,
force tuning and the typed handle on it. `lib/constellation/` holds the
filtering and derivation; `pages/tools/` holds the page and the canvas.

**The dataset is deliberately not in the "published methodology" category**
that `assessmentModel.ts`, `fabricEstimatorModel.ts` and
`sapQuoteGeneratorModel.ts` are in. Nothing here reaches a client document or
a quote, and `priority` is carried in the data rather than computed — the tool
derives no number that could be wrong. What is pinned is the contract: which
decisions a filter shows, and the graph that comes out.

### The fixture is the prototype's own output

`lib/constellation/__fixtures__/reference.json` was generated by lifting the
original HTML's filtering logic into a Node script and running it against the
same dataset, **before the port was written**. Sixteen scenarios record their
inputs and their outputs — node ids, per-kind link counts, hub degrees, the
sheet label, the average priority — and the tests replay every one.

This is the AD-10 rule applied properly: the fixture is not generated by the
code under test. It caught nothing during the port, which is the outcome you
want and not an argument against having built it.

Two prototype behaviours are pinned as behaviours rather than tidied:

- Deselecting every system shows an empty map but labels the sheet
  `· 0 systems`, where the department and spine cases say "none selected".
- A decision survives the system filter if **any** of its systems is selected.
  That is what makes the Flexibility tab's "untick ERP and see what is left"
  move work — and measuring it corrected the claim. Every decision in this
  dataset draws on something besides the ERP, so all 179 stay on screen; what
  disappears is the ERP node and 150 links. The demo is about the links.

### The map is dark, and the rest of the page is not

The three prose tabs are the portal: light surface, Plus Jakarta Sans, orange
accent, `tool.css` chrome. The map has its own ground.

That is not a second theme and not decoration. 240 nodes and 863 links on
`--surface` is unreadable — the faint links vanish and the middle turns to
mud — and the artefact is called a constellation. Every hue on the stage is a
portal accent lifted for a dark background: bands run orange, amber, green,
blue, which is the portal's own status ordering. The boundary is the stage
border, and nothing crosses it in either direction.

The glow behind each node is a scaled copy of the node's own shape, not an SVG
blur filter. A blur over 240 nodes costs real frames on a laptop mid-meeting,
which is exactly when this tool gets used.

### d3 owns the SVG, React owns everything else

Zoom, drag and the force simulation all write to the DOM sixty times a second;
re-rendering 240 nodes through React on every tick is the one thing that would
make this feel slow. So `ConstellationCanvas` keeps the imperative half behind
a narrow boundary — graph in, `onSelect` out — and the filter rail, title
block and inspector are ordinary React.

Node instances are held in a map inside the canvas and reused, so narrowing a
filter rearranges the map rather than scattering it.

### The only lazily-loaded route

d3 and the dataset are about 240 kB together, a third of the bundle, and
nobody who came to price an upgrade needs either. The route is a
`React.lazy` import — the same reasoning as the dynamic `docx` and `exceljs`
imports, applied at the page rather than inside a library. Without it the main
chunk goes from 353 kB to 594 kB.

### Two defects found by rendering it and looking

Both were in the prototype and neither would have been caught by a test:

1. The focus bar's "back to full map" button sat **underneath** the inspector,
   which is 352 px wide and always open when a decision is focused. Centring
   is now on the visible part of the stage.
2. The ego view's radius was computed from the full stage width, so with the
   inspector open the systems ran off the left edge and the process spine sat
   behind the panel — losing the "systems left, process right" reading the
   focus bar promises.

AD-13's lesson generalises further than the Word output: render it and look.

### What this does not decide

- **Whether a client's own inventory ever replaces the example.** Today the
  page states on screen that everything is hypothetical, that there is no
  client data in it, and that the scores are deliberately pessimistic
  placeholders. A test asserts the dataset contains no `@`. Swapping in a real
  client's decisions makes it personal data in the browser and is the AD-08
  and AD-11 conversation, with Natasha Keskin (General Counsel), before it is
  a code change.
- **Whether it should become configurable in-app.** The prototype's stated
  intent is a copy per client, plus pains and their implications, plus facts
  and dimensions decomposed out of the metrics. All of that is editing and
  persistence, which is the same conversation as above.
- **Whether it feeds anything downstream.** It is a conversation piece. The
  Fabric handoff is still undecided and this does not change that.
