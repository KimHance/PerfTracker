import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  COPY_ADVICE_WORDS,
  COPY_EVAL_WORDS,
  DIAGNOSE_ATRACE_CATEGORIES,
  DIAGNOSE_MAX_DURATION_MS,
  copyViolations,
} from '@perftracker/core'
import { describe, expect, it } from 'vitest'
import { DIAGNOSE_MEASURE_COPY } from '../../src/web/format/diagnose.js'

/**
 * **진단 모드가 측정 화면에 새로 내는 문구** (DM-15 · 기능 문서 결정 9 · 10).
 *
 * 정본은 디자인 문서 `## 문구` 표다. 이 시험은 (1) 표의 gui 줄 중 **측정 화면 자리** 줄과 코드의 모음
 * (`DIAGNOSE_MEASURE_COPY`)이 양방향으로 같은지, (2) 각 문구가 문장이 아니라 단어 꼴인지를 본다.
 * 보고서 자리 gui 줄은 보고서 쪽 모음과 시험이 맡는다 — 여기서는 그 줄들이 "보고서 자리" 로 읽히는지만
 * 본다 (어느 쪽에도 안 드는 gui 줄이 생기면 아무 시험도 그 줄을 코드와 대조하지 않는다).
 *
 * 단어형 규칙의 주인은 core 의 `copyViolations` 하나다 (`copy/wordform.ts`) — gui 가 낱말 목록을
 * 따로 적으면 한 곳만 고쳐지는 날이 온다. 기존 문구(합쇼체)는 대상이 아니다 (plan D10).
 */
const DESIGN = readFileSync(
  fileURLToPath(new URL('../../../../docs/design/diagnostic-mode.md', import.meta.url)),
  'utf8',
)

