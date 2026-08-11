/**
 * The plan API contract.
 *
 * Two things are tested here that nothing else in this repo tests: a
 * response we did not produce, and a payload we must be able to prove the
 * contents of.
 *
 * AD-16 recorded that the AI path is the least-proven code in the portal —
 * `interpret()` has never seen a real response. This file exists so the same
 * is not said of the plan path. Every rejection case is a response the skill
 * could plausibly return and the quote must refuse.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  PLAN_PAYLOAD_WITHHELD_FIELDS,
  PLAN_SCHEMA_VERSION,
  PLAN_TOOL,
  type QuotePlan
} from '../../config/sapQuotePlanModel';
import {
  PlanRejected,
  payloadForPlan,
  planActivity,
  planToSeed,
  validatePlanResponse
} from './sapQuotePlan';
import { planImport, type AssessmentExport } from './sapQuoteImport';
import { createBlankQuote } from './sapQuoteGenerator';

const FIXTURE_PATH = join(__dirname, '__fixtures__', 'import.json');
const SCENARIOS = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Array<{
  name: string;
  input: AssessmentExport;
}>;

function assessment(name = 'businessobjects complete'): AssessmentExport {
  const found = SCENARIOS.find((s) => s.name === name);
  if (!found) throw new Error(`No fixture scenario "${name}"`);
  return structuredClone(found.input);
}

/** A plan the quote should accept, matching what the skill returns. */
function validPlan(): Record<string, unknown> {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    tool: PLAN_TOOL,
    route: 'install',
    routeReason:
      'Operating system is Windows Server 2016, earlier than Windows Server 2022.',
    productStack: 'SAP Business Objects',
    lines: [
      {
        code: 'DI-BIA-SAP-BOBJ-DES-CONNECT',
        hours: 0.5,
        activity: 'Connectivity and key personnel check',
        derivation: 'Standard allowance.',
        source: 'engine'
      },
      {
        code: 'DI-BIA-SAP-BOBJ-BLD-MIGRATION',
        hours: 15,
        activity: 'Initial and Go Live migrations',
        derivation: 'Medium migration band — 2.82 GB input filestore, 1,460 items.',
        source: 'engine'
      },
      {
        code: 'DI-BIA-SAP-BOBJ-TRAINING',
        hours: 23.5,
        activity: 'End user training',
        derivation: 'Requested in the assessment: BI Launchpad guide 1h, CMS 7.5h.',
        source: 'model',
        engineHours: null
      }
    ],
    scope: {
      platform: ['prereqs', 'install_prod', 'mig_initial'],
      training: ['webi_s'],
      other: ['uat_s']
    },
    customScope: { platform: [], training: ['BI Launchpad user guide.'], other: [] },
    dependencies: ['Consulting pre-requisites document being complete.'],
    assumptions: ['Work is carried out during core hours.'],
    exclusions: ['Any activity not explicitly listed.'],
    intro: '{client} have requested the services of Codestone to install {product}.',
    env: {
      product: 'BOBJ',
      os_pre_ws2022: true,
      input_frs_gb: 2.82,
      output_frs_gb: 183,
      content_count: 1460,
      environments: 1,
      tomcat_instances: 1,
      auth: 'Windows AD',
      migration_band: 'medium'
    },
    warnings: [
      { id: 'confirm-universe-conversion', severity: 'warn', text: '64 UNV universes.' }
    ]
  };
}

/** Mutate a valid plan and assert it is refused, with a reason worth reading. */
function rejects(mutate: (plan: Record<string, unknown>) => void, matching: RegExp) {
  const plan = validPlan();
  mutate(plan);
  expect(() => validatePlanResponse(plan)).toThrowError(PlanRejected);
  expect(() => validatePlanResponse(plan)).toThrowError(matching);
}

