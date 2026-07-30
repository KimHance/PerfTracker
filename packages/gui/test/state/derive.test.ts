import { describe, expect, it } from 'vitest'
import type { AppView, DeviceView } from '../../src/contract/api.js'
import type { Action } from '../../src/web/state/actions.js'
import { busySerials, canStart, filterApps, needsClock, runningCount } from '../../src/web/state/derive.js'
import { type AppState, initialState, newTab } from '../../src/web/state/model.js'
import { reducer } from '../../src/web/state/reducer.js'

const apply = (state: AppState, ...actions: Action[]): AppState => actions.reduce(reducer, state)

function device(serial: string, measuring = false): DeviceView {
  return { serial, model: 'M', state: 'device', spec: null, measuring, metrics: [] }
}

describe('busySerials', () => {
  it('다른 탭이 측정 중인 기기를 점유로 본다', () => {
    let state = initialState()
    state = apply(state, { type: 'tab/added', key: 't2' })
    state = apply(state, { type: 'tab/patched', key: 't1', patch: { serial: 'S1' } })
    state = apply(state, { type: 'session/started', tabKey: 't1', sessionId: 'a', name: 'n', startedAt: 0, unsupported: [] })

    // 한 기기에 두 세션을 걸면 나중 것이 앞 것의 Perfetto 세션을 밀어낸다.
    expect(busySerials(state, 't2').has('S1')).toBe(true)
  })

  it('자기 탭이 쓰는 기기는 점유로 세지 않는다', () => {
    let state = initialState()
    state = apply(state, { type: 'tab/patched', key: 't1', patch: { serial: 'S1' } })
    state = apply(state, { type: 'session/started', tabKey: 't1', sessionId: 'a', name: 'n', startedAt: 0, unsupported: [] })

    expect(busySerials(state, 't1').has('S1')).toBe(false)
  })

  it('서버가 알려 준 진행 중 세션도 점유다', () => {
    // 브라우저를 새로 고쳐 탭 상태가 사라져도 기기의 점유는 그대로다.
    const state = apply(initialState(), { type: 'devices/loaded', devices: [device('S9', true)] })

    expect(busySerials(state).has('S9')).toBe(true)
  })
})

describe('시작 가능 여부', () => {
  const withDevice = (...devices: DeviceView[]): AppState => ({ ...initialState(), devices })
  const ready = { ...newTab('t1'), serial: 'S1', packageName: 'com.x' }

  it('기기와 앱이 둘 다 있어야 시작할 수 있다', () => {
    const s = withDevice(device('S1'))
    expect(canStart(s, newTab('t1'))).toBe(false)
    expect(canStart(s, { ...newTab('t1'), serial: 'S1' })).toBe(false)
    expect(canStart(s, { ...newTab('t1'), packageName: 'com.x' })).toBe(false)
    expect(canStart(s, ready)).toBe(true)
  })

  it('이름은 비어도 시작할 수 있다', () => {
    expect(canStart(withDevice(device('S1')), { ...ready, name: '' })).toBe(true)
  })

  it('고른 기기가 사라졌으면 시작할 수 없다', () => {
    // 케이블을 뽑고 새로고침한 상황. 화면에는 아무것도 선택되지 않은 것처럼 보이는데
    // 버튼만 활성이면 누르는 순간 없는 기기로 세션을 열려 한다 (실측 결함).
    expect(canStart(withDevice(), ready)).toBe(false)
  })

  it('꽂혀 있어도 쓸 수 없는 상태면 시작할 수 없다', () => {
    expect(canStart(withDevice({ ...device('S1'), state: 'unauthorized' }), ready)).toBe(false)
    expect(canStart(withDevice({ ...device('S1'), state: 'offline' }), ready)).toBe(false)
  })

  it('다른 곳에서 측정 중인 기기면 시작할 수 없다', () => {
    expect(canStart(withDevice(device('S1', true)), ready)).toBe(false)
  })
})

describe('기기가 사라지면 선택을 푼다', () => {
  const selected = (): AppState =>
    apply(initialState(), { type: 'devices/loaded', devices: [device('S1')] }, {
      type: 'tab/patched',
      key: 't1',
      patch: { serial: 'S1', packageName: 'com.x', appQuery: '브라우저' },
    })

  it('목록에서 빠지면 기기·앱·검색어가 함께 풀린다', () => {
    const next = apply(selected(), { type: 'devices/loaded', devices: [] })

    expect(next.tabs[0]).toMatchObject({ serial: null, packageName: null, appQuery: '' })
  })

  it('쓸 수 없는 상태로 바뀌어도 푼다', () => {
    const next = apply(selected(), {
      type: 'devices/loaded',
      devices: [{ ...device('S1'), state: 'unauthorized' }],
    })

    expect(next.tabs[0]!.serial).toBeNull()
  })

  it('그대로 있으면 건드리지 않는다', () => {
    const next = apply(selected(), { type: 'devices/loaded', devices: [device('S1')] })

    expect(next.tabs[0]).toMatchObject({ serial: 'S1', packageName: 'com.x' })
  })

  it('측정 중인 탭은 건드리지 않는다', () => {
    /**
     * 케이블이 빠져도 그 세션의 포인터는 살아 있다. 여기서 지우면 GUI 안에서 그 세션을
     * 되찾을 길이 사라진다 — 정리는 `sessions/loaded` 와 `stop` 의 몫이다.
     */
    let state = selected()
    state = apply(state, {
      type: 'session/started',
      tabKey: 't1',
      sessionId: 'a',
      name: 'n',
      startedAt: 0,
      unsupported: [],
    })

    const next = apply(state, { type: 'devices/loaded', devices: [] })

    expect(next.tabs[0]).toMatchObject({ serial: 'S1', phase: 'running' })
  })
})

describe('앱 검색', () => {
  const apps: AppView[] = [
    { label: 'Stream (debug)', packageName: 'com.example.streaming.debug' },
    { label: 'Airbnb', packageName: 'com.airbnb.android' },
  ]

  it('라벨과 패키지명 둘 다로 찾힌다', () => {
    // 사람은 둘 중 아는 쪽으로 검색한다.
    expect(filterApps(apps, 'stream').map((a) => a.label)).toEqual(['Stream (debug)'])
    expect(filterApps(apps, 'example').map((a) => a.label)).toEqual(['Stream (debug)'])
    expect(filterApps(apps, 'airbnb.android').map((a) => a.label)).toEqual(['Airbnb'])
    expect(filterApps(apps, '없는앱')).toHaveLength(0)
  })

  it('대소문자를 가리지 않는다', () => {
    expect(filterApps(apps, 'AiRbNb').map((a) => a.label)).toEqual(['Airbnb'])
  })

  it('빈 검색어는 전부 남긴다', () => {
    expect(filterApps(apps, '   ')).toHaveLength(2)
  })
})

describe('시계', () => {
  it('측정 중 탭이 없으면 시계가 필요 없다', () => {
    // 아무도 안 보는 시계 때문에 500ms 마다 전체를 다시 그릴 이유가 없다.
    const state = initialState()
    expect(needsClock(state)).toBe(false)
    expect(runningCount(state)).toBe(0)

    const running = apply(state, { type: 'session/started', tabKey: 't1', sessionId: 'a', name: 'n', startedAt: 0, unsupported: [] })
    expect(needsClock(running)).toBe(true)
  })
})

