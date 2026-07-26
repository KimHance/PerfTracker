import type { MetricReason } from '../schema/reasons.js'
import type { AppCpuData, AppCpuProcess, CpuData, CpuFrequency } from '../schema/result.js'
import {
  type AppProcessCandidate,
  appProcessSql,
  resolveAppProcess,
  staleNameReason,
} from './appProcess.js'
import { FTRACE_POWER_BLOCK, PROCESS_STATS_BLOCK, SYS_STATS_BLOCK } from './blocks.js'
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
  /** 단조성이 깨져 통째로 제외한 코어 번호들 (오름차순). 정상 트레이스에서는 빈 배열이다. */
  droppedCpus: number[]
}

/** /proc/stat 관례상 io_wait 도 idle 이다. 나머지(user/nice/system/irq/softirq/steal)는 전부 busy. */
const IDLE_COUNTERS = new Set(['cpu.times.idle_ns', 'cpu.times.io_wait_ns'])

/**
 * 누적 카운터 행들을 구간 사용률로 접는다.
 *
 * `min`/`max` 를 `first`/`last` 로 쓰는 것은 이 카운터가 단조 증가라는 사실에 기댄 것이다.
 * 그 가정이 깨지면(음수 delta — 세션 중 기기 재부팅 등) **그 코어를 통째로 버린다.**
 *
 * 왜 행 하나가 아니라 코어 전체인가: idle 과 io_wait 은 분모(total)에만 들어가고 분자(busy)
 * 에는 안 들어간다. 되감긴 `idle_ns` 행 하나만 버리면 그 코어의 분모에서 idle 이 빠지고
 * 분자는 그대로 남아 사용률이 100% 쪽으로 밀린다 — 못 잰 것이 "매우 바빴다" 로 둔갑한다.
 * 한 코어의 카운터 집합은 함께 읽어야만 의미가 있으므로 함께 버린다.
 *
 * `rows` 가 아예 비면 null 이다("표본 없음"). 행은 있는데 전부 버린 경우는 null 이 아니라
 * `perCore: []` + `droppedCpus` 로 돌려준다 — 그 둘은 사용자에게 다른 사실이고,
 * 호출자가 다른 사유 코드를 낸다.
 *
 * Task 6 의 measurement_overhead 가 `totalDeltaNs` 를 분모로 재사용한다.
 */
export function summarizeCpuTimes(rows: CpuTimeRow[]): CpuTimeSummary | null {
  if (rows.length === 0) return null

  const byCpu = new Map<number, { total: number; busy: number; broken: boolean }>()
  let samples = 0
  let firstTs = Number.POSITIVE_INFINITY
  let lastTs = 0

  for (const row of rows) {
    const acc = byCpu.get(row.cpu) ?? { total: 0, busy: 0, broken: false }
    byCpu.set(row.cpu, acc)

    samples = Math.max(samples, row.samples)
    firstTs = Math.min(firstTs, row.first_ts)
    lastTs = Math.max(lastTs, row.last_ts)

    const delta = row.last - row.first
    if (!Number.isFinite(delta) || delta < 0) {
      acc.broken = true
      continue
    }
    acc.total += delta
    if (!IDLE_COUNTERS.has(row.counter)) acc.busy += delta
  }

  let total = 0
  let busy = 0
  const perCore: { cpu: number; busy_pct: number }[] = []
  const droppedCpus: number[] = []
  for (const [cpu, acc] of [...byCpu.entries()].sort((a, b) => a[0] - b[0])) {
    if (acc.broken) {
      droppedCpus.push(cpu)
      continue
    }
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
    droppedCpus,
  }
}

/**
 * 대상 앱 프로세스의 CPU **시간**. `/proc/<pid>/stat` 의 utime/stime 을 perfetto 가
 * `runtime.user_ns` / `runtime.kernel_ns` 카운터로 낸 것이고, `PROCESS_STATS_BLOCK` 의
 * `record_process_runtime: true` 가 만든다 — **데이터소스를 새로 켜지 않는다.**
 *
 * `extract/overhead.ts` 가 `traced` / `traced_probes` 에 대해 정확히 같은 카운터를 같은
 * 방식으로 접는다. 이 도구는 프로세스별 CPU 를 뽑을 줄 알면서 자기 자신에게만 쓰고 있었다.
 */
