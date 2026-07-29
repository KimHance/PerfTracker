import { describe, expect, it } from 'vitest'
import { appProcessSql } from '../../src/collectors/appProcess.js'
import { processStatsBlock, SYS_STATS_BLOCK } from '../../src/collectors/blocks.js'
import {
  appMemorySql,
  appMemoryTimelineSql,
  buildMemoryTimeline,
  buildSystemMemoryTimeline,
  type CounterStatRow,
  memoryCollector,
  SYSTEM_MEMORY_SQL,
  SYSTEM_MEMORY_TIMELINE_SQL,
  type SystemMemoryTimelineRow,
} from '../../src/collectors/memory/index.js'
import type { ExtractContext } from '../../src/collectors/types.js'

class FakeTp {
  constructor(private readonly answers: Record<string, unknown>) {}
  async queryJson<T>(sql: string): Promise<T> {
    // 시계열 쿼리를 명시하지 않은 테스트는 그것에 관심이 없다는 뜻이다 — 빈 배열로 둔다.
    // 시계열 자체는 `buildMemoryTimeline` 단위 테스트와 아래 전용 테스트가 지킨다.
    if (!(sql in this.answers) && sql.includes('trace_bounds')) return [] as T
    if (!(sql in this.answers)) throw new Error(`예상하지 못한 쿼리: ${sql.slice(0, 60)}`)
    const value = this.answers[sql]
    if (value instanceof Error) throw value
    return value as T
  }
}

const PKG = 'com.android.systemui'

function ctx(answers: Record<string, unknown>, appPid: number | null = null): ExtractContext {
  return {
    tp: new FakeTp(answers) as unknown as ExtractContext['tp'],
    packageName: PKG,
    appUid: null,
    env: { sdkInt: 35, dataSources: ['linux.process_stats', 'linux.sys_stats'] },
    capture: { startup: null, launchRequested: false, appPid, snapshots: {} },
  }
}

/** 에뮬레이터 실측 트레이스의 com.android.systemui 값 그대로. 단위는 바이트다. */
const APP_ROWS: CounterStatRow[] = [
  { counter: 'mem.rss', min: 181055488, max: 181727232, avg: 181107160, samples: 13 },
  { counter: 'mem.rss.anon', min: 70209536, max: 70356992, avg: 70220878, samples: 13 },
  { counter: 'mem.rss.file', min: 105996288, max: 106520576, avg: 106036617, samples: 13 },
  { counter: 'mem.rss.watermark', min: 269627392, max: 269627392, avg: 269627392, samples: 13 },
]

/** 에뮬레이터 실측 meminfo. 역시 바이트다. */
const SYS_ROWS: CounterStatRow[] = [
  { counter: 'Buffers', min: 5066752, max: 5083136, avg: 5076834, samples: 13 },
  { counter: 'Cached', min: 876904448, max: 882368512, avg: 879101164, samples: 13 },
  { counter: 'MemAvailable', min: 817786880, max: 823353344, avg: 821774808, samples: 13 },
  { counter: 'MemFree', min: 152825856, max: 163594240, avg: 159958882, samples: 13 },
  { counter: 'MemTotal', min: 2070597632, max: 2070597632, avg: 2070597632, samples: 13 },
  { counter: 'SwapCached', min: 16429056, max: 16535552, avg: 16447330, samples: 13 },
  { counter: 'SwapFree', min: 811859968, max: 830210048, avg: 816981858, samples: 13 },
  { counter: 'SwapTotal', min: 1552941056, max: 1552941056, avg: 1552941056, samples: 13 },
]

const CANDIDATES = [{ upid: 261, pid: 802, name: PKG }]

function answers(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    [appProcessSql(PKG, null)]: CANDIDATES,
    [appMemorySql(261)]: APP_ROWS,
    [SYSTEM_MEMORY_SQL]: SYS_ROWS,
    ...over,
  }
}

