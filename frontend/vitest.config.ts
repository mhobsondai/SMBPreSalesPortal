import { defineConfig } from 'vitest/config';

/*
 * Kept separate from `vite.config.ts` so the dev-server proxy config and
 * the test config cannot interfere with one another.
 *
 * Environment is `node`: everything under test is a pure module. Nothing
 * here renders React, by design — the tools put their logic in `lib/` so it
 * can be tested without a DOM.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Fixtures are read from disk, so give them a stable working directory.
    root: __dirname
  }
});
