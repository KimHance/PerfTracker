import { sqlQuote } from '../perfetto/traceProcessor/client.js'
import type { MemoryData, MemoryStat, SystemMemory } from '../schema/result.js'
import { type AppProcessCandidate, resolveAppProcess, staleNameReason } from './appProcess.js'
import { PROCESS_STATS_BLOCK, SYS_STATS_BLOCK } from './blocks.js'
import { bytesToKb } from './num.js'
import type {
  CollectorEnv,
  ExtractContext,
  ExtractOutcome,
  SupportResult,
  TraceCollector,
} from './types.js'

const PROCESS_STATS_SOURCE = 'linux.process_stats'

export type MemoryProcessCandidate = AppProcessCandidate

export interface CounterStatRow {
  counter: string
  min: number
  max: number
  avg: number
  samples: number
}

/**
 * 후보를 좁혀서 가져온다. `glob` 을 쓰는 이유: 패키지명에 `.` 이 흔한데 `like` 에서는 `_` 가
 * 와일드카드라 `com.foo_bar` 가 `com.fooXbar` 를 잡는다. glob 은 `.` 도 `_` 도 리터럴이다.
 * (`*` 와 `?` 와 `[` 는 패키지명에 나올 수 없다.)
 *
 * `appPid` 가 있으면 pid 조건도 함께 건다 — 이름이 `zygote64` 로 굳은 프로세스는 이름
 * 조건으로는 절대 후보에 들어오지 못하기 때문이다 (`collectors/appProcess.ts` 참고).
 * pid 는 숫자라 인터폴레이션이 안전하다.
 */
export function appProcessSql(packageName: string, appPid: number | null): string {
  const exact = sqlQuote(packageName)
  const sub = sqlQuote(`${packageName}:*`)
  const byPid = appPid !== null ? ` or p.pid = ${Math.trunc(appPid)}` : ''
  return (
    "select json_group_array(json_object('upid', upid, 'pid', pid, 'name', name)) as j from (" +
    `select p.upid as upid, p.pid as pid, p.name as name from process p ` +
    `where p.name = ${exact} or p.name glob ${sub}${byPid} order by p.pid)`
  )
}

/** upid 는 숫자라 인터폴레이션이 안전하다 (frame.ts 의 `frameDurationsSql` 과 같은 규칙). */
export function appMemorySql(upid: number): string {
  return (
    "select json_group_array(json_object('counter', counter, 'min', min_v, 'max', max_v, " +
    "'avg', avg_v, 'samples', samples)) as j from (" +
    'select t.name as counter, cast(min(c.value) as int) as min_v, ' +
    'cast(max(c.value) as int) as max_v, cast(avg(c.value) as int) as avg_v, count(*) as samples ' +
    'from counter c join process_counter_track t on c.track_id = t.id ' +
    `where t.upid = ${upid} ` +
    "and t.name in ('mem.rss', 'mem.rss.anon', 'mem.rss.file', 'mem.rss.watermark') " +
    'group by t.name order by t.name)'
  )
}

/**
 * meminfo 는 프로세스에도 CPU 에도 붙지 않는 전역 카운터다.
 * `counter_track.type = 'meminfo'` 로 거르는 것이 이름 목록을 하드코딩하는 것보다 안전하다 —
 * 실측에서 `MemTotal` / `MemAvailable` 등 8종이 전부 이 type 으로 나왔다.
 */
export const SYSTEM_MEMORY_SQL =
  "select json_group_array(json_object('counter', counter, 'min', min_v, 'max', max_v, " +
  "'avg', avg_v, 'samples', samples)) as j from (" +
  'select t.name as counter, cast(min(c.value) as int) as min_v, ' +
  'cast(max(c.value) as int) as max_v, cast(avg(c.value) as int) as avg_v, count(*) as samples ' +
  'from counter c join counter_track t on c.track_id = t.id ' +
  "where t.type = 'meminfo' group by t.name order by t.name)"

function toStat(row: CounterStatRow | undefined): MemoryStat | null {
  if (row === undefined) return null
  return { min_kb: bytesToKb(row.min), max_kb: bytesToKb(row.max), avg_kb: bytesToKb(row.avg) }
}

