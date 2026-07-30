/**
 * **데이터 모델** — 프레임워크(HWUI)가 자기 렌더링을 센 집계의 세션 델타.
 *
 * 값 하나하나가 `null` 일 수 있다: 그 줄이 출력에 없었거나(Unity·Vulkan·OpenGL 앱은 HWUI
 * 통계를 내지 않는다), 세션 중 앱 프로세스가 죽어 누적이 리셋된 경우다. **0 과 다른 말이다.**
 */
export interface HwuiCounters {
  totalFrames: number | null
  jankyFrames: number | null
  missedVsync: number | null
  highInputLatency: number | null
  slowUiThread: number | null
  slowBitmapUploads: number | null
  slowDrawCommands: number | null
  deadlineMissed: number | null
}

export interface HwuiCollection {
  counters: HwuiCounters
}
