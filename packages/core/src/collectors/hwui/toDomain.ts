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
  }
}
