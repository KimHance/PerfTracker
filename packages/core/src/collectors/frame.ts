import type { FrameBucket, FrameData } from '../schema/result.js'
import type { Collector, CollectorEnv, ExtractContext } from './types.js'

const DATA_SOURCE = 'android.surfaceflinger.frametimeline'
const MIN_SDK = 31
const FRAME_BUDGET_MS = 16.67
const OVERFLOW_FROM_MS = 700

/**
 * frametimeline 은 프레임 타이밍만 주고 트레이스의 process 테이블에는 이름을 채우지 않는다.
 * linux.process_stats 가 그 이름을 채운다 — 없으면 FRAME_PROCESS_SQL 의 모든 후보가 name: null
 * 로 나와 isSystemProcess 에 전부 걸러지고 selectRenderProcess 가 항상 null 을 반환한다.
 * 폴링 주기는 assertLowOverheadConfig 의 1000ms 하한과 설계 프로브 값을 그대로 따른다.
 */
const PROCESS_STATS_BLOCK =
  'data_sources { config { name: "linux.process_stats" ' +
  'process_stats_config { proc_stats_poll_ms: 1000 scan_all_processes_on_start: true } } }'

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

/** 경계는 [from, to) 반개구간이다. */
export function bucketFrames(durationsMs: number[]): FrameBucket[] {
  const buckets = buildFrameBuckets()
  const overflow = buckets[buckets.length - 1]!

  for (const ms of durationsMs) {
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

export interface FrameProcessCandidate {
  upid: number
  pid: number
  name: string | null
  frames: number
}

function isSystemProcess(name: string | null): boolean {
  if (name === null) return true
  return name.startsWith('/') || name.startsWith('system_server') || name.startsWith('com.android.systemui')
}

/**
 * 런처 alias 때문에 패키지명과 실제 렌더 프로세스명이 다를 수 있다.
 * 패키지 일치를 먼저 보고, 없으면 시스템 프로세스를 뺀 프레임 최다 프로세스를 고른다.
 */
export function selectRenderProcess(
  candidates: FrameProcessCandidate[],
  packageName: string,
): FrameProcessCandidate | null {
  const exact = candidates.find(
    (c) => c.name === packageName || (c.name !== null && c.name.startsWith(`${packageName}:`)),
  )
  if (exact) return exact

  const apps = candidates.filter((c) => !isSystemProcess(c.name)).sort((a, b) => b.frames - a.frames)
  return apps[0] ?? null
}

export const FRAME_PROCESS_SQL =
  "select json_group_array(json_object('upid', upid, 'pid', pid, 'name', name, 'frames', frames)) as j " +
  'from (select p.upid as upid, p.pid as pid, p.name as name, count(*) as frames ' +
  'from actual_frame_timeline_slice f join process p using(upid) group by p.upid order by frames desc)'

export function frameDurationsSql(upid: number): string {
  return `select json_group_array(dur) as j from actual_frame_timeline_slice where upid = ${upid}`
}

const round = (v: number, digits: number): number => {
  const f = 10 ** digits
  return Math.round(v * f) / f
}

export const frameCollector: Collector<FrameData> = {
  id: 'frame',
  source: 'perfetto: actual_frame_timeline_slice.dur',

  supports(env: CollectorEnv) {
    if (env.sdkInt < MIN_SDK) {
      return { supported: false, reason: `requires Android 12+ (device sdk_int=${env.sdkInt})` }
    }
    if (!env.dataSources.includes(DATA_SOURCE)) {
      return { supported: false, reason: `data source not registered: ${DATA_SOURCE}` }
    }
    return { supported: true }
  },

  traceConfigBlocks() {
    return [`data_sources { config { name: "${DATA_SOURCE}" } }`, PROCESS_STATS_BLOCK]
  },

  async extract(ctx: ExtractContext): Promise<FrameData | null> {
    const candidates = await ctx.tp.queryJson<FrameProcessCandidate[]>(FRAME_PROCESS_SQL)
    const picked = selectRenderProcess(candidates, ctx.packageName)
    if (!picked) return null

    const durationsNs = await ctx.tp.queryJson<number[]>(frameDurationsSql(picked.upid))
    if (durationsNs.length === 0) return null

    const durationsMs = durationsNs.map((ns) => ns / 1e6)
    const sorted = [...durationsMs].sort((a, b) => a - b)
    const within = durationsMs.filter((ms) => ms <= FRAME_BUDGET_MS).length

    return {
      process: picked.name ?? String(picked.pid),
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
  },
}
