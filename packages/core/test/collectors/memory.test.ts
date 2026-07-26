import { describe, expect, it } from 'vitest'
import { PROCESS_STATS_BLOCK, SYS_STATS_BLOCK } from '../../src/collectors/blocks.js'
import {
  appMemorySql,
  appProcessSql,
  type CounterStatRow,
  memoryCollector,
  type MemoryProcessCandidate,
  selectAppProcess,
  SYSTEM_MEMORY_SQL,
} from '../../src/collectors/memory.js'
import type { ExtractContext } from '../../src/collectors/types.js'

describe('selectAppProcess', () => {
  const main: MemoryProcessCandidate = { upid: 5, pid: 24193, name: 'com.foo.bar' }
  const remote: MemoryProcessCandidate = { upid: 6, pid: 24290, name: 'com.foo.bar:remote' }
  const push: MemoryProcessCandidate = { upid: 7, pid: 24101, name: 'com.foo.bar:push' }

  it('패키지명과 정확히 같은 프로세스를 먼저 고른다', () => {
    expect(selectAppProcess([remote, main, push], 'com.foo.bar')).toBe(main)
  })

  it('메인 프로세스가 없으면 pid 가 가장 작은 서브프로세스를 고른다', () => {
    expect(selectAppProcess([remote, push], 'com.foo.bar')).toBe(push)
  })

  it('접두어만 같은 다른 패키지를 잡지 않는다', () => {
    const other: MemoryProcessCandidate = { upid: 9, pid: 1, name: 'com.foo.barbaz' }
    expect(selectAppProcess([other], 'com.foo.bar')).toBeNull()
  })

  it('이름이 null 인 후보는 무시한다', () => {
    expect(selectAppProcess([{ upid: 1, pid: 2, name: null }], 'com.foo.bar')).toBeNull()
  })

  it('후보가 없으면 null 이다', () => {
    expect(selectAppProcess([], 'com.foo.bar')).toBeNull()
  })
})

describe('appProcessSql', () => {
  it('패키지명을 SQL 리터럴로 감싼다', () => {
    expect(appProcessSql('com.foo.bar')).toContain("'com.foo.bar'")
  })

  it('작은따옴표가 섞여도 리터럴 밖으로 새지 않는다', () => {
    expect(appProcessSql("a'b")).toContain("'a''b'")
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

const PKG = 'com.android.systemui'

function ctx(answers: Record<string, unknown>): ExtractContext {
  return {
    tp: new FakeTp(answers) as unknown as ExtractContext['tp'],
    packageName: PKG,
    env: { sdkInt: 35, dataSources: ['linux.process_stats', 'linux.sys_stats'] },
    capture: { startup: null, launchRequested: false },
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
    [appProcessSql(PKG)]: CANDIDATES,
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
    expect(memoryCollector.traceConfigBlocks()).toEqual([PROCESS_STATS_BLOCK, SYS_STATS_BLOCK])
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
    const outcome = await memoryCollector.extract(ctx(answers({ [appProcessSql(PKG)]: [] })))
    expect(outcome).toEqual({
      collected: false,
      reason: { code: 'process_not_in_trace', detail: { package: PKG } },
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
