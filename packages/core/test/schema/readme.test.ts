import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { COLLECTORS } from '../../src/collectors/registry.js'
import { METRIC_REASON_CODES } from '../../src/schema/reasons.js'
import {
  DiagnoseBlockSchema,
  ResultSchema,
  SCHEMA_VERSION,
  SliceBranchStatsSchema,
  SliceNameRowSchema,
} from '../../src/schema/result.js'

/**
 * README 가 스키마에 대해 **숫자로** 말하는 것들을 코드와 대조한다.
 *
 * 왜 이 파일이 있는가: 이 저장소는 같은 문장이 **두 번** 낡은 전적이 있다.
 * `reason_code` 개수는 M2 리뷰에서 6 → 21 로 고쳤는데 M3 가 30 으로 넓히는 동안 21 그대로
 * 남았다. 사람이 고치기로 한 규칙은 이미 두 번 실패했으므로 세 번째로 같은 규칙을 세우지
 * 않는다.
 *
 * 이 저장소가 같은 문제에 이미 쓰고 있는 해법을 문서에 적용한 것이다:
 * `insufficient_samples` 문장이 `POLL_PERIOD_MS` 를 읽고 `sdk_too_low` 가
 * `ANDROID_RELEASE_BY_SDK` 를 읽는 것 — **진실의 출처를 하나로 두고 나머지는 거기서
 * 끌어온다.** 마크다운은 런타임에 상수를 읽을 수 없으므로, 그 자리를 테스트가 대신한다.
 *
 * **숫자를 아예 빼는 선택지도 있었고 택하지 않았다.** 그 숫자는 장식이 아니라 소비자의
 * 유일한 자가진단 손잡이다: `1.1.0` 산출물끼리는 `schema_version` 이 같아서, 캐시해 둔 스키마가
 * 낡았는지 확인할 방법은 "내 파일의 enum 개수를 세어 이 숫자와 비교" 밖에 없다.
 * 숫자를 빼면 "그냥 다시 꺼내 보라" 만 남는다 — 확인이 아니라 권유다.
 *
 * 문장을 다시 쓰면 이 테스트가 "찾지 못했다" 로 실패한다. 그것이 의도한 동작이다 —
 * 고정된 문장을 고칠 때는 이 대조가 여전히 성립하는지 사람이 한 번 봐야 한다.
 */
const README = readFileSync(fileURLToPath(new URL('../../../../README.md', import.meta.url)), 'utf8')
const STATUS = readFileSync(fileURLToPath(new URL('../../../../docs/STATUS.md', import.meta.url)), 'utf8')
const CORE_AGENTS = readFileSync(fileURLToPath(new URL('../../AGENTS.md', import.meta.url)), 'utf8')
const RESULT_TS = readFileSync(fileURLToPath(new URL('../../src/schema/result.ts', import.meta.url)), 'utf8')

