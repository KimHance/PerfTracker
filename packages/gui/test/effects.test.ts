import { describe, expect, it } from 'vitest'
import type { MarkView, RunView, StartRequest, StopRequest } from '../src/contract/api.js'
import type { ApiClient } from '../src/web/api/client.js'
import { addMark, selectApp, startSession, stopSession } from '../src/web/effects/effects.js'
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
    env: note('env', { version: '0.1.0', adbPath: null, outDir: 'runs' }),
    doctor: note('doctor', []),
    devices: note('devices', []),
    sessions: note('sessions', []),
    apps: note('apps', []),
    appDetail: note('appDetail', { packageName: 'com.x', versionName: null }),
    start: note('start', {
      id: 's1',
      name: 'n',
      serial: 'S1',
      runDir: 'runs/x',
      startedAt: '2026-07-27T10:00:00.000Z',
      unsupported: [],
      command: 'perftracker start (가짜)',
    }),
    marks: note('marks', [] as MarkView[]),
    addMark: note('addMark', [] as MarkView[]),
    removeMark: note('removeMark', [] as MarkView[]),
    stop: note('stop', { run: {} as RunView, command: 'perftracker stop (가짜)' }),
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

describe('앱 선택', () => {
  it('고른 앱 하나만 버전을 읽는다', async () => {
    const asked: string[] = []
    const { api } = spyApi({
      appDetail: async (_serial: string, pkg: string) => {
        asked.push(pkg)
        return { packageName: pkg, versionName: '30.0.0.67' }
      },
    })
    const { dispatch, actions } = collector()

    await selectApp({ api, dispatch }, 't1', 'S1', 'com.sec.android.app.sbrowser')

    // 목록 전체가 아니라 딱 하나다 — 82개에 돌리면 adb 왕복이 82번이다.
    expect(asked).toEqual(['com.sec.android.app.sbrowser'])
    expect(actions.find((a) => a.type === 'appVersion/loaded')).toMatchObject({ versionName: '30.0.0.67' })
  })

  it('버전을 못 읽어도 선택은 유지된다', async () => {
    // 버전은 부가 정보다. 못 읽었다고 앱을 못 고르게 하면 측정 자체가 막힌다.
    const { api } = spyApi({
      appDetail: async () => {
        throw new Error('dumpsys 실패')
      },
    })
    const { dispatch, actions } = collector()

    await selectApp({ api, dispatch }, 't1', 'S1', 'com.x')

    expect(actions.find((a) => a.type === 'tab/patched')).toMatchObject({ patch: { packageName: 'com.x' } })
    // 모르는 것은 null 이다 — 오류 배너를 띄우지도, 없는 버전을 지어내지도 않는다.
    expect(actions.find((a) => a.type === 'appVersion/loaded')).toMatchObject({ versionName: null })
    expect(actions.map((a) => a.type)).not.toContain('error/raised')
  })
})

describe('마킹', () => {
  it('서버가 준 목록으로 통째로 바뀐다', async () => {
    // 화면이 자기 목록을 따로 고치면 같은 세션에 `perftracker mark` 로 남긴 마킹과 어긋난다.
    const server: MarkView[] = [
      { offsetMs: 1000, label: 'CLI 가 남긴 것' },
      { offsetMs: 3000, label: '스크롤 시작' },
    ]
    const { api } = spyApi({ addMark: async () => server })
    const { dispatch, actions } = collector()

    await addMark({ api, dispatch }, running(), '스크롤 시작')

    expect(actions.find((a) => a.type === 'marks/loaded')).toMatchObject({ marks: server })
  })

  it('보내기 전에 앞뒤 공백을 뗀다', async () => {
    const sent: string[] = []
    const { api } = spyApi({
      addMark: async (_serial: string, label: string) => {
        sent.push(label)
        return []
      },
    })
    const { dispatch } = collector()

    await addMark({ api, dispatch }, running(), '  광고 재생  ')

    expect(sent).toEqual(['광고 재생'])
  })

  it('빈 라벨은 서버를 부르지 않는다', async () => {
    const { api, calls } = spyApi()
    const { dispatch, actions } = collector()

    await addMark({ api, dispatch }, running(), '   ')

    expect(calls).toEqual([])
    expect(actions).toEqual([])
  })

  it('실패해도 화면이 마킹을 남긴 척하지 않는다', async () => {
    const { api } = spyApi({
      addMark: async () => {
        throw new Error('세션이 없습니다')
      },
    })
    const { dispatch, actions } = collector()

    await addMark({ api, dispatch }, running(), '진입')

    expect(actions.map((a) => a.type)).toContain('error/raised')
    expect(actions.map((a) => a.type)).not.toContain('marks/loaded')
  })
})

describe('정지', () => {
  it('마킹을 실어 보내지 않는다 — 이미 서버에 있다', async () => {
    const sent: StopRequest[] = []
    const { api } = spyApi({
      stop: async (_serial: string, req: StopRequest) => {
        sent.push(req)
        return { run: {} as RunView, command: 'perftracker stop -d S1' }
      },
    })
    const { dispatch } = collector()

    await stopSession({ api, dispatch }, { ...running(), offline: true })

    expect(sent).toEqual([{ offline: true }])
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
          command: 'perftracker start (가짜)',
        }
      },
    })
    const { dispatch, actions } = collector()

    await startSession({ api, dispatch }, { ...newTab('t1'), serial: 'S1', packageName: 'com.x', name: '  ' }, 'runs')

    expect(sent[0]?.name).toBeNull()
    // 경과 시간의 기준은 브라우저 시계가 아니라 서버가 준 시작 시각이다.
    const started = actions.find((a) => a.type === 'session/started')
    expect(started).toMatchObject({ name: '세션-1', startedAt: Date.parse('2026-07-27T10:00:00.000Z') })
  })

  it('기기나 앱이 없으면 아무것도 부르지 않는다', async () => {
    const { api, calls } = spyApi()
    const { dispatch } = collector()

    await startSession({ api, dispatch }, newTab('t1'), 'runs')

    expect(calls).toEqual([])
  })

  it('실패하면 오버레이를 걷고 오류를 올린다', async () => {
    const { api } = spyApi({
      start: async () => {
        throw new Error('이미 이 기기에 세션이 있습니다')
      },
    })
    const { dispatch, actions } = collector()

    await startSession({ api, dispatch }, { ...newTab('t1'), serial: 'S1', packageName: 'com.x' }, 'runs')

    expect(actions.map((a) => a.type)).toContain('error/raised')
    // 실패했는데 측정 중 화면으로 넘어가면 있지도 않은 세션의 타이머가 돈다.
    expect(actions.map((a) => a.type)).not.toContain('session/started')
  })
})
