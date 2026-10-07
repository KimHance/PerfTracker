import { describe, expect, it } from 'vitest'
import type { ActiveSessionView } from '../../src/contract/api.js'
import type { Action } from '../../src/web/state/actions.js'
import { type AppState, initialState } from '../../src/web/state/model.js'
import { reducer } from '../../src/web/state/reducer.js'

const apply = (state: AppState, ...actions: Action[]): AppState => actions.reduce(reducer, state)

function session(overrides: Partial<ActiveSessionView> = {}): ActiveSessionView {
  return {
    id: 'aaa111',
    name: '홈 스크롤',
    serial: 'S1',
    packageName: 'com.x',
    runDir: 'runs/x',
    startedAt: '2026-07-28T10:00:00.000Z',
    launch: true,
    marks: [],
    unsupported: [],
    ...overrides,
  }
}

describe('새로고침 복구', () => {
  it('빈 화면에 진행 중인 세션이 있으면 측정 중 탭으로 되살린다', () => {
    // 이게 없으면 새로고침 한 번에 기기가 잠긴 채 GUI 안에서 정지할 길이 사라진다.
    const state = apply(initialState(), { type: 'sessions/loaded', sessions: [session()] })
    const tab = state.tabs[0]!

    expect(state.tabs).toHaveLength(1)
    expect(tab.phase).toBe('running')
    expect(tab.serial).toBe('S1')
    expect(tab.name).toBe('홈 스크롤')
    expect(tab.sessionId).toBe('aaa111')
  })

  it('경과는 0 부터 다시 세지 않고 서버가 준 시작 시각에서 잇는다', () => {
    const state = apply(initialState(), { type: 'sessions/loaded', sessions: [session()] })

    expect(state.tabs[0]!.startedAt).toBe(Date.parse('2026-07-28T10:00:00.000Z'))
  })

  it('빈 탭이 없으면 탭을 새로 만든다', () => {
    let state = apply(initialState(), {
      type: 'tab/patched',
      key: 't1',
      patch: { serial: 'S9', packageName: 'com.other', name: '쓰던 탭' },
    })

    state = apply(state, { type: 'sessions/loaded', sessions: [session()] })

    expect(state.tabs).toHaveLength(2)
    expect(state.tabs[1]!.serial).toBe('S1')
  })

  it('여러 번 불려도 탭이 늘지 않는다', () => {
    // 3초마다 불리는 동기화다. 부를 때마다 탭이 생기면 화면이 금방 못 쓰게 된다.
    let state = initialState()
    for (let i = 0; i < 5; i++) state = apply(state, { type: 'sessions/loaded', sessions: [session()] })

    expect(state.tabs).toHaveLength(1)
  })

  it('세션 둘이면 탭 둘이 된다', () => {
    const state = apply(initialState(), {
      type: 'sessions/loaded',
      sessions: [session(), session({ id: 'bbb222', serial: 'S2', name: '두번째' })],
    })

    expect(state.tabs.map((t) => t.serial)).toEqual(['S1', 'S2'])
    expect(state.tabs.every((t) => t.phase === 'running')).toBe(true)
  })
})

describe('밖에서 끝난 세션', () => {
  it('서버에 없으면 측정 중 탭을 설정 화면으로 되돌린다', () => {
    // 터미널에서 `perftracker stop` 을 친 경우다. 화면이 계속 타이머를 돌리면 거짓말이 된다.
    let state = apply(initialState(), { type: 'sessions/loaded', sessions: [session()] })
    expect(state.tabs[0]!.phase).toBe('running')

    state = apply(state, { type: 'sessions/loaded', sessions: [] })

    expect(state.tabs[0]!.phase).toBe('setup')
    expect(state.tabs[0]!.startedAt).toBeNull()
    expect(state.tabs[0]!.sessionId).toBeNull()
  })

  it('설정 중이던 탭은 건드리지 않는다', () => {
    let state = apply(initialState(), {
      type: 'tab/patched',
      key: 't1',
      patch: { serial: 'S9', packageName: 'com.other', name: '고르는 중' },
    })

    state = apply(state, { type: 'sessions/loaded', sessions: [] })

    expect(state.tabs[0]!.name).toBe('고르는 중')
    expect(state.tabs[0]!.packageName).toBe('com.other')
  })
})

describe('마킹 동기화', () => {
  it('터미널에서 남긴 마킹이 측정 중 탭에 들어온다', () => {
    let state = apply(initialState(), { type: 'sessions/loaded', sessions: [session()] })
    expect(state.tabs[0]!.marks).toHaveLength(0)

    state = apply(state, {
      type: 'sessions/loaded',
      sessions: [session({ marks: [{ offsetMs: 5000, label: 'CLI 가 남긴 것' }] })],
    })

    expect(state.tabs[0]!.marks).toEqual([{ offsetMs: 5000, label: 'CLI 가 남긴 것' }])
  })

  it('못 재는 지표도 함께 실려 온다', () => {
    const state = apply(initialState(), {
      type: 'sessions/loaded',
      sessions: [session({ unsupported: [{ id: 'frame', reason: 'sdk_int=30' }] })],
    })

    expect(state.tabs[0]!.unsupported).toEqual([{ id: 'frame', reason: 'sdk_int=30' }])
  })
})

