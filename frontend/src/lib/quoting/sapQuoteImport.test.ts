/**
 * Assessment import.
 *
 * Replayed against the **real** install assessment fixture rather than
 * hand-written JSON: `lib/assessments/__fixtures__/reference.json` is what
 * `toExport()` actually produces, so if that contract moves these tests
 * fail here rather than in a client's quote. That is the whole point of
 * AD-11 pinning the export shape.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  AUTH_CONFIG_HOURS,
  MIGRATION_BANDS,
  MINIMUM_IN_PLACE_UPGRADE_OS_YEAR,
  PLATFORM_HOURS_PER_ENVIRONMENT,
  ROUTE_LINES,
  SUPPORTED_ASSESSMENT_SCHEMA_VERSION,
  TOMCAT_HOURS_PER_INSTANCE,
  UNIVERSE_CONVERSION_HOURS,
  type Interpretation
} from '../../config/sapQuoteImportModel';
import {
  allChangeIds,
  answerState,
  applyImport,
  buildSeed,
  containsPersonalData,
  interpretLocally,
  migrationBandFor,
  needsInterpretation,
  parseAssessmentExport,
  planImport,
  seedSummaryLines,
  technicalStringsFor,
  universeCount,
  type AssessmentExport
} from './sapQuoteImport';
import {
  computeTotals,
  createBlankQuote,
  defaultsForProjectType,
  routeConflict,
  buildPhases,
  type QuoteState
} from './sapQuoteGenerator';

const ASSESSMENT_FIXTURE = join(
  __dirname,
  '..',
  'assessments',
  '__fixtures__',
  'reference.json'
);
const FIXTURE_PATH = join(__dirname, '__fixtures__', 'import.json');

interface AssessmentScenario {
  name: string;
  export: AssessmentExport;
}

const SCENARIOS = (
  JSON.parse(readFileSync(ASSESSMENT_FIXTURE, 'utf8')) as AssessmentScenario[]
).map((s) => ({ name: s.name, export: s.export }));

function scenario(name: string): AssessmentExport {
  const found = SCENARIOS.find((s) => s.name === name);
  if (!found) throw new Error(`No assessment scenario named ${name}`);
  return found.export;
}

function seedFor(name: string) {
  const assessment = scenario(name);
  return buildSeed(assessment, interpretLocally(technicalStringsFor(assessment)));
}

const BLANK: QuoteState = createBlankQuote('2026-08-05');

// ══════════════════════════════════════════════════════════════════════

describe('parsing', () => {
  it('accepts every scenario the install assessment actually produces', () => {
    for (const s of SCENARIOS) {
      const result = parseAssessmentExport(JSON.stringify(s.export));
      expect(result.ok, s.name).toBe(true);
    }
  });

  it('refuses anything that is not an assessment export', () => {
    expect(parseAssessmentExport('').ok).toBe(false);
    expect(parseAssessmentExport('   ').ok).toBe(false);
    expect(parseAssessmentExport('not json').ok).toBe(false);
    expect(parseAssessmentExport('[]').ok).toBe(false);
    expect(parseAssessmentExport('"a string"').ok).toBe(false);
    expect(parseAssessmentExport('{}').ok).toBe(false);
  });

  it('names the tool it expected', () => {
    const result = parseAssessmentExport(
      JSON.stringify({ tool: 'fabric-data-calculator', schemaVersion: 2 })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('fabric-data-calculator');
  });

  it('refuses a schema version it does not read, and says which', () => {
    const older = { ...scenario('businessobjects complete'), schemaVersion: 1 };
    const result = parseAssessmentExport(JSON.stringify(older));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('v1');
      expect(result.error).toContain(`v${SUPPORTED_ASSESSMENT_SCHEMA_VERSION}`);
    }
  });

  it('refuses a malformed environment rather than repairing it', () => {
    const broken = {
      ...scenario('businessobjects complete'),
      environments: [{ id: 'env-1', label: 'PROD01' }]
    };
    expect(parseAssessmentExport(JSON.stringify(broken)).ok).toBe(false);
  });

  it('refuses an export with no environments', () => {
    const empty = { ...scenario('crystal server'), environments: [] };
    expect(parseAssessmentExport(JSON.stringify(empty)).ok).toBe(false);
  });
});

describe('the three answer states', () => {
  const crystal = scenario('crystal server').environments[0];
  const blank = scenario('blank').environments[0];

  it('reads an absent key as not applicable', () => {
    // Crystal Server has no universes, so the keys are absent entirely.
    expect(answerState(crystal.answers, 'universeCountMode')).toBe('absent');
    expect(answerState(crystal.answers, 'webiDocuments')).toBe('absent');
  });

  it('reads null as applicable but unanswered', () => {
    expect(answerState(blank.answers, 'operatingSystem')).toBe('unanswered');
    expect(answerState(blank.answers, 'universeCountMode')).toBe('unanswered');
  });

  it('reads a value as answered, including a zero', () => {
    expect(answerState(crystal.answers, 'pendingInstances')).toBe('answered');
    expect(crystal.answers.pendingInstances).toBe(0);
  });

  it('counts an absent universe group as a real zero, not a gap', () => {
    const result = universeCount(crystal);
    expect(result.total).toBe(0);
    expect(result.unknown).toEqual([]);
  });

  it('reports an unanswered universe group as a gap, not a zero', () => {
    const result = universeCount(blank);
    expect(result.total).toBe(0);
    expect(result.unknown.length).toBeGreaterThan(0);
  });

  it('reads separate and combined universe counts', () => {
    // 'businessobjects complete' counts separately: 64 UNV + 18 UNX.
    expect(universeCount(scenario('businessobjects complete').environments[0]).total).toBe(82);
    // 'two environments partial' uses a combined total of 82.
    expect(universeCount(scenario('two environments partial').environments[0]).total).toBe(82);
  });
});

describe('local interpretation', () => {
  it('reads a plain Windows Server version', () => {
    const result = interpretLocally({
      operatingSystem: 'Windows Server 2016',
      authentication: 'Windows AD',
      platformSoftware: 'SAP BusinessObjects BI 4.2 SP7'
    });
    expect(result.operatingSystem.preWindowsServer2022).toBe(true);
    expect(result.operatingSystem.detected).toBe('Windows Server 2016');
    expect(result.authentication.auth).toBe('Windows AD');
    expect(result.platformSoftware.currentVersion).toBe('4.2 SP7');
    expect(needsInterpretation(result)).toBe(false);
  });

  it('puts 2022 and later on the upgrade side of the rule', () => {
    for (const os of ['Windows Server 2022', 'Windows Server 2025']) {
      const result = interpretLocally({ operatingSystem: os, authentication: '', platformSoftware: '' });
      expect(result.operatingSystem.preWindowsServer2022, os).toBe(false);
    }
    for (const os of ['Windows Server 2012 R2', 'Windows Server 2016', 'Windows Server 2019']) {
      const result = interpretLocally({ operatingSystem: os, authentication: '', platformSoftware: '' });
      expect(result.operatingSystem.preWindowsServer2022, os).toBe(true);
    }
  });

  it('reads the 2K shorthand', () => {
    const result = interpretLocally({
      operatingSystem: 'W2K12R2 Datacenter',
      authentication: '',
      platformSoftware: ''
    });
    expect(result.operatingSystem.preWindowsServer2022).toBe(true);
  });

  it('returns null rather than false for a non-Windows platform', () => {
    // The rule is about Windows Server editions. Answering "false" would
    // silently license an in-place upgrade on RHEL.
    const result = interpretLocally({
      operatingSystem: 'Red Hat Enterprise Linux 8',
      authentication: '',
      platformSoftware: ''
    });
    expect(result.operatingSystem.preWindowsServer2022).toBeNull();
    expect(result.operatingSystem.confidence).toBe('unknown');
    expect(needsInterpretation(result)).toBe(true);
  });

  it('returns null rather than false when it cannot read the OS', () => {
    for (const os of ['', 'the old one', 'TBC']) {
      const result = interpretLocally({ operatingSystem: os, authentication: '', platformSoftware: '' });
      expect(result.operatingSystem.preWindowsServer2022, os).toBeNull();
    }
  });

  it('maps the three authentication modes', () => {
    const cases: Array<[string, string]> = [
      ['Enterprise', 'Enterprise'],
      ['enterprise authentication', 'Enterprise'],
      ['Windows AD', 'Windows AD'],
      ['Active Directory', 'Windows AD'],
      ['AD with SSO via Kerberos', 'Windows AD'],
      ['NTLM', 'Windows AD'],
      ['SAML', 'SAML'],
      ['SAML2 through ADFS', 'SAML'],
      ['Federated sign-on', 'SAML']
    ];
    for (const [raw, expected] of cases) {
      const result = interpretLocally({ operatingSystem: '', authentication: raw, platformSoftware: '' });
      expect(result.authentication.auth, raw).toBe(expected);
    }
  });

  it('tests SAML before AD so ADFS is not mistaken for Active Directory', () => {
    const result = interpretLocally({
      operatingSystem: '',
      authentication: 'ADFS federation',
      platformSoftware: ''
    });
    expect(result.authentication.auth).toBe('SAML');
  });

  it('refuses to file LDAP under a mode the model does not have', () => {
    // The assessment invites "LDAP" but the effort model prices only three
    // modes. Guessing Windows AD would price 7.5h on nothing. See AD-15.
    const result = interpretLocally({
      operatingSystem: '',
      authentication: 'LDAP',
      platformSoftware: ''
    });
    expect(result.authentication.auth).toBeNull();
    expect(result.authentication.reason).toContain('LDAP');
    expect(needsInterpretation(result)).toBe(true);
  });

  it('reads a platform version or a release year', () => {
    expect(
      interpretLocally({ operatingSystem: '', authentication: '', platformSoftware: 'SAP BOBJ BI 4.3' })
        .platformSoftware.currentVersion
    ).toBe('4.3');
    expect(
      interpretLocally({
        operatingSystem: '',
        authentication: '',
        platformSoftware: 'SAP Crystal Server 2016'
      }).platformSoftware.currentVersion
    ).toBe('2016');
  });
});

describe('what leaves the browser', () => {
  it('is three technical strings and nothing else', () => {
    const assessment = scenario('businessobjects complete');
    const payload = technicalStringsFor(assessment);
    expect(Object.keys(payload).sort()).toEqual([
      'authentication',
      'operatingSystem',
      'platformSoftware'
    ]);
  });

  it('carries no client name, contact name or email address', () => {
    const assessment = scenario('businessobjects complete');
    const payload = technicalStringsFor(assessment);
    const serialised = JSON.stringify(payload);

    const client = assessment.client;
    for (const key of [
      'client',
      'signOffName',
      'signOffEmail',
      'technicalContactName',
      'technicalContactEmail'
    ]) {
      const value = client[key];
      if (typeof value === 'string' && value.trim() !== '') {
        expect(serialised, `${key} leaked`).not.toContain(value);
      }
    }
    expect(containsPersonalData(payload)).toBe(false);
  });

  it('detects an email address if one ever appeared in a technical field', () => {
    expect(
      containsPersonalData({
        operatingSystem: 'Windows Server 2016',
        authentication: 'ask bob@example.com',
        platformSoftware: ''
      })
    ).toBe(true);
  });

  it('does not call out at all when the local read is confident', () => {
    const assessment = scenario('businessobjects complete');
    expect(needsInterpretation(interpretLocally(technicalStringsFor(assessment)))).toBe(false);
  });
});

describe('migration bands', () => {
  it('bands on size and count, taking the higher', () => {
    expect(migrationBandFor(2, 500).id).toBe('small');
    expect(migrationBandFor(8, 500).id).toBe('medium');
    expect(migrationBandFor(2, 5000).id).toBe('medium');
    expect(migrationBandFor(20, 500).id).toBe('large');
    expect(migrationBandFor(2, 20000).id).toBe('large');
    expect(migrationBandFor(20, 20000).id).toBe('large');
  });

  it('holds the boundaries', () => {
    expect(migrationBandFor(5, 999).id).toBe('small');
    expect(migrationBandFor(5.01, 999).id).toBe('medium');
    expect(migrationBandFor(4, 1000).id).toBe('medium');
    expect(migrationBandFor(15, 9999).id).toBe('medium');
    expect(migrationBandFor(15.01, 9999).id).toBe('large');
    expect(migrationBandFor(4, 10000).id).toBe('large');
  });

  it('bands an empty estate as small rather than failing', () => {
    expect(migrationBandFor(0, 0).id).toBe('small');
  });

  it('has ascending thresholds and hours', () => {
    for (let i = 1; i < MIGRATION_BANDS.length; i += 1) {
      expect(MIGRATION_BANDS[i].maxGb).toBeGreaterThan(MIGRATION_BANDS[i - 1].maxGb);
      expect(MIGRATION_BANDS[i].hours).toBeGreaterThan(MIGRATION_BANDS[i - 1].hours);
    }
  });
});

describe('seeding — BusinessObjects, Windows Server 2016', () => {
  const seed = seedFor('businessobjects complete');

  it('forces install and migration on a pre-2022 OS', () => {
    expect(seed.projectType).toBe('install');
    expect(seed.routeReason).toContain(String(MINIMUM_IN_PLACE_UPGRADE_OS_YEAR));
  });

  it('picks the right product stack', () => {
    expect(seed.productStack).toBe('SAP Business Objects');
  });

  it('takes the client and contacts from the assessment', () => {
    const client = scenario('businessobjects complete').client;
    expect(seed.client).toBe(client.client);
    expect(seed.contactName).toBe(client.signOffName);
    expect(seed.contactEmail).toBe(client.signOffEmail);
  });

  it('sums the filestore across environments', () => {
    // 42.5 + 118
    expect(seed.filestoreGb.total).toBeCloseTo(160.5, 6);
    expect(seed.filestoreGb.unknown).toEqual([]);
  });

  it('sums universes, Crystal, WebI and publications into the content count', () => {
    // 64 + 18 universes, 820 Crystal, 460 WebI, 35 publications
    expect(seed.contentCount.total).toBe(1397);
  });

  it('bands the migration from those totals', () => {
    expect(seed.migrationBand?.id).toBe('large');
    expect(seed.hours['DI-BIA-SAP-BOBJ-BLD-MIGRATION']).toBe(30);
  });

  it('scales the platform install by the production environment count', () => {
    expect(seed.hours['DI-BIA-SAP-BOBJ-BLD-MIGR-INSTALL']).toBe(
      PLATFORM_HOURS_PER_ENVIRONMENT
    );
  });

  it('prices configuration from the interpreted authentication', () => {
    expect(seed.auth).toBe('Windows AD');
    expect(seed.hours['DI-BIA-SAP-BOBJ-BLD-MIGR-CONFIG']).toBe(
      AUTH_CONFIG_HOURS['Windows AD']
    );
  });

  it('counts a Tomcat instance from separate Tomcat or external access', () => {
    expect(seed.tomcatInstances).toBe(1);
    expect(seed.hours['DI-BIA-SAP-BOBJ-BLD-MIGR-TOMCAT']).toBe(TOMCAT_HOURS_PER_INSTANCE);
  });

  it('adds universe conversion when UNVs exist', () => {
    expect(seed.convertUniverses).toBe(true);
    expect(seed.hours['DI-BIA-SAP-BOBJ-BLD-DEV-REPORTS']).toBe(UNIVERSE_CONVERSION_HOURS);
    expect(seed.scope).toContain('conv_universe');
    expect(seed.scope).toContain('conv_repoint');
  });

  it('explains every hour it filled in', () => {
    for (const code of Object.keys(seed.hours)) {
      expect(seed.derivations[code], code).toBeTruthy();
    }
  });

  it('warns that Tomcat is costed so the exclusion needs removing', () => {
    expect(seed.notes.map((n) => n.id)).toContain('tomcat-scoped');
  });
});

describe('seeding — Crystal Server, Windows Server 2019', () => {
  const seed = seedFor('crystal server');

  it('uses Crystal product codes', () => {
    expect(seed.productStack).toBe('SAP Crystal Server');
    for (const code of Object.keys(seed.hours)) {
      expect(code).toContain('-CRY-');
    }
  });

  it('still forces install on a 2019 server', () => {
    expect(seed.projectType).toBe('install');
  });

  it('never converts universes on Crystal Server', () => {
    expect(seed.convertUniverses).toBe(false);
    expect(seed.hours['DI-BIA-SAP-CRY-BLD-DEV-REPORTS']).toBeUndefined();
    expect(seed.scope).not.toContain('conv_universe');
  });

  it('bands a small estate small', () => {
    // 3.2 + 9.8 GB, 140 + 4 items
    expect(seed.filestoreGb.total).toBeCloseTo(13, 6);
    expect(seed.contentCount.total).toBe(144);
    expect(seed.migrationBand?.id).toBe('medium');
  });

  it('prices Enterprise configuration lower than AD', () => {
    expect(seed.auth).toBe('Enterprise');
    expect(seed.hours['DI-BIA-SAP-CRY-BLD-MIGR-CONFIG']).toBe(AUTH_CONFIG_HOURS.Enterprise);
    expect(AUTH_CONFIG_HOURS.Enterprise).toBeLessThan(AUTH_CONFIG_HOURS['Windows AD']);
  });

  it('adds no Tomcat hours when there is no separate Tomcat and no external access', () => {
    expect(seed.tomcatInstances).toBe(0);
    expect(seed.hours['DI-BIA-SAP-CRY-BLD-MIGR-TOMCAT']).toBeUndefined();
  });
});

describe('seeding — two production environments', () => {
  const seed = seedFor('two environments partial');

  it('multiplies platform and configuration effort by the count', () => {
    expect(seed.environments).toBe(2);
    expect(seed.hours['DI-BIA-SAP-BOBJ-BLD-MIGR-INSTALL']).toBe(
      PLATFORM_HOURS_PER_ENVIRONMENT * 2
    );
  });

  it('warns that the migration is banded once on the combined total', () => {
    expect(seed.notes.map((n) => n.id)).toContain('multi-environment-band');
  });

  it('names the fields the assessment has not answered yet', () => {
    expect(seed.notes.map((n) => n.id)).toContain('incomplete-sizing');
    const note = seed.notes.find((n) => n.id === 'incomplete-sizing')!;
    expect(note.text).toMatch(/PROD|Production/);
  });

  it('flags an unknown UNV/UNX split rather than assuming no conversion', () => {
    expect(seed.convertUniverses).toBe(true);
    expect(seed.notes.map((n) => n.id)).toContain('universe-split-unknown');
  });

  it('scopes test environments without costing them', () => {
    expect(seed.testEnvironments).toBeGreaterThan(0);
    expect(seed.scope).toContain('install_test');
    expect(seed.notes.map((n) => n.id)).toContain('test-environments');
    // Nothing in the hours map mentions a test environment.
    expect(Object.values(seed.derivations).join(' ')).not.toMatch(/test environment/i);
  });
});

describe('seeding — a blank assessment', () => {
  const seed = seedFor('blank');

  it('does not invent a route', () => {
    expect(seed.notes.map((n) => n.id)).toContain('route-unconfirmed');
    expect(seed.routeReason).toContain('Confirm');
  });

  it('does not pre-fill configuration hours it cannot justify', () => {
    // No note here, and that is right: an undetermined route defaults to
    // an in-place upgrade, which has no configuration line to warn about.
    // The install case is covered separately below.
    expect(seed.auth).toBeNull();
    expect(seed.hours['DI-BIA-SAP-BOBJ-BLD-MIGR-CONFIG']).toBeUndefined();
  });

  it('says the assessment is incomplete', () => {
    expect(seed.notes.map((n) => n.id)).toContain('assessment-incomplete');
  });

  it('still fills the standard allowances', () => {
    expect(seed.hours['DI-BIA-SAP-BOBJ-DES-CONNECT']).toBe(0.5);
    expect(seed.hours['DI-BIA-SAP-BOBJ-UA-TESTING']).toBe(3.75);
  });
});

describe('unreadable authentication on the install route', () => {
  /*
   * The install route is the one with a configuration line, so this is
   * where an unreadable authentication string has to be visible. Built by
   * blanking the field on a Crystal scenario, which the OS rule already
   * forces onto install.
   */
  const assessment: AssessmentExport = (() => {
    const base = scenario('crystal server');
    return {
      ...base,
      environments: base.environments.map((e) => ({
        ...e,
        answers: { ...e.answers, authentication: 'LDAP over TLS' }
      }))
    };
  })();

  const seed = buildSeed(assessment, interpretLocally(technicalStringsFor(assessment)));

  it('forces the install route, so configuration hours are relevant', () => {
    expect(seed.projectType).toBe('install');
  });

  it('leaves the configuration line empty rather than guessing', () => {
    expect(seed.auth).toBeNull();
    expect(seed.hours['DI-BIA-SAP-CRY-BLD-MIGR-CONFIG']).toBeUndefined();
  });

  it('says why, quoting the LDAP reason', () => {
    const note = seed.notes.find((n) => n.id === 'auth-unknown');
    expect(note).toBeDefined();
    expect(note!.text).toContain('LDAP');
  });

  it('still fills every other line', () => {
    expect(seed.hours['DI-BIA-SAP-CRY-BLD-MIGR-INSTALL']).toBe(
      PLATFORM_HOURS_PER_ENVIRONMENT
    );
    expect(seed.hours['DI-BIA-SAP-CRY-BLD-MIGRATION']).toBeGreaterThan(0);
  });
});

