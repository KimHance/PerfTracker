import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { SessionStateError } from '../../src/errors.js'
import { appendMark, removeMark, resolveMarkSession, sortedMarks } from '../../src/session/marks.js'
import { type ActiveSession, readActiveSession, writeActiveSession } from '../../src/session/state.js'

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'perftracker-marks-'))
})

function session(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    version: 1,
    id: 'a1b2c3',
    name: '홈 스크롤',
    serial: 'S1',
    packageName: 'com.x',
    runDir: '/tmp/run',
    perfettoKey: 'k',
    remoteTracePath: '/data/misc/perfetto-traces/x',
    startedAt: '2026-07-28T10:00:00.000Z',
    configuredDurationMs: 600_000,
    options: { launch: true },
    startup: null,
    ...overrides,
  }
}

describe('마킹 대상 세션 고르기', () => {
  it('세션 고유값으로 찾는다', async () => {
    await writeActiveSession(session({ serial: 'S1', id: 'aaa111' }), home)
    await writeActiveSession(session({ serial: 'S2', id: 'bbb222' }), home)

    const found = await resolveMarkSession({ sessionId: 'bbb222', home })

    expect(found.serial).toBe('S2')
  })

  it('세션이 하나뿐이면 아무것도 지정하지 않아도 된다', async () => {
    await writeActiveSession(session({ serial: 'S1' }), home)

    expect((await resolveMarkSession({ home })).serial).toBe('S1')
  })

  it('세션이 둘인데 지정하지 않으면 고르지 않고 묻는다', async () => {
    // 엉뚱한 세션에 붙은 마킹은 result.json 을 열기 전까지 아무도 눈치채지 못한다.
    await writeActiveSession(session({ serial: 'S1', id: 'aaa111' }), home)
    await writeActiveSession(session({ serial: 'S2', id: 'bbb222' }), home)

    await expect(resolveMarkSession({ home })).rejects.toThrow(SessionStateError)
    await expect(resolveMarkSession({ home })).rejects.toThrow(/aaa111[\s\S]*bbb222/)
  })

  it('진행 중인 세션이 없으면 그렇게 말한다', async () => {
    await expect(resolveMarkSession({ home })).rejects.toThrow(/진행 중인 세션이 없습니다/)
  })

  it('없는 세션 고유값은 조용히 다른 세션을 고르지 않는다', async () => {
    await writeActiveSession(session({ serial: 'S1', id: 'aaa111' }), home)

    await expect(resolveMarkSession({ sessionId: 'zzz999', home })).rejects.toThrow(/zzz999/)
  })
})

describe('마킹 남기기', () => {
  it('경과는 저장된 시작 시각에서 계산된다', async () => {
    // 부르는 쪽이 계산해 넘기면 CLI 와 GUI 가 서로 다른 기준(브라우저 시계)을 쓰게 된다.
    const s = session()
    await writeActiveSession(s, home)

    const { mark } = await appendMark(s, '스크롤 시작', new Date('2026-07-28T10:00:07.500Z'), home)

    expect(mark).toEqual({ offsetMs: 7500, label: '스크롤 시작' })
  })

  it('포인터 파일에 쌓인다', async () => {
    const s = session()
    await writeActiveSession(s, home)

    await appendMark(s, '첫째', new Date('2026-07-28T10:00:01.000Z'), home)
    const { total } = await appendMark(s, '둘째', new Date('2026-07-28T10:00:02.000Z'), home)

    expect(total).toBe(2)
    const stored = await readActiveSession('S1', home)
    expect(stored?.marks).toEqual([
      { offsetMs: 1000, label: '첫째' },
      { offsetMs: 2000, label: '둘째' },
    ])
  })

  it('그 사이 다른 프로세스가 붙인 마킹을 덮어쓰지 않는다', async () => {
    // CLI 와 GUI 서버가 같은 세션에 동시에 쓴다. 인자로 받은 사본을 그대로 쓰면 한쪽이 사라진다.
    const s = session()
    await writeActiveSession(s, home)

    await appendMark(s, 'CLI 가 남긴 것', new Date('2026-07-28T10:00:01.000Z'), home)
    // `s` 는 그 마킹을 모르는 낡은 사본이다.
    await appendMark(s, 'GUI 가 남긴 것', new Date('2026-07-28T10:00:02.000Z'), home)

    const stored = await readActiveSession('S1', home)
    expect(stored?.marks?.map((m) => m.label)).toEqual(['CLI 가 남긴 것', 'GUI 가 남긴 것'])
  })

  it('빈 이름은 거절한다', async () => {
    const s = session()
    await writeActiveSession(s, home)

    await expect(appendMark(s, '   ', new Date(), home)).rejects.toThrow(SessionStateError)
  })

  it('앞뒤 공백은 떼고 저장한다', async () => {
    const s = session()
    await writeActiveSession(s, home)

    const { mark } = await appendMark(s, '  광고 재생  ', new Date('2026-07-28T10:00:01.000Z'), home)

    expect(mark.label).toBe('광고 재생')
  })

  it('시작보다 이른 시각은 0 으로 본다', async () => {
    const s = session()
    await writeActiveSession(s, home)

    const { mark } = await appendMark(s, '이상한 시계', new Date('2026-07-28T09:59:00.000Z'), home)

    expect(mark.offsetMs).toBe(0)
  })
})

