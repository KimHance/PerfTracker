import { createRequire } from 'node:module'

/**
 * 화면 머리에 뜨는 버전. 이 패키지의 `package.json` 에서 읽는다.
 *
 * 예전에는 `open` 이 `startGuiServer` 에 버전 문자열을 박아 넘겼고, 0.3.0 을 낸 뒤에도
 * 화면에 `v0.1.0` 이 떴다. 넘겨받는 칸이 있으면 누군가 또 박아 넣는다 —
 * 그래서 칸을 없애고 여기서 읽는다.
 *
 * 세 패키지는 같은 버전으로 함께 나간다 (`packages/cli/test/version.test.ts` 가 대조한다).
 * 그래서 이 값이 사용자가 설치한 `perftracker` 의 버전과 같다.
 *
 * 경로: `dist/server/version.js` 기준 `../../package.json`. npm 은 `package.json` 을
 * 항상 tarball 에 넣으므로 설치본에서도 있다.
 */
export const GUI_VERSION: string = (
  createRequire(import.meta.url)('../../package.json') as { version: string }
).version
