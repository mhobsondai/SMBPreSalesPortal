/**
 * Navigation tree — the single source of truth for the whole portal.
 *
 * ## The model
 *
 * A `Section` is any navigable page. It may contain:
 *   - `children` — further sections (another level of navigation)
 *   - `tiles`    — leaf links to actual tools
 *   - both, if a section has its own tools *and* sub-sections
 *
 * The tree is walked by path, so **depth is unlimited and adding a level
 * requires no code change** — no new route, no new component, no new CSS.
 * `/area/data-ai/sap-bi-platforms/crystal/whatever` resolves as long as
 * the slugs exist here.
 *
 * That matters because the shape of this portal isn't known yet. Sections
 * will be added and reorganised as tools appear, and none of that should
 * require touching the router.
 *
 * ## Adding things
 *
 * A new tool → append a `Tile` to the right section's `tiles`.
 * A new grouping → append a `Section` to the right section's `children`.
 *
 * ## Slugs are URLs
 *
 * They appear in bookmarks people share. Renaming one breaks links, so
 * choose deliberately and prefer adding over renaming.
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
  /** Short label for cards, breadcrumbs and menus. */
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
    description: `The first ${subject} tool is being built. This tile will become a live link when it ships.`,
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
      'Microsoft Fabric, Power BI, Foundry, SAP BusinessObjects and Crystal Server pre-sales tooling — assessments, migration sizing and solution design.',
    children: [
      {
        slug: 'self-assessments',
        name: 'Self-Assessments',
        headline: ['Self-', 'Assessments'],
        summary:
          'Structured questionnaires clients complete themselves, producing the input for sizing, health checks and scoping conversations.',
        tiles: [placeholder('self-assessments', 'self-assessment')]
      },
      {
        slug: 'sap-bi-platforms',
        name: 'SAP BI Platforms',
        headline: ['SAP BI', 'Platforms'],
        summary:
          'SAP BusinessObjects and Crystal Server — health checks, upgrade and migration sizing, effort estimation and quote generation.',
        tiles: [placeholder('sap-bi', 'SAP BI Platforms')]
      },
      {
        slug: 'microsoft-platforms',
        name: 'Microsoft Platforms',
        headline: ['Microsoft', 'Platforms'],
        summary:
          'Microsoft Fabric, Power BI and Foundry — capacity sizing, workload assessment, migration planning and solution design.',
        tiles: [placeholder('microsoft-platforms', 'Microsoft Platforms')]
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