describe('memoryCollector.supports', () => {
  it('linux.process_stats 가 없으면 미지원이다', () => {
    expect(memoryCollector.supports({ sdkInt: 35, dataSources: ['linux.sys_stats'] })).toEqual({
      supported: false,
      reason: { code: 'data_source_not_registered', detail: { data_source: 'linux.process_stats' } },
    })
  })

  it('linux.sys_stats 가 없어도 지원된다 — 시스템 메모리는 부가 정보다', () => {
    expect(memoryCollector.supports({ sdkInt: 21, dataSources: ['linux.process_stats'] })).toEqual({
      supported: true,
    })
  })
})

describe('memoryCollector.traceConfigBlocks', () => {
  it('공유 상수를 그대로 쓴다 — 사본을 만들면 merge 가 던진다', () => {
    expect(memoryCollector.traceConfigBlocks({ sdkInt: 36, dataSources: [] })).toEqual([processStatsBlock(36), SYS_STATS_BLOCK])
  })
})

describe('memoryCollector.extract', () => {
  it('바이트를 kB 로 바꿔 앱 RSS 를 낸다', async () => {
    const outcome = await memoryCollector.extract(ctx(answers()))
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.process).toBe(PKG)
    expect(outcome.data.pid).toBe(802)
    expect(outcome.data.samples).toBe(13)
    expect(outcome.data.rss).toEqual({ min_kb: 176812, max_kb: 177468, avg_kb: 176862 })
    expect(outcome.data.rss_watermark_peak_kb).toBe(263308)
  })

  it('시스템 메모리도 kB 로 함께 낸다', async () => {
    const outcome = await memoryCollector.extract(ctx(answers()))
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.system).toEqual({
      mem_total_kb: 2022068,
      mem_available: { min_kb: 798620, max_kb: 804056, avg_kb: 802514 },
      mem_free: { min_kb: 149244, max_kb: 159760, avg_kb: 156210 },
      cached: { min_kb: 856352, max_kb: 861688, avg_kb: 858497 },
      swap_total_kb: 1516544,
      swap_free: { min_kb: 792832, max_kb: 810752, avg_kb: 797834 },
    })
    expect(outcome.partialReason).toBeUndefined()
  })

  it('meminfo 가 없으면 system 은 null 이고 partial 이다', async () => {
    const outcome = await memoryCollector.extract(ctx(answers({ [SYSTEM_MEMORY_SQL]: [] })))
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.system).toBeNull()
    expect(outcome.partialReason).toEqual({ code: 'no_meminfo_samples' })
  })

  it('meminfo 쿼리가 터져도 앱 RSS 는 살린다', async () => {
    const outcome = await memoryCollector.extract(
      ctx(answers({ [SYSTEM_MEMORY_SQL]: new Error('no such table') })),
    )
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.system).toBeNull()
    expect(outcome.partialReason).toEqual({ code: 'no_meminfo_samples' })
  })

  it('앱 프로세스가 트레이스에 없으면 process_not_in_trace 다', async () => {
    const outcome = await memoryCollector.extract(ctx(answers({ [appProcessSql(PKG, null)]: [] })))
    expect(outcome).toEqual({
      collected: false,
      reason: { code: 'process_not_in_trace', detail: { package: PKG } },
    })
  })

  /** 에뮬레이터 실측: 앱은 트레이스 안에 있는데 이름이 "zygote64" 로 굳어 못 찾던 상황. */
  describe('트레이스의 프로세스 이름이 낡았을 때', () => {
    const STALE = [{ upid: 309, pid: 6037, name: 'zygote64' }]
    const STALE_ROWS: CounterStatRow[] = [
      { counter: 'mem.rss', min: 300000000, max: 400904192, avg: 350000000, samples: 40 },
    ]

    function staleAnswers(over: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        [appProcessSql(PKG, 6037)]: STALE,
        [appMemorySql(309)]: STALE_ROWS,
        [SYSTEM_MEMORY_SQL]: SYS_ROWS,
        ...over,
      }
    }

    it('캡처한 pid 로 앱을 찾아 RSS 를 낸다', async () => {
      const outcome = await memoryCollector.extract(ctx(staleAnswers(), 6037))
      expect(outcome.collected).toBe(true)
      if (!outcome.collected) return
      expect(outcome.data.pid).toBe(6037)
      expect(outcome.data.samples).toBe(40)
      expect(outcome.data.rss.max_kb).toBe(391508)
      // 트레이스가 아는 이름을 그대로 흘리지 않는다.
      expect(outcome.data.process).not.toBe('zygote64')
      expect(outcome.data.process).toBe(PKG)
      expect(outcome.partialReason).toEqual({
        code: 'process_name_stale_in_trace',
        detail: { package: PKG, pid: 6037, trace_name: 'zygote64' },
      })
    })

    it('pid 를 모르면 이름이 낡은 프로세스를 앱이라고 우기지 않는다', async () => {
      const outcome = await memoryCollector.extract(
        ctx(answers({ [appProcessSql(PKG, null)]: STALE })),
      )
      expect(outcome).toEqual({
        collected: false,
        reason: { code: 'process_not_in_trace', detail: { package: PKG } },
      })
    })
  })

  it('프로세스는 있는데 mem.rss 표본이 없으면 no_rss_samples 다', async () => {
    const outcome = await memoryCollector.extract(ctx(answers({ [appMemorySql(261)]: [] })))
    expect(outcome).toEqual({
      collected: false,
      reason: { code: 'no_rss_samples', detail: { process: PKG } },
    })
  })

  it('mem.rss 만 있고 anon/file 이 없어도 수집된다', async () => {
    const only = APP_ROWS.filter((r) => r.counter === 'mem.rss')
    const outcome = await memoryCollector.extract(ctx(answers({ [appMemorySql(261)]: only })))
    expect(outcome.collected).toBe(true)
    if (!outcome.collected) return
    expect(outcome.data.rss_anon).toBeNull()
    expect(outcome.data.rss_file).toBeNull()
    expect(outcome.data.rss_watermark_peak_kb).toBeNull()
  })
})

