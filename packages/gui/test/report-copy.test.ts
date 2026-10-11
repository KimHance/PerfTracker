import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { COPY_ADVICE_WORDS, COPY_EVAL_WORDS, copyViolations } from '@perftracker/core'
import { describe, expect, it } from 'vitest'
import { DIAGNOSE_REPORT_COPY, fillReportCopy } from '../src/web/report/diagnose-copy.js'
import { MANIFEST } from '../src/web/report/manifest.js'
import { LABEL_WORDS, READABILITY_COPY } from '../src/web/report/readability-copy.js'

/**
 * **진단 모드가 보고서에 새로 내는 문구** (DM-15 · 기능 문서 결정 9 · 10).
 *
 * 정본은 디자인 문서 `## 문구` 표다. 이 시험은 (1) 표의 **gui 보고서 줄**과 코드의 모음
 * (`DIAGNOSE_REPORT_COPY`)이 양방향으로 같은지, (2) 각 문구가 문장이 아니라 단어 꼴인지를 본다.
 * 규칙(낱말 목록 · 끝 글자)은 core 의 `copyViolations` 하나가 주인이다 — 패키지마다 목록을 따로
 * 적으면 한 곳만 고쳐진다. 기존 문구는 대상이 아니다 (plan D10).
 *
 * **gui 줄은 두 화면이 나눠 갖는다.** 측정 화면(04 옵션 행 · 탭 배지 · 킥커 · 각주 · 드로어 꼬리)
 * 줄은 그 화면의 모음과 시험이 맡고, 여기는 `자리` 칸이 보고서를 가리키는 줄만 본다 — 아래
 * `REPORT_PLACE`. 측정 줄이 이 모음에 섞여 들어오면(또는 그 반대) 양방향 대조가 깨진다.
 */
const DESIGN = readFileSync(
  fileURLToPath(new URL('../../../docs/design/diagnostic-mode.md', import.meta.url)),
  'utf8',
)

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

/**
 * gui 줄 가운데 **보고서의 자리**. 표의 `자리` 칸이 이 말로 시작하면 보고서 줄이다 — 보고서 레일 ·
 * 머리 · 진단 탭 섹션 · 진단 탭 카드 · slice 표 · 측정 비용 카드. 측정 화면 줄의 자리(04 · 탭 배지 ·
 * running · 기록 드로어)는 이 말로 시작하지 않는다.
 */
const REPORT_PLACE = /^(보고서 |진단 탭 |카드 제목|slice 표 |측정 비용 카드 )/

const GUI = copyTable(DESIGN).filter((r) => r.pkg === 'gui')
const TABLE = GUI.filter((r) => REPORT_PLACE.test(r.place)).map((r) => r.copy)
const CODE: string[] = Object.values(DIAGNOSE_REPORT_COPY)

describe('DM-15 문구 표 ↔ 코드 (gui 보고서)', () => {
  it('DM-15 문구 표 ↔ 코드 — 표의 gui 보고서 줄과 모음이 양방향으로 같다', () => {
    const onlyTable = [...TABLE]
    for (const c of CODE) {
      const i = onlyTable.indexOf(c)
      if (i >= 0) onlyTable.splice(i, 1)
    }
    const onlyCode = [...CODE]
    for (const t of TABLE) {
      const i = onlyCode.indexOf(t)
      if (i >= 0) onlyCode.splice(i, 1)
    }
    // 같은 글자(`진단`)가 자리마다 따로 있으므로 개수까지 같아야 한다.
    expect(onlyTable, '표에만 있음').toEqual([])
    expect(onlyCode, '코드에만 있음').toEqual([])
  })

  it('DM-15 문구 표 ↔ 코드 — 표가 실제로 읽혀야 이 시험이 의미를 갖는다', () => {
    // 표를 못 읽어 빈 배열끼리 비교하면 위 단언은 무조건 통과한다.
    expect(TABLE.length).toBe(19)
    // 보고서 줄로 안 센 gui 줄은 측정 화면의 것이다 — 그중 어느 것도 이 모음에 없다.
    const measure = GUI.filter((r) => !REPORT_PLACE.test(r.place))
    expect(measure.length).toBeGreaterThan(0)
    for (const r of measure) expect(r.place, r.copy).toMatch(/^(04 |탭 배지|running |기록 드로어)/)
  })
})

