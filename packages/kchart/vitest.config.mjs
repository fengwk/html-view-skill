import { defineConfig } from 'vitest/config';

// `npm test` runs only the build smoke tests; the legacy vm-based tests are replaced by the
// test-migration slices and do not run here.
export default defineConfig({
  test: {
    include: ['tests/build/**/*.test.mjs'],
    globalSetup: ['tests/build/global-setup.mjs'],
    environment: 'node',
  },
});