describe('buildMemoryTimeline', () => {
  it('바이트를 kB 로 바꿔 초별로 낸다', () => {
    expect(
      buildMemoryTimeline([
        { second: 0, rssBytes: 1024 * 1024 },
        { second: 1, rssBytes: 2 * 1024 * 1024 },
      ]),
    ).toEqual([
      { t_s: 0, rss_kb: 1024 },
      { t_s: 1, rss_kb: 2048 },
    ])
  })

  it('같은 초에 표본이 여럿이면 마지막이 남는다 (폴링 지터)', () => {
    const t = buildMemoryTimeline([
      { second: 0, rssBytes: 1024 * 1024 },
      { second: 0, rssBytes: 3 * 1024 * 1024 },
    ])

    expect(t).toEqual([{ t_s: 0, rss_kb: 3072 }])
  })

  it('값이 없는 초를 0 으로 채우지 않는다', () => {
    expect(
      buildMemoryTimeline([
        { second: 0, rssBytes: 1024 },
        { second: 4, rssBytes: 1024 },
      ]).map((p) => p.t_s),
    ).toEqual([0, 4])
  })

  it('빈 입력은 빈 배열', () => {
    expect(buildMemoryTimeline([])).toEqual([])
  })

  /** frame·log·cpu 와 같은 0 초를 써야 네 시계열을 t_s 로 맞춰 볼 수 있다. */
  it('frame 과 같은 기준점(trace_bounds)을 쓴다', () => {
    expect(appMemoryTimelineSql(3)).toContain('select start_ts from trace_bounds')
    expect(appMemoryTimelineSql(3)).toContain("t.name = 'mem.rss'")
  })
})