describe('a seed is always one route', () => {
  it('never seeds both upgrade and install products', () => {
    for (const s of SCENARIOS) {
      const seed = buildSeed(s.export, interpretLocally(technicalStringsFor(s.export)));
      const state: QuoteState = {
        ...BLANK,
        productStack: seed.productStack,
        hours: seed.hours
      };
      expect(routeConflict(buildPhases(state)), s.name).toEqual([]);
    }
  });

  it('emits only codes the chosen route declares', () => {
    for (const s of SCENARIOS) {
      const seed = buildSeed(s.export, interpretLocally(technicalStringsFor(s.export)));
      const allowed = ROUTE_LINES[seed.projectType];
      for (const code of Object.keys(seed.hours)) {
        const suffix = code.replace(/^DI-BIA-SAP-(BOBJ|CRY)-/, '');
        expect(allowed, `${s.name}: ${code}`).toContain(suffix);
      }
    }
  });

  it('never seeds a contingency line', () => {
    for (const s of SCENARIOS) {
      const seed = buildSeed(s.export, interpretLocally(technicalStringsFor(s.export)));
      for (const code of Object.keys(seed.hours)) {
        expect(code, s.name).not.toContain('-CONTINGENCY');
      }
    }
  });

  it('never seeds a phase the skill has no opinion about', () => {
    const never = ['-SIT', '-TRAINING', '-BLD-DEV-UNIVERSE', '-TRN-OPERATIONS'];
    for (const s of SCENARIOS) {
      const seed = buildSeed(s.export, interpretLocally(technicalStringsFor(s.export)));
      for (const code of Object.keys(seed.hours)) {
        for (const suffix of never) {
          expect(code.endsWith(suffix), `${s.name}: ${code}`).toBe(false);
        }
      }
    }
  });
});

