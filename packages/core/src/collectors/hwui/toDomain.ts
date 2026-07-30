import type { HwuiData } from '../../schema/result.js'
import type { HwuiCollection } from './model.js'

/**
 * 프레임워크 칸을 **트레이스 버킷과 같은 모양**으로 옮긴다. 그래야 화면의 분포 렌더러를
 * 그대로 쓸 수 있다 — 분포를 그리는 코드가 두 벌이 되면 하나는 언젠가 낡는다.
 *
 * **700ms 에서 자른다.** 프레임워크 칸은 4950ms 까지 가는데 실제 데이터는 앞쪽에 몰려 있어서,
 * 그대로 그리면 화면의 3분의 2가 빈 칸이 된다. 700ms 는 트레이스 버킷의 상한과 같은 자리다.
 *
 * **자르되 버리지 않는다.** 700ms 이상은 마지막 한 칸(`to_ms: null`)으로 접는다 — 그래야
 * 칸의 합이 `total_frames` 와 같고, "느린 프레임이 몇 장 있었나" 를 여전히 읽을 수 있다.
 * 그 아래는 **0 인 칸까지 전부 남긴다** (규칙: 버킷은 하나도 빠짐없이).
 *
 * **칸 이름은 그 칸의 끝이다.** 프레임워크가 `6ms=155` 라고 하면 6ms 가 걸린 프레임 수이므로
 * 구간으로는 `[5, 6)` 이다. 첫 칸 `5ms` 는 "5ms 이하 전부" 라 `[0, 5)` 가 된다.
 * 이름을 그대로 `from_ms` 에 넣으면 한 칸씩 밀리고 0–5ms 구간이 사라진 것처럼 보인다.
 */
export const HWUI_OVERFLOW_FROM_MS = 700

export function toHwuiHistogram(
  histogram: { ms: number; frames: number }[] | null,
): NonNullable<HwuiData['histogram']> | null {
  if (histogram === null || histogram.length === 0) return null
  const sorted = [...histogram].sort((a, b) => a.ms - b.ms)

  const kept = sorted.filter((b) => b.ms <= HWUI_OVERFLOW_FROM_MS)
  const overflow = sorted
    .filter((b) => b.ms > HWUI_OVERFLOW_FROM_MS)
    .reduce((n, b) => n + b.frames, 0)

  const out: NonNullable<HwuiData['histogram']> = kept.map((b, i) => ({
    from_ms: i === 0 ? 0 : kept[i - 1]!.ms,
    to_ms: b.ms,
    count: b.frames,
  }))
  // 자른 뒤에도 칸이 하나는 있어야 한다. 700 이상만 있는 트레이스는 실제로 없지만,
  // 있다면 그 사실이 그대로 보여야 한다.
  out.push({ from_ms: HWUI_OVERFLOW_FROM_MS, to_ms: null, count: overflow })
  return out
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

  // ceil 랭크 — 그 자리에 놓인 칸의 값을 쓴다.
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