describe('a plan the quote accepts', () => {
  it('validates and comes back with every field', () => {
    const plan = validatePlanResponse(validPlan());
    expect(plan.route).toBe('install');
    expect(plan.lines).toHaveLength(3);
    expect(plan.scope.platform).toContain('install_prod');
    expect(plan.customScope.training).toHaveLength(1);
    expect(plan.intro).toContain('{client}');
  });

  it('keeps the engine and model distinction rather than flattening it', () => {
    const plan = validatePlanResponse(validPlan());
    expect(plan.lines.filter((l) => l.source === 'model')).toHaveLength(1);
    expect(plan.lines.find((l) => l.source === 'model')!.engineHours).toBeNull();
  });

  it('accepts a model line that overrode an engine figure', () => {
    const raw = validPlan();
    (raw.lines as Array<Record<string, unknown>>)[1].source = 'model';
    (raw.lines as Array<Record<string, unknown>>)[1].engineHours = 30;
    expect(validatePlanResponse(raw).lines[1].engineHours).toBe(30);
  });

  it('allows an empty warnings list, but not a missing one', () => {
    const raw = validPlan();
    raw.warnings = [];
    expect(validatePlanResponse(raw).warnings).toEqual([]);
    delete raw.warnings;
    expect(() => validatePlanResponse(raw)).toThrowError(/warnings/i);
  });
});

describe('a plan the quote refuses', () => {
  it('rejects a response that is not a plan at all', () => {
    rejects((p) => (p.tool = 'sap-install-assessment'), /not a quote plan/i);
  });

  it('rejects a schema version it does not read', () => {
    rejects((p) => (p.schemaVersion = 2), /schema v2/);
  });

  it('rejects an unknown product code rather than skipping the line', () => {
    rejects(
      (p) =>
        (p.lines as unknown[]).push({
          code: 'DI-BIA-SAP-BOBJ-NOT-A-THING',
          hours: 5,
          activity: 'x',
          derivation: 'y',
          source: 'engine'
        }),
      /not in the catalogue/i
    );
  });

  it('rejects a contingency line — the quote derives those', () => {
    rejects(
      (p) =>
        (p.lines as unknown[]).push({
          code: 'DI-BIA-SAP-BOBJ-BLD-CONTINGENCY',
          hours: 5,
          activity: 'x',
          derivation: 'y',
          source: 'engine'
        }),
      /contingency/i
    );
  });

  it('rejects a project management line — the quote tiers PM itself', () => {
    rejects(
      (p) =>
        (p.lines as unknown[]).push({
          code: 'DI-BIA-PM-SILVER',
          hours: 5,
          activity: 'x',
          derivation: 'y',
          source: 'engine'
        }),
      /project management/i
    );
  });

  it('rejects a plan that mixes both routes', () => {
    rejects(
      (p) =>
        (p.lines as unknown[]).push({
          code: 'DI-BIA-SAP-BOBJ-BLD-UPGR-INSTALL',
          hours: 7.5,
          activity: 'x',
          derivation: 'y',
          source: 'engine'
        }),
      /one route or the other/i
    );
  });

  it('rejects lines that contradict the stated route', () => {
    rejects((p) => (p.route = 'upgrade'), /says upgrade but proposes install/i);
  });

  it('rejects a scope id the quote does not have', () => {
    rejects(
      (p) => ((p.scope as Record<string, string[]>).platform.push('not_a_real_id')),
      /scope item this quote does not have/i
    );
  });

  it('rejects a grand total anywhere in the document', () => {
    rejects((p) => (p.totals = { grandValue: 1234 }), /belong to the quote, not the plan/i);
  });

  it('rejects a total hidden inside a nested object', () => {
    rejects(
      (p) => ((p.env as Record<string, unknown>).pricing = { total: 900 }),
      /belong to the quote, not the plan/i
    );
  });

  it('rejects a money value on a line', () => {
    rejects(
      (p) => ((p.lines as Array<Record<string, unknown>>)[0].value = 800),
      /belong to the quote, not the plan/i
    );
  });

  it('rejects a line with no derivation', () => {
    rejects(
      (p) => delete (p.lines as Array<Record<string, unknown>>)[0].derivation,
      /nobody can explain/i
    );
  });

  it('rejects a model line that hides what the engine said', () => {
    rejects(
      (p) => delete (p.lines as Array<Record<string, unknown>>)[2].engineHours,
      /does not say what the engine proposed/i
    );
  });

  it('rejects zero and negative hours', () => {
    rejects((p) => ((p.lines as Array<Record<string, unknown>>)[0].hours = 0), /worth something/i);
    rejects((p) => ((p.lines as Array<Record<string, unknown>>)[0].hours = -5), /worth something/i);
  });

  it('rejects a product stack the quote does not have', () => {
    rejects((p) => (p.productStack = 'SAP Datasphere'), /product stack this quote does not have/i);
  });

  it('rejects codes that belong to the other stack', () => {
    rejects((p) => (p.productStack = 'SAP Crystal Server'), /does not belong to/i);
  });

  it('rejects a brief with the client name substituted in', () => {
    rejects(
      (p) => (p.intro = 'Acme Ltd have requested the services of Codestone.'),
      /\{client\} intact/
    );
  });

  it('rejects a duplicated line', () => {
    rejects(
      (p) => (p.lines as unknown[]).push(structuredClone((p.lines as unknown[])[0])),
      /twice/i
    );
  });

  it('rejects a plan with no lines at all', () => {
    rejects((p) => (p.lines = []), /no effort lines/i);
  });

  it('rejects a plan with no derived inputs to audit', () => {
    rejects((p) => delete p.env, /no derived inputs/i);
  });
});