describe('the plan', () => {
  const seed = seedFor('businessobjects complete');

  it('changes nothing on its own', () => {
    const before = JSON.stringify(BLANK);
    planImport(BLANK, seed);
    expect(JSON.stringify(BLANK)).toBe(before);
  });

  it('offers every seeded hour as its own change', () => {
    const plan = planImport(BLANK, seed);
    for (const code of Object.keys(seed.hours)) {
      expect(plan.changes.some((c) => c.kind === 'hours' && c.code === code), code).toBe(true);
    }
  });

  it('reports no conflicts against a blank quote', () => {
    expect(planImport(BLANK, seed).conflicts).toEqual([]);
  });

  it('flags a change that would overwrite an entered value', () => {
    const started: QuoteState = {
      ...BLANK,
      client: 'Someone Else Ltd',
      hours: { 'DI-BIA-SAP-BOBJ-BLD-MIGRATION': 99 }
    };
    const plan = planImport(started, seed);
    expect(plan.conflicts).toContain('client');
    expect(plan.conflicts).toContain('DI-BIA-SAP-BOBJ-BLD-MIGRATION');
  });

  it('omits values that already match', () => {
    const already: QuoteState = { ...BLANK, client: seed.client };
    expect(planImport(already, seed).changes.some((c) => c.id === 'client')).toBe(false);
  });

  it('carries the derivation onto the hours rows', () => {
    const plan = planImport(BLANK, seed);
    const migration = plan.changes.find(
      (c) => c.kind === 'hours' && c.code === 'DI-BIA-SAP-BOBJ-BLD-MIGRATION'
    );
    expect(migration?.note).toContain('migration band');
  });

  it('groups changes in a readable order', () => {
    const groups = planImport(BLANK, seed).changes.map((c) => c.group);
    const order = ['identity', 'setup', 'hours', 'scope'];
    const seen = groups.map((g) => order.indexOf(g));
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });
});

