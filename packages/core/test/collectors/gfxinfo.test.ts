import { describe, expect, it } from 'vitest'
import { percentile } from '../../src/collectors/frame/index.js'
import {
  diffGfxinfo,
  parseGfxinfoCounters,
  parseGfxinfoHistogram,
  percentileFromHistogram,
  toHwuiHistogram,
} from '../../src/collectors/hwui/index.js'

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
  /**
   * **0 인 칸을 버리지 않는다.** 분포는 어디가 비어 있는가가 곧 정보이고, 있는 칸만 남기면
   * 축이 세션마다 달라져 두 결과를 나란히 볼 수 없다.
   */
  it('같은 프로세스면 칸마다 빼고, 0 이 된 칸도 남긴다', () => {
    const d = diffGfxinfo({ before: dump(110, 5), after: dump(130, 8) })!
    expect(d.collection.histogram).toEqual([
      { ms: 5, frames: 20 },
      { ms: 6, frames: 0 },
      { ms: 8, frames: 0 },
    ])
  })

  it('프로세스가 바뀌면 after 를 칸째로 그대로 쓴다', () => {
    const d = diffGfxinfo({ before: dump(9999, 90, 30912), after: dump(30, 2, 1283) })!
    expect(d.collection.histogram).toEqual([
      { ms: 5, frames: 20 },
      { ms: 6, frames: 7 },
      { ms: 8, frames: 3 },
    ])
  })
})

describe('toHwuiHistogram', () => {
  /**
   * **칸 이름은 그 칸의 끝이다.** `6ms=155` 는 6ms 걸린 프레임 수이므로 구간으로는 `[5, 6)`,
   * 첫 칸 `5ms` 는 "5ms 이하 전부" 라 `[0, 5)` 다. 이름을 그대로 `from_ms` 에 넣으면 한 칸씩
   * 밀리고 0–5ms 구간이 사라진 것처럼 보인다.
   */
  it('칸 이름을 끝으로 읽는다 — 0-5, 5-6, 6-7', () => {
    const out = toHwuiHistogram([{ ms: 5, frames: 10 }, { ms: 6, frames: 4 }, { ms: 7, frames: 3 }])!
    expect(out.slice(0, 3)).toEqual([
      { from_ms: 0, to_ms: 5, count: 10 },
      { from_ms: 5, to_ms: 6, count: 4 },
      { from_ms: 6, to_ms: 7, count: 3 },
    ])
  })

  /**
   * **700ms 에서 자르되 버리지 않는다.** 프레임워크 칸은 4950ms 까지 가는데 실제 데이터는
   * 앞쪽에 몰려 있어 그대로 그리면 화면의 3분의 2가 빈다. 넘는 것은 마지막 한 칸으로 접어
   * 칸의 합이 전체 프레임 수와 같게 둔다.
   */
  it('700ms 를 넘는 것을 마지막 한 칸으로 접는다 — 합이 유지된다', () => {
    const out = toHwuiHistogram([
      { ms: 5, frames: 10 },
      { ms: 700, frames: 2 },
      { ms: 1500, frames: 3 },
      { ms: 4950, frames: 1 },
    ])!
    // 700 칸 자체는 남는다 — `[650, 700)` 은 잘라 낼 구간이 아니다.
    expect(out.map((b) => `${b.from_ms}-${b.to_ms}=${b.count}`)).toEqual([
      '0-5=10',
      '5-700=2',
      '700-null=4',
    ])
    expect(out.reduce((n, b) => n + b.count, 0)).toBe(16)
  })

  it('700 아래는 0 인 칸도 남긴다', () => {
    const out = toHwuiHistogram([{ ms: 5, frames: 10 }, { ms: 6, frames: 0 }, { ms: 7, frames: 1 }])!
    expect(out.map((b) => b.count)).toEqual([10, 0, 1, 0])
  })

  it('빈 것은 null 이다', () => {
    expect(toHwuiHistogram([])).toBeNull()
    expect(toHwuiHistogram(null)).toBeNull()
  })
})

/**
 * **백분위는 세션 히스토그램에서 낸다.** `dumpsys gfxinfo` 도 자기 백분위를 찍지만 그것은
 * 프로세스 시작 이후 누적이라, 그대로 실으면 분포와 백분위가 서로 다른 구간을 말하게 된다.
 *
 * 실기기 교차 확인(Stream `--launch`, 프로세스가 세션 안에서 시작해 누적=세션):
 * 우리 계산 8/25/38/89 = 기기 보고 8/25/38/89.
 */
describe('percentileFromHistogram', () => {
  const bins = [
    { ms: 5, frames: 50 },
    { ms: 10, frames: 30 },
    { ms: 20, frames: 15 },
    { ms: 40, frames: 5 },
  ]

  it('누적 개수로 자리를 찾는다', () => {
    expect(percentileFromHistogram(bins, 50)).toBe(5)
    expect(percentileFromHistogram(bins, 90)).toBe(20)
    expect(percentileFromHistogram(bins, 99)).toBe(40)
  })

  /**
   * 지속 시간 백분위와 **같은 규칙**(ceil 랭크)이어야 두 화면의 같은 이름이 같은 뜻이 된다.
   * 총합이 홀수여야 ceil 과 floor 가 갈린다 — 짝수로 재면 이 규칙을 지키는지 알 수 없다.
   */
  it('ceil 랭크를 쓴다 — 지속 시간 백분위와 같은 규칙', () => {
    // 3장 중 p50: ceil(1.5)=2 번째 → 9. floor 였다면 1 번째 → 5 가 된다.
    const odd = [{ ms: 5, frames: 1 }, { ms: 9, frames: 2 }]
    expect(percentileFromHistogram(odd, 50)).toBe(9)
    // 같은 입력을 지속 시간 쪽 함수에 넣어도 같은 답이 나와야 한다.
    expect(percentile([5, 9, 9], 50)).toBe(9)
  })

  it('비었으면 null 이다 — 0 이 아니다', () => {
    expect(percentileFromHistogram([], 50)).toBeNull()
  })
})
