import { describe, expect, it } from 'vitest'
import { type AppProcessCandidate, resolveAppProcess } from '../../src/collectors/appProcess.js'

const PKG = 'com.foo.bar'

const main: AppProcessCandidate = { upid: 5, pid: 24193, name: PKG }
const remote: AppProcessCandidate = { upid: 6, pid: 24290, name: `${PKG}:remote` }
const push: AppProcessCandidate = { upid: 7, pid: 24101, name: `${PKG}:push` }
/** 갓 fork 된 앱 프로세스가 트레이스에 굳어 있는 모습 (에뮬레이터 실측). */
const stale: AppProcessCandidate = { upid: 309, pid: 6037, name: 'zygote64' }

describe('resolveAppProcess — 트레이스 이름으로 확인되는 경우', () => {
  it('패키지명과 정확히 같은 프로세스를 먼저 고른다', () => {
    const r = resolveAppProcess([remote, main, push], PKG, null)!
    expect(r.candidate).toBe(main)
    expect(r.name).toBe(PKG)
    expect(r.match).toBe('trace_name')
  })

  it('메인 프로세스가 없으면 pid 가 가장 작은 서브프로세스를 고른다', () => {
    const r = resolveAppProcess([remote, push], PKG, null)!
    expect(r.candidate).toBe(push)
    expect(r.name).toBe(`${PKG}:push`)
    expect(r.match).toBe('trace_name')
  })

  it('접두어만 같은 다른 패키지를 잡지 않는다', () => {
    expect(resolveAppProcess([{ upid: 9, pid: 1, name: 'com.foo.barbaz' }], PKG, null)).toBeNull()
  })

  it('이름이 null 인 후보는 무시한다', () => {
    expect(resolveAppProcess([{ upid: 1, pid: 2, name: null }], PKG, null)).toBeNull()
  })

  it('후보가 없으면 null 이다', () => {
    expect(resolveAppProcess([], PKG, null)).toBeNull()
  })
})

describe('resolveAppProcess — 캡처한 pid 로만 확인되는 경우', () => {
  it('트레이스 이름이 zygote64 로 굳어 있어도 pid 로 찾아낸다', () => {
    const r = resolveAppProcess([stale], PKG, 6037)!
    expect(r.candidate).toBe(stale)
    expect(r.match).toBe('capture_pid')
    // 트레이스가 아는 이름("zygote64")이 아니라, 캡처 시점에 기기가 확인해 준 이름을 쓴다.
    expect(r.name).toBe(PKG)
    expect(r.traceName).toBe('zygote64')
  })

  it('pid 를 모르면 낡은 이름을 추측으로 메우지 않는다', () => {
    // 예전에는 "시스템 프로세스를 뺀 최다 프레임" 휴리스틱이 여기서 zygote64 를 골라
    // 확인되지 않은 이름을 사실처럼 내보냈다.
    expect(resolveAppProcess([stale], PKG, null)).toBeNull()
  })

  it('캡처한 pid 가 트레이스에 없으면 null 이다', () => {
    expect(resolveAppProcess([stale], PKG, 9999)).toBeNull()
  })

  it('시스템 프로세스만 있으면 null 이다', () => {
    // 잠금화면 세션이 실제로 이렇게 나온다 — 450프레임이 전부 surfaceflinger 였다.
    expect(
      resolveAppProcess([{ upid: 1, pid: 1, name: '/system/bin/surfaceflinger' }], PKG, null),
    ).toBeNull()
  })

  it('pid 로 찾은 프로세스의 이름이 마침 맞으면 트레이스 이름으로 확인된 것이다', () => {
    const r = resolveAppProcess([main], PKG, 24193)!
    expect(r.match).toBe('trace_name')
    expect(r.name).toBe(PKG)
  })

  it('이름이 맞는 다른 프로세스가 있어도 캡처한 pid 가 우선이다', () => {
    // 세션 중에 앱이 죽고 다시 뜨면 같은 이름의 upid 가 둘이 된다.
    // 우리가 띄운 그 프로세스가 무엇인지 아는 것은 pid 뿐이다.
    const r = resolveAppProcess([main, { upid: 8, pid: 30000, name: PKG }], PKG, 30000)!
    expect(r.candidate.upid).toBe(8)
    expect(r.match).toBe('trace_name')
  })
})
