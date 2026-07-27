import { parseThermalDump } from '../../../device/state.js'
import type { BaseExtractContext } from '../../types.js'
import type { ThermalSnapshotPair } from '../model.js'

/**
 * **`dumpsys thermalservice` 경로.** `ThermalService` 는 Android 10(API 29)에서 들어왔다 —
 * 그 아래에는 이 dumpsys 자체가 없다.
 *
 * **추가 adb 호출이 0회다.** 이 원문은 `collectDeviceState()` 가 매 세션 시작 직전·종료
 * 직후에 찍어 `raw/thermalservice_{before,after}.txt` 로 저장해 둔 것이다. 그래서 thermal 은
 * `captureSnapshots()` 를 **선언하지 않는다** — 선언하면 같은 명령이 두 번 나간다.
 *
 * 그 결과 **이 collector 가 생기기 전에 찍힌 run 디렉토리에서도 값이 나온다.**
 */
export const THERMAL_MIN_SDK = 29
export const THERMAL_SNAPSHOT_KEY = 'thermalservice'

/** before 원문이 없으면 null. 그 구분은 호출자가 사유로 바꾼다. */
export function collectThermalSnapshots(ctx: BaseExtractContext): ThermalSnapshotPair | null {
  const pair = ctx.capture.snapshots[THERMAL_SNAPSHOT_KEY]
  if (pair?.before == null) return null

  return {
    before: parseThermalDump(pair.before),
    after: pair.after !== null ? parseThermalDump(pair.after) : null,
    afterText: pair.after,
  }
}
