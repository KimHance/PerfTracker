import { describe, expect, it } from 'vitest'
import { FTRACE_POWER_BLOCK, SYS_STATS_BLOCK } from '../../src/collectors/blocks.js'
import {
  CPU_FREQ_SQL,
  CPU_TIMES_SQL,
  type CpuTimeRow,
  cpuCollector,
  summarizeCpuTimes,
} from '../../src/collectors/cpu.js'
import type { ExtractContext } from '../../src/collectors/types.js'

/** 에뮬레이터(API 35, 4코어) 실측 트레이스에서 그대로 뜬 cpu0/cpu1 8종 카운터. */
const REAL_ROWS: CpuTimeRow[] = [
  { cpu: 0, counter: 'cpu.times.idle_ns', first: 455540000000, last: 466270000000, first_ts: 526952312208, last_ts: 538007140339, samples: 13 },
  { cpu: 0, counter: 'cpu.times.io_wait_ns', first: 3260000000, last: 3260000000, first_ts: 526952312208, last_ts: 538007140339, samples: 13 },
  { cpu: 0, counter: 'cpu.times.irq_ns', first: 26200000000, last: 26380000000, first_ts: 526952312208, last_ts: 538007140339, samples: 13 },
  { cpu: 0, counter: 'cpu.times.softirq_ns', first: 5760000000, last: 5770000000, first_ts: 526952312208, last_ts: 538007140339, samples: 13 },
  { cpu: 0, counter: 'cpu.times.steal_ns', first: 0, last: 0, first_ts: 526952312208, last_ts: 538007140339, samples: 13 },
  { cpu: 0, counter: 'cpu.times.system_mode_ns', first: 24970000000, last: 25050000000, first_ts: 526952312208, last_ts: 538007140339, samples: 13 },
  { cpu: 0, counter: 'cpu.times.user_nice_ns', first: 5910000000, last: 5910000000, first_ts: 526952312208, last_ts: 538007140339, samples: 13 },
  { cpu: 0, counter: 'cpu.times.user_ns', first: 3950000000, last: 3960000000, first_ts: 526952312208, last_ts: 538007140339, samples: 13 },
  { cpu: 1, counter: 'cpu.times.idle_ns', first: 456160000000, last: 467100000000, first_ts: 526952312208, last_ts: 538007140339, samples: 13 },
  { cpu: 1, counter: 'cpu.times.io_wait_ns', first: 5710000000, last: 5720000000, first_ts: 526952312208, last_ts: 538007140339, samples: 13 },
  { cpu: 1, counter: 'cpu.times.irq_ns', first: 11700000000, last: 11750000000, first_ts: 526952312208, last_ts: 538007140339, samples: 13 },
  { cpu: 1, counter: 'cpu.times.softirq_ns', first: 210000000, last: 210000000, first_ts: 526952312208, last_ts: 538007140339, samples: 13 },
  { cpu: 1, counter: 'cpu.times.steal_ns', first: 0, last: 0, first_ts: 526952312208, last_ts: 538007140339, samples: 13 },
  { cpu: 1, counter: 'cpu.times.system_mode_ns', first: 29770000000, last: 29800000000, first_ts: 526952312208, last_ts: 538007140339, samples: 13 },
  { cpu: 1, counter: 'cpu.times.user_nice_ns', first: 12160000000, last: 12160000000, first_ts: 526952312208, last_ts: 538007140339, samples: 13 },
  { cpu: 1, counter: 'cpu.times.user_ns', first: 8650000000, last: 8670000000, first_ts: 526952312208, last_ts: 538007140339, samples: 13 },
]

