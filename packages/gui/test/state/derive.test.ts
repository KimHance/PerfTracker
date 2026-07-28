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
    state = apply(state, { type: 'session/started', tabKey: 't1', sessionId: 'a', name: 'n', startedAt: 0 })

    // 한 기기에 두 세션을 걸면 나중 것이 앞 것의 Perfetto 세션을 밀어낸다.
    expect(busySerials(state, 't2').has('S1')).toBe(true)
  })

  it('자기 탭이 쓰는 기기는 점유로 세지 않는다', () => {
    let state = initialState()
    state = apply(state, { type: 'tab/patched', key: 't1', patch: { serial: 'S1' } })
    state = apply(state, { type: 'session/started', tabKey: 't1', sessionId: 'a', name: 'n', startedAt: 0 })

    expect(busySerials(state, 't1').has('S1')).toBe(false)
  })

  it('서버가 알려 준 진행 중 세션도 점유다', () => {
    // 브라우저를 새로 고쳐 탭 상태가 사라져도 기기의 점유는 그대로다.
    const state = apply(initialState(), { type: 'devices/loaded', devices: [device('S9', true)] })

    expect(busySerials(state).has('S9')).toBe(true)
  })
})

describe('시작 가능 여부', () => {
  it('기기와 앱이 둘 다 있어야 시작할 수 있다', () => {
    expect(canStart(newTab('t'))).toBe(false)
    expect(canStart({ ...newTab('t'), serial: 'S1' })).toBe(false)
    expect(canStart({ ...newTab('t'), packageName: 'com.x' })).toBe(false)
    expect(canStart({ ...newTab('t'), serial: 'S1', packageName: 'com.x' })).toBe(true)
  })

  it('이름은 비어도 시작할 수 있다', () => {
    expect(canStart({ ...newTab('t'), serial: 'S1', packageName: 'com.x', name: '' })).toBe(true)
  })
})

describe('앱 검색', () => {
  const apps: AppView[] = [
    { label: 'Stream (debug)', packageName: 'com.example.streaming.debug', versionCode: 1 },
    { label: 'Airbnb', packageName: 'com.airbnb.android', versionCode: 2 },
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

    const running = apply(state, { type: 'session/started', tabKey: 't1', sessionId: 'a', name: 'n', startedAt: 0 })
    expect(needsClock(running)).toBe(true)
  })
})