describe('applying', () => {
  const seed = seedFor('businessobjects complete');
  const plan = planImport(BLANK, seed);

  it('applies everything when everything is accepted', () => {
    const next = applyImport(BLANK, plan, allChangeIds(plan));
    expect(next.client).toBe(seed.client);
    expect(next.productStack).toBe(seed.productStack);
    expect(next.projectType).toBe(seed.projectType);
    for (const [code, value] of Object.entries(seed.hours)) {
      expect(next.hours[code], code).toBe(value);
    }
    for (const scopeId of seed.scope) {
      expect(next.inScope[scopeId], scopeId).toBe(true);
    }
  });

  it('applies nothing when nothing is accepted', () => {
    expect(applyImport(BLANK, plan, new Set())).toEqual(BLANK);
  });

  it('leaves the route alone when only the route is refused', () => {
    const accepted = allChangeIds(plan);
    accepted.delete('projectType');
    const next = applyImport(BLANK, plan, accepted);
    expect(next.projectType).toBe(BLANK.projectType);
    expect(next.client).toBe(seed.client);
  });

  it('does not mutate the state it was given', () => {
    const before = JSON.stringify(BLANK);
    applyImport(BLANK, plan, allChangeIds(plan));
    expect(JSON.stringify(BLANK)).toBe(before);
  });

  it('produces a quote that costs without a route conflict', () => {
    const next = applyImport(BLANK, plan, allChangeIds(plan));
    const totals = computeTotals(next);
    expect(totals.isEmpty).toBe(false);
    expect(Number.isFinite(totals.grandValue)).toBe(true);
    expect(routeConflict(totals.phases)).toEqual([]);
  });

  it('keeps hours the import did not touch', () => {
    const started: QuoteState = {
      ...BLANK,
      hours: { 'DI-BIA-SAP-BOBJ-SIT': 15 }
    };
    const next = applyImport(started, planImport(started, seed), allChangeIds(plan));
    expect(next.hours['DI-BIA-SAP-BOBJ-SIT']).toBe(15);
  });
});

