import { createRequire } from 'node:module'

/**
 * **이 패키지의 버전.** `package.json` 에서 읽는다 — 문자열로 적어 두지 않는다.
 *
 * 적어 두면 낡는다. 실제로 낡았다: `extract/run.ts` 가 `'0.1.0'` 을 폴백으로 박아 두어
 * **0.2.0 으로 잰 세션이 `result.json` 에 "0.1.0 이 쟀다" 고 적었다.** 이 도구의 존재
 * 이유가 버전 A 와 B 의 비교인데 산출물이 자기 버전을 틀리게 말하면 그 비교의 기준이
 * 사라진다.
 *
 * `createRequire` 를 쓰는 이유: ESM 에서 JSON 을 임포트하면 실행 플래그가 필요하고
 * (`--experimental-json-modules` 이력), 번들러마다 처리가 갈린다. `dist/index.js` 기준
 * `../package.json` 은 npm 이 항상 tarball 에 넣으므로 설치본에서도 존재한다.
 */
export const TOOL_VERSION: string = (
  createRequire(import.meta.url)('../package.json') as { version: string }
).version
