import { describe, expect, it } from 'vitest'
import type { RunView } from '../../src/contract/api.js'
import type { Action } from '../../src/web/state/actions.js'
import { type AppState, initialState, newTab } from '../../src/web/state/model.js'
import { reducer } from '../../src/web/state/reducer.js'

const apply = (state: AppState, ...actions: Action[]): AppState => actions.reduce(reducer, state)

function run(id: string, at: string): RunView {
  return {
    id,
    name: id,
    runDir: `runs/${id}`,
    serial: 'S1',
    model: 'M',
    packageName: 'com.x',
    appLabel: 'X',
    appVersion: '1.0',
    at,
    durationMs: 1000,
    launch: true,
    unsupportedCount: 0,
    warningCount: 0,
    markCount: 0,
  }
}

describe('탭', () => {
  it('탭이 하나뿐이면 닫아도 남는다', () => {
    const state = initialState()
    const next = apply(state, { type: 'tab/closed', key: state.tabs[0]!.key })
    // 탭이 0개면 사용자가 아무것도 할 수 없는 화면이 된다.
    expect(next.tabs).toHaveLength(1)
  })

  it('활성 탭을 닫으면 이웃이 활성이 된다', () => {
    let state = initialState()
    state = apply(state, { type: 'tab/added', key: 't2' }, { type: 'tab/added', key: 't3' })
    state = apply(state, { type: 'tab/selected', key: 't2' })

    const next = apply(state, { type: 'tab/closed', key: 't2' })

    expect(next.tabs.map((t) => t.key)).toEqual(['t1', 't3'])
    expect(next.activeTabKey).toBe('t3')
  })

  it('닫힌 탭에 늦게 도착한 갱신은 버려진다', () => {
    let state = initialState()
    state = apply(state, { type: 'tab/added', key: 't2' }, { type: 'tab/closed', key: 't2' })

    const next = apply(state, { type: 'tab/patched', key: 't2', patch: { name: '유령' } })

    expect(next.tabs.some((t) => t.name === '유령')).toBe(false)
  })
})

describe('세션 정지', () => {
  const started = (): AppState => {
    let state = initialState()
    const key = state.tabs[0]!.key
    state = apply(state, {
      type: 'tab/patched',
      key,
      patch: { serial: 'S1', packageName: 'com.x', name: '홈 스크롤', launch: false, force: true },
    })
    return apply(state, { type: 'session/started', tabKey: key, sessionId: 'a', name: '홈 스크롤', startedAt: 1000, unsupported: [] })
  }

  it('기기와 --launch/--force 는 남고 앱·이름·마킹은 비워진다', () => {
    let state = started()
    const key = state.tabs[0]!.key
    state = apply(state, { type: 'marks/loaded', tabKey: key, marks: [{ offsetMs: 500, label: '진입' }] })

    const next = apply(state, { type: 'session/stopped', tabKey: key, run: run('r1', '2026-07-27T10:00:00') })
    const tab = next.tabs[0]!

    expect(tab.phase).toBe('setup')
    expect(tab.serial).toBe('S1')
    expect(tab.launch).toBe(false)
    expect(tab.force).toBe(true)
    expect(tab.packageName).toBeNull()
    expect(tab.name).toBe('')
    expect(tab.marks).toEqual([])
  })

  it('여러 탭이 동시에 끝나도 기록은 최신순이다', () => {
    let state = started()
    const key = state.tabs[0]!.key

    // 늦게 끝난 세션이 먼저 도착하고, 먼저 시작된 세션이 뒤에 도착하는 순서를 만든다.
    state = apply(state, { type: 'session/stopped', tabKey: key, run: run('late', '2026-07-27T10:00:00') })
    state = apply(state, { type: 'session/started', tabKey: key, sessionId: 'b', name: 'x', startedAt: 2000, unsupported: [] })
    state = apply(state, { type: 'session/stopped', tabKey: key, run: run('early', '2026-07-27T09:00:00') })

    expect(state.runs.map((r) => r.id)).toEqual(['late', 'early'])
  })

  it('정지 결과가 없으면 기록을 만들지 않고 탭만 되돌린다', () => {
    const state = started()
    const next = apply(state, { type: 'session/stopped', tabKey: state.tabs[0]!.key, run: null })

    expect(next.runs).toHaveLength(0)
    expect(next.tabs[0]!.phase).toBe('setup')
  })

  it('DM-12 정지 뒤 진단은 남지 않는다 — 토글 · 고지 둘 다 비고 --launch/--force 는 남는다', () => {
    // 진단은 수치의 성질을 바꾸는 옵션이다. 다음 세션이 말없이 진단으로 열리면 평소 기록인 줄 알고
    // 나란히 놓게 된다 — CLI 도 start 마다 --diagnose 를 줘야 진단이다.
    let state = started()
    const key = state.tabs[0]!.key
    state = apply(state, {
      type: 'tab/patched',
      key,
      patch: { diagnose: true, diagnoseNotice: '앱 slice 열림 모름 — sdk 30 · debuggable 아님' },
    })

    for (const result of [run('r1', '2026-07-27T10:00:00'), null]) {
      const tab = apply(state, { type: 'session/stopped', tabKey: key, run: result }).tabs[0]!
      expect(tab.diagnose).toBe(false)
      expect(tab.diagnoseNotice).toBeNull()
      expect(tab.launch).toBe(false)
      expect(tab.force).toBe(true)
    }
  })
})

