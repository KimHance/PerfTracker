/**
 * **sdk 31+ 경로.** perfetto `android.surfaceflinger.frametimeline` 이 프레임마다 한 행을 낸다.
 *
 * 이 파일이 아는 것: 트레이스에서 프레임을 꺼내는 법.
 * 이 파일이 **모르는 것**: 표본 상한, 버킷 — 전부 `toDomain.ts` 의 몫이다.
 */
export const FRAMETIMELINE_DATA_SOURCE = 'android.surfaceflinger.frametimeline'
export const FRAMETIMELINE_MIN_SDK = 31