describe('마킹 지우기', () => {
  it('인덱스로 하나만 지운다', async () => {
    const s = session()
    await writeActiveSession(s, home)
    await appendMark(s, 'A', new Date('2026-07-28T10:00:01.000Z'), home)
    await appendMark(s, 'B', new Date('2026-07-28T10:00:02.000Z'), home)
    await appendMark(s, 'C', new Date('2026-07-28T10:00:03.000Z'), home)

    const removed = await removeMark('S1', 1, home)

    expect(removed?.label).toBe('B')
    expect((await readActiveSession('S1', home))?.marks?.map((m) => m.label)).toEqual(['A', 'C'])
  })

  it('범위 밖이면 아무것도 지우지 않는다', async () => {
    const s = session()
    await writeActiveSession(s, home)
    await appendMark(s, 'A', new Date('2026-07-28T10:00:01.000Z'), home)

    expect(await removeMark('S1', 9, home)).toBeNull()
    expect((await readActiveSession('S1', home))?.marks).toHaveLength(1)
  })
})

describe('정렬', () => {
  it('저장 순서와 무관하게 시간순으로 읽힌다', () => {
    const s = session({
      marks: [
        { offsetMs: 3000, label: '늦게' },
        { offsetMs: 1000, label: '일찍' },
      ],
    })

    expect(sortedMarks(s).map((m) => m.label)).toEqual(['일찍', '늦게'])
  })

  it('마킹이 없던 시절의 세션은 빈 배열이다', () => {
    expect(sortedMarks(session())).toEqual([])
  })
})

describe('result.json 으로 나가는 모양', () => {
  it('시간순으로 나간다 — 저장 순서가 뒤집혀 있어도', () => {
    /**
     * `extract` 가 `sortedMarks` 를 통과시키는지 고정한다. 지금은 마킹이 시간순으로만 쌓이지만
     * 그것은 `appendMark` 의 현재 동작일 뿐 계약이 아니다 — `session.marks[]` 의 `.describe()` 가
     * 소비자에게 "시간순(오름차순)" 이라고 공시하고 있으므로, 저장 순서가 어떻든 그 공시는
     * 지켜져야 한다.
     */
    const s = session({
      marks: [
        { offsetMs: 9000, label: '나중' },
        { offsetMs: 1000, label: '먼저' },
        { offsetMs: 5000, label: '가운데' },
      ],
    })

    const out = sortedMarks(s).map((m) => ({ offset_ms: m.offsetMs, label: m.label }))

    expect(out).toEqual([
      { offset_ms: 1000, label: '먼저' },
      { offset_ms: 5000, label: '가운데' },
      { offset_ms: 9000, label: '나중' },
    ])
  })
})

describe('기기 접촉', () => {
  it('마킹 경로는 adb 를 아예 쥐지 않는다', async () => {
    /**
     * 규칙 1 이 여기서 지켜지는 방식은 "조심해서 안 부른다" 가 아니라 **부를 수단이 없다** 이다:
     * `appendMark` / `removeMark` / `resolveMarkSession` 어느 것도 `AdbClient` 를 받지 않는다.
     * 인자로 받게 되는 순간 이 테스트가 컴파일되지 않는다.
     */
    const s = session()
    await writeActiveSession(s, home)

    await appendMark(s, '측정 창 안', new Date('2026-07-28T10:00:05.000Z'), home)

    // 포인터 파일만 바뀌었다는 것을 파일 내용으로 확인한다.
    const raw = await readFile(join(home, 'active', 'S1.json'), 'utf8')
    expect(JSON.parse(raw).marks).toEqual([{ offsetMs: 5000, label: '측정 창 안' }])
  })
})
