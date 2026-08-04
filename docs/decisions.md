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
