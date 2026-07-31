/**
 * Practice-area and tile registry.
 *
 * The whole navigation tree is data, not code. Adding a new tool means
 * appending a Tile to the relevant area — no new page component, no new
 * route, no CSS. Set `status: 'live'` and give it a `to` (internal route)
 * or `href` (external app) when it ships.
 *
 * Keep slugs stable: they appear in URLs and will end up in bookmarks.
 */

export type TileStatus = 'live' | 'development' | 'planned';

export interface Tile {
  id: string;
  title: string;
  description: string;
  status: TileStatus;
  /** Internal react-router route. Mutually exclusive with `href`. */
  to?: string;
  /** External URL — opens in a new tab. Mutually exclusive with `to`. */
  href?: string;
}

export interface PracticeArea {
  /** URL slug — /area/:slug */
  slug: string;
  /** Short label used on the landing page card and breadcrumbs. */
  name: string;
  /** Headline split so the second half can carry the orange accent. */
  headline: [string, string?];
  summary: string;
  tiles: Tile[];
}

export const PRACTICE_AREAS: PracticeArea[] = [
  {
    slug: 'infrastructure-365',
    name: 'Infrastructure & 365',
    headline: ['Infrastructure', '& 365'],
    summary:
      'Cloud platform, networking, identity, endpoint and Microsoft 365 pre-sales tooling — sizing, assessment and proposal support.',
    tiles: [
      {
        id: 'infra-placeholder',
        title: 'App in development',
        description:
          'The first Infrastructure & 365 tool is being built. This tile will become a live link when it ships.',
        status: 'development'
      }
    ]
  },
  {
    slug: 'erp',
    name: 'ERP',
    headline: ['ERP'],
    summary:
      'Business Central, SAP and finance-transformation pre-sales tooling — scoping, effort estimation and quote generation.',
    tiles: [
      {
        id: 'erp-placeholder',
        title: 'App in development',
        description:
          'The first ERP tool is being built. This tile will become a live link when it ships.',
        status: 'development'
      }
    ]
  },
  {
    slug: 'data-ai',
    name: 'Data & AI',
    headline: ['Data', '& AI'],
    summary:
      'Microsoft Fabric, Power BI, Foundry, SAP BusinessObjects and Crystal Server pre-sales tooling — assessments, migration sizing and solution design.',
    tiles: [
      {
        id: 'data-ai-placeholder',
        title: 'App in development',
        description:
          'The first Data & AI tool is being built. This tile will become a live link when it ships.',
        status: 'development'
      }
    ]
  }
];

export function findPracticeArea(slug: string | undefined): PracticeArea | undefined {
  return PRACTICE_AREAS.find((area) => area.slug === slug);
}
