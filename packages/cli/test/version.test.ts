import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
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
  ) as { version: string; dependencies?: Record<string, string> }

  it('package.json 과 같다', () => {
    expect(CLI_VERSION).toBe(pkg.version)
  })

  /**
   * 폴백 문자열이 되살아나는 것을 막는다 — 소스 어디에도 버전을 다시 적지 않는다.
   * 처음엔 `program.ts` 만 봤는데, 그 사이 `open.ts` 가 화면에 `'0.1.0'` 을 넘기고 있었다.
   */
  it('소스에 버전 문자열을 박아 두지 않는다', () => {
    const root = fileURLToPath(new URL('../src', import.meta.url))
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) return files(path)
        return name.endsWith('.ts') ? [path] : []
      })
    const hits = files(root)
      .filter((path) =>
        /\.version\(['"`]\d+\.\d+\.\d+|version:\s*['"`]\d+\.\d+\.\d+/.test(readFileSync(path, 'utf8')),
      )
      .map((path) => relative(root, path))

    expect(hits, '버전 문자열이 박힌 파일').toEqual([])
  })

  /**
   * 화면 머리의 버전은 gui 가 자기 `package.json` 에서 읽는다. 그 값이 사용자가 설치한
   * `perftracker` 와 같으려면 세 패키지가 같은 버전으로 나가야 하고, 서로를 그 버전으로 물어야 한다.
   */
  it('세 패키지가 같은 버전으로 나간다', () => {
    const read = (rel: string) =>
      JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')) as {
        version: string
        dependencies?: Record<string, string>
      }
    const core = read('../../core/package.json')
    const gui = read('../../gui/package.json')

    expect(core.version).toBe(pkg.version)
    expect(gui.version).toBe(pkg.version)
    expect(gui.dependencies?.['@perftracker/core']).toBe(pkg.version)
    expect(pkg.dependencies?.['@perftracker/core']).toBe(pkg.version)
    expect(pkg.dependencies?.['@perftracker/gui']).toBe(pkg.version)
  })
})
