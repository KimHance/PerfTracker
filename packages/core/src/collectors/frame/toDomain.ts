import type { FrameBucket, FrameData, FrameTimelinePoint } from '../../schema/result.js'
import { round } from '../num.js'
import type { FrameCollection, FrameSample } from './model.js'

const OVERFLOW_FROM_MS = 700

/**
 * 버킷 경계는 **해상도 배분**이지 기준선이 아니다. 흔히 쓰이는 예산 부근(60fps 16.67ms,
 * 120Hz 8.33ms, 90Hz 11.1ms 가 전부 5~16ms 구간에 들어온다)을 1ms 로 조밀하게 보고, 심한
 * 지연으로 갈수록 폭을 넓혀 꼬리를 압축한다. 어느 값이 예산인지는 이 파일이 정하지 않는다.
 */
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
 * 버킷에 넣을 수 있는 값인가. `bucketFrames` 와 소스가 **같은 규칙**을 쓰게 하는 자리다 —
 * 규칙이 둘로 갈리면 하나는 던지고 하나는 통과시키는 상태가 생긴다.
 */
export function isBucketableDuration(ms: number): boolean {
  return Number.isFinite(ms) && ms >= 0
}

/**
 * 경계는 [from, to) 반개구간이다.
 * 범위 밖(음수·NaN) 입력은 조용히 오버플로 버킷으로 흘리지 않고 거부한다 — 그렇게 하면
 * 미완결 프레임(dur = -1)이 구글의 700ms frozen frame 기준에 대응하는 자리에 섞인다.
 *
 * 이 함수는 순수 함수의 불변식으로 던진다. 호출자는 던지게 두지 않고 **부르기 전에**
 * 같은 규칙으로 걸러 메트릭 사유로 바꾼다 (`frame_duration_out_of_range`).
 */
export function bucketFrames(durationsMs: number[]): FrameBucket[] {
  const buckets = buildFrameBuckets()
  const overflow = buckets[buckets.length - 1]!

  for (const ms of durationsMs) {
    if (!isBucketableDuration(ms)) {
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

/**
 * 표본을 초 단위로 묶는다.
 *
 * 값이 없는 초는 배열에 넣지 않는다. 0 으로 채우면 "그 초에 한 장도 못 그렸다" 와
 * "그 초에 대한 표본이 없다" 가 같은 모양이 되는데, 앱이 화면을 안 바꾸면 프레임이 아예
 * 안 나오는 것이 정상이라 전자도 실제로 일어난다. 둘을 구분할 수 없게 만들지 않는다.
 */
export function buildFrameTimeline(samples: FrameSample[]): FrameTimelinePoint[] {
  const bySecond = new Map<number, number[]>()

  for (const { second, durationMs } of samples) {
    const bucket = bySecond.get(second)
    if (bucket === undefined) bySecond.set(second, [durationMs])
    else bucket.push(durationMs)
  }

  return [...bySecond.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([second, durations]) => {
      const sorted = [...durations].sort((a, b) => a - b)
      return {
        t_s: second,
        count: durations.length,
        // 세션 전체와 **같은** 백분위 함수를 쓴다. 규칙이 갈리면 두 숫자가 어긋난다.
        p50_ms: round(percentile(sorted, 50), 2),
        max_ms: round(sorted[sorted.length - 1]!, 2),
      }
    })
}

/** 버킷에 넣을 수 없는 값이 섞여 있으면 그 값을 돌려준다. 호출자가 사유로 바꾼다. */
export function findOutOfRange(samples: FrameSample[]): number | undefined {
  return samples.find((s) => !isBucketableDuration(s.durationMs))?.durationMs
}

/**
 * **데이터 모델 → 도메인 모델.** 이 함수는 기기도, SDK 도, 어떤 명령으로 얻었는지도 모른다.
 * 어느 소스에서 왔든 `FrameCollection` 이면 같은 계산을 받는다 — 그것이 이 분리의 목적이다.
 *
 * 어떤 기준선과도 비교하지 않는다. 분포와 백분위만 낸다 (`BUCKETS_DESCRIPTION` 참고).
 */
export function toFrameData(collection: FrameCollection): FrameData {
  const durationsMs = collection.samples.map((s) => s.durationMs)
  const sorted = [...durationsMs].sort((a, b) => a - b)

  return {
    process: collection.process,
    pid: collection.pid,
    total_frames: durationsMs.length,
    buckets: bucketFrames(durationsMs),
    percentiles: {
      p50: round(percentile(sorted, 50), 2),
      p90: round(percentile(sorted, 90), 2),
      p95: round(percentile(sorted, 95), 2),
      p99: round(percentile(sorted, 99), 2),
    },
    mean_ms: round(durationsMs.reduce((s, v) => s + v, 0) / durationsMs.length, 2),
    max_ms: round(sorted[sorted.length - 1]!, 2),
    timeline: buildFrameTimeline(collection.samples),
  }
}
