import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { initialState } from '../src/web/state/model.js'
import { GUI_VERSION } from '../src/server/version.js'

/**
 * 화면 머리의 버전은 `package.json` 에서만 온다.
 *
 * `open` 이 `startGuiServer` 에 버전 문자열을 박아 넘겼고, 0.3.0 을 낸 뒤에도
 * 화면은 `v0.1.0` 을 말했다. 브라우저 쪽 초기 상태에도 같은 문자열이 있었다.
 * 그래서 넘겨받는 칸을 없앴고, 여기서 문자열이 되살아나는 것을 막는다.
 */
const SRC = fileURLToPath(new URL('../src', import.meta.url))

/** 목업은 기기 없이 화면을 띄우는 가짜 데이터라 버전도 가짜다 — `?mock` 일 때만 쓰인다. */
const ALLOWED = new Set(['web/api/mock.ts'])

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(name) ? [path] : []
  })
}

describe('GUI 버전', () => {
  it('package.json 과 같다', () => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { version: string }

    expect(GUI_VERSION).toBe(pkg.version)
  })

  it('서버가 알려 주기 전의 화면은 버전을 모른다', () => {
    expect(initialState().env.version).toBeNull()
  })

  it('소스에 버전 문자열을 박아 두지 않는다', () => {
    const hits = sourceFiles(SRC)
      .filter((path) => !ALLOWED.has(relative(SRC, path).split('\\').join('/')))
      .filter((path) => /version:\s*['"`]\d+\.\d+\.\d+/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(SRC, path))

    expect(hits, '버전 문자열이 박힌 파일').toEqual([])
  })
})
