import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/test/device/**/*.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
})
