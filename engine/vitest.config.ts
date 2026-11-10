import { defineConfig } from 'vitest/config';

// The full-game simulation takes ~45-65 s on a cloud machine (a few seconds on a Mac). The 5 s default timed it out
// there, so allow 3 minutes per test: a real hang still fails, a slow machine doesn't.
export default defineConfig({
  test: { testTimeout: 180_000, hookTimeout: 180_000 },
});
