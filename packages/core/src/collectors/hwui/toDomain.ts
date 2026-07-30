import type { HwuiData } from '../../schema/result.js'
import type { HwuiCollection } from './model.js'

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
  }
}
