import { describe, expect, it } from 'vitest'
import { CPU_TIMES_SQL, type CpuTimeRow } from '../../src/collectors/cpu.js'
import {
  computeOverhead,
  isTracingProcess,
  summarizeTracingCost,
  TRACING_OVERHEAD_SQL,
  type TracingCounterRow,
} from '../../src/extract/overhead.js'
import type { TraceProcessor } from '../../src/perfetto/traceProcessor/client.js'

describe('isTracingProcess', () => {
  it('전체 경로로 오는 실제 이름을 잡는다', () => {
    expect(isTracingProcess('/system/bin/traced')).toBe(true)
    expect(isTracingProcess('/system/bin/traced_probes')).toBe(true)
  })

  it('경로 없는 이름도 잡는다', () => {
    expect(isTracingProcess('traced')).toBe(true)
    expect(isTracingProcess('perfetto')).toBe(true)
  })

  it('이름이 겹치는 남의 프로세스를 잡지 않는다', () => {
    expect(isTracingProcess('rcu_tasks_trace')).toBe(false)
    expect(isTracingProcess('/vendor/bin/hw/android.hardware.atrace@1.0-service')).toBe(false)
    expect(isTracingProcess('traced_probes_helper')).toBe(false)
  })

  it('null 은 트레이싱 프로세스가 아니다', () => {
    expect(isTracingProcess(null)).toBe(false)
  })
})

/** 에뮬레이터 실측 12초 캡처의 값 그대로. */
const REAL_TRACING_ROWS: TracingCounterRow[] = [
  { process: '/system/bin/traced_probes', counter: 'mem.rss', first: 7593984, last: 7856128 },
  { process: '/system/bin/traced_probes', counter: 'runtime.kernel_ns', first: 30000000, last: 140000000 },
  { process: '/system/bin/traced_probes', counter: 'runtime.user_ns', first: 30000000, last: 70000000 },
  { process: '/system/bin/traced', counter: 'mem.rss', first: 3346432, last: 3477504 },
  { process: '/system/bin/traced', counter: 'runtime.kernel_ns', first: 10000000, last: 10000000 },
  { process: '/system/bin/traced', counter: 'runtime.user_ns', first: 0, last: 0 },
]

describe('summarizeTracingCost', () => {
  it('실측 행에서 CPU 시간과 peak RSS 를 낸다', () => {
    // traced_probes: kernel 110ms + user 40ms = 150ms, traced: 0ms → 합 150ms
    // peak RSS: 7856128 + 3477504 = 11333632 바이트 = 11068 kB
    expect(summarizeTracingCost(REAL_TRACING_ROWS)).toEqual({
      cpuTimeMs: 150,
      peakRssKb: 11068,
    })
  })

  it('행이 없으면 둘 다 null 이다 — 0 이 아니다', () => {
    expect(summarizeTracingCost([])).toEqual({ cpuTimeMs: null, peakRssKb: null })
  })

  it('runtime.* 가 없는 옛 캡처는 CPU 만 null 이고 RSS 는 살아 있다', () => {
    const rssOnly = REAL_TRACING_ROWS.filter((r) => r.counter === 'mem.rss')
    expect(summarizeTracingCost(rssOnly)).toEqual({ cpuTimeMs: null, peakRssKb: 11068 })
  })

  it('트레이싱 프로세스가 아닌 행은 무시한다 — SQL 이 느슨해도 여기서 걸린다', () => {
    expect(
      summarizeTracingCost([
        { process: 'com.foo.bar', counter: 'mem.rss', first: 0, last: 999_999_999 },
        ...REAL_TRACING_ROWS,
      ]),
    ).toEqual({ cpuTimeMs: 150, peakRssKb: 11068 })
  })

  it('단조성이 깨진 CPU 행은 버린다', () => {
    expect(
      summarizeTracingCost([
        { process: 'traced', counter: 'runtime.user_ns', first: 500_000_000, last: 0 },
        { process: 'traced', counter: 'runtime.kernel_ns', first: 0, last: 20_000_000 },
      ]),
    ).toEqual({ cpuTimeMs: 20, peakRssKb: null })
  })
})

class FakeTp {
  constructor(private readonly answers: Record<string, unknown>) {}
  async queryJson<T>(sql: string): Promise<T> {
    if (!(sql in this.answers)) throw new Error(`예상하지 못한 쿼리: ${sql.slice(0, 60)}`)
    const value = this.answers[sql]
    if (value instanceof Error) throw value
    return value as T
  }
}

const tp = (answers: Record<string, unknown>): TraceProcessor =>
  new FakeTp(answers) as unknown as TraceProcessor

/** 12초 × 4코어 ≈ 44120ms 의 기기 전체 CPU 시간. */
const CPU_ROWS: CpuTimeRow[] = [
  { cpu: 0, counter: 'cpu.times.idle_ns', first: 0, last: 11_010_000_000, first_ts: 0, last_ts: 11_055_000_000, samples: 13 },
  { cpu: 1, counter: 'cpu.times.idle_ns', first: 0, last: 11_050_000_000, first_ts: 0, last_ts: 11_055_000_000, samples: 13 },
]

describe('computeOverhead', () => {
  it('CPU 점유율을 기기 전체 CPU 시간으로 나눠 낸다', async () => {
    const result = await computeOverhead(
      tp({ [TRACING_OVERHEAD_SQL]: REAL_TRACING_ROWS, [CPU_TIMES_SQL]: CPU_ROWS }),
    )
    // 150ms / 22060ms × 100 = 0.68%
    expect(result).toEqual({ cpuTimeMs: 150, cpuSharePct: 0.68, peakRssKb: 11068 })
  })

  it('sys_stats 가 없으면 분모를 몰라 점유율만 null 이다', async () => {
    const result = await computeOverhead(
      tp({ [TRACING_OVERHEAD_SQL]: REAL_TRACING_ROWS, [CPU_TIMES_SQL]: [] }),
    )
    expect(result).toEqual({ cpuTimeMs: 150, cpuSharePct: null, peakRssKb: 11068 })
  })

  it('오버헤드 쿼리가 터져도 던지지 않고 전부 null 을 낸다', async () => {
    const result = await computeOverhead(
      tp({ [TRACING_OVERHEAD_SQL]: new Error('no such table: counter') }),
    )
    expect(result).toEqual({ cpuTimeMs: null, cpuSharePct: null, peakRssKb: null })
  })

  it('CPU 시간 쿼리만 터져도 나머지는 살린다', async () => {
    const result = await computeOverhead(
      tp({ [TRACING_OVERHEAD_SQL]: REAL_TRACING_ROWS, [CPU_TIMES_SQL]: new Error('boom') }),
    )
    expect(result).toEqual({ cpuTimeMs: 150, cpuSharePct: null, peakRssKb: 11068 })
  })
})
