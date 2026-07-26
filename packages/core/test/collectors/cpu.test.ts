import { describe, expect, it } from 'vitest'
import { appProcessSql } from '../../src/collectors/appProcess.js'
import { FTRACE_POWER_BLOCK, PROCESS_STATS_BLOCK, SYS_STATS_BLOCK } from '../../src/collectors/blocks.js'
import {
  type AppCpuRow,
  appCpuSql,
  CPU_FREQ_SQL,
  CPU_TIMES_SQL,
  type CpuTimeRow,
  cpuCollector,
  summarizeAppCpu,
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

  /**
   * 예전에는 문제가 된 **행 하나만** 버렸다. idle/io_wait 은 total 에만 들어가고 busy 에는
   * 안 들어가므로, idle 행만 사라지면 분모에서 idle 이 빠지고 분자는 그대로다 —
   * 사용률이 100% 쪽으로 밀린다. 아래 입력은 옛 코드에서 정확히 busy_pct 100 을 냈다.
   */
  it('단조성이 깨진 코어는 행 하나가 아니라 그 코어를 통째로 버린다', () => {
    const s = summarizeCpuTimes([
      { cpu: 0, counter: 'cpu.times.idle_ns', first: 900, last: 100, first_ts: 0, last_ts: 1_000_000, samples: 2 },
      { cpu: 0, counter: 'cpu.times.user_ns', first: 0, last: 400, first_ts: 0, last_ts: 1_000_000, samples: 2 },
      { cpu: 1, counter: 'cpu.times.idle_ns', first: 0, last: 800, first_ts: 0, last_ts: 1_000_000, samples: 2 },
      { cpu: 1, counter: 'cpu.times.user_ns', first: 0, last: 200, first_ts: 0, last_ts: 1_000_000, samples: 2 },
    ])!
    expect(s.droppedCpus).toEqual([0])
    expect(s.perCore).toEqual([{ cpu: 1, busy_pct: 20 }])
    expect(s.totalDeltaNs).toBe(1000)
    expect(s.busyDeltaNs).toBe(200)
  })

  it('모든 코어가 깨지면 표본이 있어도 낼 값이 없다', () => {
    const s = summarizeCpuTimes([
      { cpu: 0, counter: 'cpu.times.idle_ns', first: 900, last: 100, first_ts: 0, last_ts: 1_000_000, samples: 2 },
    ])!
    // 행이 있었다는 사실과 아무것도 못 냈다는 사실을 둘 다 남긴다 — null 이면 구분이 사라진다.
    expect(s.perCore).toEqual([])
    expect(s.droppedCpus).toEqual([0])
    expect(s.totalDeltaNs).toBe(0)
  })

  it('멀쩡한 트레이스에서는 버린 코어가 없다', () => {
    expect(summarizeCpuTimes(REAL_ROWS)!.droppedCpus).toEqual([])
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

const PKG = 'com.foo.bar'

function ctx(answers: Record<string, unknown>, appPid: number | null = null): ExtractContext {
  return {
    tp: new FakeTp(answers) as unknown as ExtractContext['tp'],
    packageName: PKG,
    appUid: null,
    env: { sdkInt: 35, dataSources: ['linux.sys_stats', 'linux.ftrace', 'linux.process_stats'] },
    capture: { startup: null, launchRequested: false, appPid, snapshots: {} },
  }
}

const FREQ_ROWS = [
  { cpu: 0, samples: 716, min_khz: 300000, max_khz: 2400000, avg_khz: 1100000.5 },
  { cpu: 1, samples: 73, min_khz: 300000, max_khz: 1800000, avg_khz: 900000 },
]

/** 대상 앱 프로세스 하나. upid 는 `appCpuSql` 의 키다. */
const APP_CANDIDATES = [{ upid: 261, pid: 802, name: PKG }]

/**
 * 앱 프로세스의 runtime 카운터. 값은 실기기 세션의 delta 를 그대로 옮긴 것이다
 * (`com.nhn.android.webtoon` pid 24193: user 5.71s / kernel 2.92s).
 * 위 `REAL_ROWS` 는 에뮬레이터의 기기 전역 행이므로 두 fixture 를 나눈 share 는
 * **산술 검증용**이지 실기기 관측치가 아니다 — 실기기 값은 README 에 있다.
 */
const APP_CPU_ROWS: AppCpuRow[] = [
  { upid: 261, counter: 'runtime.kernel_ns', first: 20_000_000, last: 2_940_000_000, samples: 61, first_ts: 1_000_000, last_ts: 60_206_000_000 },
  { upid: 261, counter: 'runtime.user_ns', first: 0, last: 5_710_000_000, samples: 61, first_ts: 1_000_000, last_ts: 60_206_000_000 },
]

function answers(over: Record<string, unknown> = {}, appPid: number | null = null): Record<string, unknown> {
  return {
    [CPU_TIMES_SQL]: REAL_ROWS,
    [CPU_FREQ_SQL]: FREQ_ROWS,
    [appProcessSql(PKG, appPid)]: APP_CANDIDATES,
    [appCpuSql([261])]: APP_CPU_ROWS,
    ...over,
  }
}

describe('appCpuSql', () => {
  it('upid 목록을 그대로 넣고 runtime 카운터만 고른다', () => {
    const sql = appCpuSql([261, 262])
    expect(sql).toContain('t.upid in (261, 262)')
    expect(sql).toContain('runtime.user_ns')
    expect(sql).toContain('runtime.kernel_ns')
  })

  /**
   * mem.rss 를 함께 가져오면 CPU 합에 메모리 값이 섞일 자리가 생긴다.
   * upid 는 숫자라 인터폴레이션이 안전하다는 것이 이 SQL 의 전제다.
   */
  it('runtime 이 아닌 카운터는 아예 조회하지 않는다', () => {
    expect(appCpuSql([1])).not.toContain('mem.rss')
  })
})

describe('summarizeAppCpu', () => {
  it('그 upid 의 행이 없으면 null 이다 — 0 이 아니다', () => {
    expect(summarizeAppCpu(APP_CPU_ROWS, 999)).toBeNull()
    expect(summarizeAppCpu([], 261)).toBeNull()
  })

  it('user 와 kernel 을 따로 접고 관측 구간을 함께 낸다', () => {
    const s = summarizeAppCpu(APP_CPU_ROWS, 261)!
    expect(s.userNs).toBe(5_710_000_000)
    expect(s.kernelNs).toBe(2_920_000_000)
    expect(s.samples).toBe(61)
    expect(s.sampledMs).toBe(60_205)
    expect(s.backwards).toBeNull()
  })

  /**
   * 프로세스별 누적 CPU 시간은 되감길 수 없다 — 되감겼다면 그 upid 가 우리가 생각하는
   * 프로세스가 아니다. 남은 카운터만으로 합을 내면 "user 만 센 CPU 시간" 이 전체인 척한다.
   */
  it('되감긴 카운터를 0 으로 뭉개지 않고 어느 카운터였는지 남긴다', () => {
    const s = summarizeAppCpu(
      [
        { upid: 5, counter: 'runtime.user_ns', first: 900, last: 100, samples: 3, first_ts: 0, last_ts: 2_000_000 },
        { upid: 5, counter: 'runtime.kernel_ns', first: 0, last: 50, samples: 3, first_ts: 0, last_ts: 2_000_000 },
      ],
      5,
    )!
    expect(s.backwards).toEqual({ counter: 'runtime.user_ns', first: 900, last: 100 })
  })
})

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
  /**
   * process_stats 가 여기 있어야 하는 이유: 이 collector 는 이제 `runtime.*` 를 읽는다.
   * 그 카운터는 `PROCESS_STATS_BLOCK` 의 `record_process_runtime: true` 가 만든다.
   * 블록 텍스트 자체는 그대로이므로 이 기기로 나가는 데이터소스는 늘지 않는다 —
   * frame/memory 가 이미 같은 상수를 요청하고 `mergeTraceConfigBlocks` 가 접는다.
   */
  it('sys_stats·ftrace 와 함께 자기가 읽는 process_stats 도 선언한다', () => {
    expect(cpuCollector.traceConfigBlocks()).toEqual([
      SYS_STATS_BLOCK,
      FTRACE_POWER_BLOCK,
      PROCESS_STATS_BLOCK,
    ])
  })
})

describe('cpuCollector.extract — 기기 전역', () => {
  it('사용률과 주파수를 함께 내면 collected 다', async () => {
    const outcome = await cpuCollector.extract(ctx(answers()))
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.partialReason).toBeUndefined()
    expect(outcome.data.device_per_core).toEqual([
      { cpu: 0, busy_pct: 2.54 },
      { cpu: 1, busy_pct: 0.9 },
    ])
    expect(outcome.data.device_total_busy_pct).toBe(1.72)
    expect(outcome.data.device_frequency).toEqual([
      { cpu: 0, samples: 716, min_khz: 300000, max_khz: 2400000, avg_khz: 1100000.5 },
      { cpu: 1, samples: 73, min_khz: 300000, max_khz: 1800000, avg_khz: 900000 },
    ])
  })

  it('주파수 이벤트가 없으면 데이터를 실은 partial 이다 — 사용률만 있는 값을 전부인 척 안 한다', async () => {
    const outcome = await cpuCollector.extract(ctx(answers({ [CPU_FREQ_SQL]: [] })))
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.device_frequency).toBeNull()
    expect(outcome.partialReason).toEqual({ code: 'cpu_freq_unavailable' })
  })

  it('CPU 시간 표본이 아예 없으면 no_cpu_samples 다', async () => {
    const outcome = await cpuCollector.extract(ctx(answers({ [CPU_TIMES_SQL]: [] })))
    expect(outcome).toEqual({ collected: false, reason: { code: 'no_cpu_samples' } })
  })

  it('표본이 하나뿐이면 insufficient_samples 다 — 누적 카운터는 차이만 의미가 있다', async () => {
    const single = REAL_ROWS.map((r) => ({ ...r, samples: 1, last: r.first }))
    const outcome = await cpuCollector.extract(ctx(answers({ [CPU_TIMES_SQL]: single })))
    expect(outcome).toEqual({
      collected: false,
      reason: { code: 'insufficient_samples', detail: { samples: 1, required: 2 } },
    })
  })

  /**
   * 표본은 충분한데 카운터가 전혀 안 움직인 경우. 예전에는 이것도 `insufficient_samples` 라
   * 한국어 문장이 "표본이 13개뿐이라..." 라는 틀린 원인을 댔다. 원인이 다르면 코드도 다르다.
   */
  it('표본은 많은데 카운터가 전혀 안 움직였으면 표본 부족이라고 하지 않는다', async () => {
    const frozen = REAL_ROWS.map((r) => ({ ...r, last: r.first }))
    const outcome = await cpuCollector.extract(ctx(answers({ [CPU_TIMES_SQL]: frozen })))
    expect(outcome).toEqual({
      collected: false,
      reason: { code: 'cpu_counters_did_not_advance', detail: { samples: 13 } },
    })
  })

  it('일부 코어를 버렸으면 값과 함께 그 사실을 낸다', async () => {
    const rows: CpuTimeRow[] = [
      ...REAL_ROWS,
      { cpu: 2, counter: 'cpu.times.idle_ns', first: 900_000_000, last: 100, first_ts: 526952312208, last_ts: 538007140339, samples: 13 },
      { cpu: 2, counter: 'cpu.times.user_ns', first: 0, last: 400_000_000, first_ts: 526952312208, last_ts: 538007140339, samples: 13 },
    ]
    const outcome = await cpuCollector.extract(ctx(answers({ [CPU_TIMES_SQL]: rows })))
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    // cpu2 는 사라지고, 남은 두 코어의 값만 실린다.
    expect(outcome.data.device_per_core.map((c) => c.cpu)).toEqual([0, 1])
    expect(outcome.partialReason).toEqual({
      code: 'cpu_counters_not_monotonic',
      detail: { dropped_cpus: [2] },
    })
  })

  it('모든 코어가 깨졌으면 표본이 없다고 하지 않는다', async () => {
    const rows: CpuTimeRow[] = REAL_ROWS.map((r) =>
      r.counter === 'cpu.times.idle_ns' ? { ...r, first: r.last, last: r.first } : r,
    )
    const outcome = await cpuCollector.extract(ctx(answers({ [CPU_TIMES_SQL]: rows })))
    expect(outcome).toEqual({
      collected: false,
      reason: { code: 'cpu_counters_not_monotonic', detail: { dropped_cpus: [0, 1] } },
    })
  })

  it('주파수 쿼리가 터져도 사용률은 살린다', async () => {
    const outcome = await cpuCollector.extract(
      ctx(answers({ [CPU_FREQ_SQL]: new Error('no such table: cpufreq') })),
    )
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.device_frequency).toBeNull()
    expect(outcome.partialReason).toEqual({ code: 'cpu_freq_unavailable' })
  })
})

