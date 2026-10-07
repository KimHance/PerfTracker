import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DIAGNOSE_COPY, fillCopy } from '../../src/copy/diagnose.js'
import { COPY_ADVICE_WORDS, COPY_EVAL_WORDS, copyLastChar, copyViolations } from '../../src/copy/wordform.js'
import { renderReason } from '../../src/schema/reasons.js'

/**
 * 진단 모드가 새로 내는 core 문구 (기능 문서 DM-15 · 결정 9).
 *
 * **정본은 디자인 문서 `## 문구` 표다.** 이 시험은 표의 core 줄과 코드의 모음(`DIAGNOSE_COPY`)을
 * 양방향으로 대조한다 — 표에만 있거나 코드에만 있는 문구가 생기면 깨진다. 문구를 바꾸려면 표를
 * 먼저 고친다. diag-capture 가 실은 doctor · 고지 줄과 이 단위의 reason 줄이 같은 모음에 있다.
 */
const DESIGN = readFileSync(
  fileURLToPath(new URL('../../../../docs/design/diagnostic-mode.md', import.meta.url)),
  'utf8',
)
const SPEC = readFileSync(fileURLToPath(new URL('../../../../docs/spec/diagnostic-mode.md', import.meta.url)), 'utf8')

/**
 * 기능 문서 DM-15 행이 적은 닫힌 목록 — `from` 뒤 `to` 앞의 백틱 낱말들. 규칙 목록의 정본은
 * 기능 문서이고, 코드의 목록이 거기서 한 낱말이라도 빠지면 그 낱말의 표본도 함께 사라져
 * "걸려야 할 표본" 시험이 아무것도 못 지킨다. 그래서 표본은 코드가 아니라 기능 문서에서 만든다.
 */
