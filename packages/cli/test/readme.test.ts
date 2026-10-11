import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  APP_SLICE_MIN_SDK,
  COMPILE_VALUES,
  DEFAULT_MAX_DURATION_MS,
  DIAGNOSE_ATRACE_CATEGORIES,
  DIAGNOSE_MAX_DURATION_MS,
} from '@perftracker/core'
import { describe, expect, it } from 'vitest'
import { buildProgram } from '../src/program.js'

/**
 * **등록된 명령이 전부 README 에 있는가.**
 *
 * `runs` 세 개는 `ebdaadd`(2026-07-28) 에서 생겼는데 그 커밋이 README 를 안 건드려서,
 * 한동안 CLI 로 되는 일이 문서에는 GUI 로만 되는 것처럼 적혀 있었다. `devices` 는 처음부터
 * 사용 예가 없었다. 둘 다 **틀린 것이 아니라 빠진 것**이라 읽는 사람은 알 길이 없다.
 *
 * 그래서 명령 목록을 정규식으로 긁지 않고 **commander 가 실제로 등록한 트리**를 읽는다
 * (`program.ts` 가 등록과 실행을 나눈 이유다). 이름을 바꾸면 여기가 같이 깨진다.
 */
const README = readFileSync(fileURLToPath(new URL('../../../README.md', import.meta.url)), 'utf8')
/** 명령별 자세한 설명(「명령 전체」)은 README 에서 이 파일로 옮겼다. README 에는 명령 표와 start 옵션 줄만 있다. */
const USAGE = readFileSync(fileURLToPath(new URL('../../../docs/usage.md', import.meta.url)), 'utf8')

/** 최상위 명령과 `runs` 처럼 하위를 가진 명령의 `부모 자식` 을 함께 낸다. */
function commandPaths(): string[] {
  const out: string[] = []
  for (const c of buildProgram().commands) {
    if (c.commands.length === 0) {
      out.push(c.name())
      continue
    }
    for (const sub of c.commands) out.push(`${c.name()} ${sub.name()}`)
  }
  return out
}

describe('README 가 명령을 빠뜨리지 않는다', () => {
  it('등록된 명령이 전부 적혀 있다', () => {
    const missing = commandPaths().filter((p) => !README.includes(`perftracker ${p}`))
    expect(missing).toEqual([])
  })

  it('명령이 실제로 등록돼 있어야 이 테스트가 의미를 갖는다', () => {
    // 트리가 비면 위 단언은 빈 배열끼리 비교하며 무조건 통과한다.
    expect(commandPaths().length).toBeGreaterThan(10)
  })
})

/**
 * **이름을 바꾼다고 남의 스크립트를 깨지 않는다.**
 *
 * `gui` 는 `open` 으로 바뀌었지만 별칭으로 계속 받는다. 별칭은 도움말에도 문서에도 안 나오고
 * (정본은 `open` 하나다) 조용히 동작만 한다 — 그래서 **테스트가 없으면 누가 지워도 아무도
 * 모른다.** 지우려면 이 테스트를 먼저 지워야 하고, 그것이 의사 표시가 된다.
 */
describe('옛 이름 호환', () => {
  it('gui 로 불러도 open 명령을 찾는다', () => {
    const open = buildProgram().commands.find((c) => c.name() === 'open')
    expect(open, 'open 명령이 없다 — 이름을 또 바꿨다면 이 테스트도 함께 고칠 것').toBeDefined()
    expect(open!.aliases()).toContain('gui')
  })

  /** 별칭은 README 의 「명령 전체」에 넣지 않는다 — 정본이 둘로 보이면 그것이 혼란이다. */
  it('별칭은 문서에 싣지 않는다', () => {
    expect(README).not.toContain('perftracker gui')
    expect(USAGE).not.toContain('perftracker gui')
  })
})

// ─── 옵션 ───

