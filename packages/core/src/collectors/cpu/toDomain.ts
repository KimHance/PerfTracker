import type { CpuTimelinePoint } from '../../schema/result.js'
import { round } from '../num.js'
import type { AppCpuRow, AppCpuTimelineRow, CpuTimeRow } from './model.js'

/** delta 를 내려면 최소 두 표본이 필요하다. */
export const MIN_SAMPLES = 2

/** /proc/stat 관례상 io_wait 도 idle 이다. 나머지(user/nice/system/irq/softirq/steal)는 전부 busy. */
const IDLE_COUNTERS = new Set(['cpu.times.idle_ns', 'cpu.times.io_wait_ns'])

export const nsToMs = (ns: number): number => Math.round(ns / 1e6)

export interface CpuTimeSummary {
  samples: number
  sampledMs: number
  totalDeltaNs: number
  busyDeltaNs: number
  perCore: { cpu: number; busy_pct: number }[]
  /** 단조성이 깨져 통째로 제외한 코어 번호들 (오름차순). 정상 트레이스에서는 빈 배열이다. */
  droppedCpus: number[]
}


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
 * `runtime.user_ns` / `runtime.kernel_ns` 카운터로 낸 것이고, `processStatsBlock` 의
 * `record_process_runtime: true` 가 만든다 — **데이터소스를 새로 켜지 않는다.**
 *
 * `extract/overhead.ts` 가 `traced` / `traced_probes` 에 대해 정확히 같은 카운터를 같은
 * 방식으로 접는다. 이 도구는 프로세스별 CPU 를 뽑을 줄 알면서 자기 자신에게만 쓰고 있었다.
 */
export function buildCpuTimeline(rows: AppCpuTimelineRow[]): CpuTimelinePoint[] {
  const out: CpuTimelinePoint[] = []
  for (let i = 1; i < rows.length; i++) {
    const [t_s, ns] = rows[i]!
    const deltaNs = ns - rows[i - 1]![1]
    if (deltaNs < 0) continue
    out.push({ t_s, app_cpu_ms: round(deltaNs / 1e6, 1) })
  }
  return out
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
