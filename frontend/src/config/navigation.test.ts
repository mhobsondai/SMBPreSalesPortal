/**
 * Navigation invariants.
 *
 * CLAUDE.md and AD-03 assert these are "covered by test". Until this file
 * existed they were not — see AD-10.
 */

import { describe, expect, it } from 'vitest';

import { SECTIONS, countAllTiles, countLiveTiles, resolvePath, type Section, type Tile } from './navigation';

function allTiles(sections: readonly Section[] = SECTIONS): Tile[] {
  return sections.flatMap((section) => [
    ...(section.tiles ?? []),
    ...allTiles(section.children ?? [])
  ]);
}

function allSections(sections: readonly Section[] = SECTIONS): Section[] {
  return sections.flatMap((section) => [section, ...allSections(section.children ?? [])]);
}

describe('tile ids', () => {
  it('are globally unique', () => {
    const ids = allTiles().map((t) => t.id);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(duplicates).toEqual([]);
  });

  it('are unique even where two sections share a tile title', () => {
    // The case AD-03 calls out: two "Quote Generator" tiles.
    const quoteGenerators = allTiles().filter((t) => t.title === 'Quote Generator');
    expect(quoteGenerators.length).toBeGreaterThan(1);
    expect(new Set(quoteGenerators.map((t) => t.id)).size).toBe(quoteGenerators.length);
  });
});

describe('live tiles', () => {
  it('always have a destination', () => {
    const broken = allTiles()
      .filter((t) => t.status === 'live')
      .filter((t) => !t.to && !t.href)
      .map((t) => t.id);
    expect(broken).toEqual([]);
  });

  it('never carry both an internal route and an external href', () => {
    const both = allTiles().filter((t) => t.to && t.href).map((t) => t.id);
    expect(both).toEqual([]);
  });
});

describe('slugs', () => {
  it('are unique among siblings', () => {
    for (const section of [{ children: SECTIONS } as unknown as Section, ...allSections()]) {
      const slugs = (section.children ?? []).map((c) => c.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
    }
  });
});

describe('resolvePath', () => {
  it('resolves a top-level section', () => {
    const resolved = resolvePath(['data-ai']);
    expect(resolved?.section.slug).toBe('data-ai');
    expect(resolved?.trail.map((s) => s.slug)).toEqual(['data-ai']);
  });

  it('resolves a nested section and builds the full trail', () => {
    const resolved = resolvePath(['data-ai', 'sap-bi-platform']);
    expect(resolved?.section.name).toBe('SAP BI Platform');
    expect(resolved?.trail.map((s) => s.slug)).toEqual(['data-ai', 'sap-bi-platform']);
  });

  it('returns undefined for an unknown segment rather than the nearest match', () => {
    // The invariant that makes a stale bookmark 404 instead of landing
    // somewhere plausible.
    expect(resolvePath(['data-ai', 'sap-bi-platforms'])).toBeUndefined();
    expect(resolvePath(['nope'])).toBeUndefined();
    expect(resolvePath(['data-ai', 'assessments', 'deeper'])).toBeUndefined();
  });

  it('returns undefined for an empty path', () => {
    expect(resolvePath([])).toBeUndefined();
  });
});

describe('counts', () => {
  it('countAllTiles includes nested tiles', () => {
    const dataAi = resolvePath(['data-ai'])!.section;
    expect(countAllTiles(dataAi)).toBe(
      (dataAi.children ?? []).reduce((n, c) => n + (c.tiles ?? []).length, 0)
    );
  });

  it('countLiveTiles counts only live tiles', () => {
    const dataAi = resolvePath(['data-ai'])!.section;
    const live = allTiles(dataAi.children ?? []).filter((t) => t.status === 'live').length;
    expect(countLiveTiles(dataAi)).toBe(live);
  });
});
