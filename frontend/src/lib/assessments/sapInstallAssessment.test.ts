/**
 * SAP Pre-Sales Install Assessment — contract tests.
 *
 * ## What this fixture is, and what it is not
 *
 * There was no prototype for this tool, so — unlike `lib/estimating` and
 * `lib/scoring` — the fixture is **not** a reference output from a trusted
 * original. Nothing independent says these values are right.
 *
 * What it does do is detect change. It pins the two things a downstream
 * consumer depends on:
 *
 *   1. **Which fields get asked**, per installation type and per dependent
 *      answer. A field that silently stops being asked becomes a quote that
 *      silently stops pricing it.
 *   2. **The export shape**, which the SAP Quote Generator reads.
 *
 * So a failure here means "the contract moved" — which is sometimes correct.
 * Regenerate with `npm run fixtures:update` and say why in the commit
 * message, exactly as for the other two tools.
 *
 * The scenarios below are the inputs, stored *with* the fixture rather than
 * alongside it, so this fixture can always be replayed.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { TABS, MAX_PRODUCTION_ENVIRONMENTS } from '../../config/sapInstallAssessmentModel';
import {
  CLIENT_TABS,
  ENVIRONMENT_TABS,
  advisories,
  createBlankAssessment,
  defaultEnvironmentLabel,
  deserialise,
  exportFilename,
  installationTypeOf,
  isTabVisible,
  overallCompleteness,
  serialise,
  summaryLines,
  syncEnvironments,
  tabCompleteness,
  toExport,
  visibleFields,
  visibleTabs,
  type AssessmentState
} from './sapInstallAssessment';

const FIXTURE_PATH = join(__dirname, '__fixtures__', 'reference.json');
const FIXED_DATE = '2026-08-03';

// ─── Scenarios ────────────────────────────────────────────────────────

function blank(): AssessmentState {
  return createBlankAssessment(FIXED_DATE);
}

/** BusinessObjects, one environment, every applicable field answered. */
function boComplete(): AssessmentState {
  return {
    client: {
      installationType: 'businessobjects',
      client: 'Acme Manufacturing Ltd',
      conversationDate: FIXED_DATE,
      technicalContactName: 'A Technical Contact',
      technicalContactEmail: 'tech@example.invalid',
      signOffName: 'A Sign-off Contact',
      signOffEmail: 'signoff@example.invalid',
      consumers: '240',
      universeModifiers: '3',
      reportModifiers: '12',
      futureDirection: 'Evaluating Power BI for new reporting; BI 4.3 to remain for Crystal.',
      adjacentWork: 'ERP upgrade running in parallel through Q4.',
      productionEnvironmentCount: '1',
      hasTestEnvironments: 'yes',
      testEnvironmentCount: '1',
      hasDevEnvironments: 'no',
      trainingBiLaunchpad: 'yes',
      trainingCms: 'yes',
      trainingWebi: 'yes',
      trainingCrystalReports: 'no',
      trainingInformationDesignTool: 'yes',
      trainingUniverseConversion: 'yes',
      goLiveCoreHours: 'no',
      goLiveSpecificWeekday: 'yes',
      goLiveWeekday: 'saturday',
      goLiveOvernight: 'no',
      goLiveWeekend: 'yes'
    },
    environments: [
      {
        id: 'env-1',
        label: 'PROD01',
        answers: {
          serverName: 'ACME-BOBJ-P01',
          proposedServerName: 'ACME-BOBJ-P02',
          operatingSystem: 'Windows Server 2016',
          platformSoftware: 'SAP BusinessObjects BI 4.2 SP7',
          authentication: 'Windows AD',
          separateTomcat: 'yes',
          clustered: 'no',
          externallyFacing: 'yes',
          httpsConfigured: 'yes',
          separateWebServer: 'yes',
          webServerName: 'ACME-WEB-P01',
          installationFolder: 'D:\\SAP BusinessObjects',
          inputFileRepositoryGb: '42.5',
          outputFileRepositoryGb: '118',
          cmsDatabaseSoftware: 'SQL Server 2016',
          auditingEnabled: 'yes',
          auditDatabaseSoftware: 'SQL Server 2016',
          universeCountMode: 'separate',
          unvCount: '64',
          unxCount: '18',
          crystalDocuments: '820',
          webiDocuments: '460',
          publications: '35',
          pendingInstances: '12',
          successfulInstances: '48210',
          destinationChangesRequired: 'yes',
          destinationChangesNarrative: 'Moving from file shares to SFTP for the finance pack.',
          successfulInstancesRequired: 'some',
          successfulInstancesNarrative: 'Last 12 months of the statutory reports only.'
        }
      }
    ]
  };
}

