/**
 * **소스와 화면을 모르는 중간형.** 프레임 한 장이 한 개다.
 *
 * `appMs` 와 `presentMs` 는 **겹치지 않는다** (실측 SM-F936N: 앱 0.00~6.30ms,
 * 표시 7.11~15.08ms). 그래서 화면에서 그대로 쌓인다.
 */
export interface FrameSample {
  /** 세션 시작 기준 경과 시각 (ms). */
  tMs: number
  /** 앱이 이 프레임을 그리는 데 쓴 시간 (ms). */
  appMs: number
  /** 앱이 낸 뒤 화면에 나가기까지 걸린 시간 (ms). */
  presentMs: number
  /**
   * **기기가 이 프레임에 배정한 마감.** 고정값이 아니다 — 주사율에 따라 다르고 세션 중에도
   * 바뀐다 (실측 한 세션: 8.23ms 672장 · 8.33ms 668장 · 41.67ms 4장, 6초에 24Hz 로 떨어짐).
   * 짝이 없으면 null 이다.
   */
  deadlineMs: number | null
}