/** `## <제목>` 절 — 다음 `## ` 까지. 그 아래 `###` 소절은 절 안이다. */
function section(title: string): string {
  const start = USAGE.search(new RegExp(`^## ${title}\\s*$`, 'm'))
  if (start < 0) throw new Error(`docs/usage.md 에 「${title}」 절이 없다`)
  const rest = USAGE.slice(start + 1)
  const end = rest.search(/^## /m)
  return end < 0 ? rest : rest.slice(0, end)
}

/** 플래그가 낱말로 적혀 있나 — `--force` 가 `--forceful` 에 걸리지 않게 앞뒤를 끊는다. */
function mentions(text: string, flag: string): boolean {
  return new RegExp(`(?<![\\w-])${flag.replace(/[-]/g, '\\-')}(?![\\w-])`).test(text)
}

function startOptions(): string[] {
  const start = buildProgram().commands.find((c) => c.name() === 'start')
  return (start?.options ?? []).map((o) => o.long ?? o.short ?? '')
}

/**
 * **`start` 에 등록된 옵션이 README 에 있는가** (DM-1). 명령 대조와 같은 이유다 — 옵션을 더하고
 * 문서를 안 고치면 틀린 것이 아니라 빠진 것이라 읽는 사람은 알 길이 없다. commander 가 실제로
 * 등록한 트리를 읽으므로 옵션 이름을 바꾸면 여기가 같이 깨진다.
 */
describe('DM-1 README 옵션 대조', () => {
  it('DM-1 README 옵션 대조 — start 에 등록된 옵션이 전부 README 에 있다', () => {
    const missing = startOptions().filter((flag) => !mentions(README, flag))
    expect(missing).toEqual([])
  })

  it('DM-1 README 옵션 대조 — --diagnose 는 「명령 전체」 절 안에 있다', () => {
    expect(mentions(section('명령 전체'), '--diagnose')).toBe(true)
  })

  it('DM-1 README 옵션 대조 — start 옵션이 실제로 등록돼 있어야 이 시험이 의미를 갖는다', () => {
    // 지금 8개 (--app --name --device --launch --out --force --diagnose --compile). 트리가 비면 위 단언은 빈 배열끼리 통과한다.
    expect(startOptions()).toContain('--diagnose')
    expect(startOptions()).toContain('--compile')
    expect(startOptions().length).toBeGreaterThanOrEqual(8)
  })
})

/**
 * **`--compile` 의 조건은 도움말이 아니라 문서가 말한다** (BP-4 · 결정 8 · 디자인 문서 `## 정한 것` 4). `--help` 설명은
 * 80칸이라 `--launch 와만` 을 싣지 않으므로, README 「명령 전체」 와 `packages/cli/AGENTS.md` 가 그 조건을 적어야 한다 —
 * 둘 다 빠지면 거부 줄을 보기 전까지 아무도 모른다.
 */
describe('BP-4 README 옵션 대조', () => {
  const AGENTS = readFileSync(fileURLToPath(new URL('../AGENTS.md', import.meta.url)), 'utf8')
  const LAUNCH_ONLY = '`--compile` 은 `--launch` 와만'

  it('BP-4 README 옵션 대조 — --compile 은 「명령 전체」 절 안에 받는 값 셋과 함께 있다', () => {
    const all = section('명령 전체')
    expect(mentions(all, '--compile')).toBe(true)
    expect(all).toContain(`--compile <${COMPILE_VALUES.join('|')}>`)
  })

  it('BP-4 README 옵션 대조 — --launch 와만 받는다는 조건이 「명령 전체」 · cli AGENTS 에 있다', () => {
    expect(section('명령 전체')).toContain(LAUNCH_ONLY)
    expect(AGENTS).toContain(LAUNCH_ONLY)
  })

  it('BP-4 README 옵션 대조 — 도움말 설명에는 그 조건이 없다 (그래서 문서가 말해야 한다)', () => {
    const start = buildProgram().commands.find((c) => c.name() === 'start')
    const help = start?.options.find((o) => o.long === '--compile')?.description ?? ''
    expect(help).not.toBe('')
    expect(help).not.toContain('--launch')
  })
})

/**
 * README 「명령 전체」의 진단 세션 절이 코드에 대해 **숫자 · 목록으로** 말하는 것을 코드와 대조한다
 * (루트 AGENTS.md). 상수가 바뀌고 문서가 남으면 문서가 조용히 거짓이 된다.
 */
describe('DM-17 README 진단 절의 숫자', () => {
  const diagnose = (): string => {
    const all = section('명령 전체')
    const start = all.search(/^### 진단 세션/m)
    if (start < 0) throw new Error('「명령 전체」 에 진단 세션 소절이 없다')
    const rest = all.slice(start + 1)
    const end = rest.search(/^### /m)
    return end < 0 ? rest : rest.slice(0, end)
  }

  it('DM-17 README 진단 절의 숫자 — 최대 10분 · 평소 30분이 core 상수와 같다', () => {
    expect(diagnose()).toContain(`최대 ${DIAGNOSE_MAX_DURATION_MS / 60_000}분`)
    expect(diagnose()).toContain(`평소 세션은 ${DEFAULT_MAX_DURATION_MS / 60_000}분`)
  })

  it('DM-17 README 진단 절의 숫자 — 앱 slice 가 열리는 sdk 경계가 APP_SLICE_MIN_SDK 와 같다', () => {
    expect(diagnose()).toContain(`sdk ${APP_SLICE_MIN_SDK} 이상`)
    expect(diagnose()).toContain(`sdk ${APP_SLICE_MIN_SDK - 1} 이하`)
  })

  it('DM-17 README 진단 절의 숫자 — 기록하는 카테고리가 DIAGNOSE_ATRACE_CATEGORIES 와 같다', () => {
    const categories = DIAGNOSE_ATRACE_CATEGORIES.map((c) => `\`${c}\``).join(' · ')
    expect(diagnose()).toContain(`atrace 카테고리 ${categories} 와`)
    expect(diagnose()).toContain(`프레임워크 slice(${categories})`)
  })
})
