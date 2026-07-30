import { describe, expect, it } from 'vitest'
import { diffGfxinfo, parseGfxinfoCounters, parseGfxinfoHistogram, toHwuiHistogram } from '../../src/collectors/hwui/index.js'

/** 실기기(SM-S901N / sdk 36) `dumpsys gfxinfo com.android.settings` 출력 형식 그대로다. */
const dump = (total: number, janky: number, pid = 12345): string =>
  [
    'Applications Graphics Acceleration Info:',
    'Uptime: 257948480 Realtime: 257948480',
    '',
    `** Graphics info for pid ${pid} [com.android.settings] **`,
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
    // **GPU 히스토그램이 먼저 온다.** 뒤에 두면 느슨한 패턴도 우연히 통과한다.
    'GPU HISTOGRAM: 1ms=686 2ms=5183',
    `HISTOGRAM: 5ms=${total - 10} 6ms=7 8ms=3`,
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
  it('같은 프로세스면 after − before 를 낸다', () => {
    const d = diffGfxinfo({ before: dump(11601, 90), after: dump(11813, 93) })!
    expect(d.collection.counters.totalFrames).toBe(212)
    expect(d.collection.counters.jankyFrames).toBe(3)
    expect(d.processRestarted).toBe(false)
  })

  /**
   * **`--launch` 세션이 항상 이 경우다.** `start` 가 force-stop 후 콜드로 띄우므로 before 는
   * 곧 죽을 프로세스의 것이다. 빼려고 들면(또는 음수라고 버리면) 콜드 스타트를 재는 세션에서
   * 이 지표가 영영 안 나온다 — 실측 Stream: before pid 30912 → after pid 1283.
   */
  it('프로세스가 바뀌었으면 빼지 않고 after 를 그대로 쓴다', () => {
    const d = diffGfxinfo({ before: dump(11601, 90, 30912), after: dump(3221, 40, 1283) })!
    expect(d.collection.counters.totalFrames).toBe(3221)
    expect(d.processRestarted).toBe(true)
  })

  /** 실측에서 before 에는 카운터 줄이 **아예 없었다**. 그때도 after 가 세션값이다. */
  it('시작 쪽 통계가 없어도 after 를 쓴다', () => {
    const before = 'Applications Graphics Acceleration Info:\n** Graphics info for pid 1 [x] **\n'
    const d = diffGfxinfo({ before, after: dump(3221, 40) })!
    expect(d.collection.counters.totalFrames).toBe(3221)
    expect(d.processRestarted).toBe(true)
  })

  /**
   * **같은 프로세스인데 값이 줄었으면 그것은 다른 이야기다.** 카운터가 리셋된 것이고
   * 그 차이는 세션값이 아니다 — 0 으로 뭉개면 "아무 일도 없었다" 는 없던 사실이 된다.
   */
  it('같은 프로세스인데 값이 줄었으면 null 이다', () => {
    const d = diffGfxinfo({ before: dump(11601, 90), after: dump(11813, 1) })!
    expect(d.collection.counters.totalFrames).toBe(212)
    expect(d.collection.counters.jankyFrames).toBeNull()
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

describe('parseGfxinfoHistogram', () => {
  it('HISTOGRAM 줄을 칸으로 읽는다', () => {
    expect(parseGfxinfoHistogram(dump(20, 1))).toEqual([
      { ms: 5, frames: 10 },
      { ms: 6, frames: 7 },
      { ms: 8, frames: 3 },
    ])
  })

  /** `GPU HISTOGRAM` 은 **다른 분포**다. 섞이면 프레임 시간 분포가 통째로 거짓이 된다. */
  it('GPU HISTOGRAM 을 프레임 히스토그램으로 읽지 않는다', () => {
    const bins = parseGfxinfoHistogram(dump(20, 1))!
    expect(bins.some((b) => b.frames === 5183)).toBe(false)
  })

  it('줄이 없으면 null 이다', () => {
    expect(parseGfxinfoHistogram('Total frames rendered: 1\n')).toBeNull()
  })
})

describe('히스토그램 세션 델타', () => {
  it('같은 프로세스면 칸마다 뺀다', () => {
    const d = diffGfxinfo({ before: dump(110, 5), after: dump(130, 8) })!
    // 5ms 칸: (130-10) - (110-10) = 20. 나머지 칸은 그대로라 0 이 되어 빠진다.
    expect(d.collection.histogram).toEqual([{ ms: 5, frames: 20 }])
  })

  it('프로세스가 바뀌면 after 를 그대로 쓴다', () => {
    const d = diffGfxinfo({ before: dump(9999, 90, 30912), after: dump(30, 2, 1283) })!
    expect(d.collection.histogram).toEqual([
      { ms: 5, frames: 20 },
      { ms: 6, frames: 7 },
      { ms: 8, frames: 3 },
    ])
  })
})

describe('toHwuiHistogram', () => {
  /** 분포 렌더러를 두 벌 만들지 않으려고 트레이스 버킷과 같은 모양으로 낸다. */
  it('to_ms 는 다음 칸의 시작이고 마지막만 null 이다', () => {
    expect(toHwuiHistogram([{ ms: 8, frames: 3 }, { ms: 5, frames: 10 }])).toEqual([
      { from_ms: 5, to_ms: 8, count: 10 },
      { from_ms: 8, to_ms: null, count: 3 },
    ])
  })

  it('빈 것은 null 이다', () => {
    expect(toHwuiHistogram([])).toBeNull()
    expect(toHwuiHistogram(null)).toBeNull()
  })
})
