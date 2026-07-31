/**
 * Navigation tree — the single source of truth for the whole portal.
 *
 * ## The model
 *
 * A `Section` is a grouping. It may contain:
 *   - `children` — sub-sections
 *   - `tiles`    — links to actual tools
 *   - both
 *
 * ## How it renders
 *
 * Top-level sections (practice areas) are cards on the landing page.
 * **Everything below renders inline** on that practice area's page as
 * headed groups of compact list rows — no further navigation.
 *
 * That is deliberate. An earlier design gave every sub-section its own
 * page, which meant three clicks to reach a tool and a lot of near-empty
 * pages. With dozens of tools coming, the cost of that navigation
 * outweighs the tidiness. One click from the landing page now reaches
 * every tool in a practice area.
 *
 * Sub-sections remain individually addressable (`/area/data-ai/assessments`)
 * because the resolver walks the tree — useful if a group ever grows
 * large enough to deserve its own page. Nothing links there today.
 *
 * ## Adding things
 *
 * A new tool → append a `Tile` to the right section's `tiles`.
 * A new grouping → append a `Section` to the right section's `children`.
 * Neither needs a route, a component, or CSS.
 *
 * ## Slugs are URLs
 *
 * They appear in bookmarks people share. Renaming one breaks links, so
 * choose deliberately and prefer adding over renaming.
 *
 * ## Tile IDs must be globally unique
 *
 * Two sections may both hold a "Quote Generator"; their ids must differ
 * (`sap-quote-generator`, `fabric-quote-generator`). Ids are React keys
 * and will become analytics identifiers.
 */

export type TileStatus = 'live' | 'development' | 'planned';

export interface Tile {
  id: string;
  title: string;
  description: string;
  status: TileStatus;
  /** Internal route. Mutually exclusive with `href`. */
  to?: string;
  /** External URL — opens in a new tab. Mutually exclusive with `to`. */
  href?: string;
}

export interface Section {
  /** URL segment. Unique among its siblings. */
  slug: string;
  /** Short label for cards, group headings and breadcrumbs. */
  name: string;
  /**
   * Page headline, split so the second part carries the orange accent.
   * Single-element is fine where no split reads naturally.
   */
  headline: [string, string?];
  summary: string;
  children?: Section[];
  tiles?: Tile[];
}

/** Placeholder used until a section's first real tool lands. */
function placeholder(id: string, subject: string): Tile {
  return {
    id: `${id}-placeholder`,
    title: 'App in development',
    description: `The first ${subject} tool is being built.`,
    status: 'development'
  };
}

export const SECTIONS: Section[] = [
  {
    slug: 'infrastructure-365',
    name: 'Infrastructure & 365',
    headline: ['Infrastructure', '& 365'],
    summary:
      'Cloud platform, networking, identity, endpoint and Microsoft 365 pre-sales tooling — sizing, assessment and proposal support.',
    tiles: [placeholder('infra', 'Infrastructure & 365')]
  },
  {
    slug: 'erp',
    name: 'ERP',
    headline: ['ERP'],
    summary:
      'Business Central, SAP and finance-transformation pre-sales tooling — scoping, effort estimation and quote generation.',
    tiles: [placeholder('erp', 'ERP')]
  },
  {
    slug: 'data-ai',
    name: 'Data & AI',
    headline: ['Data', '& AI'],
    summary:
      'Microsoft Fabric, Power BI, Foundry, SAP BusinessObjects and Crystal Server pre-sales tooling — assessments, sizing and quote generation.',
    children: [
      {
        slug: 'assessments',
        name: 'Assessments',
        headline: ['Assessments'],
        summary:
          'Client-facing maturity assessment, its scoring and insight tooling, and the clinic format that follows.',
        tiles: [
          {
            id: 'client-link',
            title: 'Client Link',
            description:
              'Enhanced Maturity Assessment — the client-facing questionnaire.',
            status: 'live',
            href: 'https://codestonecloudbusiness.com/enhanced-maturity-assessment/'
          },
          {
            id: 'assessment-scoring-engine',
            title: 'Assessment Scoring Engine',
            description: 'Scores completed maturity assessments.',
            status: 'development'
          },
          {
            id: 'insight-spark-engine',
            title: 'Insight Spark Engine',
            description: 'Turns assessment results into talking points and themes.',
            status: 'development'
          },
          {
            id: 'data-ai-clinic',
            title: 'Data and AI Clinic',
            description: 'Clinic session format and supporting collateral.',
            status: 'development'
          }
        ]
      },
      {
        slug: 'sap-bi-platform',
        name: 'SAP BI Platform',
        headline: ['SAP BI', 'Platform'],
        summary:
          'SAP BusinessObjects and Crystal Server — estate assessment, effort estimation and quote generation.',
        tiles: [
          {
            id: 'sap-presales-install-assessment',
            title: 'Pre-Sales Install Assessment',
            description: 'Capture an existing estate ahead of scoping.',
            status: 'development'
          },
          {
            id: 'sap-quote-generator',
            title: 'Quote Generator',
            description: 'Produce a LabMat quote and scope from an assessment.',
            status: 'development'
          }
        ]
      },
      {
        slug: 'fabric-platform',
        name: 'Fabric Platform',
        headline: ['Fabric', 'Platform'],
        summary:
          'Microsoft Fabric capacity sizing and quote generation.',
        tiles: [
          {
            id: 'fabric-data-calculator',
            title: 'Data Calculator',
            description: 'Size capacity and storage from workload inputs.',
            status: 'development'
          },
          {
            id: 'fabric-quote-generator',
            title: 'Quote Generator',
            description: 'Produce a quote and scope from calculator output.',
            status: 'development'
          }
        ]
      }
    ]
  }
];

// ─── Tree navigation ─────────────────────────────────────────────────

export interface Resolved {
  /** The section the path points at. */
  section: Section;
  /**
   * Every section from the root down to and including `section`.
   * Used to build breadcrumbs without a second lookup.
   */
  trail: Section[];
}

/**
 * Resolve a path (e.g. `['data-ai', 'sap-bi-platforms']`) against the tree.
 *
 * Returns `undefined` for any unknown segment rather than the nearest
 * match — a wrong URL should 404, not silently land somewhere plausible.
 */
export function resolvePath(segments: string[]): Resolved | undefined {
  if (segments.length === 0) return undefined;

  const trail: Section[] = [];
  let pool: Section[] | undefined = SECTIONS;

  for (const segment of segments) {
    const match: Section | undefined = pool?.find((s) => s.slug === segment);
    if (!match) return undefined;
    trail.push(match);
    pool = match.children;
  }

  return { section: trail[trail.length - 1], trail };
}

/** URL for a section, given its trail. */
export function sectionHref(trail: Section[]): string {
  return `/area/${trail.map((s) => s.slug).join('/')}`;
}

/** Live tools anywhere beneath a section, inclusive. */
export function countLiveTiles(section: Section): number {
  const own = (section.tiles ?? []).filter((t) => t.status === 'live').length;
  const nested = (section.children ?? []).reduce(
    (sum, child) => sum + countLiveTiles(child),
    0
  );
  return own + nested;
}

/** All tools anywhere beneath a section, inclusive, regardless of status. */
export function countAllTiles(section: Section): number {
  const own = (section.tiles ?? []).length;
  const nested = (section.children ?? []).reduce(
    (sum, child) => sum + countAllTiles(child),
    0
  );
  return own + nested;
}