/** `## 문구` 절 — 다음 `## ` 까지. */
function copySection(): string {
  const start = DESIGN.search(/^## 문구\s*$/m)
  if (start < 0) throw new Error('디자인 문서에 `## 문구` 절이 없다')
  const rest = DESIGN.slice(start + 1)
  const end = rest.search(/^## /m)
  return end < 0 ? rest : rest.slice(0, end)
}

/** 표 한 줄의 칸. `\|` 는 칸 안의 글자다. */
function cells(row: string): string[] {
  return row
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((c) => c.trim())
}

/** 표의 gui 줄 — `{ 자리, 문구 }`. 문구 칸은 백틱 하나로 감싼 원문 그대로 (안의 공백도). */
function guiRows(): { place: string; copy: string }[] {
  const rows = copySection()
    .split('\n')
    .filter((l) => l.startsWith('|'))
    .map(cells)
  const header = rows[0] ?? []
  const pkgAt = header.indexOf('패키지')
  const placeAt = header.indexOf('자리')
  const copyAt = header.indexOf('문구')
  if (pkgAt < 0 || placeAt < 0 || copyAt < 0) throw new Error('`## 문구` 표 머리에 `패키지` · `자리` · `문구` 칸이 없다')

  return rows
    .filter((c) => c[pkgAt] === 'gui')
    .map((c) => {
      const m = /^`([^`]+)`$/.exec(c[copyAt] ?? '')
      if (m === null) throw new Error(`문구 칸이 백틱 하나로 감싼 꼴이 아니다: ${c[copyAt]}`)
      return { place: c[placeAt] ?? '', copy: m[1]! }
    })
}

/**
 * 자리 칸으로 화면을 가른다. 측정 화면 = 04 세션 · 탭 스트립 · 측정 중 화면 · 기록 드로어 (디자인 문서
 * `## 화면` 의 `측정 ·` 행들). 새 gui 줄이 둘 중 어디에도 안 맞으면 아래 시험이 깨져 자리를 정하게 한다.
 */
const MEASURE_PLACES = ['04 ', '탭 배지', 'running ', '기록 드로어']
const REPORT_PLACES = ['보고서 ', '진단 탭', '카드 제목', 'slice 표', '측정 비용']

const isMeasure = (place: string): boolean => MEASURE_PLACES.some((p) => place.startsWith(p))
const isReport = (place: string): boolean => REPORT_PLACES.some((p) => place.startsWith(p))

const CODE_COPIES: string[] = Object.values(DIAGNOSE_MEASURE_COPY)

describe('DM-15 문구 표 ↔ 코드 (gui 측정)', () => {
  it('DM-15 문구 표 ↔ 코드 (gui 측정) — 표의 측정 화면 gui 줄과 모음이 양방향으로 같다', () => {
    const table = guiRows()
      .filter((r) => isMeasure(r.place))
      .map((r) => r.copy)

    // 표에만 있는 문구 · 코드에만 있는 문구 둘 다 0. 같은 글자(`진단`)가 두 자리에 있으므로 개수까지 본다.
    expect(table.filter((t) => !CODE_COPIES.includes(t)), '표에만 있음').toEqual([])
    expect(CODE_COPIES.filter((c) => !table.includes(c)), '코드에만 있음').toEqual([])
    expect([...table].sort()).toEqual([...CODE_COPIES].sort())
  })

  it('DM-15 문구 표 ↔ 코드 (gui 측정) — 표의 gui 줄은 전부 측정 화면이나 보고서 자리다', () => {
    const rows = guiRows()
    expect(rows.filter((r) => !isMeasure(r.place) && !isReport(r.place)), '어느 화면에도 안 드는 줄').toEqual([])
    expect(rows.filter((r) => isMeasure(r.place) && isReport(r.place)), '두 화면에 다 드는 줄').toEqual([])
  })

  it('DM-15 문구 표 ↔ 코드 (gui 측정) — 표가 실제로 읽혀야 이 시험이 의미를 갖는다', () => {
    // 표를 못 읽어 빈 배열끼리 비교하면 위 단언은 무조건 통과한다. 측정 화면 자리는 다섯
    // (04 옵션 행 · 탭 배지 · 킥커 꼬리 · 각주 둘째 줄 · 드로어 메타 꼬리).
    expect(guiRows().filter((r) => isMeasure(r.place))).toHaveLength(5)
    expect(guiRows().filter((r) => isReport(r.place)).length).toBeGreaterThan(0)
  })
})

describe('DM-15 단어형 규칙 (gui 측정)', () => {
  it('DM-15 단어형 규칙 (gui 측정) — 측정 화면 진단 문구가 전부 단어 꼴이다', () => {
    const broken = CODE_COPIES.map((c) => ({ c, v: copyViolations(c) })).filter((x) => x.v.length > 0)
    expect(broken).toEqual([])
  })

  /**
   * **규칙마다 깨 본다** — 검사기가 실패할 수 있다는 것이 증거다. 각 규칙을 어긴 꼴을 실제 측정 화면
   * 문구에 덧붙여 그 규칙 이름이 나오는지 본다.
   */
  it.each([
    ['끝=다', `${DIAGNOSE_MEASURE_COPY.footnote} 기록한다`],
    ['끝=다', `${DIAGNOSE_MEASURE_COPY.drawerTag}이다.`],
    ['끝=요', `${DIAGNOSE_MEASURE_COPY.optionDesc} 켜져요 `],
    ['니다', `${DIAGNOSE_MEASURE_COPY.kickerTail} 중입니다 · 진단`],
    ...COPY_ADVICE_WORDS.map((w) => [`권유:${w}`, `${DIAGNOSE_MEASURE_COPY.footnote} ${w} 진단`]),
  ])('DM-15 단어형 규칙 (gui 측정) — 깨 봄: %s', (rule, sample) => {
    expect(copyViolations(sample)).toContain(rule)
  })

  /** 평가 낱말은 목록의 낱말마다 — 받아들임 기준이 이름을 댄 넷(`느림` · `빨라짐` · `빨리` · `나빠짐`)도. */
  it.each([
    ...COPY_EVAL_WORDS.map((w) => [w, `${DIAGNOSE_MEASURE_COPY.tabBadge} ${w}`]),
    ['느림', '진단 세션 느림'],
    ['빨라', '프레임 빨라짐'],
    ['빨리', '빨리 열림'],
    ['나빠', '시작 시간 나빠짐'],
  ])('DM-15 단어형 규칙 (gui 측정) — 깨 봄: 평가 %s', (word, sample) => {
    expect(copyViolations(sample)).toContain(`평가:${word}`)
  })
})

/**
 * 값 자리 없는 고정 문구가 코드의 사실을 숫자 · 목록으로 말한다 — 그 사실이 바뀌면 문구도 같이
 * 바뀌어야 하므로 core 상수와 대조한다 (루트 AGENTS.md 「문서가 숫자로 말하면 대조 시험」).
 * 측정 화면 계약에는 최대 시간 필드가 없어서(plan D20) 10분은 이 문구로만 말해진다.
 */
describe('DM-17 측정 화면 진단 문구의 숫자 · 범위', () => {
  it('DM-17 측정 화면 진단 문구의 최대 시간이 DIAGNOSE_MAX_DURATION_MS 와 같다', () => {
    const minutes = DIAGNOSE_MAX_DURATION_MS / 60_000
    expect(DIAGNOSE_MEASURE_COPY.optionDesc).toContain(`최대 ${minutes}분`)
    expect(DIAGNOSE_MEASURE_COPY.footnote).toContain(`최대 ${minutes}분`)
  })

  it('DM-3 04 옵션 행 설명의 범위가 DIAGNOSE_ATRACE_CATEGORIES 와 같다', () => {
    expect(DIAGNOSE_MEASURE_COPY.optionDesc).toContain(`(${DIAGNOSE_ATRACE_CATEGORIES.join(' · ')} + 대상 앱)`)
  })
})
