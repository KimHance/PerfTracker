import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { METRIC_REASON_CODES } from '../../src/schema/reasons.js'
import { DexoptLineSchema, ResultSchema, TargetAppSchema, WARNING_CODES } from '../../src/schema/result.js'

/**
 * README 가 컴파일 상태(기능 문서 baseline-profile BP-1 ~ BP-3)에 대해 **목록 · 사실**로 말하는 것을 코드와
 * 대조한다. 개수 문장(reason_code 43개)은 `readme.test.ts` 의 기존 시험이 본다.
 */
const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const README = read('../../../../README.md')
const STATUS = read('../../../../docs/STATUS.md')
const CORE_AGENTS = read('../../AGENTS.md')
const RESULT_TS = read('../../src/schema/result.ts')

/** `### <제목>` 절 하나 — 다음 `## ` · `### ` 머리 전까지. */
function section(heading: string): string {
  const start = README.indexOf(`\n${heading}\n`)
  if (start < 0) return ''
  const rest = README.slice(start + heading.length + 2)
  const end = rest.search(/\n#{2,3} /)
  return end < 0 ? rest : rest.slice(0, end)
}

/** 머리가 `head` 로 시작하는 표의 첫 칸에 적힌 `` `이름` `` 전부. */
function firstColumn(text: string, head: string): string[] {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => l.startsWith(head))
  if (start < 0) return []
  const names: string[] = []
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break
    for (const m of (line.split('|')[1] ?? '').matchAll(/`([^`]+)`/g)) names.push(m[1]!)
  }
  return names
}

describe('BP-1 README 1.2.0 문단', () => {
  /**
   * 결정 7 — 컴파일 상태는 모든 세션에 실리고 `target_app` 은 닫힌 객체다. 그 말이 README 에 없으면 1.1.0 스키마를
   * 캐시한 소비자는 평소 세션 산출물이 왜 거부되는지 모른다. 사실의 근거(`additionalProperties: false`)도 여기서 본다.
   */
  it('BP-1 README 1.2.0 문단 — 평소 산출물도 1.1.0 이 거부 (target_app 이 닫힌 객체)', () => {
    const json = z.toJSONSchema(ResultSchema) as unknown as {
      properties: { target_app: { additionalProperties?: unknown; properties: Record<string, unknown> } }
    }
    expect(json.properties.target_app.additionalProperties).toBe(false)
    expect(Object.keys(json.properties.target_app.properties)).toContain('compile_state_start')

    const intro = /> \*\*`1\.2\.0` 은[\s\S]*?\n\n/.exec(README)?.[0] ?? ''
    expect(intro, 'README 1.2.0 문단을 찾지 못했다').not.toBe('')
    expect(intro).toContain('**모든 세션**의 `target_app`')
    expect(intro).toContain('평소 세션의\n> `result.json` 도 `1.1.0` 과 키가 다릅니다')
    expect(intro).toContain('평소 세션 산출물도 거부합니다')

    const cache = section('### 스키마를 다시 꺼내야 하는 때')
    expect(cache).toContain('**`1.2.0` 산출물은 평소 세션의 것도 `1.1.0` 스키마가 거부합니다.**')
    expect(cache).toContain('`target_app` 이\n  `additionalProperties: false`')
  })

  it('BP-1 "평소 세션 산출물은 1.1.0 과 키가 같다" 는 문장이 README · STATUS · core AGENTS · result.ts 에 0', () => {
    // 줄바꿈 · 인용(`>`) · 백틱을 걷어 한 줄로 — 문장이 어떻게 꺾여 있든 같은 말이면 걸린다. "같지 않다" 는 걸리지 않는다.
    const flat = (t: string): string => t.replace(/\n\s*>?\s*/g, ' ').replaceAll('`', '')
    const claim =
      /평소[\s\S]{0,40}?(?:1\.1\.0 ?(?:과|와) 키가 같(?!지)|키가 1\.1\.0 ?(?:과|와) 같(?!지)|키는 1\.1\.0 ?(?:과|와) 같(?!지)|키 하나 다르지 않)/
    for (const [where, text] of [
      ['README.md', README],
      ['docs/STATUS.md', STATUS],
      ['packages/core/AGENTS.md', CORE_AGENTS],
      ['packages/core/src/schema/result.ts', RESULT_TS],
    ] as const) {
      expect(claim.exec(flat(text))?.[0] ?? null, where).toBeNull()
    }
    // 이 정규식이 옛 문장들을 실제로 잡는다는 것 — 걸러야 할 것을 못 거르는 시험은 증거가 아니다.
    for (const old of [
      '평소 세션 산출물은 키가 `1.1.0` 과 같아 그대로 통과합니다.',
      '평소 세션의 `result.json` 은 `1.1.0` 과\n> 키가 같고',
      '평소 세션 `result.json` 의 키는 1.1.0 과 같다.',
      '평소 세션의 result.json 은\n// 1.1.0 과 키가 같고',
      '평소 세션의 `result.json` 은 키 하나 다르지 않습니다.',
    ]) {
      expect(claim.test(flat(old)), old).toBe(true)
    }
    expect(claim.test(flat('평소 세션의 키가 1.1.0 과 같지는 않다'))).toBe(false)
  })
})