/** `### <제목>` 절 하나 — 다음 `## ` · `### ` 머리 전까지. */
function section(heading: string): string {
  const start = README.indexOf(`\n${heading}\n`)
  if (start < 0) return ''
  const rest = README.slice(start + heading.length + 2)
  const end = rest.search(/\n#{2,3} /)
  return end < 0 ? rest : rest.slice(0, end)
}

/**
 * 절 안에서 머리가 `| 필드 |` 인 표들의 첫 칸에 적힌 이름 전부. 한 칸에 `` `a` · `b` `` 처럼
 * 여럿이 있으면 다 센다. 표가 목록으로 말하는 것을 코드와 대조하는 데 쓴다.
 */
function fieldColumn(text: string): string[] {
  const names: string[] = []
  let inTable = false
  for (const line of text.split('\n')) {
    if (line.startsWith('| 필드 |')) {
      inTable = true
      continue
    }
    if (!line.startsWith('|')) {
      inTable = false
      continue
    }
    if (!inTable || line.startsWith('| ---')) continue
    const first = line.split('|')[1] ?? ''
    for (const m of first.matchAll(/`([^`]+)`/g)) names.push(m[1]!)
  }
  return names
}

/**
 * **지표 목록이 두 번 낡았다.** `metrics.frame` 을 접은 커밋이 README 를 136줄 줄였는데
 * 머리말의 표에는 `frame` 행이 남았고, 개수는 `지표 8개` 그대로였다. 링크(`#metricsframe`)는
 * 가리키는 절이 없어 죽어 있었는데 **아무 테스트도 그것을 몰랐다** — 이 파일은 그때
 * `reason_code` 개수와 `schema_version` 만 보고 있었다.
 *
 * npm 에 내면 이 README 가 그대로 패키지 페이지가 된다. 틀린 지표 목록은 이제 밖으로 나간다.
 */
describe('README 의 지표 목록', () => {
  const ids = COLLECTORS.map((c) => c.id)

  it('개수를 코드와 대조한다', () => {
    const m = /## 무엇을 재는가 — 지표 (\d+)개/.exec(README)
    expect(m, 'README 에서 지표 개수 문장을 찾지 못했다 — 문구를 바꿨다면 이 테스트도 함께 고칠 것').not.toBeNull()
    expect(Number(m![1])).toBe(ids.length)
  })

  it('등록된 지표가 전부 표에 있다', () => {
    const missing = ids.filter((id) => !README.includes(`[\`${id}\`](#metrics${id})`))
    expect(missing, 'README 표에 없는 지표').toEqual([])
  })
})

describe('README 가 스키마에 대해 말하는 숫자', () => {
  it('reason_code 개수가 METRIC_REASON_CODES 와 같다', () => {
    const m = /이 버전의 reason_code 값은 \*\*(\d+)개\*\*/.exec(README)
    expect(m, 'README 에서 reason_code 개수 문장을 찾지 못했다 — 문구를 바꿨다면 이 테스트도 함께 고칠 것').not.toBeNull()
    expect(Number(m![1])).toBe(METRIC_REASON_CODES.length)
  })

  it('schema_version 이 SCHEMA_VERSION 과 같다', () => {
    const m = /`schema_version` 이 그 계약의 버전입니다 \(현재 `([^`]+)`\)/.exec(README)
    expect(m, 'README 에서 schema_version 문장을 찾지 못했다').not.toBeNull()
    expect(m![1]).toBe(SCHEMA_VERSION)
  })

  /**
   * 숫자가 아니라 **사실**의 고정. `1.1.0` 시절 중간에 스키마를 캐시한 소비자가 깨지는 경로는
   * 셋이고 서로 독립적인데, `1.1.0` 산출물끼리는 `schema_version` 이 같아 다시 꺼내라는 신호가
   * 없다. 그 설명이 README 에서 사라지면 소비자는 조용히 깨진다. `1.2.0` 부터는 버전이 신호이고,
   * 진단 세션 산출물이 `1.1.0` 스키마에 걸리는 자리도 함께 적혀 있어야 한다 (DM-6).
   */
  it('캐시된 스키마가 깨지는 경로를 README 가 다 말한다 — 1.1.0 안의 셋과 1.2.0 의 진단 키', () => {
    const section = README.slice(README.indexOf('### 스키마를 다시 꺼내야 하는 때'))
    expect(section.length, '"스키마를 다시 꺼내야 하는 때" 절이 없다').toBeGreaterThan(0)

    // 경로 1 — thermal_zones 항목이 닫힌 객체다.
    expect(section).toContain('thermal_zones')
    expect(section).toContain('additionalProperties: false')
    // 경로 2 — reason_code 가 닫힌 enum 이다.
    expect(section).toContain('reason_code')
    // 경로 3 — cpu / log 의 필드 이름이 바뀌었다. 이름이 바뀐 것은 소비자가 **즉시** 알아야
    // 하는 종류의 변경이고(옛 이름을 읽으면 undefined 다), 그 사실이 여기 없으면
    // `schema_version` 이 같은 1.1.0 산출물끼리는 신호가 하나도 없다.
    expect(section).toContain('device_total_busy_pct')
    expect(section).toContain('log.device_total')
    // 그리고 왜 1.1.0 끼리는 신호가 없는지.
    expect(section).toContain('schema_version')
    expect(section).toMatch(/신호가 산출물 안에\s*\n?존재하지 않습니다/)
    // 1.2.0 부터는 버전이 신호이고, 진단 세션 산출물이 1.1.0 스키마에 걸리는 자리.
    expect(section).toContain('`1.2.0` 부터는 `schema_version` 이 신호입니다')
    expect(section).toContain('`diagnose` 키와 `options.diagnose`')
  })
})

describe('DM-6 schema_version 1.2.0', () => {
  it('DM-6 schema_version 1.2.0 — 1.1.0 은 출시됐으므로 진단 자리를 더한 지금은 1.2.0 이다', () => {
    expect(SCHEMA_VERSION).toBe('1.2.0')
  })

  /**
   * `1.1.0` 은 npm 0.1.0 ~ 0.2.1 로 나갔다. "출시된 적이 없다" 는 문장이 남으면 버전을 올리지
   * 않을 근거가 다시 생긴다 — 그 문장이 바로 1.1.0 안에서 계약을 넓히던 근거였다.
   */
  it('DM-6 schema_version 1.2.0 — "1.1.0 은 출시된 적이 없다" 는 문장이 코드 · README · STATUS 에 0', () => {
    const claim = /1\.1\.0[^\n]{0,40}(?:\n[^\n]{0,40})?출시된 적이 없/
    for (const [where, text] of [
      ['README.md', README],
      ['docs/STATUS.md', STATUS],
      ['packages/core/AGENTS.md', CORE_AGENTS],
      ['packages/core/src/schema/result.ts', RESULT_TS],
    ] as const) {
      expect(claim.exec(text)?.[0] ?? null, where).toBeNull()
    }
    expect(CORE_AGENTS).not.toContain('미출시 동안 올리지 않는다')
  })

  it('DM-6 README 최상위 구조 표가 ResultSchema 의 최상위 키와 같다 — diagnose 가 표에 있다', () => {
    const listed = fieldColumn(section('### 최상위 구조'))
    expect(listed.length, '「최상위 구조」 표를 찾지 못했다').toBeGreaterThan(0)
    expect([...listed].sort()).toEqual(Object.keys(ResultSchema.shape).sort())
  })
})

describe('DM-7 README 진단 블록 절', () => {
  it('DM-7 README 진단 블록 절의 필드 표가 스키마의 필드와 양방향으로 같다', () => {
    const listed = fieldColumn(section('### `diagnose`'))
    expect(listed.length, 'README 에서 「`diagnose`」 절의 필드 표를 찾지 못했다').toBeGreaterThan(0)
    const inSchema = [
      ...Object.keys(DiagnoseBlockSchema.shape),
      ...Object.keys(SliceNameRowSchema.shape),
      ...Object.keys(SliceBranchStatsSchema.shape),
    ]
    expect(listed.filter((k) => !inSchema.includes(k)), 'README 에만 있는 필드').toEqual([])
    expect(inSchema.filter((k) => !listed.includes(k)), '스키마에만 있는 필드').toEqual([])
  })

  it('DM-7 README 진단 블록 절이 합 ms 와 갈래 · 접기 · 순서 규칙을 말한다', () => {
    const text = section('### `diagnose`')
    expect(text).toContain('`sum_ms` 를 행끼리 더하지 마세요')
    expect(text).toContain('프레임워크 slice(am · wm · view)와 앱 slice 를 가르지 않습니다')
    expect(text).toContain('frametimeline')
    expect(text).toContain('UTF-16 코드 단위 순')
    expect(text).toContain('`app_slices_open_unknown`')
  })
})

describe('DM-14 README measurement_overhead', () => {
  it('DM-14 README measurement_overhead 절이 진단 세션 한정을 말한다', () => {
    const text = section('### `measurement_overhead`')
    expect(text).toContain('atrace slice 비용이 앱 프로세스에 청구되어')
    expect(text).toContain('평소 세션과 수치를 나란히 놓을 수 없습니다')
  })
})
