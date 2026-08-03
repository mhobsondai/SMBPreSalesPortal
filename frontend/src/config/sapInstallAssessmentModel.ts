/**
 * SAP BI Platform — Pre-Sales Install Assessment model.
 *
 * Derived from `Blank Install Assessment.docx`, but **deliberately
 * reordered**. The document groups fields by subject; this model groups
 * them by *where the consultant gets the answer from* — one CMC screen per
 * tab — so a call can be worked through with the fewest possible context
 * switches. The mapping back to the document's sections is recorded in
 * AD-11.
 *
 * ## This is a capture model, not an estimating model
 *
 * Unlike `fabricEstimatorModel.ts` and `assessmentModel.ts`, nothing here
 * carries a weight or a day factor, and the tool derives no score. Every
 * number in the output is a figure the client stated. So this file is not
 * published methodology in the AD-08/AD-09 sense.
 *
 * What *is* pinned is the **shape of the export** and the **conditional
 * visibility rules** — the downstream Quote Generator will consume the
 * JSON, and a field that silently stops being asked would produce a quote
 * that silently stops pricing it. See
 * `lib/assessments/__fixtures__/reference.json`.
 *
 * ## Adding guidance
 *
 * Every tab has a `guidance` block with empty copy and image slots. Drop a
 * screenshot into `public/guidance/sap-install/` and set `src` — the
 * placeholder box becomes the image with no code change. Sizes are
 * declared per slot because the source screenshots vary considerably.
 */

// ─── Installation type drives what gets asked ─────────────────────────

/**
 * Crystal Server has no universes and no Web Intelligence, so several
 * fields and one whole tab do not apply to it. This is the single most
 * important switch in the model.
 */
export type InstallationType = 'crystal-server' | 'businessobjects';

export const INSTALLATION_TYPES: ReadonlyArray<{
  value: InstallationType;
  label: string;
}> = [
  { value: 'businessobjects', label: 'SAP BusinessObjects' },
  { value: 'crystal-server', label: 'SAP Crystal Server' }
];

// ─── Fields ───────────────────────────────────────────────────────────

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'email'
  | 'date'
  | 'number'
  | 'gb'
  | 'yesno'
  | 'yesnosome'
  | 'select'
  | 'weekday';

export interface FieldOption {
  value: string;
  label: string;
}

export interface Field {
  /** Stable id. Unique within the whole model — it is a React key, an
   *  export key, and a localStorage key. */
  id: string;
  label: string;
  kind: FieldKind;
  /** Short hint rendered under the label. Not guidance — guidance lives
   *  in the right-hand pane. */
  hint?: string;
  placeholder?: string;
  /** Required for `select`. */
  options?: readonly FieldOption[];
  /**
   * Restrict this field to certain installation types. Absent means it
   * applies to both.
   */
  onlyFor?: readonly InstallationType[];
  /**
   * Show only when another field in the same scope holds one of these
   * values. The referenced field must appear earlier in the same tab.
   */
  showWhen?: { field: string; equals: readonly string[] };
  /**
   * Excluded from completeness counts. Use for genuinely optional
   * narrative, so a tab can read complete without it.
   */
  optional?: boolean;
}

// ─── Guidance (copy and screenshots supplied later) ───────────────────

export interface GuidanceImage {
  id: string;
  /** Empty until supplied. */
  caption: string;
  /**
   * Path under `public/`, e.g. `/guidance/sap-install/ccm-tomcat.png`.
   * Empty renders a labelled placeholder box at the declared size.
   */
  src: string;
  /** Declared so layout does not jump when the real screenshot lands. */
  size: 'half' | 'full' | 'wide';
}

export interface Guidance {
  /** Empty until supplied. */
  intro: string;
  /** Numbered walkthrough. Empty until supplied. */
  steps: readonly string[];
  images: readonly GuidanceImage[];
}

function guidance(images: Array<[string, GuidanceImage['size']]>): Guidance {
  return {
    intro: '',
    steps: [],
    images: images.map(([id, size]) => ({ id, caption: '', src: '', size }))
  };
}

/** No guidance needed — the questions are self-explanatory. */
const SELF_EVIDENT: Guidance = { intro: '', steps: [], images: [] };

// ─── Tabs ─────────────────────────────────────────────────────────────

/**
 * `client` tabs are answered once. `environment` tabs are answered once
 * per **production** environment.
 *
 * Test and development environments are counted on the Landscape tab but
 * never detailed: they are rebuilt as a copy of the new production once
 * it is ready, so their current configuration does not size the work.
 */
