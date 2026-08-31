import { createRequire } from 'node:module'

/**
 * **사용자가 설치한 `perftracker` 의 버전.** `package.json` 에서 읽는다.
 *
 * 여기 문자열을 적어 두면 릴리스마다 사람이 두 곳을 고쳐야 하고, 실제로 한 곳이 낡았다 —
 * 0.2.0 을 낸 뒤에도 `--version` 이 `0.1.0` 을 말했다. `packages/cli/test/version.test.ts`
 * 가 이 값과 `package.json` 을 대조한다.
 */
export const CLI_VERSION: string = (
  createRequire(import.meta.url)('../package.json') as { version: string }
).version
