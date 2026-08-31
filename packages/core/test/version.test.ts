import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TOOL_VERSION } from '../src/version.js'

/** `result.json` 의 `tool.version` 이 여기서 나온다. 자세한 사유는 cli 쪽 같은 테스트에 있다. */
describe('core 버전', () => {
  it('package.json 과 같다', () => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { version: string }
    expect(TOOL_VERSION).toBe(pkg.version)
  })

  it('폴백에 버전 문자열을 박아 두지 않는다', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../src/extract/run.ts', import.meta.url)),
      'utf8',
    )
    expect(src, 'run.ts 에 하드코딩된 폴백 버전').not.toMatch(/toolVersion \?\? ['"]\d+\.\d+\.\d+['"]/)
  })
})