export type TabScope = 'client' | 'environment';

export interface Tab {
  id: string;
  title: string;
  /** One line under the tab heading, explaining what this screen is for. */
  blurb: string;
  scope: TabScope;
  onlyFor?: readonly InstallationType[];
  fields: readonly Field[];
  guidance: Guidance;
}

const YES_NO_SOME: readonly FieldOption[] = [
  { value: 'yes', label: 'Yes — all required' },
  { value: 'some', label: 'Some — a subset is required' },
  { value: 'no', label: 'No — none required' }
];

const WEEKDAYS: readonly FieldOption[] = [
  { value: 'monday', label: 'Monday' },
  { value: 'tuesday', label: 'Tuesday' },
  { value: 'wednesday', label: 'Wednesday' },
  { value: 'thursday', label: 'Thursday' },
  { value: 'friday', label: 'Friday' },
  { value: 'saturday', label: 'Saturday' },
  { value: 'sunday', label: 'Sunday' }
];

export const TABS: readonly Tab[] = [
  // ─── Client-level, front ────────────────────────────────────────────
  {
    id: 'overview',
    title: 'Overview information',
    blurb:
      'Headline details for the engagement. Everything here comes from the conversation itself.',
    scope: 'client',
    guidance: SELF_EVIDENT,
    fields: [
      { id: 'client', label: 'Client', kind: 'text', placeholder: 'Organisation name' },
      {
        id: 'conversationDate',
        label: 'Date of conversation',
        kind: 'date',
        hint: 'Defaults to today.'
      },
      { id: 'technicalContactName', label: 'Technical contact — name', kind: 'text' },
      { id: 'technicalContactEmail', label: 'Technical contact — email', kind: 'email' },
      { id: 'signOffName', label: 'Sign-off contact — name', kind: 'text' },
      { id: 'signOffEmail', label: 'Sign-off contact — email', kind: 'email' }
    ]
  },
  {
    id: 'usage',
    title: 'Usage and future plans',
    blurb:
      'How much the platform is used, by whom, and where the client thinks it is going.',
    scope: 'client',
    guidance: SELF_EVIDENT,
    fields: [
      {
        id: 'consumers',
        label: 'Content consumers',
        kind: 'number',
        hint: 'People who either log in directly or receive scheduled output.'
      },
      {
        id: 'universeModifiers',
        label: 'Universe modifiers',
        kind: 'number',
        hint: 'People who build or change universes.',
        onlyFor: ['businessobjects']
      },
      {
        id: 'reportModifiers',
        label: 'Report modifiers',
        kind: 'number',
        hint: 'People who build or change reports.'
      },
      {
        id: 'futureDirection',
        label: 'Future direction',
        kind: 'textarea',
        hint: 'Transition to another toolset? Planning a move to Power BI? Anything shaping the roadmap.',
        optional: true
      },
      {
        id: 'adjacentWork',
        label: 'Adjacent work that might impact delivery',
        kind: 'textarea',
        hint: 'Other programmes, freezes, migrations or reorganisations happening in parallel.',
        optional: true
      }
    ]
  },
  {
    id: 'landscape',
    title: 'Landscape overview',
    blurb:
      'What is being installed, and how many environments exist. The environment count is the single largest driver of overall effort.',
    scope: 'client',
    guidance: SELF_EVIDENT,
    fields: [
      {
        id: 'installationType',
        label: 'Installation type',
        kind: 'select',
        options: INSTALLATION_TYPES,
        hint: 'Crystal Server has no universes and no Web Intelligence — choosing it removes those questions.'
      },
      {
        id: 'productionEnvironmentCount',
        label: 'Production environments',
        kind: 'number',
        hint: 'Each one gets its own set of tabs below. Most clients have one.'
      },
      { id: 'hasTestEnvironments', label: 'Test environments?', kind: 'yesno' },
      {
        id: 'testEnvironmentCount',
        label: 'How many test environments?',
        kind: 'number',
        showWhen: { field: 'hasTestEnvironments', equals: ['yes'] }
      },
      { id: 'hasDevEnvironments', label: 'Development environments?', kind: 'yesno' },
      {
        id: 'devEnvironmentCount',
        label: 'How many development environments?',
        kind: 'number',
        showWhen: { field: 'hasDevEnvironments', equals: ['yes'] }
      }
    ]
  },

  // ─── Per production environment ─────────────────────────────────────
  {
    id: 'server',
    title: 'Server Technical Information',
    blurb: 'Identity and version of the current server, and what it is moving to.',
    scope: 'environment',
    guidance: SELF_EVIDENT,
    fields: [
      { id: 'serverName', label: 'Current server name', kind: 'text' },
      {
        id: 'proposedServerName',
        label: 'Proposed server name',
        kind: 'text',
        hint: 'Leave blank if not yet decided.',
        optional: true
      },
      {
        id: 'operatingSystem',
        label: 'Operating system',
        kind: 'text',
        placeholder: 'e.g. Windows Server 2016'
      },
      {
        id: 'platformSoftware',
        label: 'Platform software',
        kind: 'text',
        hint: 'The installed version, e.g. SAP BusinessObjects BI 4.2 SP7, or Crystal Server 2016.'
      },
      {
        id: 'authentication',
        label: 'Authentication',
        kind: 'text',
        placeholder: 'e.g. Enterprise, Windows AD, LDAP'
      }
    ]
  },
  {
    id: 'ccm',
    title: 'Central Configuration Manager',
    blurb:
      'Everything visible from the CCM on the server, plus the filestore it points at.',
    scope: 'environment',
    guidance: guidance([
      ['ccm-launch', 'half'],
      ['ccm-server-list', 'wide'],
      ['ccm-tomcat', 'half'],
      ['ccm-cluster', 'half'],
      ['ccm-install-folder', 'wide'],
      ['filestore-input-size', 'half'],
      ['filestore-output-size', 'half']
    ]),
    fields: [
      { id: 'separateTomcat', label: 'Separate Tomcat?', kind: 'yesno' },
      { id: 'clustered', label: 'Clustered environment?', kind: 'yesno' },
      {
        id: 'externallyFacing',
        label: 'Server accessed externally?',
        kind: 'yesno',
        hint: 'Reachable from outside the client network.'
      },
      { id: 'httpsConfigured', label: 'HTTPS configured?', kind: 'yesno' },
      { id: 'separateWebServer', label: 'Separate web server?', kind: 'yesno' },
      {
        id: 'webServerName',
        label: 'Web server name',
        kind: 'text',
        showWhen: { field: 'separateWebServer', equals: ['yes'] }
      },
      {
        id: 'installationFolder',
        label: 'Default installation folder',
        kind: 'text',
        placeholder: 'e.g. C:\\Program Files (x86)\\SAP BusinessObjects'
      },
      {
        id: 'inputFileRepositoryGb',
        label: 'Input file repository size',
        kind: 'gb',
        hint: '<installation folder>\\SAP BusinessObjects Enterprise XI 4.0\\FileStore\\Input'
      },
      {
        id: 'outputFileRepositoryGb',
        label: 'Output file repository size',
        kind: 'gb',
        hint: '<installation folder>\\SAP BusinessObjects Enterprise XI 4.0\\FileStore\\Output'
      }
    ]
  },
  {
    id: 'cmc-settings',
    title: 'CMC Settings',
    blurb: 'The CMS and auditing databases behind the platform.',
    scope: 'environment',
    guidance: guidance([
      ['cmc-settings-nav', 'half'],
      ['cmc-cms-database', 'wide'],
      ['cmc-audit-database', 'wide']
    ]),
    fields: [
      {
        id: 'cmsDatabaseSoftware',
        label: 'CMS database software',
        kind: 'text',
        placeholder: 'e.g. SQL Server 2016, SAP SQL Anywhere'
      },
      { id: 'auditingEnabled', label: 'Auditing enabled?', kind: 'yesno' },
      {
        id: 'auditDatabaseSoftware',
        label: 'Audit database software',
        kind: 'text',
        showWhen: { field: 'auditingEnabled', equals: ['yes'] }
      }
    ]
  },
  {
    id: 'cmc-universes',
    title: 'CMC Universes',
    blurb: 'Universe counts, taken from the CMC universe folders.',
    scope: 'environment',
    onlyFor: ['businessobjects'],
    guidance: guidance([
      ['cmc-universes-nav', 'half'],
      ['cmc-universes-count', 'wide']
    ]),
    fields: [
      {
        id: 'universeCountMode',
        label: 'How are you counting universes?',
        kind: 'select',
        hint: 'Use a combined total when there are too many of both types to separate reliably.',
        options: [
          { value: 'separate', label: 'Separately — UNV and UNX' },
          { value: 'combined', label: 'Combined total only' }
        ]
      },
      {
        id: 'unvCount',
        label: 'Number of UNV universes',
        kind: 'number',
        showWhen: { field: 'universeCountMode', equals: ['separate'] }
      },
      {
        id: 'unxCount',
        label: 'Number of UNX universes',
        kind: 'number',
        showWhen: { field: 'universeCountMode', equals: ['separate'] }
      },
      {
        id: 'combinedUniverseCount',
        label: 'Combined universe total',
        kind: 'number',
        showWhen: { field: 'universeCountMode', equals: ['combined'] }
      }
    ]
  },
  {
    id: 'cmc-contents',
    title: 'CMC Contents',
    blurb: 'Document counts, taken from the CMC folder listing.',
    scope: 'environment',
    guidance: guidance([
      ['cmc-folders-nav', 'half'],
      ['cmc-folders-count', 'wide']
    ]),
    fields: [
      { id: 'crystalDocuments', label: 'Crystal documents', kind: 'number' },
      {
        id: 'webiDocuments',
        label: 'Web Intelligence documents',
        kind: 'number',
        onlyFor: ['businessobjects']
      },
      {
        id: 'publications',
        label: 'Publications and program objects',
        kind: 'number'
      }
    ]
  },
  {
    id: 'cmc-schedules',
    title: 'CMC Schedules',
    blurb:
      'Instance volumes, and what the client actually needs carried across.',
    scope: 'environment',
    guidance: guidance([
      ['cmc-instance-manager-nav', 'half'],
      ['cmc-pending-instances', 'wide'],
      ['cmc-successful-instances', 'wide']
    ]),
    fields: [
      { id: 'pendingInstances', label: 'Pending instances', kind: 'number' },
      { id: 'successfulInstances', label: 'Successful instances', kind: 'number' },
      {
        id: 'destinationChangesRequired',
        label: 'Are changes to the scheduled destinations required?',
        kind: 'yesno'
      },
      {
        id: 'destinationChangesNarrative',
        label: 'What needs to change?',
        kind: 'textarea',
        showWhen: { field: 'destinationChangesRequired', equals: ['yes'] }
      },
      {
        id: 'successfulInstancesRequired',
        label: 'Are all successful instances of the reports required?',
        kind: 'yesnosome',
        options: YES_NO_SOME
      },
      {
        id: 'successfulInstancesNarrative',
        label: 'Which instances are required?',
        kind: 'textarea',
        showWhen: { field: 'successfulInstancesRequired', equals: ['some'] }
      }
    ]
  },

  // ─── Client-level, tail ─────────────────────────────────────────────
  {
    id: 'training',
    title: 'Training requirements',
    blurb: 'Which of the standard training items the client wants included.',
    scope: 'client',
    guidance: SELF_EVIDENT,
    fields: [
      { id: 'trainingBiLaunchpad', label: 'BI Launchpad — guide', kind: 'yesno' },
      { id: 'trainingCms', label: 'CMS training — 1 day', kind: 'yesno' },
      {
        id: 'trainingWebi',
        label: 'Web Intelligence training — 1 day',
        kind: 'yesno',
        onlyFor: ['businessobjects']
      },
      {
        id: 'trainingCrystalReports',
        label: 'Crystal Reports training — 3 days',
        kind: 'yesno'
      },
      {
        id: 'trainingInformationDesignTool',
        label: 'Information Design Tool training — 1 day',
        kind: 'yesno',
        hint: 'For universe development.',
        onlyFor: ['businessobjects']
      },
      {
        id: 'trainingUniverseConversion',
        label: 'Universe conversion and report repointing — guide',
        kind: 'yesno',
        onlyFor: ['businessobjects']
      }
    ]
  },
  {
    id: 'go-live',
    title: 'Go Live requirements',
    blurb:
      'When the cutover has to happen. Anything outside core hours is charged at a different rate.',
    scope: 'client',
    guidance: SELF_EVIDENT,
    fields: [
      { id: 'goLiveCoreHours', label: 'In core hours', kind: 'yesno' },
      { id: 'goLiveSpecificWeekday', label: 'Specific day of the week', kind: 'yesno' },
      {
        id: 'goLiveWeekday',
        label: 'Which day?',
        kind: 'weekday',
        options: WEEKDAYS,
        showWhen: { field: 'goLiveSpecificWeekday', equals: ['yes'] }
      },
      { id: 'goLiveOvernight', label: 'Overnight', kind: 'yesno' },
      { id: 'goLiveWeekend', label: 'Weekend', kind: 'yesno' }
    ]
  }
] as const;

/** Environments cannot sensibly be unbounded — the rail stops being usable. */
export const MAX_PRODUCTION_ENVIRONMENTS = 8;

/** Bumped whenever the export shape changes. Read by the Quote Generator. */
export const ASSESSMENT_SCHEMA_VERSION = 1;
