import { appProcessSql, resolveAppProcess, type ResolvedAppProcess } from '../../appProcess.js'
import type { AppProcessCandidate } from '../../appProcess.js'
import { relativeSecondSql } from '../../timeline.js'
import type { ExtractContext } from '../../types.js'
import type { CounterStatBytes, MemoryCollection, SystemMemoryBytes } from '../model.js'

/**
 * **perfetto `linux.process_stats` + `linux.sys_stats` 경로.**
 * 이 파일이 아는 것: 카운터를 어떤 SQL 로 꺼내는가. 모르는 것: kB 도, 스키마 모양도 모른다.
 */
export const PROCESS_STATS_SOURCE = 'linux.process_stats'

export type MemoryProcessCandidate = AppProcessCandidate

export interface CounterStatRow {
  counter: string
  min: number
  max: number
  avg: number
  samples: number
}

/** upid 는 숫자라 인터폴레이션이 안전하다. */
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
 * 앱 RSS 의 시간별 표본 `[상대초, 바이트]`. 기준점은 frame 과 **같은** trace_bounds 다 —
 * 지표마다 자기 첫 표본을 0 초로 잡으면 두 그래프를 겹쳤을 때 축이 어긋난다.
 */
export function appMemoryTimelineSql(upid: number): string {
  return (
    `select json_group_array(json_array(${relativeSecondSql('c.ts')}, cast(c.value as int))) as j ` +
    'from counter c join process_counter_track t on c.track_id = t.id ' +
    `where t.upid = ${upid} and t.name = 'mem.rss' order by c.ts`
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

function stat(row: CounterStatRow | undefined): CounterStatBytes | null {
  return row === undefined ? null : { min: row.min, max: row.max, avg: row.avg, samples: row.samples }
}

/**
 * 필요한 이름이 하나라도 빠지면 그 자리를 억지로 0 으로 채우지 않고 통째로 포기한다 —
 * 반쯤 채운 시스템 메모리는 읽는 쪽이 구분할 수 없는 거짓말이 된다.
 */
export function toSystemBytes(rows: CounterStatRow[]): SystemMemoryBytes | null {
  const by = new Map(rows.map((r) => [r.counter, r]))
  const total = by.get('MemTotal')
  const available = stat(by.get('MemAvailable'))
  const free = stat(by.get('MemFree'))
  const cached = stat(by.get('Cached'))
  const swapTotal = by.get('SwapTotal')
  const swapFree = stat(by.get('SwapFree'))

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
    memTotal: total.max,
    memAvailable: available,
    memFree: free,
    cached,
    swapTotal: swapTotal.max,
    swapFree,
  }
}

export interface ProcessStatsResult {
  collection: MemoryCollection | null
  resolved: ResolvedAppProcess<MemoryProcessCandidate> | null
  /** 앱은 찾았지만 `mem.rss` 표본이 없는 경우. 호출자가 사유를 가른다. */
  noRssSamples: boolean
}

export async function collectFromProcessStats(ctx: ExtractContext): Promise<ProcessStatsResult> {
  const candidates = await ctx.tp.queryJson<MemoryProcessCandidate[]>(
    appProcessSql(ctx.packageName, ctx.capture.appPid),
  )
  const resolved = resolveAppProcess(candidates, ctx.packageName, ctx.capture.appPid)
  if (resolved === null) return { collection: null, resolved: null, noRssSamples: false }

  const upid = resolved.candidate.upid
  const rows = await ctx.tp.queryJson<CounterStatRow[]>(appMemorySql(upid))
  const by = new Map(rows.map((r) => [r.counter, r]))
  const rss = stat(by.get('mem.rss'))
  if (rss === null) return { collection: null, resolved, noRssSamples: true }

  // sys_stats 는 별도 데이터소스라 없을 수 있다. 그 부재가 앱 RSS 를 죽이면 안 된다.
  let system: SystemMemoryBytes | null = null
  try {
    system = toSystemBytes(await ctx.tp.queryJson<CounterStatRow[]>(SYSTEM_MEMORY_SQL))
  } catch {
    system = null
  }

  const timelineRows = await ctx.tp.queryJson<[number, number][]>(appMemoryTimelineSql(upid))
  const watermark = by.get('mem.rss.watermark')

  return {
    resolved,
    noRssSamples: false,
    collection: {
      process: resolved.name,
      pid: resolved.candidate.pid,
      rss,
      rssAnon: stat(by.get('mem.rss.anon')),
      rssFile: stat(by.get('mem.rss.file')),
      watermarkPeak: watermark === undefined ? null : watermark.max,
      timeline: timelineRows.map(([second, rssBytes]) => ({ second, rssBytes })),
      system,
    },
  }
}