function specList(from: string, to: string): string[] {
  const row = SPEC.split('\n').find((l) => l.startsWith('| DM-15 '))
  expect(row, '기능 문서에서 DM-15 행을 찾지 못했다').toBeDefined()
  const start = row!.indexOf(from)
  const end = row!.indexOf(to, start)
  expect(start > -1 && end > start, `DM-15 행에서 「${from}」 ~ 「${to}」 를 찾지 못했다`).toBe(true)
  return [...row!.slice(start, end).matchAll(/`([^`]+)`/g)].map((m) => m[1]!)
}
const SPEC_EVAL = specList('닫힌 목록(결정 10):', '규칙마다')
const SPEC_ADVICE = specList('권유 · 1인칭(', ')')

interface CopyRow {
  pkg: string
  place: string
  copy: string
}

/** `## 문구` 절의 표 — 열: 패키지 · 자리 · 문구(백틱 하나) · 뜻 · 안 쓰는 말. */
function copyTable(markdown: string): CopyRow[] {
  const lines = markdown.split('\n')
  const start = lines.indexOf('## 문구')
  expect(start, '디자인 문서에 「## 문구」 절이 없다').toBeGreaterThan(-1)
  const rows: CopyRow[] = []
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break
    if (!line.startsWith('|') || line.startsWith('|---') || line.startsWith('| 패키지')) continue
    const cells = line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
    const m = /^`([^`]+)`$/.exec(cells[2] ?? '')
    expect(m, `문구 칸이 백틱 하나가 아니다: ${line}`).not.toBeNull()
    rows.push({ pkg: cells[0]!, place: cells[1]!, copy: m![1]! })
  }
  return rows
}

const TABLE = copyTable(DESIGN)
const CORE_ROWS = TABLE.filter((r) => r.pkg === 'core')
const CODE = Object.values(DIAGNOSE_COPY) as string[]

describe('DM-15 문구 표 ↔ 코드 (core)', () => {
  it('DM-15 문구 표 ↔ 코드 — 표의 core 줄과 DIAGNOSE_COPY 가 양방향으로 같다', () => {
    const inTable = CORE_ROWS.map((r) => r.copy)
    expect(inTable.length, '표에 core 줄이 없다').toBeGreaterThan(0)
    expect(inTable.filter((c) => !CODE.includes(c)), '표에만 있는 core 문구').toEqual([])
    expect(CODE.filter((c) => !inTable.includes(c)), '코드에만 있는 core 문구').toEqual([])
    // 같은 문구가 표에 두 번 있으면 한쪽 자리를 고칠 때 다른 쪽이 조용히 낡는다.
    expect(new Set(inTable).size).toBe(inTable.length)
  })

  it('DM-15 문구 표 ↔ 코드 — 새 reason 문구는 reason_code 렌더러가 모음에서 꺼내 쓴다', () => {
    expect(renderReason({ code: 'app_slices_open_unknown', detail: { sdk_int: 30, debuggable: false } })).toBe(
      fillCopy(DIAGNOSE_COPY.reasonNotDebuggable, { sdk: 30 }),
    )
    expect(renderReason({ code: 'app_slices_open_unknown', detail: { sdk_int: 30, debuggable: null } })).toBe(
      fillCopy(DIAGNOSE_COPY.reasonDebuggableUnknown, { sdk: 30 }),
    )
  })
})

describe('DM-15 단어형 규칙 (core)', () => {
  it('DM-15 단어형 규칙 — core 모음의 문구마다 어긴 규칙 0', () => {
    const bad = CODE.map((c) => [c, copyViolations(c)] as const).filter(([, v]) => v.length > 0)
    expect(bad).toEqual([])
  })

  it('DM-15 단어형 규칙 — 값을 채운 문구도 규칙 0 (자리표시 뒤에 숨은 끝 글자가 없다)', () => {
    for (const c of CODE) expect(copyViolations(fillCopy(c, { sdk: 30 })), c).toEqual([])
  })

  /**
   * 규칙이 실제로 걸리는지 — 규칙마다, 평가 낱말은 목록의 낱말마다 그것을 넣은 표본이 걸려야 한다.
   * 통과하는 시험은 증거가 아니다. 표본은 디자이너 검사기(`check_copy.py --break`)와 같다.
   */
  it('DM-15 단어형 규칙 — 평가 낱말 · 권유 목록이 기능 문서 DM-15 의 닫힌 목록과 같다', () => {
    expect(SPEC_EVAL).toHaveLength(28)
    expect([...COPY_EVAL_WORDS]).toEqual(SPEC_EVAL)
    expect([...COPY_ADVICE_WORDS]).toEqual(SPEC_ADVICE)
  })

  it('DM-15 단어형 규칙 — 규칙 · 낱말마다 걸려야 할 표본이 그 규칙으로 걸린다', () => {
    const mustFail: [string, string][] = [
      ['진단 세션을 시작한다', '끝=다'],
      ['시작했어요', '끝=요'],
      ['slice 를 셌다.', '끝=다'],
      ['시작한다 {n}', '끝=다'],
      ['앱 slice 열림 모름 — sdk 30 · debuggable 아님입니다', '니다'],
      ['다시 실행하세요', '권유:세요'],
      ['재시작하십시오', '권유:십시오'],
      ['바랍니다 확인', '권유:바랍니다'],
      ['확인해야 함', '권유:해야'],
      ['안내 드립니다', '권유:드립니다'],
      ['저희 측정', '권유:저희'],
      ...SPEC_EVAL.map((w) => [`slice ${w}`, `평가:${w}`] as [string, string]),
      // 명사형 · 불규칙 활용형 (결정 10) — 어간만으로는 못 잡던 것.
      ['프레임 느림', '평가:느림'],
      ['시작 빨라짐', '평가:빨라'],
      ['빨리 끝남', '평가:빨리'],
      ['응답 나빠짐', '평가:나빠'],
    ]
    for (const [sample, rule] of mustFail) expect(copyViolations(sample), sample).toContain(rule)
    for (const w of SPEC_ADVICE) expect(mustFail.some(([, r]) => r === `권유:${w}`), w).toBe(true)
  })

  it('DM-15 단어형 규칙 — 걸리면 안 될 표본은 통과한다 (`좋` 이 `조회` 에 걸리지 않는다)', () => {
    const mustPass = [
      '진단',
      'slice 비용 앱 프로세스 몫 · 평소 세션과 비교 불가',
      '앱 프로세스 몫 미포함',
      '조회',
      '—',
      '▲',
      '진단 {elapsed}',
      'sdk {sdk} · 열림',
      'diagnose: app slice',
    ]
    for (const sample of mustPass) expect(copyViolations(sample), sample).toEqual([])
    // NFD 로 저장된 문구도 같은 결과다 — 음절로 맞춘 뒤 비교한다.
    expect(copyViolations('프레임 느림'.normalize('NFD'))).toContain('평가:느림')
    expect(copyViolations('조회'.normalize('NFD'))).toEqual([])
  })

  it('DM-15 단어형 규칙 — 끝 글자는 자리표시 · 문장부호 · 기호 · 공백을 건너뛴다', () => {
    expect(copyLastChar('진단 {elapsed}')).toBe('단')
    expect(copyLastChar('slice 수 — ')).toBe('수')
    expect(copyLastChar('끝났다.')).toBe('다')
    expect(copyLastChar('▲')).toBe('')
  })
})
