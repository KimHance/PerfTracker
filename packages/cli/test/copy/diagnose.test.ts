import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DIAGNOSE_ATRACE_CATEGORIES, DIAGNOSE_MAX_DURATION_MS } from '@perftracker/core'
import { describe, expect, it } from 'vitest'
import { DIAGNOSE_CLI_COPY } from '../../src/copy/diagnose.js'

/**
 * **진단 모드가 새로 내는 cli 문구** (DM-15 · 기능 문서 결정 9 · 10).
 *
 * 정본은 디자인 문서 `## 문구` 표다. 이 시험은 (1) 표의 cli 줄과 코드의 모음이 양방향으로 같은지,
 * (2) 각 문구가 문장이 아니라 단어 꼴인지를 본다. 기존 문구(합쇼체)는 대상이 아니다 (plan D10).
 * core · gui 는 자기 패키지 시험이 따로 본다 — gui 는 cli 를 못 보고(규칙 4) 문구도 패키지마다 다르다.
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

/** 표에서 `패키지` 칸이 `pkg` 인 줄의 `문구` 칸 — 백틱 하나로 감싼 원문 그대로 (안의 공백도). */
function tableCopies(pkg: string): string[] {
  const rows = copySection()
    .split('\n')
    .filter((l) => l.startsWith('|'))
    .map(cells)
  const header = rows[0] ?? []
  const pkgAt = header.indexOf('패키지')
  const copyAt = header.indexOf('문구')
  if (pkgAt < 0 || copyAt < 0) throw new Error('`## 문구` 표 머리에 `패키지` · `문구` 칸이 없다')

  return rows
    .filter((c) => c[pkgAt] === pkg)
    .map((c) => {
      const m = /^`([^`]+)`$/.exec(c[copyAt] ?? '')
      if (m === null) throw new Error(`문구 칸이 백틱 하나로 감싼 꼴이 아니다: ${c[copyAt]}`)
      return m[1]!
    })
}

// ─── 단어형 규칙 (DM-15 받아들임 기준 그대로) ───

/** 권유 · 1인칭. */
const PROPOSALS = ['세요', '십시오', '바랍니다', '해야', '드립니다', '저희']

/**
 * 평가 낱말 — **음절 그대로 부분 일치하는 닫힌 목록** (결정 10). 명사형 · 불규칙 활용형까지 적는다:
 * 어간(`느리`)만으론 `느림` · `빨라` · `나빠` 의 음절이 달라 못 잡는다. 자모(NFD)로 비교하지 않는다 —
 * 음절 경계를 넘어 `좋`(ㅈㅗㅎ)이 `조회`(ㅈㅗ + ㅎㅚ)에 걸린다.
 */
const EVALUATIVE = [
  '느리', '느린', '느림', '느려', '느릴',
  '빠르', '빠른', '빠름', '빨라', '빨리', '빠를',
  '좋',
  '나쁘', '나쁜', '나쁨', '나빠', '나쁠',
  '부드러', '부드럽',
  '무거', '무겁',
  '가벼', '가볍',
  '심각', '주의', '문제', '병목', '권장',
]

/** 문구 하나가 어긴 규칙들. 빈 배열이면 통과. 음절로 비교하려고 NFC 로 맞춘다 (자모 비교가 아니다). */
function violations(copy: string): string[] {
  const text = copy.normalize('NFC')
  const out: string[] = []

  // 끝 글자 — 문장부호 · 공백을 빼고 본다 (`측정한다.` 의 `.`).
  const last = [...text.replace(/[\s\p{P}]+$/u, '')].at(-1)
  if (last === '다' || last === '요') out.push(`끝 글자 ${last}`)
  if (text.includes('니다')) out.push('니다')
  for (const w of PROPOSALS) if (text.includes(w)) out.push(`권유 ${w}`)
  for (const w of EVALUATIVE) if (text.includes(w)) out.push(`평가 ${w}`)
  return out
}

const CODE_COPIES: string[] = Object.values(DIAGNOSE_CLI_COPY)

describe('DM-15 문구 표 ↔ 코드 (cli)', () => {
  it('DM-15 문구 표 ↔ 코드 — 표의 cli 줄과 모음이 양방향으로 같다', () => {
    const table = tableCopies('cli')

    // 표에만 있는 문구 · 코드에만 있는 문구 둘 다 0.
    expect(table.filter((t) => !CODE_COPIES.includes(t)), '표에만 있음').toEqual([])
    expect(CODE_COPIES.filter((c) => !table.includes(c)), '코드에만 있음').toEqual([])
    expect([...table].sort()).toEqual([...CODE_COPIES].sort())
  })

  it('DM-15 문구 표 ↔ 코드 — 표가 실제로 읽혀야 이 시험이 의미를 갖는다', () => {
    // 표를 못 읽어 빈 배열끼리 비교하면 위 단언은 무조건 통과한다.
    expect(tableCopies('cli').length).toBe(3)
    expect(tableCopies('core').length).toBeGreaterThan(0)
    expect(tableCopies('gui').length).toBeGreaterThan(0)
  })
})

describe('DM-15 단어형 규칙 (cli)', () => {
  it('DM-15 단어형 규칙 — cli 진단 문구가 전부 단어 꼴이다', () => {
    const broken = CODE_COPIES.map((c) => ({ c, v: violations(c) })).filter((x) => x.v.length > 0)
    expect(broken).toEqual([])
  })

  /**
   * **규칙마다 깨 본다** — 검사기가 실패할 수 있다는 것이 증거다. 각 규칙을 어긴 문구를 실제 cli
   * 문구에 덧붙여 그 규칙 이름이 나오는지 본다.
   */
  it.each([
    ['끝 글자 다', `${DIAGNOSE_CLI_COPY.labelLine} 기록한다`],
    ['끝 글자 다', `${DIAGNOSE_CLI_COPY.runsTag}이다.`],
    ['끝 글자 요', `${DIAGNOSE_CLI_COPY.helpDiagnose} 켜져요 `],
    ['니다', `${DIAGNOSE_CLI_COPY.helpDiagnose} 기록합니다 · 진단`],
    ...PROPOSALS.map((w) => [`권유 ${w}`, `${DIAGNOSE_CLI_COPY.labelLine} ${w} 진단`]),
  ])('DM-15 단어형 규칙 — 깨 봄: %s', (rule, sample) => {
    expect(violations(sample)).toContain(rule)
  })

  /** 평가 낱말은 목록의 낱말마다 — 받아들임 기준이 이름을 댄 넷(`느림` · `빨라짐` · `빨리` · `나빠짐`)도. */
  it.each([
    ...EVALUATIVE.map((w) => [w, `${DIAGNOSE_CLI_COPY.labelLine} ${w}`]),
    ['느림', '앱 slice 느림'],
    ['빨라', '프레임 빨라짐'],
    ['빨리', '빨리 열림'],
    ['나빠', '시작 시간 나빠짐'],
  ])('DM-15 단어형 규칙 — 깨 봄: 평가 %s', (word, sample) => {
    expect(violations(sample)).toContain(`평가 ${word}`)
  })

  /** 걸리면 안 되는 것 — 음절 경계를 넘지 않는다 (`조회` 는 `좋` 이 아니다) · `진단` 은 `다` 로 안 끝난다. */
  it.each(['조회', '진단', '최대 10분', '느낌표', '다음 진단'])('DM-15 단어형 규칙 — 통과해야 함: %s', (sample) => {
    expect(violations(sample)).toEqual([])
  })
})

/**
 * 값 자리 없는 고정 문구가 코드의 사실을 숫자 · 목록으로 말한다 — 그 사실이 바뀌면 문구도 같이
 * 바뀌어야 하므로 core 상수와 대조한다 (루트 AGENTS.md 「문서가 숫자로 말하면 대조 시험」).
 */
describe('DM-17 진단 문구의 숫자 · 범위', () => {
  it('DM-17 진단 문구의 최대 시간이 DIAGNOSE_MAX_DURATION_MS 와 같다', () => {
    const minutes = DIAGNOSE_MAX_DURATION_MS / 60_000
    expect(DIAGNOSE_CLI_COPY.labelLine).toContain(`최대 ${minutes}분`)
    expect(DIAGNOSE_CLI_COPY.helpDiagnose).toContain(`최대 ${minutes}분`)
  })

  it('DM-3 진단 라벨 줄의 범위가 DIAGNOSE_ATRACE_CATEGORIES 와 같다', () => {
    expect(DIAGNOSE_CLI_COPY.labelLine).toContain(`atrace ${DIAGNOSE_ATRACE_CATEGORIES.join(' · ')} + 앱 slice`)
  })
})