describe('마킹', () => {
  it('서버 목록을 그대로 싣고 입력 초안을 비운다', () => {
    let state = initialState()
    const key = state.tabs[0]!.key
    state = apply(state, { type: 'tab/patched', key, patch: { markDraft: '스크롤' } })

    state = apply(state, {
      type: 'marks/loaded',
      tabKey: key,
      // 서버는 시간순으로 준다. 화면이 최신순으로 뒤집어 그릴 뿐 저장 순서는 건드리지 않는다 —
      // 삭제에 쓰는 인덱스가 서버의 인덱스와 같아야 한다.
      marks: [
        { offsetMs: 100, label: '앱 진입' },
        { offsetMs: 900, label: '스크롤' },
      ],
    })

    expect(state.tabs[0]!.marks.map((m) => m.label)).toEqual(['앱 진입', '스크롤'])
    expect(state.tabs[0]!.markDraft).toBe('')
  })
})

describe('오류와 로딩', () => {
  it('실패는 로딩 오버레이를 함께 걷는다', () => {
    let state = initialState()
    state = apply(state, { type: 'loading/began', loading: { label: 'x', command: 'y' } })

    state = apply(state, { type: 'error/raised', message: '실패' })

    // 오버레이가 남으면 화면이 영원히 잠긴다.
    expect(state.loading).toBeNull()
    expect(state.error).toBe('실패')
  })
})

describe('CLI 로그', () => {
  it('최신이 위로 오고 40건에서 잘린다', () => {
    let state = initialState()
    for (let i = 0; i < 45; i++) {
      state = apply(state, { type: 'cli/logged', at: '00:00:00', command: `cmd${i}` })
    }

    expect(state.cliLog).toHaveLength(40)
    expect(state.cliLog[0]!.command).toBe('cmd44')
    expect(state.cliLog[39]!.command).toBe('cmd5')
  })
})

describe('기록', () => {
  it('한 번 열면 NEW 가 사라진다', () => {
    let state = initialState()
    state = apply(state, {
      type: 'session/stopped',
      tabKey: state.tabs[0]!.key,
      run: run('r1', '2026-07-27T10:00:00'),
    })
    expect(state.freshRunIds).toContain('r1')

    state = apply(state, { type: 'run/opened', runId: 'r1' })

    expect(state.freshRunIds).not.toContain('r1')
  })

  it('탭을 새로 열면 기본 옵션이 그대로다', () => {
    const tab = newTab('tX')
    expect(tab.launch).toBe(true)
    expect(tab.force).toBe(true)
    expect(tab.offline).toBe(false)
    // 진단은 켤 때만 — 평소 세션이 기본이다 (`start` 도 `--diagnose` 를 줘야 진단이다).
    expect(tab.diagnose).toBe(false)
    expect(tab.diagnoseNotice).toBeNull()
    // 저장 위치는 탭이 들고 있지 않다 — 서버가 정하고 화면은 env 로 받아 표시만 한다.
  })
})
