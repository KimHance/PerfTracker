import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CLI_VERSION } from '../src/version.js'

/**
 * **버전을 두 곳에 적으면 한 곳이 낡는다. 실제로 낡았다.**
 *
 * `program.ts` 가 `.version('0.1.0')` 을 박아 두고 `extract/run.ts` 가 같은 문자열을
 * 폴백으로 갖고 있었다. 0.2.0 을 npm 에 낸 뒤에도 `perftracker --version` 은 `0.1.0` 을
 * 말했고, **그 버전이 `result.json` 의 `tool.version` 으로 그대로 실렸다.**
 *
 * 이 도구의 존재 이유가 버전 A 와 B 의 비교인데 산출물이 자기 버전을 틀리게 말하면
 * 무엇과 무엇을 비교했는지가 사라진다. 그래서 이것은 표기 문제가 아니라 데이터 문제다.
 */
describe('CLI 버전', () => {
  const pkg = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as { version: string }

  it('package.json 과 같다', () => {
    expect(CLI_VERSION).toBe(pkg.version)
  })

  /** 폴백 문자열이 되살아나는 것을 막는다 — 소스에 버전을 다시 적지 않는다. */
  it('소스에 버전 문자열을 박아 두지 않는다', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../src/program.ts', import.meta.url)),
      'utf8',
    )
    expect(src, 'program.ts 에 하드코딩된 버전').not.toMatch(/\.version\(['"]\d+\.\d+\.\d+['"]\)/)
  })
})
