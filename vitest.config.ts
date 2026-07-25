import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    // on-device/ 는 실기기가 꽂혀 있어야 도는 테스트다. 기본 실행에서 뺀다.
    exclude: ['**/node_modules/**', 'packages/*/test/on-device/**'],
  },
})