describe('cpuCollector.extract — 대상 앱', () => {
  it('앱 프로세스의 user/kernel CPU 시간을 낸다', async () => {
    const outcome = await cpuCollector.extract(ctx(answers()))
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    const app = outcome.data.app!
    expect(app.process).toBe(PKG)
    expect(app.pid).toBe(802)
    expect(app.user_ms).toBe(5710)
    expect(app.kernel_ms).toBe(2920)
    expect(app.total_ms).toBe(8630)
    expect(app.samples).toBe(61)
  })

  /**
   * 분모는 **같은 구간의 기기 전체 CPU 시간(모든 코어, idle 포함)** 이다.
   * `measurement_overhead.tracing_processes_cpu_share_pct` 와 같은 분모여야 한 result.json
   * 안의 두 백분율이 서로 비교 가능하다. REAL_ROWS 의 총합은 22,060ms 다.
   */
  it('share 의 분모가 기기 전체 CPU 시간이다 — 벽시계도 코어 하나도 아니다', async () => {
    const outcome = await cpuCollector.extract(ctx(answers()))
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.app!.share_of_device_cpu_pct).toBe(39.12)
    // 분모를 잘못 고르면 나오는 값들: 앱 자신의 관측 구간(60.205s) 대비 14.34,
    // 기기 표본 구간(11.055s) 대비 78.06. 셋 다 서로 다른 숫자다.
    expect(outcome.data.app!.share_of_device_cpu_pct).not.toBe(14.34)
    expect(outcome.data.app!.share_of_device_cpu_pct).not.toBe(78.06)
  })

  /**
   * 이 저장소가 반복해서 거부해 온 것: 조회하지 못한 것에 0 을 싣기.
   * 앱을 못 찾은 세션의 `app` 은 **null** 이고 사유가 왜인지 말한다.
   */
  it('앱 프로세스를 못 찾으면 0 이 아니라 null 이고 사유를 남긴다', async () => {
    const outcome = await cpuCollector.extract(ctx(answers({ [appProcessSql(PKG, null)]: [] })))
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.app).toBeNull()
    expect(outcome.data.device_total_busy_pct).toBe(1.72)
    expect(outcome.partialReason).toEqual({
      code: 'process_not_in_trace',
      detail: { package: PKG },
    })
  })

  it('프로세스는 찾았는데 runtime 카운터가 없으면 0 이 아니라 null 이다', async () => {
    const outcome = await cpuCollector.extract(ctx(answers({ [appCpuSql([261])]: [] })))
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.app).toBeNull()
    expect(outcome.partialReason).toEqual({
      code: 'no_app_cpu_samples',
      detail: { process: PKG, pid: 802 },
    })
  })

  it('앱 쿼리가 터져도 기기 전역 값은 살리고 앱만 null 로 둔다', async () => {
    const outcome = await cpuCollector.extract(
      ctx(answers({ [appCpuSql([261])]: new Error('no such column: upid') })),
    )
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.app).toBeNull()
    expect(outcome.data.device_per_core.length).toBe(2)
    expect(outcome.partialReason).toEqual({
      code: 'query_failed',
      detail: { message: 'no such column: upid' },
    })
  })

  /**
   * 실기기에서 트레이스는 갓 fork 된 앱을 `<pre-initialized>` 로 기록한다.
   * frame/memory 와 **같은 규칙**(pid 우선)으로 풀어야 세 지표가 같은 프로세스를 가리킨다.
   */
  it('이름이 낡았으면 pid 로 찾고 그 사실을 사유로 남긴다', async () => {
    const stale = [{ upid: 261, pid: 24193, name: '<pre-initialized>' }]
    const outcome = await cpuCollector.extract(
      ctx(answers({ [appProcessSql(PKG, 24193)]: stale }, 24193), 24193),
    )
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.app!.process).toBe(PKG)
    expect(outcome.data.app!.pid).toBe(24193)
    expect(outcome.data.app!.total_ms).toBe(8630)
    expect(outcome.partialReason).toEqual({
      code: 'process_name_stale_in_trace',
      detail: { package: PKG, pid: 24193, trace_name: '<pre-initialized>' },
    })
  })

  /**
   * 실기기 실측: uid 10388 에 프로세스가 넷이었고, 그중 이름이 패키지명과 정확히 같은 것은
   * **8.63초를 쓴 본체가 아니라 10ms 를 쓴 자식**이었다 (본체 이름은 `<pre-initialized>`).
   * 그래서 후보를 전부 더한 값을 "이 앱의 CPU" 라고 부르지 않는다 — 대표 프로세스는 하나이고
   * 나머지는 자기 pid 를 달고 따로 실린다.
   */
  it('후보가 여럿이면 대표 하나만 app 이고 나머지는 따로 실린다', async () => {
    const many = [
      { upid: 261, pid: 24193, name: '<pre-initialized>' },
      { upid: 262, pid: 24328, name: PKG },
    ]
    const rows: AppCpuRow[] = [
      ...APP_CPU_ROWS,
      { upid: 262, counter: 'runtime.kernel_ns', first: 0, last: 10_000_000, samples: 59, first_ts: 0, last_ts: 60_000_000_000 },
      { upid: 262, counter: 'runtime.user_ns', first: 0, last: 0, samples: 59, first_ts: 0, last_ts: 60_000_000_000 },
    ]
    const outcome = await cpuCollector.extract(
      ctx(answers({ [appProcessSql(PKG, 24193)]: many, [appCpuSql([261, 262])]: rows }, 24193), 24193),
    )
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.app!.pid).toBe(24193)
    expect(outcome.data.app!.total_ms).toBe(8630)
    // 합산했다면 8640 이 나왔을 것이다. 합치지 않는다.
    expect(outcome.data.app!.other_processes).toEqual([
      { process: PKG, pid: 24328, user_ms: 0, kernel_ms: 10, total_ms: 10 },
    ])
  })

  it('다른 프로세스가 없으면 빈 배열이다 — null 과 뜻이 다르다', async () => {
    const outcome = await cpuCollector.extract(ctx(answers()))
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.app!.other_processes).toEqual([])
  })

  it('앱 카운터가 되감겼으면 절반만 센 값을 내지 않는다', async () => {
    const rows: AppCpuRow[] = [
      { upid: 261, counter: 'runtime.user_ns', first: 900, last: 100, samples: 3, first_ts: 0, last_ts: 2_000_000 },
      { upid: 261, counter: 'runtime.kernel_ns', first: 0, last: 50, samples: 3, first_ts: 0, last_ts: 2_000_000 },
    ]
    const outcome = await cpuCollector.extract(ctx(answers({ [appCpuSql([261])]: rows })))
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.app).toBeNull()
    expect(outcome.partialReason).toEqual({
      code: 'counter_went_backwards',
      detail: { counter: 'runtime.user_ns', before: 900, after: 100 },
    })
  })

  /**
   * 사유 자리는 하나뿐이다. **앱이 통째로 없는 사실이 먼저다** — 이 메트릭의 표제 질문이
   * 이제 "이 앱이 CPU 를 얼마나 썼나" 이고, 그 답이 null 인 이유는 데이터 어디에도 없다.
   * (버려진 코어는 `device_per_core` 가 짧아진 것으로 흔적이 남는다.)
   */
  it('앱이 없는 사실이 버려진 코어보다 먼저 실린다', async () => {
    const rows: CpuTimeRow[] = [
      ...REAL_ROWS,
      { cpu: 2, counter: 'cpu.times.idle_ns', first: 900_000_000, last: 100, first_ts: 526952312208, last_ts: 538007140339, samples: 13 },
      { cpu: 2, counter: 'cpu.times.user_ns', first: 0, last: 400_000_000, first_ts: 526952312208, last_ts: 538007140339, samples: 13 },
    ]
    const outcome = await cpuCollector.extract(
      ctx(answers({ [CPU_TIMES_SQL]: rows, [appProcessSql(PKG, null)]: [] })),
    )
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.partialReason?.code).toBe('process_not_in_trace')
  })
})