describe('the payload sent for a plan', () => {
  const source = assessment();

  it('carries no personal data, because it is built rather than cleaned', () => {
    const payload = payloadForPlan(source) as {
      client: Record<string, unknown>;
      environments: Array<{ answers: Record<string, unknown> }>;
    };

    expect(JSON.stringify(payload)).not.toContain('@');

    /*
     * Checked against the blocks rather than the serialised document,
     * because `client` is also the name of the block that holds the
     * engagement-level answers. The withheld field is `client.client` — the
     * client's name — not the container it sits in.
     */
    const carried = [
      ...Object.keys(payload.client),
      ...payload.environments.flatMap((e) => Object.keys(e.answers))
    ];
    for (const field of PLAN_PAYLOAD_WITHHELD_FIELDS) {
      expect(carried, `withheld field ${field} appeared in the payload`).not.toContain(field);
    }
  });

  it('withholds the actual values, not just the keys', () => {
    const serialised = JSON.stringify(payloadForPlan(source));
    for (const value of [
      source.client.client,
      source.client.technicalContactName,
      source.client.technicalContactEmail,
      source.client.signOffName,
      source.client.signOffEmail
    ]) {
      if (typeof value === 'string' && value !== '') {
        expect(serialised).not.toContain(value);
      }
    }
  });

  it('drops a free-text field even when it carries a name', () => {
    const withNarrative = structuredClone(source);
    withNarrative.client.futureDirection = 'Rebecca in the data team is leading this.';
    withNarrative.environments[0].answers.serverName = 'ACME-BOBJ-P01';
    const serialised = JSON.stringify(payloadForPlan(withNarrative));
    expect(serialised).not.toContain('Rebecca');
    expect(serialised).not.toContain('ACME-BOBJ-P01');
  });

  it('still carries everything the skill needs to price the job', () => {
    const payload = payloadForPlan(source) as Record<string, unknown>;
    const answers = (payload.environments as Array<{ answers: Record<string, unknown> }>)[0]
      .answers;
    expect(payload.schemaVersion).toBe(source.schemaVersion);
    expect(payload.installationType).toBe(source.installationType);
    expect(answers.operatingSystem).toBe(source.environments[0].answers.operatingSystem);
    expect(answers.inputFileRepositoryGb).toBe(
      source.environments[0].answers.inputFileRepositoryGb
    );
    expect(answers.outputFileRepositoryGb).toBe(
      source.environments[0].answers.outputFileRepositoryGb
    );
  });

  it('keeps absent and null distinct, because they mean different things', () => {
    const partial = structuredClone(source);
    partial.environments[0].answers.unvCount = null;
    delete partial.environments[0].answers.publications;
    const answers = (
      payloadForPlan(partial) as Array<never> & {
        environments: Array<{ answers: Record<string, unknown> }>;
      }
    ).environments[0].answers;
    expect('unvCount' in answers).toBe(true);
    expect(answers.unvCount).toBeNull();
    expect('publications' in answers).toBe(false);
  });
});

