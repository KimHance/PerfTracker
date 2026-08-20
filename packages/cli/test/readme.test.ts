import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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
  })
})
