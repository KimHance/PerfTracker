import type { FrameBucket, FrameData, FrameTimelinePoint } from '../../schema/result.js'
import { round } from '../num.js'
import type { FrameCollection, FrameJankRow, FrameSample } from './model.js'

const OVERFLOW_FROM_MS = 700

/**
 * 버킷 경계는 **해상도 배분**이지 기준선이 아니다. 흔히 쓰이는 예산 부근(60fps 16.67ms,
 * 120Hz 8.33ms, 90Hz 11.1ms 가 전부 5~16ms 구간에 들어온다)을 1ms 로 조밀하게 보고, 심한
 * 지연으로 갈수록 폭을 넓혀 꼬리를 압축한다. 어느 값이 예산인지는 이 파일이 정하지 않는다.
 *
 * **꼬리를 왜 이만큼 넓히는가.** 130ms 를 넘은 프레임은 이미 명백한 이상치이고, 그 지점에서
 * 분포가 답하는 질문은 "165ms 냐 185ms 냐" 가 아니라 "이런 것이 몇 개 있었나" 다. 정확한
 * 값이 필요하면 `percentiles` 와 `max_ms` 가 소수점까지 말한다 — **분포는 모양을 보는 자리고
 * 정확한 값은 백분위가 담당**하는 분업이 이미 이 스키마에 있다.
 *
 * 예전에는 130–350 을 5ms 로 잘라 그 한 구간에만 버킷 44개를 뒀다. 실측 두 세션에서 그
 * 44칸에 들어간 프레임은 각각 **1개**였고, 나머지 43칸은 매 result.json 에 실려 나가
 * 읽는 쪽이 매번 파싱했다. 지금은 130 이상을 30 → 50 → 100ms 로 넓혀 101개를 61개로 줄인다.
 * **보이는 막대 수는 그대로다** — 줄어든 것은 전부 빈 버킷이다.
 *
 * 100–130 은 넓히지 않는다. 아직 "얼마나 밀렸나" 를 가늠하는 구간이라(60fps 8프레임분이
 * 133ms) 4ms 를 유지한다.
 */
export const FRAME_BUCKET_RANGES: { from: number; to: number; step: number }[] = [
  { from: 0, to: 5, step: 5 },
  { from: 5, to: 16, step: 1 },
  { from: 16, to: 50, step: 2 },
  { from: 50, to: 130, step: 4 },
  { from: 130, to: 250, step: 30 },
  { from: 250, to: 500, step: 50 },
  { from: 500, to: 700, step: 100 },
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

/**
 * **기기가 이 세션 동안 요구한 마감들.** 값이 여럿이면 세션 중 주사율이 바뀐 것이다.
 *
 * 우리는 임계값을 고르지 않는다. 대신 기기가 무엇을 요구했는지를 그대로 싣는다 — 그것이
 * 없으면 읽는 쪽은 지속 시간만 보고 "무엇에 대해 늦은 것인지" 를 알 수 없다.
 * 실측 한 세션에 8.33ms(3,599장)와 16.67ms(66장)가 함께 있었다.
 *
 * 많은 순으로 낸다. 하나도 모르면 `null` 이다 (빈 배열이 아니다 — 마감이 없었던 것이 아니라
 * 이 경로가 알려 주지 않은 것이다).
 */
export function buildDeadlines(samples: FrameSample[]): FrameData['deadlines'] {
  const byMs = new Map<number, number>()
  for (const s of samples) {
    if (s.deadlineMs === null) continue
    const key = round(s.deadlineMs, 2)
    byMs.set(key, (byMs.get(key) ?? 0) + 1)
  }
  if (byMs.size === 0) return null

  return [...byMs.entries()]
    .map(([ms, frames]) => ({ ms, frames }))
    .sort((a, b) => b.frames - a.frames || a.ms - b.ms)
}

/** 버킷에 넣을 수 없는 값이 섞여 있으면 그 값을 돌려준다. 호출자가 사유로 바꾼다. */
export function findOutOfRange(samples: FrameSample[]): number | undefined {
  return samples.find((s) => !isBucketableDuration(s.durationMs))?.durationMs
}

/** 기기가 "문제 없음" 을 적는 값. 꼬리표가 아니라 꼬리표의 부재다. */
const JANK_NONE = 'None'

/** 표시 주기를 통째로 넘긴 프레임. SurfaceFlinger 가 쓰는 원문 그대로다. */
const JANK_DROPPED = 'Dropped Frame'

/**
 * 꼬리표 집계를 도메인 모양으로 옮긴다.
 *
 * **꼬리표는 집합이라 겹친다.** `"App Deadline Missed, Buffer Stuffing"` 한 장은 두 꼬리표에
 * 각각 세어지므로 `by_type` 의 합은 `janky_frames` 를 넘을 수 있다. 그것을 사실대로 두는 대신
 * 하나만 고르면(예: 첫 꼬리표) 나머지가 사라진다 — 세지 않은 것을 0 으로 만드는 일이다.
 *
 * **판정하지 않는다.** 어느 꼬리표가 나쁜지 정하지 않고 개수만 낸다. `Buffer Stuffing` 이
 * 실측에서 1,347장으로 압도적인데(Stream 세션), 그것을 "심각"으로 접으면 이 도구가 판정을
 * 시작하는 것이다 — 무엇이 중요한지는 읽는 쪽이 정한다.
 */
export function buildJank(rows: FrameJankRow[] | null): FrameData['jank'] {
  if (rows === null) return null

  const byType = new Map<string, number>()
  let janky = 0
  let late = 0
  let total = 0

  for (const row of rows) {
    total += row.count
    if (!row.onTime) late += row.count
    if (row.type === JANK_NONE || row.type === '') continue
    janky += row.count
    for (const tag of row.type.split(',')) {
      const t = tag.trim()
      if (t === '' || t === JANK_NONE) continue
      byType.set(t, (byType.get(t) ?? 0) + row.count)
    }
  }

  return {
    total_frames: total,
    janky_frames: janky,
    late_frames: late,
    // `by_type` 에도 있지만 따로 센다 — 읽는 쪽이 가장 먼저 보는 값이라 경로를 찾게 하지 않는다.
    dropped_frames: byType.get(JANK_DROPPED) ?? 0,
    by_type: [...byType.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
  }
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
    jank: buildJank(collection.jank),
    deadlines: buildDeadlines(collection.samples),
  }
}