export interface AppCpuRow {
  upid: number
  counter: string
  first: number
  last: number
  samples: number
  first_ts: number
  last_ts: number
}

/**
 * upid 목록으로 runtime 카운터를 가져온다. upid 는 숫자라 인터폴레이션이 안전하다
 * (`memory.ts` 의 `appMemorySql`, `frame.ts` 의 `frameDurationsSql` 과 같은 규칙).
 *
 * `mem.rss` 는 일부러 조회하지 않는다 — 이 collector 가 쓰지 않는 값을 한 배열에 섞어
 * 오면 접는 쪽에서 CPU 합에 메모리 값이 들어갈 자리가 생긴다.
 */
export function appCpuSql(upids: number[]): string {
  return (
    "select json_group_array(json_object('upid', upid, 'counter', counter, 'first', first_v, " +
    "'last', last_v, 'samples', n, 'first_ts', first_ts, 'last_ts', last_ts)) as j from (" +
    'select t.upid as upid, t.name as counter, cast(min(c.value) as int) as first_v, ' +
    'cast(max(c.value) as int) as last_v, count(*) as n, ' +
    'min(c.ts) as first_ts, max(c.ts) as last_ts ' +
    'from counter c join process_counter_track t on c.track_id = t.id ' +
    `where t.upid in (${upids.map((u) => Math.trunc(u)).join(', ')}) ` +
    "and t.name in ('runtime.user_ns', 'runtime.kernel_ns') " +
    'group by t.upid, t.name order by t.upid, t.name)'
  )
}

export interface AppCpuSummary {
  userNs: number
  kernelNs: number
  samples: number
  sampledMs: number
  /**
   * 단조성이 깨진 카운터. **프로세스별 누적 CPU 시간은 되감길 수 없으므로** 이것이 null 이
   * 아니면 이 upid 가 우리가 생각하는 프로세스가 아니라는 뜻이다. 그때 호출자는 값을 내지
   * 않는다 — 남은 카운터만 더하면 "user 만 센 CPU 시간" 이 전체인 척한다.
   */
  backwards: { counter: string; first: number; last: number } | null
}

/**
 * 한 upid 의 runtime 카운터를 접는다. 그 upid 의 행이 **하나도 없으면 null** 이다 —
 * 0 은 "재 보니 0" 이고 null 은 "안 쟀다" 이며, 이 둘을 뭉개는 것이 이 저장소가 반복해서
 * 거부해 온 결함이다 (`record_process_runtime` 이 꺼진 옛 캡처가 정확히 이 경우다).
 */
export function summarizeAppCpu(rows: AppCpuRow[], upid: number): AppCpuSummary | null {
  const mine = rows.filter((r) => r.upid === upid)
  if (mine.length === 0) return null

  let userNs = 0
  let kernelNs = 0
  let samples = 0
  let firstTs = Number.POSITIVE_INFINITY
  let lastTs = 0
  let backwards: AppCpuSummary['backwards'] = null

  for (const row of mine) {
    samples = Math.max(samples, row.samples)
    firstTs = Math.min(firstTs, row.first_ts)
    lastTs = Math.max(lastTs, row.last_ts)

    const delta = row.last - row.first
    if (!Number.isFinite(delta) || delta < 0) {
      backwards ??= { counter: row.counter, first: row.first, last: row.last }
      continue
    }
    if (row.counter === 'runtime.user_ns') userNs += delta
    else if (row.counter === 'runtime.kernel_ns') kernelNs += delta
  }

  return {
    userNs,
    kernelNs,
    samples,
    sampledMs: Number.isFinite(firstTs) ? Math.max(0, Math.round((lastTs - firstTs) / 1e6)) : 0,
    backwards,
  }
}

const nsToMs = (ns: number): number => Math.round(ns / 1e6)

/** 대상 앱 부분의 산출 결과. 값이 없으면 사유가 왜인지 말한다 — 0 을 내지 않는다. */
interface AppCpuOutcome {
  data: AppCpuData | null
  reason: MetricReason | null
}

