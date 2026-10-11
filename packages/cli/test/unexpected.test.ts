import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { UNEXPECTED_ERROR_HEAD, unexpectedErrorText } from '../src/unexpected.js'

/**
 * **예상 못 한 오류의 머리 문장은 한 곳** (검수 왕복 1 #3) — 진입점(`index.ts`)과 compile 뒤 실패의 되돌림 줄
 * (`commands/compile.ts`)이 같은 상수를 부른다. 문자열째 두 벌이면 한쪽만 고쳐져 같은 오류가 다른 머리로 나간다.
 */
const SRC = fileURLToPath(new URL('../src/', import.meta.url))

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  )
}

describe('BP-5 예상 못 한 오류 머리는 한 곳', () => {
  it('BP-5 예상 못 한 오류 머리는 한 곳 — src 에서 그 문장은 unexpected.ts 하나에만', () => {
    const holders = sources(SRC).filter((f) => readFileSync(f, 'utf8').includes(UNEXPECTED_ERROR_HEAD))
    expect(holders.map((f) => f.slice(SRC.length))).toEqual(['unexpected.ts'])
  })

  it('BP-5 예상 못 한 오류 머리는 한 곳 — 진입점 · compile 이 같은 함수를 부른다', () => {
    for (const f of ['index.ts', 'commands/compile.ts']) {
      expect(readFileSync(join(SRC, f), 'utf8')).toContain('unexpectedErrorText(')
    }
  })

  it('BP-5 예상 못 한 오류 머리는 한 곳 — 머리 다음 줄에 스택', () => {
    const e = new TypeError('boom')
    expect(unexpectedErrorText(e)).toBe(`${UNEXPECTED_ERROR_HEAD}\n${e.stack}`)
    expect(unexpectedErrorText('문자열')).toBe(`${UNEXPECTED_ERROR_HEAD}\n문자열`)
  })
})
