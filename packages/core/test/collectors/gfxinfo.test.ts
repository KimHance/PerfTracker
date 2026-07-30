import { describe, expect, it } from 'vitest'
import { diffGfxinfo, parseGfxinfoCounters } from '../../src/collectors/frame/index.js'

/** 실기기(SM-S901N / sdk 36) `dumpsys gfxinfo com.android.settings` 출력 형식 그대로다. */
const dump = (total: number, janky: number): string =>
  [
    'Applications Graphics Acceleration Info:',
    'Uptime: 257948480 Realtime: 257948480',
    '',
    '** Graphics info for pid 12345 [com.android.settings] **',
    `Total frames rendered: ${total}`,
    // **legacy 줄을 먼저 둔다.** 뒤에 두면 느슨한 패턴도 우연히 통과한다 (먼저 만나는 쪽이
    // 이기므로). 순서를 뒤집어야 라벨 매칭이 실제로 무엇을 막는지 드러난다.
    'Janky frames (legacy): 138 (2.09%)',
    `Janky frames: ${janky} (1.43%)`,
    '50th percentile: 5ms',
    'Number Missed Vsync: 43',
    'Number High input latency: 3111',
    'Number Slow UI thread: 71',
    'Number Slow bitmap uploads: 1',
    'Number Slow issue draw commands: 19',
    'Number Frame deadline missed: 94',
    '',
  ].join('\n')

describe('parseGfxinfoCounters', () => {
  it('라벨별 첫 정수를 읽는다 — 괄호 안 퍼센트에 걸리지 않는다', () => {
    const c = parseGfxinfoCounters(dump(11598, 94))!
    expect(c['totalFrames']).toBe(11598)
    expect(c['jankyFrames']).toBe(94)
  })

  /**
   * `Janky frames` 와 `Janky frames (legacy)` 는 **다른 값**이다 (실측 94 vs 138).
   * 라벨을 줄 시작에 고정하지 않으면 둘이 섞인다.
   */
  it('legacy 줄을 본래 값으로 읽지 않는다', () => {
    expect(parseGfxinfoCounters(dump(11598, 94))!['jankyFrames']).not.toBe(138)
  })

  /** Unity·Vulkan·OpenGL 앱은 HWUI 통계를 아예 내지 않는다. 0 으로 채우면 거짓이 된다. */
  it('한 줄도 못 읽으면 null 이다 — 0 이 아니다', () => {
    expect(parseGfxinfoCounters('Applications Graphics Acceleration Info:\n')).toBeNull()
  })
})

describe('diffGfxinfo — 누적값의 전후 차이가 이 세션의 값이다', () => {
  it('after − before 를 낸다', () => {
    const d = diffGfxinfo({ before: dump(11601, 90), after: dump(11813, 93) })!
    expect(d.counters.totalFrames).toBe(212)
    expect(d.counters.jankyFrames).toBe(3)
  })

  /**
   * **음수는 0 이 아니다.** 세션 중 앱 프로세스가 죽으면 누적이 리셋되고, 그때 차이는
   * 이 세션의 값이 아니다. 0 으로 뭉개면 "아무 일도 없었다" 는 없던 사실이 된다.
   */
  it('누적이 리셋됐으면(after < before) null 이다', () => {
    const d = diffGfxinfo({ before: dump(11601, 90), after: dump(10, 1) })!
    expect(d.counters.totalFrames).toBeNull()
    expect(d.counters.jankyFrames).toBeNull()
  })

  it('한쪽 스냅샷이 없으면 통째로 null 이다', () => {
    expect(diffGfxinfo({ before: dump(1, 1), after: null })).toBeNull()
    expect(diffGfxinfo({ before: null, after: dump(1, 1) })).toBeNull()
    expect(diffGfxinfo(undefined)).toBeNull()
  })

  it('HWUI 통계를 안 내는 앱이면 null 이다', () => {
    expect(diffGfxinfo({ before: 'nothing', after: 'nothing' })).toBeNull()
  })
})