/**
 * `app` 자리를 채운다. **절대 던지지 않는다** — 앱 프로세스를 못 읽는 것이 기기 전역 값까지
 * 잃을 이유는 아니다. 못 읽은 자리는 null 이고 사유가 갈래를 말한다.
 */
async function extractAppCpu(ctx: ExtractContext, deviceTotalNs: number): Promise<AppCpuOutcome> {
  let candidates: AppProcessCandidate[]
  let rows: AppCpuRow[]
  let resolved: ReturnType<typeof resolveAppProcess<AppProcessCandidate>>
  try {
    candidates = await ctx.tp.queryJson<AppProcessCandidate[]>(
      appProcessSql(ctx.packageName, ctx.capture.appPid),
    )
    resolved = resolveAppProcess(candidates, ctx.packageName, ctx.capture.appPid)
    if (resolved === null) {
      return {
        data: null,
        reason: { code: 'process_not_in_trace', detail: { package: ctx.packageName } },
      }
    }
    rows = await ctx.tp.queryJson<AppCpuRow[]>(appCpuSql(candidates.map((c) => c.upid)))
  } catch (e) {
    return { data: null, reason: { code: 'query_failed', detail: { message: (e as Error).message } } }
  }

  const picked = resolved.candidate
  const summary = summarizeAppCpu(rows, picked.upid)
  if (summary === null) {
    return {
      data: null,
      reason: {
        code: 'no_app_cpu_samples',
        detail: { process: resolved.name, pid: picked.pid },
      },
    }
  }
  if (summary.backwards !== null) {
    return {
      data: null,
      reason: {
        code: 'counter_went_backwards',
        detail: {
          counter: summary.backwards.counter,
          before: summary.backwards.first,
          after: summary.backwards.last,
        },
      },
    }
  }

  // 나머지 후보는 **합치지 않고** 각자 pid 를 달고 실린다. 근거는 실기기 실측이다:
  // 앱 uid 의 프로세스 넷 중 트레이스 이름이 패키지명과 정확히 같은 것은 8.63초를 쓴 본체가
  // 아니라 10ms 를 쓴 자식이었고, 본체 이름은 `<pre-initialized>` 였다. 즉 이름으로 모은
  // 후보 집합은 "이 앱의 프로세스 전부" 가 아니다. 그 집합의 합을 "이 앱의 CPU" 라고 부르면
  // 확인하지 못한 것을 사실로 만드는 것이 된다. CPU 시간은 더해도 이중 계산이 아니지만,
  // **불완전한 집합의 합은 이중 계산보다 나쁘다** — 누가 빠졌는지조차 결과에 안 남는다.
  const others: AppCpuProcess[] = []
  for (const c of candidates) {
    if (c.upid === picked.upid) continue
    const s = summarizeAppCpu(rows, c.upid)
    if (s === null || s.backwards !== null) continue
    others.push({
      process: c.name,
      pid: c.pid,
      user_ms: nsToMs(s.userNs),
      kernel_ms: nsToMs(s.kernelNs),
      total_ms: nsToMs(s.userNs + s.kernelNs),
    })
  }

  const totalMs = nsToMs(summary.userNs + summary.kernelNs)
  return {
    data: {
      process: resolved.name,
      pid: picked.pid,
      samples: summary.samples,
      sampled_ms: summary.sampledMs,
      user_ms: nsToMs(summary.userNs),
      kernel_ms: nsToMs(summary.kernelNs),
      total_ms: totalMs,
      // 분모는 `extract/overhead.ts` 의 `tracing_processes_cpu_share_pct` 와 **같은 값**이다.
      // 한 result.json 안의 두 백분율이 다른 분모를 쓰면 서로 비교할 수 없는 숫자가 된다.
      share_of_device_cpu_pct: round((totalMs / (deviceTotalNs / 1e6)) * 100, 2),
      other_processes: others,
    },
    reason: staleNameReason(resolved, ctx.packageName),
  }
}

