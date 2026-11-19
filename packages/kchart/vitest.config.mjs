import { defineConfig } from 'vitest/config';

// `npm test` builds dist once, then runs every test file; tests import src/ modules directly or the
// built dist/esm/node.js when they need the assembled Node API.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.mjs'],
    globalSetup: ['tests/build/global-setup.mjs'],
    environment: 'node',
  },
});