describe('summarizeCpuTimes', () => {
  it('표본이 없으면 null 이다', () => {
    expect(summarizeCpuTimes([])).toBeNull()
  })

  it('실측 행에서 코어별 사용률을 낸다', () => {
    const s = summarizeCpuTimes(REAL_ROWS)!
    // cpu0: busy = 180+10+0+80+0+10 = 280ms, idle = 10730+0 = 10730ms, total = 11010ms
    expect(s.perCore).toEqual([
      { cpu: 0, busy_pct: 2.54 },
      { cpu: 1, busy_pct: 0.9 },
    ])
  })

  it('관측 구간을 ts 범위에서 낸다', () => {
    const s = summarizeCpuTimes(REAL_ROWS)!
    expect(s.sampledMs).toBe(11055)
    expect(s.samples).toBe(13)
  })

  it('idle 과 io_wait 만 idle 로 세고 나머지는 전부 busy 다', () => {
    const s = summarizeCpuTimes([
      { cpu: 0, counter: 'cpu.times.idle_ns', first: 0, last: 700_000_000, first_ts: 0, last_ts: 1_000_000_000, samples: 2 },
      { cpu: 0, counter: 'cpu.times.io_wait_ns', first: 0, last: 100_000_000, first_ts: 0, last_ts: 1_000_000_000, samples: 2 },
      { cpu: 0, counter: 'cpu.times.user_ns', first: 0, last: 150_000_000, first_ts: 0, last_ts: 1_000_000_000, samples: 2 },
      { cpu: 0, counter: 'cpu.times.irq_ns', first: 0, last: 50_000_000, first_ts: 0, last_ts: 1_000_000_000, samples: 2 },
    ])!
    expect(s.totalDeltaNs).toBe(1_000_000_000)
    expect(s.busyDeltaNs).toBe(200_000_000)
    expect(s.perCore).toEqual([{ cpu: 0, busy_pct: 20 }])
  })

  it('단조성이 깨진 행(재부팅 등)은 버린다', () => {
    const s = summarizeCpuTimes([
      { cpu: 0, counter: 'cpu.times.idle_ns', first: 900, last: 100, first_ts: 0, last_ts: 1_000_000, samples: 2 },
      { cpu: 0, counter: 'cpu.times.user_ns', first: 0, last: 400, first_ts: 0, last_ts: 1_000_000, samples: 2 },
    ])!
    expect(s.totalDeltaNs).toBe(400)
    expect(s.busyDeltaNs).toBe(400)
  })

  it('구간 차이가 0 이면 코어 사용률을 0 으로 두고 나누지 않는다', () => {
    const s = summarizeCpuTimes([
      { cpu: 0, counter: 'cpu.times.idle_ns', first: 5, last: 5, first_ts: 0, last_ts: 0, samples: 1 },
    ])!
    expect(s.totalDeltaNs).toBe(0)
    expect(s.perCore).toEqual([{ cpu: 0, busy_pct: 0 }])
    expect(Number.isNaN(s.perCore[0]!.busy_pct)).toBe(false)
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

function ctx(answers: Record<string, unknown>): ExtractContext {
  return {
    tp: new FakeTp(answers) as unknown as ExtractContext['tp'],
    packageName: 'com.foo.bar',
    env: { sdkInt: 35, dataSources: ['linux.sys_stats', 'linux.ftrace'] },
    capture: { startup: null, launchRequested: false, appPid: null },
  }
}

const FREQ_ROWS = [
  { cpu: 0, samples: 716, min_khz: 300000, max_khz: 2400000, avg_khz: 1100000.5 },
  { cpu: 1, samples: 73, min_khz: 300000, max_khz: 1800000, avg_khz: 900000 },
]

describe('cpuCollector.supports', () => {
  it('linux.sys_stats 가 없으면 미지원이다 — 사용률이 이 메트릭의 뼈대다', () => {
    expect(cpuCollector.supports({ sdkInt: 35, dataSources: ['linux.ftrace'] })).toEqual({
      supported: false,
      reason: { code: 'data_source_not_registered', detail: { data_source: 'linux.sys_stats' } },
    })
  })

  it('linux.ftrace 가 없어도 지원된다 — 주파수는 있으면 좋은 것이지 전제가 아니다', () => {
    expect(cpuCollector.supports({ sdkInt: 21, dataSources: ['linux.sys_stats'] })).toEqual({
      supported: true,
    })
  })
})

describe('cpuCollector.traceConfigBlocks', () => {
  it('sys_stats 와 ftrace 블록을 공유 상수로 요구한다', () => {
    expect(cpuCollector.traceConfigBlocks()).toEqual([SYS_STATS_BLOCK, FTRACE_POWER_BLOCK])
  })
})

describe('cpuCollector.extract', () => {
  it('사용률과 주파수를 함께 내면 collected 다', async () => {
    const outcome = await cpuCollector.extract(
      ctx({ [CPU_TIMES_SQL]: REAL_ROWS, [CPU_FREQ_SQL]: FREQ_ROWS }),
    )
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.partialReason).toBeUndefined()
    expect(outcome.data.per_core).toEqual([
      { cpu: 0, busy_pct: 2.54 },
      { cpu: 1, busy_pct: 0.9 },
    ])
    expect(outcome.data.total_busy_pct).toBe(1.72)
    expect(outcome.data.frequency).toEqual([
      { cpu: 0, samples: 716, min_khz: 300000, max_khz: 2400000, avg_khz: 1100000.5 },
      { cpu: 1, samples: 73, min_khz: 300000, max_khz: 1800000, avg_khz: 900000 },
    ])
  })

  it('주파수 이벤트가 없으면 데이터를 실은 partial 이다 — 사용률만 있는 값을 전부인 척 안 한다', async () => {
    const outcome = await cpuCollector.extract(
      ctx({ [CPU_TIMES_SQL]: REAL_ROWS, [CPU_FREQ_SQL]: [] }),
    )
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.frequency).toBeNull()
    expect(outcome.partialReason).toEqual({ code: 'cpu_freq_unavailable' })
  })

  it('CPU 시간 표본이 아예 없으면 no_cpu_samples 다', async () => {
    const outcome = await cpuCollector.extract(ctx({ [CPU_TIMES_SQL]: [] }))
    expect(outcome).toEqual({ collected: false, reason: { code: 'no_cpu_samples' } })
  })

  it('표본이 하나뿐이면 insufficient_samples 다 — 누적 카운터는 차이만 의미가 있다', async () => {
    const single = REAL_ROWS.map((r) => ({ ...r, samples: 1, last: r.first }))
    const outcome = await cpuCollector.extract(ctx({ [CPU_TIMES_SQL]: single }))
    expect(outcome).toEqual({
      collected: false,
      reason: { code: 'insufficient_samples', detail: { samples: 1, required: 2 } },
    })
  })

  it('주파수 쿼리가 터져도 사용률은 살린다', async () => {
    const outcome = await cpuCollector.extract(
      ctx({ [CPU_TIMES_SQL]: REAL_ROWS, [CPU_FREQ_SQL]: new Error('no such table: cpufreq') }),
    )
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.frequency).toBeNull()
    expect(outcome.partialReason).toEqual({ code: 'cpu_freq_unavailable' })
  })
})