export const cpuCollector: TraceCollector<CpuData> = {
  id: 'cpu',
  source:
    'perfetto: linux.process_stats runtime.* (앱) + linux.sys_stats cpu.times.* · ' +
    'ftrace power/cpu_frequency (기기 전역)',
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
    //
    // process_stats 는 앱 단위 `runtime.*` 를 읽으려고 선언한다. **블록 텍스트는 공유 상수
    // 그대로이므로 기기로 나가는 데이터소스가 늘지 않는다** — frame/memory 가 이미 같은
    // 상수를 요청하고 `mergeTraceConfigBlocks` 가 하나로 접는다. 읽는 것을 선언하지 않으면
    // frame(sdk<31 에서 꺼짐)과 memory 가 둘 다 미지원인 기기에서 조용히 값이 사라진다.
    return [SYS_STATS_BLOCK, FTRACE_POWER_BLOCK, PROCESS_STATS_BLOCK]
  },

  async extract(ctx: ExtractContext): Promise<ExtractOutcome<CpuData>> {
    const rows = await ctx.tp.queryJson<CpuTimeRow[]>(CPU_TIMES_SQL)
    const summary = summarizeCpuTimes(rows)
    if (summary === null) {
      return { collected: false, reason: { code: 'no_cpu_samples' } }
    }
    // 남은 코어가 하나도 없다 = 행은 있었는데 전부 되감겼다. "표본이 없다" 와 다른 사실이다.
    if (summary.perCore.length === 0) {
      return {
        collected: false,
        reason: { code: 'cpu_counters_not_monotonic', detail: { dropped_cpus: summary.droppedCpus } },
      }
    }
    if (summary.samples < MIN_SAMPLES) {
      return {
        collected: false,
        reason: {
          code: 'insufficient_samples',
          detail: { samples: summary.samples, required: MIN_SAMPLES },
        },
      }
    }
    // 표본은 충분한데 카운터가 전혀 안 움직인 것은 원인이 다르다 — 세션 구간이 통째로
    // 절전/유휴에 들어간 경우가 이렇게 나온다. 같은 코드로 뭉치면 사유 문장이 거짓말을 한다.
    if (summary.totalDeltaNs <= 0) {
      return {
        collected: false,
        reason: { code: 'cpu_counters_did_not_advance', detail: { samples: summary.samples } },
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

    const app = await extractAppCpu(ctx, summary.totalDeltaNs)

    const data: CpuData = {
      device_sampled_ms: summary.sampledMs,
      device_samples: summary.samples,
      device_total_busy_pct: round((summary.busyDeltaNs / summary.totalDeltaNs) * 100, 2),
      device_per_core: summary.perCore,
      device_frequency: frequency,
      app: app.data,
    }

    /**
     * **사유 자리는 하나뿐이라 순서를 여기서 못 박는다.** 위에서 아래로 처음 걸리는 것 하나만
     * 실린다:
     *
     * 1. 앱 부분이 값을 못 낸 사유 (`process_not_in_trace` / `query_failed` /
     *    `no_app_cpu_samples` / `counter_went_backwards`) — 이 메트릭의 표제 질문이 이제
     *    "이 앱이 CPU 를 얼마나 썼나" 이고, `app: null` 의 **이유는 데이터 어디에도 없다.**
     * 2. `cpu_counters_not_monotonic` — 기기 전역 값이 남은 코어만의 것이라는 뜻이다.
     *    흔적은 `device_per_core` 가 짧아진 것으로 데이터에도 남는다.
     * 3. `process_name_stale_in_trace` — 값은 정상이고 근거가 이름이 아니라 pid 였다는 사실.
     *    (1 과 달리 이때 `app` 은 non-null 이므로 둘이 겹치지 않는다.)
     * 4. `cpu_freq_unavailable` — `device_frequency: null` 로 데이터에 이미 드러난다.
     */
    const reasons: MetricReason[] = [
      ...(app.reason !== null && app.data === null ? [app.reason] : []),
      ...(summary.droppedCpus.length > 0
        ? [
            {
              code: 'cpu_counters_not_monotonic' as const,
              detail: { dropped_cpus: summary.droppedCpus },
            },
          ]
        : []),
      ...(app.reason !== null && app.data !== null ? [app.reason] : []),
      ...(frequency === null ? [{ code: 'cpu_freq_unavailable' as const }] : []),
    ]

    const first = reasons[0]
    return first === undefined
      ? { collected: true, data }
      : { collected: true, data, partialReason: first }
  },
}
