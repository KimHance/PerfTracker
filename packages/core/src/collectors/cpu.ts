import type { CpuData, CpuFrequency } from '../schema/result.js'
import { FTRACE_POWER_BLOCK, SYS_STATS_BLOCK } from './blocks.js'
import { round } from './num.js'
import type {
  CollectorEnv,
  ExtractContext,
  ExtractOutcome,
  SupportResult,
  TraceCollector,
} from './types.js'

const SYS_STATS_SOURCE = 'linux.sys_stats'
/** delta 를 내려면 최소 두 표본이 필요하다. */
const MIN_SAMPLES = 2

/**
 * `cpu.times.*` 는 부팅 이후 누적 ns 라 **차이**만 의미가 있다.
 * `cpu_counter_track.cpu` 가 코어 번호다 (v57 에서 `ucpu` 와 별도로 존재한다 — 실측 확인).
 * 단일 행·단일 열 계약을 지키려고 group by 를 서브쿼리에 가둔다.
 */
export const CPU_TIMES_SQL =
  "select json_group_array(json_object('cpu', cpu, 'counter', counter, 'first', first, " +
  "'last', last, 'first_ts', first_ts, 'last_ts', last_ts, 'samples', samples)) as j from (" +
  'select t.cpu as cpu, t.name as counter, ' +
  'cast(min(c.value) as int) as first, cast(max(c.value) as int) as last, ' +
  'min(c.ts) as first_ts, max(c.ts) as last_ts, count(*) as samples ' +
  'from counter c join cpu_counter_track t on c.track_id = t.id ' +
  "where t.name like 'cpu.times.%' " +
  'group by t.cpu, t.name order by t.cpu, t.name)'

/** ftrace `power/cpu_frequency` 는 `cpufreq` 라는 이름의 cpu_counter_track 이 된다 (실측 확인). 단위는 kHz. */
export const CPU_FREQ_SQL =
  "select json_group_array(json_object('cpu', cpu, 'samples', samples, 'min_khz', min_khz, " +
  "'max_khz', max_khz, 'avg_khz', avg_khz)) as j from (" +
  'select t.cpu as cpu, count(*) as samples, min(c.value) as min_khz, ' +
  'max(c.value) as max_khz, avg(c.value) as avg_khz ' +
  'from counter c join cpu_counter_track t on c.track_id = t.id ' +
  "where t.name = 'cpufreq' group by t.cpu order by t.cpu)"

export interface CpuTimeRow {
  cpu: number
  counter: string
  first: number
  last: number
  first_ts: number
  last_ts: number
  samples: number
}

export interface CpuFreqRow {
  cpu: number
  samples: number
  min_khz: number
  max_khz: number
  avg_khz: number
}

export interface CpuTimeSummary {
  samples: number
  sampledMs: number
  totalDeltaNs: number
  busyDeltaNs: number
  perCore: { cpu: number; busy_pct: number }[]
}

/** /proc/stat 관례상 io_wait 도 idle 이다. 나머지(user/nice/system/irq/softirq/steal)는 전부 busy. */
const IDLE_COUNTERS = new Set(['cpu.times.idle_ns', 'cpu.times.io_wait_ns'])

/**
 * 누적 카운터 행들을 구간 사용률로 접는다.
 *
 * `min`/`max` 를 `first`/`last` 로 쓰는 것은 이 카운터가 단조 증가라는 사실에 기댄 것이다.
 * 그 가정이 깨진 행(음수 delta — 기기 재부팅 등)은 조용히 0 으로 만들지 않고 **버린다.**
 * 남기면 total 은 늘고 busy 는 안 늘어 사용률이 실제보다 낮게 나온다.
 *
 * Task 6 의 measurement_overhead 가 `totalDeltaNs` 를 분모로 재사용한다.
 */