describe('summary', () => {
  it('leads with the product and route', () => {
    const lines = seedSummaryLines(seedFor('businessobjects complete'));
    expect(lines[0]).toContain('SAP Business Objects');
    expect(lines[0]).toContain('install and migration');
  });

  it('states the migration band when there is one', () => {
    expect(seedSummaryLines(seedFor('crystal server')).join('\n')).toContain('migration band');
  });
});

// ── Pinned end-to-end, inputs and outputs together (AD-10) ───────────

/*
 * The seed is projected rather than stored whole.
 *
 * `MIGRATION_BANDS` uses `Infinity` for the open-ended top band, which is
 * the honest value — and `JSON.stringify` turns it into `null`, so a
 * fixture holding the band object could never replay to itself. Caught by
 * the replay test, which is exactly what that test is for.
 *
 * The band's identity is what carries the pricing decision, so that is what
 * is pinned. Anything stored in a fixture has to survive a JSON round trip.
 */
interface Snapshot {
  name: string;
  input: AssessmentExport;
  interpretation: Interpretation;
  seed: Omit<ReturnType<typeof buildSeed>, 'migrationBand'> & {
    migrationBandId: string | null;
  };
  changes: Array<{ id: string; from: string; to: string; note?: string }>;
  totals: { grandValue: number; grandHours: number; pmLevel: string };
}