describe('DM-15 단어형 규칙 (gui 보고서)', () => {
  it('DM-15 단어형 규칙 — gui 보고서 진단 문구가 전부 단어 꼴이다', () => {
    const broken = CODE.map((c) => ({ c, v: copyViolations(c) })).filter((x) => x.v.length > 0)
    expect(broken).toEqual([])
    // 값 자리를 채운 뒤에도 같다 — 칸 단위 `{n}행` 이 숫자로 바뀌어도 끝 글자가 `다` 가 되지 않는다.
    expect(copyViolations(fillReportCopy(DIAGNOSE_REPORT_COPY.tableUnit, { n: '1,055' }))).toEqual([])
  })

  /** **규칙마다 깨 본다** — 실제 보고서 문구에 어긴 말을 붙여 그 규칙이 걸리는지 본다. */
  it.each([
    ['끝=다', `${DIAGNOSE_REPORT_COPY.cardNames} 이다`],
    ['끝=요', `${DIAGNOSE_REPORT_COPY.overheadUnit}이에요.`],
    ['니다', `${DIAGNOSE_REPORT_COPY.section} 기록합니다 · 표`],
    ...COPY_ADVICE_WORDS.map((w) => [`권유:${w}`, `${DIAGNOSE_REPORT_COPY.tableUnit} ${w} 표`]),
    ...COPY_EVAL_WORDS.map((w) => [`평가:${w}`, `${DIAGNOSE_REPORT_COPY.cardCounts} ${w}`]),
  ])('DM-15 단어형 규칙 — 깨 봄: %s', (rule, sample) => {
    expect(copyViolations(sample)).toContain(rule)
  })

  it('DM-15 값 자리 — 채우면 행 수가 들어가고 모르는 자리는 남는다', () => {
    expect(fillReportCopy(DIAGNOSE_REPORT_COPY.tableUnit, { n: '1,055' })).toBe('대상 앱 프로세스 · 1,055행')
    expect(fillReportCopy(DIAGNOSE_REPORT_COPY.tableUnit, {})).toBe(DIAGNOSE_REPORT_COPY.tableUnit)
  })
})

/* ══════════════════ report-readability — 문구 표 ↔ 코드 (RR-5 · RR-6) ══════════════════ */

/**
 * 보고서 가독성이 새로 내거나 바꾸는 문구. 정본은 `docs/design/report-readability.md` `## 문구` (결정 7) —
 * 첫 표(패키지 · 자리 · 문구 · 뜻 · 안 쓰는 말)와 라벨 단어 표(카드 · `경로` → `단어`). 표에만 있거나 코드에만
 * 있는 문구가 생기면 깨진다.
 */
const RR_DESIGN = readFileSync(
  fileURLToPath(new URL('../../../docs/design/report-readability.md', import.meta.url)),
  'utf8',
)
/** `## 문구` 절 — 다음 `## ` 까지. */
const RR_SECTION = ((): string => {
  const at = RR_DESIGN.indexOf('\n## 문구\n')
  expect(at).toBeGreaterThan(0)
  const rest = RR_DESIGN.slice(at + 1)
  const end = rest.indexOf('\n## ', 1)
  return end < 0 ? rest : rest.slice(0, end)
})()
/** 첫 표만 — 라벨 단어 표 앞에서 끊는다. */
const RR_ROWS = copyTable(RR_SECTION.slice(0, RR_SECTION.indexOf('라벨 단어 줄')))
/** `앱 RSS 구성` 새 행의 단어는 라벨 단어다 — 첫 표에 있지만 `LABEL_WORDS` 쪽. */
const isLabelRow = (r: CopyRow): boolean => r.place.includes('새 행 단어')
/** 라벨 단어 표 — `` `경로` → `단어` `` 짝. `` `diagnose` → 빈 칸 `` 처럼 단어가 백틱이 아니면 짝이 아니다. */
const RR_LABEL_PAIRS = ((): [string, string][] => {
  const table = RR_SECTION.slice(RR_SECTION.indexOf('라벨 단어 줄'))
  return [...table.matchAll(/`([^`]+)` → `([^`]+)`/g)].map((m) => [m[1]!, m[2]!])
})()