export function summarizeCpuTimes(rows: CpuTimeRow[]): CpuTimeSummary | null {
  if (rows.length === 0) return null

  const byCpu = new Map<number, { total: number; busy: number }>()
  let samples = 0
  let firstTs = Number.POSITIVE_INFINITY
  let lastTs = 0

  for (const row of rows) {
    const delta = row.last - row.first
    if (!Number.isFinite(delta) || delta < 0) continue

    const acc = byCpu.get(row.cpu) ?? { total: 0, busy: 0 }
    acc.total += delta
    if (!IDLE_COUNTERS.has(row.counter)) acc.busy += delta
    byCpu.set(row.cpu, acc)

    samples = Math.max(samples, row.samples)
    firstTs = Math.min(firstTs, row.first_ts)
    lastTs = Math.max(lastTs, row.last_ts)
  }

  if (byCpu.size === 0) return null

  let total = 0
  let busy = 0
  const perCore: { cpu: number; busy_pct: number }[] = []
  for (const [cpu, acc] of [...byCpu.entries()].sort((a, b) => a[0] - b[0])) {
    total += acc.total
    busy += acc.busy
    perCore.push({ cpu, busy_pct: acc.total > 0 ? round((acc.busy / acc.total) * 100, 2) : 0 })
  }

  return {
    samples,
    sampledMs: Number.isFinite(firstTs) ? Math.max(0, Math.round((lastTs - firstTs) / 1e6)) : 0,
    totalDeltaNs: total,
    busyDeltaNs: busy,
    perCore,
  }
}

export const cpuCollector: TraceCollector<CpuData> = {
  id: 'cpu',
  source: 'perfetto: linux.sys_stats cpu.times.* + ftrace power/cpu_frequency',
  needsTrace: true,

  supports(env: CollectorEnv): SupportResult {
    // sys_stats 만 하드 요구다. ftrace 가 없으면 주파수가 빠질 뿐 사용률은 나온다.
    if (!env.dataSources.includes(SYS_STATS_SOURCE)) {
      return {
        supported: false,
        reason: { code: 'data_source_not_registered', detail: { data_source: SYS_STATS_SOURCE } },
      }
    }
    return { supported: true }
  },

  traceConfigBlocks() {
    // ftrace 를 supports() 와 무관하게 항상 요청한다 — 등록되지 않은 데이터소스는
    // perfetto 가 조용히 무시하고, 세션을 실패시키지 않는다.
    return [SYS_STATS_BLOCK, FTRACE_POWER_BLOCK]
  },

  async extract(ctx: ExtractContext): Promise<ExtractOutcome<CpuData>> {
    const rows = await ctx.tp.queryJson<CpuTimeRow[]>(CPU_TIMES_SQL)
    const summary = summarizeCpuTimes(rows)
    if (summary === null) {
      return { collected: false, reason: { code: 'no_cpu_samples' } }
    }
    if (summary.samples < MIN_SAMPLES || summary.totalDeltaNs <= 0) {
      return {
        collected: false,
        reason: {
          code: 'insufficient_samples',
          detail: { samples: summary.samples, required: MIN_SAMPLES },
        },
      }
    }

    // 주파수는 별도 데이터소스(ftrace)라 별도로 실패할 수 있다. 그 실패가 사용률을 죽이면 안 된다.
    let frequency: CpuFrequency[] | null = null
    try {
      const freqRows = await ctx.tp.queryJson<CpuFreqRow[]>(CPU_FREQ_SQL)
      if (freqRows.length > 0) {
        frequency = freqRows.map((r) => ({
          cpu: r.cpu,
          samples: r.samples,
          min_khz: round(r.min_khz, 1),
          max_khz: round(r.max_khz, 1),
          avg_khz: round(r.avg_khz, 1),
        }))
      }
    } catch {
      // ftrace 가 아예 없는 기기에서는 테이블이 비어 있거나 쿼리가 실패한다. 둘 다 "주파수 없음" 이다.
      frequency = null
    }

    const data: CpuData = {
      sampled_ms: summary.sampledMs,
      samples: summary.samples,
      total_busy_pct: round((summary.busyDeltaNs / summary.totalDeltaNs) * 100, 2),
      per_core: summary.perCore,
      frequency,
    }

    // 스펙: 사용률과 주파수는 함께 봐야 한다. 함께 못 냈으면 그 사실을 결과에 적는다.
    return frequency === null
      ? { collected: true, data, partialReason: { code: 'cpu_freq_unavailable' } }
      : { collected: true, data }
  },
}
