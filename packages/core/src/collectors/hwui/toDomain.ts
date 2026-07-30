import type { HwuiData } from '../../schema/result.js'
import type { HwuiCollection } from './model.js'

/**
 * 프레임워크 칸을 **트레이스 버킷과 같은 모양**으로 옮긴다. 그래야 화면의 분포 렌더러를
 * 그대로 쓸 수 있다 — 분포를 그리는 코드가 두 벌이 되면 하나는 언젠가 낡는다.
 *
 * `to_ms` 는 다음 칸의 시작이다. 마지막 칸만 `null`(상한 없음) — 프레임워크 히스토그램의
 * 마지막 칸이 실제로 그런 뜻이다.
 */
export function toHwuiHistogram(
  histogram: { ms: number; frames: number }[] | null,
): NonNullable<HwuiData['histogram']> | null {
  if (histogram === null || histogram.length === 0) return null
  const sorted = [...histogram].sort((a, b) => a.ms - b.ms)
  return sorted.map((b, i) => ({
    from_ms: b.ms,
    to_ms: i === sorted.length - 1 ? null : sorted[i + 1]!.ms,
    count: b.frames,
  }))
}

/**
 * **세션 히스토그램에서 백분위를 낸다.**
 *
 * `dumpsys gfxinfo` 도 자기 백분위를 찍지만 그것은 **프로세스 시작 이후 누적**이다 —
 * 세션 델타가 아니다. 그것을 그대로 실으면 분포는 세션 값인데 백분위만 세션 밖 프레임까지
 * 포함하는, 서로 안 맞는 두 숫자가 한 카드에 앉는다.
 *
 * 해상도는 **프레임워크의 칸 폭**이다. 5~32ms 는 1ms 라 촘촘하고 그 뒤로는 넓어지므로,
 * 꼬리 백분위는 그 칸의 **시작값**으로 떨어진다 (예: 53ms 칸에 걸리면 53). 정확한 값이 아니라
 * 하한이라는 뜻이고, 그래서 지어내지 않고 칸 경계를 그대로 쓴다.
 */
export function percentileFromHistogram(
  bins: { ms: number; frames: number }[],
  p: number,
): number | null {
  const total = bins.reduce((n, b) => n + b.frames, 0)
  if (total === 0) return null

  // 지속 시간 백분위와 **같은 규칙**이다 (ceil 랭크, 그 자리의 값). 규칙이 갈리면 두 화면의
  // 같은 이름이 다른 뜻이 된다.
  const rank = Math.ceil((p / 100) * total)
  let seen = 0
  for (const b of [...bins].sort((a, x) => a.ms - x.ms)) {
    seen += b.frames
    if (seen >= rank) return b.ms
  }
  return bins[bins.length - 1]!.ms
}

/** 데이터 모델 → 스키마. 이름만 snake_case 로 옮긴다 — 계산은 이미 소스에서 끝났다. */
export function toHwuiData(collection: HwuiCollection): HwuiData {
  const c = collection.counters
  return {
    total_frames: c.totalFrames,
    janky_frames: c.jankyFrames,
    missed_vsync: c.missedVsync,
    high_input_latency: c.highInputLatency,
    slow_ui_thread: c.slowUiThread,
    slow_bitmap_uploads: c.slowBitmapUploads,
    slow_draw_commands: c.slowDrawCommands,
    deadline_missed: c.deadlineMissed,
    histogram: toHwuiHistogram(collection.histogram),
    percentiles:
      collection.histogram === null
        ? null
        : {
            p50: percentileFromHistogram(collection.histogram, 50),
            p90: percentileFromHistogram(collection.histogram, 90),
            p95: percentileFromHistogram(collection.histogram, 95),
            p99: percentileFromHistogram(collection.histogram, 99),
          },
  }
}
