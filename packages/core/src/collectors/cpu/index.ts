import type { MetricReason } from '../../schema/reasons.js'
import type {
  AppCpuData,
  AppCpuProcess,
  CpuData,
  CpuFrequency,
  DeviceCpuTimelinePoint,
} from '../../schema/result.js'
import { appProcessSql, resolveAppProcess, staleNameReason } from '../appProcess.js'
import type { AppProcessCandidate } from '../appProcess.js'
import { FTRACE_POWER_BLOCK, processStatsBlock, SYS_STATS_BLOCK } from '../blocks.js'
import { round } from '../num.js'
import type {
  CollectorEnv,
  ExtractContext,
  ExtractOutcome,
  SupportResult,
  TraceCollector,
} from '../types.js'
import type { AppCpuRow, CpuFreqRow, CpuTimeRow, DeviceCpuTimelineRow } from './model.js'
import {
  appCpuSql,
  appCpuTimelineSql,
  CPU_FREQ_SQL,
  CPU_TIMES_SQL,
  DEVICE_CPU_TIMELINE_SQL,
  SYS_STATS_SOURCE,
} from './sources/sysStats.js'
import {
  buildCpuTimeline,
  buildDeviceCpuTimeline,
  MIN_SAMPLES,
  nsToMs,
  summarizeAppCpu,
  summarizeCpuTimes,
} from './toDomain.js'

export * from './model.js'
export * from './toDomain.js'
export * from './sources/sysStats.js'

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
      timeline: buildCpuTimeline(
        await ctx.tp.queryJson<[number, number][]>(appCpuTimelineSql(picked.upid)),
      ),
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

  traceConfigBlocks(env: CollectorEnv) {
    // ftrace 를 supports() 와 무관하게 항상 요청한다 — 등록되지 않은 데이터소스는
    // perfetto 가 조용히 무시하고, 세션을 실패시키지 않는다.
    //
    // process_stats 는 앱 단위 `runtime.*` 를 읽으려고 선언한다. **블록 텍스트는 공유 상수
    // 그대로이므로 기기로 나가는 데이터소스가 늘지 않는다** — frame/memory 가 이미 같은
    // 상수를 요청하고 `mergeTraceConfigBlocks` 가 하나로 접는다. 읽는 것을 선언하지 않으면
    // frame(sdk<31 에서 꺼짐)과 memory 가 둘 다 미지원인 기기에서 조용히 값이 사라진다.
    return [SYS_STATS_BLOCK, FTRACE_POWER_BLOCK, processStatsBlock(env.sdkInt)]
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

    // 초당 추이는 위 집계와 **같은 카운터**를 다시 접은 것이다 — 기기에 더 묻지 않는다.
    // 실패해도 집계를 죽이지 않는다 (주파수와 같은 정책).
    let deviceTimeline: DeviceCpuTimelinePoint[] | null = null
    try {
      deviceTimeline = buildDeviceCpuTimeline(
        await ctx.tp.queryJson<DeviceCpuTimelineRow[]>(DEVICE_CPU_TIMELINE_SQL),
      )
    } catch {
      deviceTimeline = null
    }

    const app = await extractAppCpu(ctx, summary.totalDeltaNs)

    const data: CpuData = {
      device_sampled_ms: summary.sampledMs,
      device_samples: summary.samples,
      device_total_busy_pct: round((summary.busyDeltaNs / summary.totalDeltaNs) * 100, 2),
      device_per_core: summary.perCore,
      device_frequency: frequency,
      device_timeline: deviceTimeline,
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