/**
 * **진단 세션도 서버가 정본이다** (DM-12 · DM-10). 새로고침 · CLI 로 연 진단 세션이 화면에 되살아날 때
 * 진단 표시(배지 · 킥커 · 각주)와 고지 줄을 잃으면, 그 세션의 수치를 평소 세션인 줄 알고 읽게 된다.
 */
describe('진단 세션 동기화', () => {
  const NOTICE = '앱 slice 열림 모름 — sdk 30 · debuggable 아님'

  it('DM-12 새로고침 · CLI 로 연 진단 세션은 진단 표시와 고지를 되찾는다', () => {
    const state = apply(initialState(), {
      type: 'sessions/loaded',
      sessions: [session({ diagnose: { notice: NOTICE } }), session({ id: 'bbb222', serial: 'S2', diagnose: { notice: null } })],
    })

    expect(state.tabs.map((t) => [t.serial, t.diagnose, t.diagnoseNotice])).toEqual([
      ['S1', true, NOTICE],
      ['S2', true, null],
    ])
  })

  it('DM-12 평소 세션을 되살린 탭엔 진단 표시가 없다', () => {
    const state = apply(initialState(), { type: 'sessions/loaded', sessions: [session()] })

    expect(state.tabs[0]!.diagnose).toBe(false)
    expect(state.tabs[0]!.diagnoseNotice).toBeNull()
  })

  it('DM-12 설정 화면에서 진단 토글을 켠 탭이 평소 세션을 되찾으면 토글이 아니라 서버를 따른다', () => {
    // 같은 기기에서 CLI 가 평소 세션을 열었다 — 화면의 토글이 켜져 있어도 그 세션은 진단이 아니다.
    let state = apply(initialState(), {
      type: 'tab/patched',
      key: 't1',
      patch: { serial: 'S1', packageName: 'com.x', diagnose: true },
    })

    state = apply(state, { type: 'sessions/loaded', sessions: [session()] })

    expect(state.tabs[0]!.phase).toBe('running')
    expect(state.tabs[0]!.diagnose).toBe(false)
  })

  it('DM-12 측정 중 동기화가 진단 칸을 서버 값으로 맞추고, 여러 번 불려도 같다', () => {
    let state = apply(initialState(), { type: 'sessions/loaded', sessions: [session({ diagnose: { notice: null } })] })
    // 화면 쪽 값이 어긋나 있어도(예: 늦게 온 응답) 다음 동기화가 서버 값으로 되돌린다.
    state = apply(state, { type: 'tab/patched', key: state.tabs[0]!.key, patch: { diagnose: false, diagnoseNotice: 'x' } })

    for (let i = 0; i < 3; i++) {
      state = apply(state, { type: 'sessions/loaded', sessions: [session({ diagnose: { notice: NOTICE } })] })
    }

    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0]!.diagnose).toBe(true)
    expect(state.tabs[0]!.diagnoseNotice).toBe(NOTICE)
  })

  it('DM-12 측정 중 동기화는 진단 → 평소로도 내려간다 — 같은 기기에 평소 세션이 열리면 진단 표시가 꺼진다', () => {
    // GUI 의 진단 세션 탭이 측정 중일 때 CLI 가 `start --force -d <같은 기기>` 로 평소 세션을 열었다.
    // 진단 칸이 있을 때만 맞추면 평소 세션에 진단 배지 · 킥커 · 각주 · 고지가 남는다.
    let state = apply(initialState(), { type: 'sessions/loaded', sessions: [session({ diagnose: { notice: NOTICE } })] })
    expect(state.tabs[0]!.diagnose).toBe(true)

    state = apply(state, { type: 'sessions/loaded', sessions: [session({ id: 'ccc333' })] })

    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0]!.phase).toBe('running')
    expect(state.tabs[0]!.diagnose).toBe(false)
    expect(state.tabs[0]!.diagnoseNotice).toBeNull()
  })

  it('DM-12 밖에서 끝난 진단 세션의 탭은 진단을 물려주지 않는다', () => {
    // 정지 뒤(`resetAfterStop`)와 같은 이유 — 다음 세션이 말없이 진단으로 열리면 안 된다.
    let state = apply(initialState(), { type: 'sessions/loaded', sessions: [session({ diagnose: { notice: NOTICE } })] })

    state = apply(state, { type: 'sessions/loaded', sessions: [] })

    expect(state.tabs[0]!.phase).toBe('setup')
    expect(state.tabs[0]!.diagnose).toBe(false)
    expect(state.tabs[0]!.diagnoseNotice).toBeNull()
  })
})
