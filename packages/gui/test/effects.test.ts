import { describe, expect, it } from 'vitest'
import type { RunView, StartRequest, StopRequest } from '../src/contract/api.js'
import type { ApiClient } from '../src/web/api/client.js'
import { addMark, startSession, stopSession } from '../src/web/effects/effects.js'
import type { Action } from '../src/web/state/actions.js'
import { newTab, type Tab } from '../src/web/state/model.js'

/** 어떤 메서드가 불렸는지 기록만 하는 가짜 클라이언트. */
function spyApi(overrides: Partial<ApiClient> = {}): { api: ApiClient; calls: string[] } {
  const calls: string[] = []
  const note =
    <T>(name: string, value: T) =>
    async (): Promise<T> => {
      calls.push(name)
      return value
    }

  const api: ApiClient = {
    env: note('env', { version: '0.1.0', adbPath: null }),
    doctor: note('doctor', []),
    devices: note('devices', []),
    apps: note('apps', []),
    start: note('start', {
      id: 's1',
      name: 'n',
      serial: 'S1',
      runDir: 'runs/x',
      startedAt: '2026-07-27T10:00:00.000Z',
      unsupported: [],
    }),
    stop: note('stop', {} as RunView),
    abort: note('abort', undefined),
    runs: note('runs', []),
    renameRun: note('renameRun', {} as RunView),
    deleteRun: note('deleteRun', undefined),
    clearRuns: note('clearRuns', undefined),
    ...overrides,
  }
  return { api, calls }
}

function collector(): { dispatch: (a: Action) => void; actions: Action[] } {
  const actions: Action[] = []
  return { dispatch: (a) => actions.push(a), actions }
}

const running = (): Tab => ({ ...newTab('t1'), serial: 'S1', packageName: 'com.x', phase: 'running', startedAt: 1000 })

describe('측정 창', () => {
  it('마킹은 기기에 아무것도 보내지 않는다', () => {
    // core 규칙 1 이 화면 쪽에서 깨지는 가장 그럴듯한 경로가 여기다 — 마킹을 "기기에
    // 기록" 하려는 순간 측정 창 안에서 adb 가 나간다.
    const { api, calls } = spyApi()
    const { dispatch, actions } = collector()

    addMark({ api, dispatch }, running(), '스크롤 시작', 4000)

    expect(calls).toEqual([])
    expect(actions.map((a) => a.type)).toEqual(['mark/added', 'cli/logged'])
  })

  it('마킹은 세션 시작으로부터의 경과로 기록된다', () => {
    const { api } = spyApi()
    const { dispatch, actions } = collector()

    addMark({ api, dispatch }, running(), '진입', 4500)

    const added = actions.find((a) => a.type === 'mark/added')
    expect(added).toMatchObject({ label: '진입', offsetMs: 3500 })
  })

  it('빈 라벨은 마킹하지 않는다', () => {
    const { api } = spyApi()
    const { dispatch, actions } = collector()

    addMark({ api, dispatch }, running(), '   ', 4000)

    expect(actions).toEqual([])
  })
})

describe('정지', () => {
  it('쌓아 둔 마킹을 이때 한 번에 보낸다', async () => {
    const sent: StopRequest[] = []
    const { api } = spyApi({
      stop: async (_serial: string, req: StopRequest) => {
        sent.push(req)
        return {} as RunView
      },
    })
    const { dispatch } = collector()
    const tab: Tab = {
      ...running(),
      marks: [
        { key: 'm2', label: '스크롤', offsetMs: 3000 },
        { key: 'm1', label: '진입', offsetMs: 500 },
      ],
    }

    await stopSession({ api, dispatch }, tab)

    // 내부 키(`key`)는 서버로 나가지 않는다 — 계약에 없는 필드다.
    expect(sent).toEqual([
      {
        offline: false,
        marks: [
          { label: '스크롤', offsetMs: 3000 },
          { label: '진입', offsetMs: 500 },
        ],
      },
    ])
  })
})

describe('시작', () => {
  it('이름이 비면 null 로 보내 서버가 붙이게 한다', async () => {
    const sent: StartRequest[] = []
    const { api } = spyApi({
      start: async (req: StartRequest) => {
        sent.push(req)
        return {
          id: 's1',
          name: '세션-1',
          serial: req.serial,
          runDir: 'runs/x',
          startedAt: '2026-07-27T10:00:00.000Z',
          unsupported: [],
        }
      },
    })
    const { dispatch, actions } = collector()

    await startSession({ api, dispatch }, { ...newTab('t1'), serial: 'S1', packageName: 'com.x', name: '  ' })

    expect(sent[0]?.name).toBeNull()
    // 경과 시간의 기준은 브라우저 시계가 아니라 서버가 준 시작 시각이다.
    const started = actions.find((a) => a.type === 'session/started')
    expect(started).toMatchObject({ name: '세션-1', startedAt: Date.parse('2026-07-27T10:00:00.000Z') })
  })

  it('기기나 앱이 없으면 아무것도 부르지 않는다', async () => {
    const { api, calls } = spyApi()
    const { dispatch } = collector()

    await startSession({ api, dispatch }, newTab('t1'))

    expect(calls).toEqual([])
  })

  it('실패하면 오버레이를 걷고 오류를 올린다', async () => {
    const { api } = spyApi({
      start: async () => {
        throw new Error('이미 이 기기에 세션이 있습니다')
      },
    })
    const { dispatch, actions } = collector()

    await startSession({ api, dispatch }, { ...newTab('t1'), serial: 'S1', packageName: 'com.x' })

    expect(actions.map((a) => a.type)).toContain('error/raised')
    // 실패했는데 측정 중 화면으로 넘어가면 있지도 않은 세션의 타이머가 돈다.
    expect(actions.map((a) => a.type)).not.toContain('session/started')
  })
})