describe('a plan becomes a seed', () => {
  const plan = validatePlanResponse(validPlan()) as QuotePlan;
  const source = assessment();
  const seed = planToSeed(plan, source);

  it('takes the client and contacts from the browser, never from the plan', () => {
    expect(seed.client).toBe(source.client.client);
    expect(seed.contactName).toBe(source.client.signOffName);
    expect(seed.contactEmail).toBe(source.client.signOffEmail);
    expect(JSON.stringify(plan)).not.toContain(String(source.client.client));
  });

  it('carries every line and its derivation', () => {
    expect(seed.hours['DI-BIA-SAP-BOBJ-BLD-MIGRATION']).toBe(15);
    expect(seed.derivations['DI-BIA-SAP-BOBJ-BLD-MIGRATION']).toMatch(/Medium migration band/);
  });

  it('says on the line when the model proposed the number', () => {
    expect(seed.derivations['DI-BIA-SAP-BOBJ-TRAINING']).toMatch(/proposed by the model/);
  });

  it('names the engine figure when the model overrode one', () => {
    const raw = validPlan();
    (raw.lines as Array<Record<string, unknown>>)[1].source = 'model';
    (raw.lines as Array<Record<string, unknown>>)[1].engineHours = 30;
    const overridden = planToSeed(validatePlanResponse(raw), source);
    expect(overridden.derivations['DI-BIA-SAP-BOBJ-BLD-MIGRATION']).toMatch(
      /against 30h from the engine/
    );
  });

  it('bands on the input filestore, not the total', () => {
    expect(seed.filestoreGb.total).toBe(2.82);
    expect(seed.migrationBand?.id).toBe('medium');
  });

  it('never seeds universe conversion — the plan asks instead', () => {
    expect(seed.convertUniverses).toBe(false);
    expect(seed.scope).not.toContain('conv_universe');
    expect(plan.warnings.map((w) => w.id)).toContain('confirm-universe-conversion');
  });

  it('flattens scope across all three categories', () => {
    expect(seed.scope).toEqual(
      expect.arrayContaining(['prereqs', 'install_prod', 'mig_initial', 'webi_s', 'uat_s'])
    );
  });

  it('carries an error-severity warning as a warning, not as information', () => {
    const raw = validPlan();
    (raw.warnings as Array<Record<string, unknown>>)[0].severity = 'error';
    const seeded = planToSeed(validatePlanResponse(raw), source);
    expect(seeded.notes[0].severity).toBe('warn');
  });

  it('exposes the per-line activity the seed has no slot for', () => {
    expect(planActivity(plan)['DI-BIA-SAP-BOBJ-TRAINING']).toBe('End user training');
  });

  it('feeds the existing preview without it being changed', () => {
    const blank = createBlankQuote('2026-08-11');
    const imported = planImport(blank, seed);
    expect(imported.changes.length).toBeGreaterThan(0);
    expect(imported.changes.some((c) => c.id === 'DI-BIA-SAP-BOBJ-BLD-MIGRATION')).toBe(true);
  });

  it('survives JSON.stringify — no Infinity reaches a fixture', () => {
    expect(() => JSON.stringify(seed)).not.toThrow();
    expect(JSON.stringify(seed)).not.toContain('null,"maxItems"');
  });
});