/**
 * Crystal Server. The universe tab and the WebI/universe fields must not
 * appear — this is the scenario that matters most.
 */
function crystalServer(): AssessmentState {
  return {
    client: {
      installationType: 'crystal-server',
      client: 'Beta Logistics',
      conversationDate: FIXED_DATE,
      technicalContactName: 'A Technical Contact',
      technicalContactEmail: 'tech@example.invalid',
      signOffName: 'A Sign-off Contact',
      signOffEmail: 'signoff@example.invalid',
      consumers: '35',
      reportModifiers: '2',
      productionEnvironmentCount: '1',
      hasTestEnvironments: 'no',
      hasDevEnvironments: 'no',
      trainingBiLaunchpad: 'yes',
      trainingCms: 'no',
      trainingCrystalReports: 'yes',
      goLiveCoreHours: 'yes',
      goLiveSpecificWeekday: 'no',
      goLiveOvernight: 'no',
      goLiveWeekend: 'no'
    },
    environments: [
      {
        id: 'env-1',
        label: 'CRYSTAL-PROD',
        answers: {
          serverName: 'BETA-CS-P01',
          operatingSystem: 'Windows Server 2019',
          platformSoftware: 'SAP Crystal Server 2016',
          authentication: 'Enterprise',
          separateTomcat: 'no',
          clustered: 'no',
          externallyFacing: 'no',
          httpsConfigured: 'no',
          separateWebServer: 'no',
          installationFolder: 'C:\\Program Files (x86)\\SAP BusinessObjects',
          inputFileRepositoryGb: '3.2',
          outputFileRepositoryGb: '9.8',
          cmsDatabaseSoftware: 'SAP SQL Anywhere',
          auditingEnabled: 'no',
          crystalDocuments: '140',
          publications: '4',
          pendingInstances: '0',
          successfulInstances: '2100',
          destinationChangesRequired: 'no',
          successfulInstancesRequired: 'yes'
        }
      }
    ]
  };
}

/** Two environments, combined universe count, partially answered. */
function twoEnvironments(): AssessmentState {
  const base = boComplete();
  const withCount: AssessmentState = {
    client: { ...base.client, productionEnvironmentCount: '2' },
    environments: base.environments
  };
  const synced = syncEnvironments(withCount, 2);
  return {
    client: synced.client,
    environments: [
      {
        ...synced.environments[0],
        answers: {
          ...synced.environments[0].answers,
          universeCountMode: 'combined',
          combinedUniverseCount: '82'
        }
      },
      {
        ...synced.environments[1],
        label: 'PROD02',
        answers: {
          serverName: 'ACME-BOBJ-P10',
          operatingSystem: 'Windows Server 2019',
          platformSoftware: 'SAP BusinessObjects BI 4.2 SP7'
        }
      }
    ]
  };
}

const SCENARIOS: Array<{ name: string; state: AssessmentState }> = [
  { name: 'blank', state: blank() },
  { name: 'businessobjects complete', state: boComplete() },
  { name: 'crystal server', state: crystalServer() },
  { name: 'two environments partial', state: twoEnvironments() }
];

// ─── Fixture ──────────────────────────────────────────────────────────

interface Snapshot {
  name: string;
  input: AssessmentState;
  visibleTabIds: string[];
  visibleFieldIds: Record<string, string[]>;
  completeness: ReturnType<typeof overallCompleteness>;
  advisoryIds: string[];
  export: ReturnType<typeof toExport>;
  summary: string[];
}

function snapshot(name: string, state: AssessmentState): Snapshot {
  const type = installationTypeOf(state);
  const visibleFieldIds: Record<string, string[]> = {};

  for (const tab of CLIENT_TABS) {
    if (!isTabVisible(tab, type)) continue;
    visibleFieldIds[`client/${tab.id}`] = visibleFields(tab, type, state.client).map((f) => f.id);
  }
  for (const environment of state.environments) {
    for (const tab of ENVIRONMENT_TABS) {
      if (!isTabVisible(tab, type)) continue;
      visibleFieldIds[`${environment.id}/${tab.id}`] = visibleFields(
        tab,
        type,
        environment.answers
      ).map((f) => f.id);
    }
  }

  return {
    name,
    input: state,
    visibleTabIds: visibleTabs(type).map((t) => t.id),
    visibleFieldIds,
    completeness: overallCompleteness(state),
    advisoryIds: advisories(state).map((a) => a.id),
    export: toExport(state),
    summary: summaryLines(state)
  };
}