describe('RR-5 문구 표 ↔ 코드', () => {
  it('RR-5 문구 표 ↔ 코드 — 첫 표와 READABILITY_COPY 가 양방향으로 같다', () => {
    const table = RR_ROWS.filter((r) => !isLabelRow(r)).map((r) => r.copy).sort()
    const code = Object.values(READABILITY_COPY).map(String).sort()
    expect(code).toEqual(table)
    // 표가 실제로 읽혔다 — 빈 배열끼리 같다고 통과하지 않게.
    expect(table.length).toBe(19)
    expect(RR_ROWS.every((r) => r.pkg === 'gui')).toBe(true)
  })

  it('RR-5 문구 표 ↔ 코드 — 새 · 바뀐 문구가 단어 꼴이다 (DM-15)', () => {
    const all = [...Object.values(READABILITY_COPY), ...Object.values(LABEL_WORDS)].map(String)
    expect(all.map((c) => ({ c, v: copyViolations(c) })).filter((x) => x.v.length > 0)).toEqual([])
    const filled = fillReportCopy(READABILITY_COPY.distFootnote, { frames: '7,531', buckets: '61' })
    expect(filled).toBe('7,531 프레임 · 버킷 61칸')
    expect(copyViolations(filled)).toEqual([])
    // 깨 본다 — 평가 낱말이 각주에 들어오면 걸린다.
    expect(copyViolations(`${READABILITY_COPY.timelineFootnote} 부드럽습니다`).length).toBeGreaterThan(0)
  })
})

describe('RR-6 단어 표 ↔ 코드', () => {
  it('RR-6 단어 표 ↔ 코드 — 라벨 단어 표 + 새 행 = LABEL_WORDS = 매니페스트의 (경로, 단어)', () => {
    const fromTable = new Map<string, string>(RR_LABEL_PAIRS)
    for (const r of RR_ROWS.filter(isLabelRow)) {
      const path = /경로 줄 `([^`]+)`/.exec(RR_DESIGN.split('\n').find((l) => l.includes(r.place)) ?? '')?.[1]
      expect(path, r.place).toBeDefined()
      fromTable.set(path!, r.copy)
    }
    // 표가 실제로 읽혔다 — 단어 줄 27 + 새 행 1.
    expect(RR_LABEL_PAIRS.length).toBe(27)
    expect(fromTable.size).toBe(28)
    const words = new Map<string, string>(Object.entries(LABEL_WORDS))
    expect([...words.entries()].sort()).toEqual([...fromTable.entries()].sort())

    // 매니페스트 — 단어를 단 키는 모두 표의 짝이고, 표의 짝은 모두 어느 키엔가 달려 있다.
    const keyed = new Map<string, string>()
    for (const b of MANIFEST) {
      if (b.kind !== 'pairs') continue
      for (const k of b.keys ?? []) {
        if (k.w === undefined) continue
        expect(fromTable.get(k.l), `${b.title} · ${k.l}`).toBe(k.w)
        keyed.set(k.l, k.w)
      }
    }
    expect([...keyed.entries()].sort()).toEqual([...fromTable.entries()].sort())
  })
})
