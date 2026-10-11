import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  checkCompileOption,
  COMPILE_TIMEOUT_MS,
  COMPILE_VALUES,
  CompileFailedError,
  copyViolations,
} from '@perftracker/core'
import { describe, expect, it } from 'vitest'
import { displayWidth } from '../../src/commands/runs.js'
import { COMPILE_CLI_COPY, fillCopy } from '../../src/copy/compile.js'

/**
 * **`start --compile` 의 cli 문구** (BP-6 · DM-15). 정본은 `docs/design/baseline-profile.md` `## 문구` 표다.
 * 이 시험은 (1) 표의 cli 줄과 코드의 모음이 양방향으로 같은지, (2) 그 가운데 core 가 오류 message 로 내는
 * 다섯이 core 의 실제 출력과 같은지, (3) 단어형 · 80칸 · 안 쓰는 말을 본다.
 */
const DESIGN = readFileSync(
  fileURLToPath(new URL('../../../../docs/design/baseline-profile.md', import.meta.url)),
  'utf8',
)

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

/** 표에서 `패키지` 칸이 `pkg` 인 줄의 `문구` 칸 — 백틱 하나로 감싼 원문 그대로. */
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

const CODE: string[] = Object.values(COMPILE_CLI_COPY)

/** 호스트에서 그대로 도는 되돌림 명령 — 80칸 규칙 밖이고 문장이 아니다 (결정 13). */
const COMMANDS: string[] = [COMPILE_CLI_COPY.revertBase, COMPILE_CLI_COPY.revertSecondary]

/** 화면 판정 금지 낱말 — 디자인 표 `안 쓰는 말` 칸 · `check_cli.py` 의 BANNED (결정 6). */
const BANNED = ['최적화', '적용됨', '프로파일 적용', 'AOT', '프로파일 있음', '예열', '복원', '오류가 발생']

/** 판정 낱말 검사기 — 「판정 낱말 0」 과 「깨 봄」 이 같은 함수를 부른다. */
function bannedIn(text: string): string[] {
  return BANNED.filter((w) => text.includes(w))
}

/** 되돌림 머리 아래 두 칸 들여 놓이는 사실 줄 (디자인 CLI 블록 2) — 80칸은 들여 쓴 채로 잰다. */
const INDENTED: string[] = [COMPILE_CLI_COPY.secondaryMixed, COMPILE_CLI_COPY.secondaryOutside]

/** 채운 줄이 80칸을 넘는 문구. `swap` 은 깨 봄용 — 틀을 다른 글자로 바꿔 채운다. */
function overWidth(copies: string[], swap: Record<string, string> = {}): { line: string; w: number }[] {
  return copies
    .map((c) => `${INDENTED.includes(c) ? '  ' : ''}${fillCopy(swap[c] ?? c, WIDEST)}`)
    .map((line) => ({ line, w: displayWidth(line) }))
    .filter((x) => x.w > 80)
}

/**
 * 값 자리를 실측한 가장 긴 값으로 채운 표본 — 80칸은 채운 줄로 잰다. `status` 는 기기 원문이라 길이 상한이 없다 —
 * 실측(SM-S901N · 디자인 CLI 블록 4)의 `-m` 밖 값 `run-from-apk` 로 잰다. 그보다 긴 filter 이름(예
 * `everything-profile`)이면 사실 줄이 80칸을 넘고, 자르지 않는다 (값을 줄이지 않음).
 */
const WIDEST = {
  value: 'speed-profile',
  before: 'speed-profile',
  after: 'speed-profile',
  ms: (COMPILE_TIMEOUT_MS - 1).toLocaleString('en-US'),
  status: 'run-from-apk',
  n: 99,
  code: 255,
  cmd: "cmd package compile -m speed-profile -f 'com.google.android.youtube'",
}