describe('BP-1 README 컴파일 상태 절', () => {
  it('BP-1 README 컴파일 상태 필드 표가 스키마와 양방향으로 같다', () => {
    const listed = firstColumn(section('### `target_app` 의 컴파일 상태'), '| 필드 |')
    expect(listed.length, '「`target_app` 의 컴파일 상태」 필드 표를 찾지 못했다').toBeGreaterThan(0)
    const inSchema = [
      ...Object.keys(TargetAppSchema.shape).filter((k) => k.startsWith('compile_state_')),
      ...Object.keys(DexoptLineSchema.shape),
    ]
    expect(listed.filter((k) => !inSchema.includes(k)), 'README 에만 있는 필드').toEqual([])
    expect(inSchema.filter((k) => !listed.includes(k)), '스키마에만 있는 필드').toEqual([])
  })

  it('BP-1 README 예시 dex 줄이 스키마를 그대로 통과한다', () => {
    const json = /```json\n([\s\S]*?)\n```/.exec(section('### `target_app` 의 컴파일 상태'))?.[1]
    expect(json, '예시 JSON 을 찾지 못했다').toBeDefined()
    const example = JSON.parse(json!) as Record<string, unknown>
    expect(Object.keys(example)).toEqual(Object.keys(DexoptLineSchema.shape))
    expect(DexoptLineSchema.parse(example)).toEqual(example)
  })

  it('BP-2 README 가 컴파일 상태의 reason_code 넷을 전부 말하고, 그 넷이 enum 에 있다', () => {
    const text = section('### `target_app` 의 컴파일 상태')
    const named = [...new Set([...text.matchAll(/`(dexopt_state_[a-z_]+)`/g)].map((m) => m[1]!))].sort()
    const inEnum = METRIC_REASON_CODES.filter((c) => c.startsWith('dexopt_state_')).sort()
    expect(named).toEqual(inEnum)
    expect(inEnum).toHaveLength(4)
  })

  /** 검수 #3 — 사유 문장(`renderReason`)은 갈래 셋을 말하는데 README 가 둘만 말했다. 셋 다 README 에 있어야 한다. */
  it('BP-2 README 가 dexopt_state_unavailable 의 갈래 셋(기기 끊김 · stop 전 extract · 끝 상태 이전 도구)을 말한다', () => {
    const bullet = /`dexopt_state_unavailable`\(([^)]*)\)/.exec(section('### `target_app` 의 컴파일 상태'))?.[1] ?? ''
    expect(bullet).toContain('기기 끊김')
    expect(bullet).toContain('아직 `stop` 하지 않은 세션을 `extract`')
    expect(bullet).toContain('끝 상태를 읽기 전의 도구로 `stop` 한 run')
  })

  it('BP-1 README 가 두 status 의 뜻을 갈라 적는다 (결정 14)', () => {
    const text = section('### `target_app` 의 컴파일 상태')
    expect(text).toContain('**compiler filter**')
    expect(text).toContain('oat 파일 상태')
    expect(DexoptLineSchema.shape.status.description).toContain('같은 낱말 다른 뜻')
  })
})

/** `packages/core/src` 아래 .ts 전부. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : []
  })
}

describe('BP-3 README 경고 목록', () => {
  it('BP-3 README 경고 목록 ↔ WARNING_CODES — 양방향으로 같다', () => {
    const listed = firstColumn(section('### `warnings`'), '| `code` |')
    expect(listed.length, 'README 「`warnings`」 표를 찾지 못했다').toBeGreaterThan(0)
    expect([...listed].sort()).toEqual([...WARNING_CODES].sort())
  })

  /**
   * 목록이 코드보다 낡지 않게 — 경고는 `{ code: '…', message: … }` 꼴로만 만들어진다. 그 자리를 소스에서 다
   * 모아 WARNING_CODES 와 맞춘다. 새 경고를 더하고 목록 · README 를 안 고치면 여기서 깨진다.
   */
  it('BP-3 코드가 내는 경고 code 가 전부 WARNING_CODES 에 있다 (compile_state_changed 포함)', () => {
    const root = fileURLToPath(new URL('../../src', import.meta.url))
    const emitted = new Set<string>()
    for (const file of sources(root)) {
      for (const m of readFileSync(file, 'utf8').matchAll(/code: '([a-z_]+)',\s*message:/g)) emitted.add(m[1]!)
    }
    expect([...emitted].sort()).toEqual([...WARNING_CODES].sort())
  })
})