const current: Snapshot[] = SCENARIOS.map((s) => snapshot(s.name, s.state));

if (process.env.UPDATE_FIXTURES) {
  writeFileSync(FIXTURE_PATH, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
}

const pinned = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Snapshot[];

describe('pinned contract', () => {
  it('covers every scenario', () => {
    expect(pinned.map((p) => p.name)).toEqual(SCENARIOS.map((s) => s.name));
  });

  describe.each(current)('$name', (snap) => {
    const reference = pinned.find((p) => p.name === snap.name);

    it('asks the same tabs', () => {
      expect(snap.visibleTabIds).toEqual(reference?.visibleTabIds);
    });

    it('asks the same fields', () => {
      expect(snap.visibleFieldIds).toEqual(reference?.visibleFieldIds);
    });

    it('exports the same shape and values', () => {
      expect(snap.export).toEqual(reference?.export);
    });

    it('reports the same completeness', () => {
      expect(snap.completeness).toEqual(reference?.completeness);
    });

    it('raises the same advisories', () => {
      expect(snap.advisoryIds).toEqual(reference?.advisoryIds);
    });

    it('produces the same summary text', () => {
      expect(snap.summary).toEqual(reference?.summary);
    });
  });
});

// ─── Visibility rules, asserted directly ──────────────────────────────

describe('installation type', () => {
  it('hides the universes tab for Crystal Server', () => {
    const ids = visibleTabs('crystal-server').map((t) => t.id);
    expect(ids).not.toContain('cmc-universes');
    expect(visibleTabs('businessobjects').map((t) => t.id)).toContain('cmc-universes');
  });

  it('hides WebI document count for Crystal Server', () => {
    const contents = TABS.find((t) => t.id === 'cmc-contents')!;
    expect(visibleFields(contents, 'crystal-server', {}).map((f) => f.id)).toEqual([
      'crystalDocuments',
      'publications'
    ]);
    expect(visibleFields(contents, 'businessobjects', {}).map((f) => f.id)).toContain(
      'webiDocuments'
    );
  });

  it('hides universe modifiers and universe-specific training for Crystal Server', () => {
    const usage = TABS.find((t) => t.id === 'usage')!;
    expect(visibleFields(usage, 'crystal-server', {}).map((f) => f.id)).not.toContain(
      'universeModifiers'
    );

    const training = TABS.find((t) => t.id === 'training')!;
    const crystalTraining = visibleFields(training, 'crystal-server', {}).map((f) => f.id);
    expect(crystalTraining).not.toContain('trainingWebi');
    expect(crystalTraining).not.toContain('trainingInformationDesignTool');
    expect(crystalTraining).not.toContain('trainingUniverseConversion');
  });

  it('defaults to BusinessObjects for an unrecognised value', () => {
    // Fails towards asking more questions rather than fewer.
    expect(installationTypeOf({ client: {}, environments: [] })).toBe('businessobjects');
    expect(
      installationTypeOf({ client: { installationType: 'nonsense' }, environments: [] })
    ).toBe('businessobjects');
  });
});

describe('dependent fields', () => {
  it('reveals the web server name only when a separate web server is confirmed', () => {
    const ccm = TABS.find((t) => t.id === 'ccm')!;
    expect(visibleFields(ccm, 'businessobjects', {}).map((f) => f.id)).not.toContain(
      'webServerName'
    );
    expect(
      visibleFields(ccm, 'businessobjects', { separateWebServer: 'yes' }).map((f) => f.id)
    ).toContain('webServerName');
    expect(
      visibleFields(ccm, 'businessobjects', { separateWebServer: 'no' }).map((f) => f.id)
    ).not.toContain('webServerName');
  });

  it('switches between separate and combined universe counts', () => {
    const universes = TABS.find((t) => t.id === 'cmc-universes')!;
    const separate = visibleFields(universes, 'businessobjects', {
      universeCountMode: 'separate'
    }).map((f) => f.id);
    expect(separate).toEqual(['universeCountMode', 'unvCount', 'unxCount']);

    const combined = visibleFields(universes, 'businessobjects', {
      universeCountMode: 'combined'
    }).map((f) => f.id);
    expect(combined).toEqual(['universeCountMode', 'combinedUniverseCount']);
  });

  it('asks for the audit database only when auditing is enabled', () => {
    const settings = TABS.find((t) => t.id === 'cmc-settings')!;
    expect(
      visibleFields(settings, 'businessobjects', { auditingEnabled: 'no' }).map((f) => f.id)
    ).not.toContain('auditDatabaseSoftware');
  });
});

describe('completeness', () => {
  it('ignores optional narrative fields', () => {
    const usage = TABS.find((t) => t.id === 'usage')!;
    const answers = { consumers: '10', universeModifiers: '1', reportModifiers: '2' };
    expect(tabCompleteness(usage, 'businessobjects', answers).isComplete).toBe(true);
  });

  it('ignores fields hidden by a dependency, so a tab can read complete', () => {
    const ccm = TABS.find((t) => t.id === 'ccm')!;
    const answers = {
      separateTomcat: 'no',
      clustered: 'no',
      externallyFacing: 'no',
      httpsConfigured: 'no',
      separateWebServer: 'no',
      installationFolder: 'C:\\SAP',
      inputFileRepositoryGb: '1',
      outputFileRepositoryGb: '2'
    };
    const result = tabCompleteness(ccm, 'businessobjects', answers);
    expect(result.isComplete).toBe(true);
    expect(result.required).toBe(8);
  });

  it('treats an answered zero as answered', () => {
    const schedules = TABS.find((t) => t.id === 'cmc-schedules')!;
    const answers = {
      pendingInstances: '0',
      successfulInstances: '0',
      destinationChangesRequired: 'no',
      successfulInstancesRequired: 'yes'
    };
    expect(tabCompleteness(schedules, 'businessobjects', answers).isComplete).toBe(true);
  });

  it('is not complete when nothing has been answered', () => {
    expect(overallCompleteness(blank()).isComplete).toBe(false);
  });

  it('is complete for a fully answered assessment', () => {
    expect(overallCompleteness(boComplete()).isComplete).toBe(true);
    expect(overallCompleteness(crystalServer()).isComplete).toBe(true);
  });
});

// ─── Environments ─────────────────────────────────────────────────────

describe('syncEnvironments', () => {
  it('appends without disturbing existing answers', () => {
    const state = boComplete();
    const grown = syncEnvironments(state, 3);
    expect(grown.environments).toHaveLength(3);
    expect(grown.environments[0]).toEqual(state.environments[0]);
    expect(grown.environments[1].label).toBe(defaultEnvironmentLabel(1));
  });

  it('drops from the end when shrinking', () => {
    const grown = syncEnvironments(boComplete(), 3);
    const shrunk = syncEnvironments(grown, 1);
    expect(shrunk.environments.map((e) => e.id)).toEqual(['env-1']);
  });

  it('clamps to at least one and at most the maximum', () => {
    expect(syncEnvironments(blank(), 0).environments).toHaveLength(1);
    expect(syncEnvironments(blank(), -5).environments).toHaveLength(1);
    expect(syncEnvironments(blank(), 999).environments).toHaveLength(
      MAX_PRODUCTION_ENVIRONMENTS
    );
  });

  it('returns the same object when the count is unchanged', () => {
    const state = blank();
    expect(syncEnvironments(state, 1)).toBe(state);
  });

  it('ignores a non-numeric count rather than destroying environments', () => {
    const grown = syncEnvironments(boComplete(), 3);
    expect(syncEnvironments(grown, Number.NaN).environments).toHaveLength(1);
  });
});

// ─── Advisories ───────────────────────────────────────────────────────

describe('advisories', () => {
  it('flags disabled auditing', () => {
    expect(advisories(crystalServer()).map((a) => a.id)).toContain('env-1-auditing');
  });

  it('flags a partial instance requirement', () => {
    expect(advisories(boComplete()).map((a) => a.id)).toContain('env-1-instances');
  });

  it('flags an out-of-hours go-live', () => {
    expect(advisories(boComplete()).map((a) => a.id)).toContain('go-live-rate');
  });

  it('flags a named-but-unnamed web server', () => {
    const state = boComplete();
    state.environments[0].answers.webServerName = '';
    expect(advisories(state).map((a) => a.id)).toContain('env-1-webserver');
  });

  it('reminds the consultant what Crystal Server skipped', () => {
    expect(advisories(crystalServer()).map((a) => a.id)).toContain('crystal-scope');
    expect(advisories(boComplete()).map((a) => a.id)).not.toContain('crystal-scope');
  });

  it('raises nothing on a blank assessment', () => {
    expect(advisories(blank())).toEqual([]);
  });
});

// ─── Export ───────────────────────────────────────────────────────────

describe('toExport', () => {
  it('omits inapplicable fields entirely, and nulls unanswered ones', () => {
    // The distinction the Quote Generator needs: "Crystal Server, so there
    // are no universes" is not the same as "not counted yet".
    const crystal = toExport(crystalServer());
    expect(crystal.environments[0].answers).not.toHaveProperty('webiDocuments');
    expect(crystal.environments[0].answers).not.toHaveProperty('unvCount');

    const partial = toExport(twoEnvironments());
    expect(partial.environments[1].answers.crystalDocuments).toBeNull();
  });

  it('coerces number and GB fields to numbers', () => {
    const answers = toExport(boComplete()).environments[0].answers;
    expect(answers.inputFileRepositoryGb).toBe(42.5);
    expect(answers.crystalDocuments).toBe(820);
    expect(typeof answers.serverName).toBe('string');
  });

  it('carries the schema version', () => {
    expect(toExport(blank()).schemaVersion).toBe(1);
    expect(toExport(blank()).tool).toBe('sap-install-assessment');
  });
});

describe('exportFilename', () => {
  it('slugs the client name and includes the conversation date', () => {
    expect(exportFilename(boComplete(), 'json')).toBe(
      'Install-Assessment-Acme-Manufacturing-Ltd-2026-08-03.json'
    );
  });

  it('falls back when the client is unnamed', () => {
    expect(exportFilename(blank(), 'docx')).toBe(
      `Install-Assessment-client-${FIXED_DATE}.docx`
    );
  });
});

// ─── Persistence ──────────────────────────────────────────────────────

describe('serialise / deserialise', () => {
  it('round-trips', () => {
    const state = boComplete();
    expect(deserialise(serialise(state))).toEqual(state);
  });

  it('refuses anything it does not fully recognise', () => {
    // A partially-understood assessment is worse than an empty one — the
    // consultant would not know which answers survived.
    expect(deserialise(null)).toBeUndefined();
    expect(deserialise('')).toBeUndefined();
    expect(deserialise('not json')).toBeUndefined();
    expect(deserialise('null')).toBeUndefined();
    expect(deserialise('[]')).toBeUndefined();
    expect(deserialise('{"client":{}}')).toBeUndefined();
    expect(deserialise('{"client":{},"environments":[]}')).toBeUndefined();
    expect(deserialise('{"client":{},"environments":[{"id":"a"}]}')).toBeUndefined();
  });
});

// ─── Model integrity ──────────────────────────────────────────────────

describe('model', () => {
  it('has globally unique field ids', () => {
    const ids = TABS.flatMap((t) => t.fields.map((f) => f.id));
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(duplicates).toEqual([]);
  });

  it('has unique tab ids', () => {
    const ids = TABS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only references earlier fields in the same tab from showWhen', () => {
    // Otherwise a dependent field could render before its controller.
    for (const tab of TABS) {
      tab.fields.forEach((field, index) => {
        if (!field.showWhen) return;
        const controllerIndex = tab.fields.findIndex((f) => f.id === field.showWhen!.field);
        expect(controllerIndex, `${tab.id}/${field.id}`).toBeGreaterThanOrEqual(0);
        expect(controllerIndex, `${tab.id}/${field.id}`).toBeLessThan(index);
      });
    }
  });

  it('gives every select-style field options', () => {
    for (const tab of TABS) {
      for (const field of tab.fields) {
        if (['select', 'weekday', 'yesnosome'].includes(field.kind)) {
          expect(field.options, `${tab.id}/${field.id}`).toBeDefined();
          expect(field.options!.length, `${tab.id}/${field.id}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('splits into client and environment scopes with nothing left over', () => {
    expect(CLIENT_TABS.length + ENVIRONMENT_TABS.length).toBe(TABS.length);
  });
});