describe('BP-6 문구 표 ↔ 코드', () => {
  it('BP-6 문구 표 ↔ 코드 — 표의 cli 줄과 모음이 양방향으로 같다', () => {
    const table = tableCopies('cli')
    expect(table.filter((t) => !CODE.includes(t)), '표에만 있음').toEqual([])
    expect(CODE.filter((c) => !table.includes(c)), '코드에만 있음').toEqual([])
    expect([...table].sort()).toEqual([...CODE].sort())
  })

  it('BP-6 문구 표 ↔ 코드 — 표가 실제로 읽혀야 이 시험이 의미를 갖는다', () => {
    // 표를 못 읽어 빈 배열끼리 비교하면 위 단언은 무조건 통과한다.
    expect(tableCopies('cli').length).toBe(16)
  })

  /** 표의 cli 줄 가운데 다섯은 core 가 오류 message 로 낸다 — cli 는 그대로 찍으므로 core 출력이 표와 같아야 한다. */
  it('BP-6 문구 표 ↔ 코드 — core 가 내는 거부 둘이 표와 같다', () => {
    expect(() => checkCompileOption({ launch: false, compile: 'speed' })).toThrow(COMPILE_CLI_COPY.rejectLaunch)
    expect(() => checkCompileOption({ launch: true, compile: 'verify' })).toThrow(
      fillCopy(COMPILE_CLI_COPY.rejectValue, { value: 'verify' }),
    )
    // 거부 줄의 받는 값 목록이 core 의 값 셋과 같다 (문구가 숫자 · 목록으로 말함).
    expect(COMPILE_CLI_COPY.rejectValue).toContain(`받는 값 ${COMPILE_VALUES.join(' · ')} ·`)
    expect(COMPILE_CLI_COPY.helpCompile).toContain(COMPILE_VALUES.join(' · '))
  })

  it('BP-6 문구 표 ↔ 코드 — core 가 내는 실패 머리 둘 · 보낸 명령이 표와 같다', () => {
    const cmd = "cmd package compile -m speed -f 'com.google.android.youtube'"
    const exit = new CompileFailedError('speed', cmd, 1, false, '', 120).message.split('\n')
    expect(exit).toEqual([fillCopy(COMPILE_CLI_COPY.failExit, { code: 1 }), fillCopy(COMPILE_CLI_COPY.failCommand, { cmd })])

    const timeout = new CompileFailedError('speed', cmd, null, true, '', COMPILE_TIMEOUT_MS).message.split('\n')
    expect(timeout).toEqual([COMPILE_CLI_COPY.failTimeout, fillCopy(COMPILE_CLI_COPY.failCommand, { cmd })])
    // 한도 문구의 분이 core 상수와 같다.
    expect(COMPILE_CLI_COPY.failTimeout).toContain(`한도 ${COMPILE_TIMEOUT_MS / 60_000}분`)
  })

  it('BP-6 문구 표 ↔ 코드 — 값 자리를 남기면 던진다 (화면에 {before} 가 나가지 않게)', () => {
    expect(() => fillCopy(COMPILE_CLI_COPY.compileLine, { value: 'speed' })).toThrow('{before}')
  })
})

describe('BP-6 단어형 · 80칸 (DM-15)', () => {
  const words = CODE.filter((c) => !COMMANDS.includes(c))

  it('BP-6 단어형 — 되돌림 명령 둘을 뺀 cli 문구가 전부 단어 꼴이다', () => {
    const broken = words.map((c) => ({ c, v: copyViolations(c) })).filter((x) => x.v.length > 0)
    expect(broken).toEqual([])
    expect(words.length).toBe(14)
  })

  it('BP-6 단어형 — 판정 낱말 0', () => {
    expect(CODE.flatMap((c) => bannedIn(c).map((w) => `${w} | ${c}`))).toEqual([])
  })

  /** 「판정 낱말 0」 이 쓰는 같은 검사기를 깨 본다 — 검사기가 빈 결과만 내면 여기가 RED (검수 왕복 1 #2). */
  it.each(BANNED)('BP-6 단어형 — 깨 봄: 판정 낱말 %s 가 걸린다', (word) => {
    expect(bannedIn(`${COMPILE_CLI_COPY.revertHead} ${word}`)).toEqual([word])
  })

  it('BP-6 단어형 — 깨 봄: 끝 글자 · 권유가 걸린다', () => {
    expect(copyViolations(`${COMPILE_CLI_COPY.revertUnknown} 바꿨습니다`)).not.toEqual([])
    expect(copyViolations(`${COMPILE_CLI_COPY.revertHead} · 다시 재세요`)).toContain('권유:세요')
  })

  it('BP-6 80칸 — 가장 긴 값으로 채워도 되돌림 명령 말고는 80칸 안 (머리 아래 줄은 두 칸 들여 잰다)', () => {
    expect(overWidth(words)).toEqual([])
  })

  /** 같은 검사기를 깨 본다 — 81칸 줄 · 들여 쓰면 81칸이 되는 보조 dex 줄. */
  it('BP-6 80칸 — 깨 봄: 81칸 줄 · 들여 81칸이 되는 줄은 걸린다', () => {
    expect(overWidth(['x'.repeat(81)])).toHaveLength(1)
    expect(overWidth(['x'.repeat(80)])).toEqual([])
    const indented = INDENTED[0]!
    const pad = 'x'.repeat(79 - displayWidth(fillCopy(indented, WIDEST)))
    expect(overWidth([`${indented}${pad}`])).toEqual([]) // 이름이 달라 들여 셈 밖 — 79칸
    expect(overWidth([indented], { [indented]: `${indented}${pad}` })).toHaveLength(1) // 들여 81칸
  })
})
