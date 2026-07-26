import { CPU_TIMES_SQL, type CpuTimeRow, summarizeCpuTimes } from '../collectors/cpu.js'
import { bytesToKb, round } from '../collectors/num.js'
import type { TraceProcessor } from '../perfetto/traceProcessor/client.js'

/**
 * 측정 도구 자신의 프로세스들.
 *
 * `perfetto` CLI 는 `--detach` 직후 종료해서 process_stats 스캔에 사실상 안 잡힌다 —
 * 실측 두 트레이스 모두에서 없었다. 그래도 목록에 남긴다: 잡히면 세는 게 맞고,
 * 안 잡히는 것이 이 도구의 비용이 0 이라는 뜻은 아니기 때문이다.
 */
export const TRACING_PROCESS_NAMES: readonly string[] = ['traced', 'traced_probes', 'perfetto']

/**
 * 트레이스의 프로세스 이름은 `/system/bin/traced` 처럼 **전체 경로**로 온다 (실측 확인).
 * `traced` 로 정확 일치시키면 0건이고, `like '%traced%'` 로 하면 `rcu_tasks_trace` 와
 * `android.hardware.atrace@1.0-service` 까지 잡힌다. basename 으로 정확 비교한다.
 */
export function isTracingProcess(name: string | null): boolean {
  if (name === null) return false
  const base = name.slice(name.lastIndexOf('/') + 1)
  return TRACING_PROCESS_NAMES.includes(base)
}

export interface TracingCounterRow {
  /**
   * 프로세스의 정체성. **이름이 아니라 이것으로 접는다** — 같은 이름의 프로세스가 둘이면
   * 이름으로 접었을 때 peak RSS 가 합이 아니라 max 가 되어, describe 가 약속한 상계가 깨진다.
   */
  upid: number
  process: string | null
  counter: string
  first: number
  last: number
}

/**
 * SQL 은 후보를 좁히기만 한다 (`like` 는 basename 을 표현하지 못한다).
 * 최종 판정은 `isTracingProcess` 가 호스트에서 한다 — 그래야 규칙이 기기 없이 테스트된다.
 */
export const TRACING_OVERHEAD_SQL =
  "select json_group_array(json_object('upid', upid, 'process', name, 'counter', counter, " +
  "'first', first_value, 'last', last_value)) as j from (" +
  'select p.upid as upid, p.name as name, t.name as counter, ' +
  'cast(min(c.value) as int) as first_value, cast(max(c.value) as int) as last_value ' +
  'from counter c join process_counter_track t on c.track_id = t.id ' +
  'join process p on t.upid = p.upid ' +
  "where t.name in ('runtime.user_ns', 'runtime.kernel_ns', 'mem.rss') " +
  "and (p.name in ('traced', 'traced_probes', 'perfetto') " +
  "or p.name like '%/traced' or p.name like '%/traced_probes' or p.name like '%/perfetto') " +
  'group by p.upid, t.name order by p.pid, t.name)'

export interface TracingCost {
  cpuTimeMs: number | null
  peakRssKb: number | null
}

const RUNTIME_COUNTERS = new Set(['runtime.user_ns', 'runtime.kernel_ns'])

/**
 * 트레이싱 프로세스들의 비용을 접는다.
 *
 * CPU 시간은 프로세스별 user+kernel delta 의 합이다.
 * peak RSS 는 **프로세스별 최댓값의 합**이다 — 표본 ts 가 프로세스마다 정확히 같지 않아
 * "동시 최대" 를 낼 수 없으므로 상계를 쓴다 (D7). 과소평가하지 않는 쪽을 골랐다.
 *
 * 해당 카운터가 아예 없으면 0 이 아니라 **null** 이다. 0 은 "재 보니 0" 이고
 * null 은 "안 쟀다" 인데, 이 구분이 M1 이 세 필드를 null 로 남긴 이유 그 자체다.
 */
export function summarizeTracingCost(rows: TracingCounterRow[]): TracingCost {
  let cpuNs = 0
  let sawRuntime = false
  // 키는 upid 다. 이름으로 접으면 같은 이름의 프로세스가 둘일 때 합이 아니라 max 가 되어
  // "프로세스별 최댓값의 합" 이라는 상계가 성립하지 않는다.
  const peakRssByProcess = new Map<number, number>()

  for (const row of rows) {
    if (!isTracingProcess(row.process)) continue

    if (RUNTIME_COUNTERS.has(row.counter)) {
      const delta = row.last - row.first
      // 단조성이 깨진 행은 버린다. 0 으로 만들면 "쟀는데 0" 과 구별이 안 된다.
      if (!Number.isFinite(delta) || delta < 0) continue
      cpuNs += delta
      sawRuntime = true
      continue
    }

    if (row.counter === 'mem.rss') {
      peakRssByProcess.set(row.upid, Math.max(peakRssByProcess.get(row.upid) ?? 0, row.last))
    }
  }

  const peakBytes = [...peakRssByProcess.values()].reduce((sum, v) => sum + v, 0)

  return {
    cpuTimeMs: sawRuntime ? Math.round(cpuNs / 1e6) : null,
    peakRssKb: peakRssByProcess.size > 0 ? bytesToKb(peakBytes) : null,
  }
}

export interface OverheadResult {
  cpuTimeMs: number | null
  cpuSharePct: number | null
  peakRssKb: number | null
}

/**
 * `measurement_overhead` 의 세 필드를 낸다.
 *
 * **절대 던지지 않는다.** 오버헤드는 부가 정보이고, 그것을 못 재는 것이 result.json 전체를
 * 못 내는 이유가 될 수는 없다. 못 잰 필드는 null 로 남아 "안 쟀다" 를 말한다.
 */
export async function computeOverhead(tp: TraceProcessor): Promise<OverheadResult> {
  let cost: TracingCost = { cpuTimeMs: null, peakRssKb: null }
  try {
    cost = summarizeTracingCost(await tp.queryJson<TracingCounterRow[]>(TRACING_OVERHEAD_SQL))
  } catch {
    return { cpuTimeMs: null, cpuSharePct: null, peakRssKb: null }
  }

  // 분모는 CPU collector 와 같은 쿼리·같은 집계를 쓴다. 두 곳이 다른 방식으로 세면
  // 결과의 두 숫자가 서로 모순되는 이야기를 한다.
  let totalCpuMs: number | null = null
  try {
    const summary = summarizeCpuTimes(await tp.queryJson<CpuTimeRow[]>(CPU_TIMES_SQL))
    if (summary !== null && summary.totalDeltaNs > 0) {
      totalCpuMs = summary.totalDeltaNs / 1e6
    }
  } catch {
    totalCpuMs = null
  }

  const cpuSharePct =
    cost.cpuTimeMs !== null && totalCpuMs !== null
      ? round((cost.cpuTimeMs / totalCpuMs) * 100, 2)
      : null

  return { cpuTimeMs: cost.cpuTimeMs, cpuSharePct, peakRssKb: cost.peakRssKb }
}
