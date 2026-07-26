import type { FrameBucket, FrameData } from '../schema/result.js'
import { type AppProcessCandidate, resolveAppProcess, staleNameReason } from './appProcess.js'
import { FRAMETIMELINE_BLOCK, PROCESS_STATS_BLOCK } from './blocks.js'
import { round } from './num.js'
import type {
  CollectorEnv,
  ExtractContext,
  ExtractOutcome,
  SupportResult,
  TraceCollector,
} from './types.js'

const DATA_SOURCE = 'android.surfaceflinger.frametimeline'
const MIN_SDK = 31
const FRAME_BUDGET_MS = 16.67
const OVERFLOW_FROM_MS = 700

/** 60fps 예산 부근을 1ms 로 조밀하게 보고, 심한 지연으로 갈수록 폭을 넓혀 꼬리를 압축한다. */
export const FRAME_BUCKET_RANGES: { from: number; to: number; step: number }[] = [
  { from: 0, to: 5, step: 5 },
  { from: 5, to: 16, step: 1 },
  { from: 16, to: 50, step: 2 },
  { from: 50, to: 130, step: 4 },
  { from: 130, to: 350, step: 5 },
  { from: 350, to: 700, step: 50 },
]

export function buildFrameBuckets(): FrameBucket[] {
  const buckets: FrameBucket[] = []
  for (const range of FRAME_BUCKET_RANGES) {
    for (let from = range.from; from < range.to; from += range.step) {
      buckets.push({ from_ms: from, to_ms: Math.min(from + range.step, range.to), count: 0 })
    }
  }
  buckets.push({ from_ms: OVERFLOW_FROM_MS, to_ms: null, count: 0 })
  return buckets
}

/**
 * 경계는 [from, to) 반개구간이다.
 * 범위 밖(음수·NaN) 입력은 조용히 오버플로 버킷으로 흘리지 않고 거부한다 — 그렇게 하면
 * `dur = -1` 짜리 미완결 slice 가 구글의 700ms frozen frame 기준에 대응하는 자리에 섞인다.
 */
export function bucketFrames(durationsMs: number[]): FrameBucket[] {
  const buckets = buildFrameBuckets()
  const overflow = buckets[buckets.length - 1]!

  for (const ms of durationsMs) {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new RangeError(`프레임 duration 이 버킷 범위 밖입니다: ${ms}`)
    }
    if (ms >= OVERFLOW_FROM_MS) {
      overflow.count += 1
      continue
    }
    const hit = buckets.find((b) => b.to_ms !== null && ms >= b.from_ms && ms < b.to_ms)
    if (hit) hit.count += 1
    else overflow.count += 1
  }
  return buckets
}

export function percentile(sortedMs: number[], p: number): number {
  if (sortedMs.length === 0) return 0
  const rank = Math.ceil((p / 100) * sortedMs.length)
  return sortedMs[Math.min(sortedMs.length - 1, Math.max(0, rank - 1))]!
}

export interface FrameProcessCandidate extends AppProcessCandidate {
  frames: number
}

export const FRAME_PROCESS_SQL =
  "select json_group_array(json_object('upid', upid, 'pid', pid, 'name', name, 'frames', frames)) as j " +
  'from (select p.upid as upid, p.pid as pid, p.name as name, count(*) as frames ' +
  'from actual_frame_timeline_slice f join process p using(upid) group by p.upid order by frames desc)'

/**
 * `dur >= 0` 이 필수다. trace_processor 는 종료 이벤트를 못 받은 slice 에 `dur = -1` 을 내는데,
 * --stop 이 트레이스를 끊는 순간 진행 중이던 프레임이 정확히 그 모양이다.
 * 거르지 않으면 그 유령 프레임이 700ms+ 버킷에 앉으면서 동시에 16.67ms 예산 안으로도 집계된다.
 */
export function frameDurationsSql(upid: number): string {
  return `select json_group_array(dur) as j from actual_frame_timeline_slice where upid = ${upid} and dur >= 0`
}

export const frameCollector: TraceCollector<FrameData> = {
  id: 'frame',
  source: 'perfetto: actual_frame_timeline_slice.dur',
  needsTrace: true,

  supports(env: CollectorEnv): SupportResult {
    if (env.sdkInt < MIN_SDK) {
      return {
        supported: false,
        reason: { code: 'sdk_too_low', detail: { sdk_int: env.sdkInt, min_sdk: MIN_SDK } },
      }
    }
    if (!env.dataSources.includes(DATA_SOURCE)) {
      return {
        supported: false,
        reason: { code: 'data_source_not_registered', detail: { data_source: DATA_SOURCE } },
      }
    }
    return { supported: true }
  },

  traceConfigBlocks() {
    return [FRAMETIMELINE_BLOCK, PROCESS_STATS_BLOCK]
  },

  /**
   * 프로세스 특정에 **추측이 없다.** 이 필드(`data.process`)는 사실로 팔리는 값이므로,
   * 확인하지 못한 이름을 넣느니 `render_process_not_found` 로 값을 내지 않는 쪽을 고른다.
   * 규칙 자체는 `collectors/appProcess.ts` 가 갖고 있다 — memory 와 같은 규칙을 쓴다.
   */
  async extract(ctx: ExtractContext): Promise<ExtractOutcome<FrameData>> {
    const candidates = await ctx.tp.queryJson<FrameProcessCandidate[]>(FRAME_PROCESS_SQL)
    const resolved = resolveAppProcess(candidates, ctx.packageName, ctx.capture.appPid)
    if (resolved === null) {
      return {
        collected: false,
        reason: { code: 'render_process_not_found', detail: { package: ctx.packageName } },
      }
    }

    const picked = resolved.candidate
    const durationsNs = await ctx.tp.queryJson<number[]>(frameDurationsSql(picked.upid))
    const processName = resolved.name
    if (durationsNs.length === 0) {
      return { collected: false, reason: { code: 'no_frames', detail: { process: processName } } }
    }

    const durationsMs = durationsNs.map((ns) => ns / 1e6)
    const sorted = [...durationsMs].sort((a, b) => a - b)
    const within = durationsMs.filter((ms) => ms <= FRAME_BUDGET_MS).length

    const data: FrameData = {
      process: processName,
      pid: picked.pid,
      total_frames: durationsMs.length,
      buckets: bucketFrames(durationsMs),
      within_16_67ms_ratio: round(within / durationsMs.length, 4),
      percentiles: {
        p50: round(percentile(sorted, 50), 2),
        p90: round(percentile(sorted, 90), 2),
        p95: round(percentile(sorted, 95), 2),
        p99: round(percentile(sorted, 99), 2),
      },
      mean_ms: round(durationsMs.reduce((s, v) => s + v, 0) / durationsMs.length, 2),
      max_ms: round(sorted[sorted.length - 1]!, 2),
    }

    // 이름이 아니라 pid 로 확인한 경우, 트레이스가 다른 이름을 알고 있다는 사실을 숨기지 않는다.
    const stale = staleNameReason(resolved, ctx.packageName)
    return stale === null ? { collected: true, data } : { collected: true, data, partialReason: stale }
  },
}