describe('memoryCollector 가 시계열을 싣는다', () => {
  it('timeline 쿼리 결과가 data.timeline 에 그대로 들어간다', async () => {
    const outcome = await memoryCollector.extract(
      ctx({
        [appProcessSql(PKG, null)]: [{ upid: 3, pid: 100, name: PKG }],
        [appMemorySql(3)]: [{ counter: 'mem.rss', min: 1024, max: 2048, avg: 1536, samples: 2 }],
        [SYSTEM_MEMORY_SQL]: [],
        [appMemoryTimelineSql(3)]: [
          [0, 1024 * 1024],
          [1, 2 * 1024 * 1024],
        ],
      }),
    )

    const data = outcome.collected ? outcome.data : null
    expect(data!.timeline).toEqual([
      { t_s: 0, rss_kb: 1024 },
      { t_s: 1, rss_kb: 2048 },
    ])
  })
})

describe('SYSTEM_MEMORY_TIMELINE_SQL', () => {
  it('meminfo 두 카운터만, 초별 마지막 표본을 고른다', () => {
    // `max(value)` 를 쓰면 "그 초의 최댓값" 이 되어 "마지막" 과 달라진다.
    expect(SYSTEM_MEMORY_TIMELINE_SQL).toContain("t.type = 'meminfo'")
    expect(SYSTEM_MEMORY_TIMELINE_SQL).toContain("'MemAvailable', 'MemFree'")
    expect(SYSTEM_MEMORY_TIMELINE_SQL).toContain('order by c.ts desc')
    expect(SYSTEM_MEMORY_TIMELINE_SQL).not.toContain('max(c.value)')
  })
})

describe('buildSystemMemoryTimeline', () => {
  const rows: SystemMemoryTimelineRow[] = [
    [0, 'MemAvailable', 4_194_304],
    [0, 'MemFree', 1_048_576],
    [1, 'MemAvailable', 3_145_728],
    [1, 'MemFree', 524_288],
  ]

  it('바이트를 kB 로 옮기고 두 값을 한 점에 담는다', () => {
    expect(buildSystemMemoryTimeline(rows)).toEqual([
      { t_s: 0, mem_available_kb: 4096, mem_free_kb: 1024 },
      { t_s: 1, mem_available_kb: 3072, mem_free_kb: 512 },
    ])
  })

  it('첫 초도 결과에 있다 — meminfo 는 누적이 아니라 그 순간의 값이다', () => {
    expect(buildSystemMemoryTimeline(rows)![0]!.t_s).toBe(0)
  })

  it('짝이 안 맞는 초는 버린다 — 한쪽만 있는 점을 0 으로 채우지 않는다', () => {
    const halfPaired: SystemMemoryTimelineRow[] = [
      [0, 'MemAvailable', 4_194_304], // MemFree 없음
      [1, 'MemAvailable', 3_145_728],
      [1, 'MemFree', 524_288],
    ]
    expect(buildSystemMemoryTimeline(halfPaired)?.map((p) => p.t_s)).toEqual([1])
  })

  it('행이 없으면 빈 배열이 아니라 null 이다', () => {
    expect(buildSystemMemoryTimeline([])).toBeNull()
  })

  it('짝 맞는 초가 하나도 없으면 null 이다', () => {
    expect(buildSystemMemoryTimeline([[0, 'MemAvailable', 4_194_304]])).toBeNull()
  })

  it('초 순서가 뒤섞여 와도 오름차순으로 낸다', () => {
    const shuffled: SystemMemoryTimelineRow[] = [
      [2, 'MemFree', 524_288],
      [0, 'MemAvailable', 4_194_304],
      [2, 'MemAvailable', 3_145_728],
      [0, 'MemFree', 1_048_576],
    ]
    expect(buildSystemMemoryTimeline(shuffled)?.map((p) => p.t_s)).toEqual([0, 2])
  })
})