function snapshot(name: string, assessment: AssessmentExport): Snapshot {
  const interpretation = interpretLocally(technicalStringsFor(assessment));
  const { migrationBand, ...seed } = buildSeed(assessment, interpretation);
  const plan = planImport(BLANK, buildSeed(assessment, interpretation));
  const applied = applyImport(BLANK, plan, allChangeIds(plan));
  const totals = computeTotals(applied);
  return {
    name,
    input: assessment,
    interpretation,
    seed: { ...seed, migrationBandId: migrationBand?.id ?? null },
    changes: plan.changes.map((c) => ({ id: c.id, from: c.from, to: c.to, note: c.note })),
    totals: {
      grandValue: totals.grandValue,
      grandHours: totals.grandHours,
      pmLevel: totals.pmLevel
    }
  };
}

const current = SCENARIOS.map((s) => snapshot(s.name, s.export));

if (process.env.UPDATE_FIXTURES) {
  writeFileSync(FIXTURE_PATH, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
}

const pinned = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Snapshot[];

describe('pinned import', () => {
  it('covers every assessment scenario', () => {
    expect(pinned.map((p) => p.name)).toEqual(SCENARIOS.map((s) => s.name));
  });

  it('stores its own inputs, so every case can be replayed', () => {
    for (const entry of pinned) {
      expect(entry.input?.tool).toBe('sap-install-assessment');
    }
  });

  it('replays the pinned inputs to the pinned outputs', () => {
    for (const entry of pinned) {
      expect(snapshot(entry.name, entry.input)).toEqual(entry);
    }
  });

  it('survives a JSON round trip, so the fixture can be trusted', () => {
    // The Infinity in the top migration band was found here: a value that
    // does not survive JSON.stringify makes a fixture unreplayable, which
    // is the AD-10 failure this project already paid for once.
    for (const entry of current) {
      expect(JSON.parse(JSON.stringify(entry))).toEqual(entry);
    }
  });

  describe.each(current)('$name', (snap) => {
    const reference = pinned.find((p) => p.name === snap.name);

    it('interprets identically', () => {
      expect(snap.interpretation).toEqual(reference?.interpretation);
    });

    it('seeds the same effort', () => {
      expect(snap.seed.hours).toEqual(reference?.seed.hours);
      expect(snap.seed.derivations).toEqual(reference?.seed.derivations);
      expect(snap.seed.migrationBandId).toEqual(reference?.seed.migrationBandId);
    });

    it('reaches the same price', () => {
      expect(snap.totals).toEqual(reference?.totals);
    });

    it('raises the same notes', () => {
      expect(snap.seed.notes).toEqual(reference?.seed.notes);
    });
  });
});

describe('model integrity', () => {
  it('declares no route line twice', () => {
    for (const [route, suffixes] of Object.entries(ROUTE_LINES)) {
      expect(new Set(suffixes).size, route).toBe(suffixes.length);
    }
  });

  it('never puts an upgrade and an install line in the same route', () => {
    expect(ROUTE_LINES.upgrade.some((s) => s.includes('MIGR'))).toBe(false);
    expect(ROUTE_LINES.install.some((s) => s.includes('UPGR'))).toBe(false);
  });

  it('prices every authentication mode', () => {
    for (const [mode, hours] of Object.entries(AUTH_CONFIG_HOURS)) {
      expect(hours, mode).toBeGreaterThan(0);
    }
  });

  it('applies the defaults on top of a route-appropriate scope', () => {
    // A seeded install quote should sit alongside install defaults, not
    // upgrade ones — otherwise the CheckList describes a different job.
    const seed = seedFor('businessobjects complete');
    const withDefaults: QuoteState = {
      ...BLANK,
      ...defaultsForProjectType(seed.projectType)
    };
    const plan = planImport(withDefaults, seed);
    const next = applyImport(withDefaults, plan, allChangeIds(plan));
    expect(next.inScope.install_prod).toBe(true);
    expect(next.inScope.upgrade_inplace).toBe(false);
  });
});
