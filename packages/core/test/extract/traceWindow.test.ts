import { describe, expect, it } from 'vitest'
import { parseDeviceClockSkewMs } from '../../src/device/clock.js'
import { computeTraceWindow, TRACE_WINDOW_SQL } from '../../src/extract/traceWindow.js'

/**
 * 이 도구에는 **0초가 둘**이다 — 시계열은 트레이스 시작(기기 시계), 마킹은 세션 시작
 * (호스트 시계). 이 파일은 그 둘을 잇는 계산을 지킨다. 틀리면 마킹이 어긋난 자리에
 * 찍히면서 맞는 것처럼 보인다.
 */
describe('computeTraceWindow', () => {
  // 실기기(SM-S901N) 값에서 온 숫자다: 세션 24.57초 · 트레이스 23.69초 · 시계 차이 -362ms.
  const SESSION_START_MS = 1_785_315_957_000
  const SPAN_NS = 23_688_826_000
  const SKEW_MS = -362
  // 트레이스는 세션 시작 0.88초 뒤에 시작했다. 기기 벽시계는 호스트보다 362ms 느리다.
  const TRACE_START_REALTIME_NS = (SESSION_START_MS + 880 + SKEW_MS) * 1e6

  it('축의 오른쪽 끝은 트레이스가 덮은 구간이다', () => {
    const w = computeTraceWindow(SPAN_NS, TRACE_START_REALTIME_NS, SESSION_START_MS, SKEW_MS)
    expect(w.spanMs).toBe(23_689)
  })

  it('기기 시계 차이를 빼야 세션 시작과 견줄 수 있다', () => {
    const w = computeTraceWindow(SPAN_NS, TRACE_START_REALTIME_NS, SESSION_START_MS, SKEW_MS)
    expect(w.startOffsetMs).toBe(880)
  })

  /** 362ms 를 무시하면 offset 이 그만큼 틀린다 — 1초 눈금에서 한 칸을 가르는 크기다. */
  it('시계 차이를 0 으로 두면 offset 이 그만큼 어긋난다', () => {
    const wrong = computeTraceWindow(SPAN_NS, TRACE_START_REALTIME_NS, SESSION_START_MS, 0)
    expect(wrong.startOffsetMs).toBe(880 + SKEW_MS)
  })

  /**
   * **모르면 옮기지 않는다.** 0 으로 가정하면 마킹이 어긋난 자리에 찍히면서 맞는 것처럼
   * 보인다 — 틀린 줄 모르는 쪽이 더 나쁘다.
   */
  it('시계 차이를 모르면 offset 은 null 이다 — 0 이 아니다', () => {
    for (const skew of [null, undefined]) {
      const w = computeTraceWindow(SPAN_NS, TRACE_START_REALTIME_NS, SESSION_START_MS, skew)
      expect(w.startOffsetMs).toBeNull()
      // 축은 여전히 그릴 수 있다. 둘은 따로 성립한다.
      expect(w.spanMs).toBe(23_689)
    }
  })

  it('트레이스가 벽시계를 모르면(clock_snapshot 없음) offset 은 null 이다', () => {
    expect(computeTraceWindow(SPAN_NS, null, SESSION_START_MS, SKEW_MS).startOffsetMs).toBeNull()
  })

  it('span 을 못 읽어도 offset 은 낼 수 있다', () => {
    const w = computeTraceWindow(null, TRACE_START_REALTIME_NS, SESSION_START_MS, SKEW_MS)
    expect(w.spanMs).toBeNull()
    expect(w.startOffsetMs).toBe(880)
  })

  it('SQL 이 두 값을 한 번에 묻는다', () => {
    expect(TRACE_WINDOW_SQL).toContain('trace_bounds')
    expect(TRACE_WINDOW_SQL).toContain('TO_REALTIME')
  })
})

describe('parseDeviceClockSkewMs', () => {
  /** 왕복 중점을 쓴다 — 답이 만들어진 시점은 호출 전후 어딘가다. */
  it('왕복의 중점을 기준으로 잰다', () => {
    const deviceNs = '1785315958000000000'
    // 호스트 1785315958100 ~ 1785315958140 → 중점 …120. 기기는 그보다 120ms 느리다.
    expect(parseDeviceClockSkewMs(deviceNs, 1_785_315_958_100, 1_785_315_958_140)).toBe(-120)
  })

  /**
   * `%N` 을 모르는 기기는 `1785315958N` 처럼 문자를 그대로 남긴다. 그것을 숫자로 읽으면
   * 시계가 몇십 년 어긋난 것처럼 보이고, 마킹이 축 밖으로 날아간다.
   */
  it('%N 을 못 푼 답을 숫자로 읽지 않는다', () => {
    expect(parseDeviceClockSkewMs('1785315958N', 1_785_315_958_000, 1_785_315_958_040)).toBeNull()
    expect(parseDeviceClockSkewMs('', 1, 2)).toBeNull()
    // 자릿수가 모자란 답(초 단위)도 거른다 — 나노초가 아니면 환산이 통째로 틀린다.
    expect(parseDeviceClockSkewMs('1785315958', 1_785_315_958_000, 1_785_315_958_040)).toBeNull()
  })
})