/**
 * meminfo 행을 시스템 메모리로 접는다. `MemTotal` 이 없으면 의미 있는 문맥이 없다고 보고 null.
 * 필요한 이름이 하나라도 빠지면 그 자리를 억지로 0 으로 채우지 않고 통째로 포기한다 —
 * 반쯤 채운 시스템 메모리는 읽는 쪽이 구분할 수 없는 거짓말이 된다.
 */
function toSystemMemory(rows: CounterStatRow[]): SystemMemory | null {
  const by = new Map(rows.map((r) => [r.counter, r]))
  const total = by.get('MemTotal')
  const available = toStat(by.get('MemAvailable'))
  const free = toStat(by.get('MemFree'))
  const cached = toStat(by.get('Cached'))
  const swapTotal = by.get('SwapTotal')
  const swapFree = toStat(by.get('SwapFree'))

  if (
    total === undefined ||
    available === null ||
    free === null ||
    cached === null ||
    swapTotal === undefined ||
    swapFree === null
  ) {
    return null
  }

  return {
    mem_total_kb: bytesToKb(total.max),
    mem_available: available,
    mem_free: free,
    cached,
    swap_total_kb: bytesToKb(swapTotal.max),
    swap_free: swapFree,
  }
}

export const memoryCollector: TraceCollector<MemoryData> = {
  id: 'memory',
  source: 'perfetto: linux.process_stats mem.rss + linux.sys_stats meminfo',
  needsTrace: true,

  supports(env: CollectorEnv): SupportResult {
    // process_stats 만 하드 요구다. meminfo 는 없으면 system: null 로 빠질 뿐이다.
    if (!env.dataSources.includes(PROCESS_STATS_SOURCE)) {
      return {
        supported: false,
        reason: {
          code: 'data_source_not_registered',
          detail: { data_source: PROCESS_STATS_SOURCE },
        },
      }
    }
    return { supported: true }
  },

  traceConfigBlocks() {
    return [PROCESS_STATS_BLOCK, SYS_STATS_BLOCK]
  },

  async extract(ctx: ExtractContext): Promise<ExtractOutcome<MemoryData>> {
    const candidates = await ctx.tp.queryJson<MemoryProcessCandidate[]>(
      appProcessSql(ctx.packageName, ctx.capture.appPid),
    )
    const resolved = resolveAppProcess(candidates, ctx.packageName, ctx.capture.appPid)
    if (resolved === null) {
      return {
        collected: false,
        reason: { code: 'process_not_in_trace', detail: { package: ctx.packageName } },
      }
    }

    const picked = resolved.candidate
    const processName = resolved.name
    const rows = await ctx.tp.queryJson<CounterStatRow[]>(appMemorySql(picked.upid))
    const by = new Map(rows.map((r) => [r.counter, r]))
    const rss = by.get('mem.rss')
    if (rss === undefined) {
      return { collected: false, reason: { code: 'no_rss_samples', detail: { process: processName } } }
    }

    // sys_stats 는 별도 데이터소스라 별도로 없을 수 있다. 그 부재가 앱 RSS 를 죽이면 안 된다.
    let system: SystemMemory | null = null
    try {
      system = toSystemMemory(await ctx.tp.queryJson<CounterStatRow[]>(SYSTEM_MEMORY_SQL))
    } catch {
      system = null
    }

    const watermark = by.get('mem.rss.watermark')
    const data: MemoryData = {
      process: processName,
      pid: picked.pid,
      samples: rss.samples,
      rss: toStat(rss)!,
      rss_anon: toStat(by.get('mem.rss.anon')),
      rss_file: toStat(by.get('mem.rss.file')),
      rss_watermark_peak_kb: watermark === undefined ? null : bytesToKb(watermark.max),
      system,
    }

    // 사유는 하나만 실을 수 있다. 둘이 겹치면 **정체성** 쪽을 먼저 낸다 —
    // meminfo 가 없다는 사실은 `system: null` 로 데이터에 이미 드러나지만,
    // "이 프로세스가 그 앱이라는 근거가 이름이 아니라 pid 였다" 는 데이터 어디에도 안 남는다.
    const stale = staleNameReason(resolved, ctx.packageName)
    if (stale !== null) return { collected: true, data, partialReason: stale }
    return system === null
      ? { collected: true, data, partialReason: { code: 'no_meminfo_samples' } }
      : { collected: true, data }
  },
}
