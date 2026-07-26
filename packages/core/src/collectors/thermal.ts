import {
  mergeThermalReadings,
  parseThermalDump,
  type ThermalDump,
  thermalZoneKey,
} from '../device/state.js'
import type { MetricReason } from '../schema/reasons.js'
import type { ThermalData, ThermalZoneReading } from '../schema/result.js'
import { round } from './num.js'
import type { BaseExtractContext, CaptureCollector, ExtractOutcome, SupportResult } from './types.js'

/** `ThermalService` 는 Android 10(API 29) 에서 들어왔다. 그 아래에는 이 dumpsys 자체가 없다. */
export const THERMAL_MIN_SDK = 29

const SNAPSHOT_KEY = 'thermalservice'

/**
 * 세션 전/후 `dumpsys thermalservice` 스냅샷의 차이.
 *
 * **추가 adb 호출이 0회다.** 이 원문은 `collectDeviceState()` 가 M0 때부터 매 세션
 * 시작 직전·종료 직후에 찍어 `raw/thermalservice_{before,after}.txt` 로 저장해 왔다.
 * 그래서 이 collector 는 `captureSnapshots()` 를 **선언하지 않는다** — 선언하면 같은 명령이
 * 두 번 나간다. 원문은 `CaptureFacts.snapshots` 가 `artifacts.raw` 를 훑어 그냥 넘겨준다.
 *
 * 그 결과 **이 collector 가 생기기 전에 찍힌 run 디렉토리에서도 값이 나온다.**
 * 그리고 그 경로가 `device.state_*.thermal_zones` 의 구멍을 덮는다 — `extract` 는
 * `capture.json` 의 `state_before/after` 를 다시 파싱하지 않고 그대로 옮기므로 옛 run 의
 * 그 필드는 여전히 중복 항목을 갖고 있다. 여기서만 원문을 **다시** 읽기 때문에
 * 옛 run 도 중복 없는 8존과 `mType`/`mStatus` 를 얻는다.
 */
export const thermalCollector: CaptureCollector<ThermalData> = {
  id: 'thermal',
  source:
    'dumpsys thermalservice: 세션 시작 직전 / 종료 직후 스냅샷의 센서별 온도 차이. ' +
    '기기 전역이며 대상 앱의 온도가 아니다. 전/후 두 점이므로 구간 중 최고 온도는 포함하지 않는다.',
  needsTrace: false,

  supports(env): SupportResult {
    return env.sdkInt >= THERMAL_MIN_SDK
      ? { supported: true }
      : {
          supported: false,
          reason: { code: 'sdk_too_low', detail: { sdk_int: env.sdkInt, min_sdk: THERMAL_MIN_SDK } },
        }
  },

  /** 데이터소스를 하나도 요구하지 않는다. 이 collector 때문에 TraceConfig 가 커지지 않는다. */
  traceConfigBlocks(): string[] {
    return []
  },

  async extract(ctx: BaseExtractContext): Promise<ExtractOutcome<ThermalData>> {
    const pair = ctx.capture.snapshots[SNAPSHOT_KEY]
    if (pair?.before == null) {
      return {
        collected: false,
        reason: { code: 'snapshot_unavailable', detail: { key: SNAPSHOT_KEY, phase: 'before' } },
      }
    }

    const before = parseThermalDump(pair.before)
    const after = pair.after !== null ? parseThermalDump(pair.after) : null

    const beforeZones = mergeThermalReadings(before)
    const afterZones = after !== null ? mergeThermalReadings(after) : []

    if (beforeZones.length === 0 && afterZones.length === 0) {
      // "센서가 없다" 와 "HAL 이 안 붙었다" 는 다른 사실이다. 기기가 말해 준 쪽을 쓴다.
      return {
        collected: false,
        reason:
          before.halReady === false ? { code: 'thermal_hal_not_ready' } : { code: 'no_thermal_zones' },
      }
    }

    const afterByKey = new Map(afterZones.map((z) => [thermalZoneKey(z), z]))
    const beforeKeys = new Set(beforeZones.map((z) => thermalZoneKey(z)))

    // before 의 순서를 지키고, after 에만 있는 존을 뒤에 붙인다. 델타 크기로 정렬하지 않는다 —
    // 어느 센서가 중요한지는 이 도구가 말하지 않는 종류의 것이고, 정렬은 기기 순서도 지운다.
    const zones: ThermalZoneReading[] = beforeZones.map((b) => {
      const a = afterByKey.get(thermalZoneKey(b))
      return {
        name: b.name,
        type: b.type,
        before_c: b.celsius,
        after_c: a?.celsius ?? null,
        // 부동소수 잔재(0.30000000000000004)를 결과 JSON 에 남기지 않는다.
        delta_c: a !== undefined ? round(a.celsius - b.celsius, 2) : null,
        status_before: b.status,
        status_after: a?.status ?? null,
        source: mergedSource(b.source, a?.source),
      }
    })
    for (const a of afterZones) {
      if (beforeKeys.has(thermalZoneKey(a))) continue
      zones.push({
        name: a.name,
        type: a.type,
        before_c: null,
        after_c: a.celsius,
        delta_c: null,
        status_before: null,
        status_after: a.status,
        source: a.source,
      })
    }

    const data: ThermalData = {
      zones,
      device_status_before: before.deviceStatus,
      device_status_after: after?.deviceStatus ?? null,
      status_override_before: before.statusOverride,
      status_override_after: after?.statusOverride ?? null,
      hal_ready_before: before.halReady,
      hal_ready_after: after?.halReady ?? null,
      headroom_thresholds: pickHeadroom(before, after),
    }

    const partialReason = thermalPartialReason(pair.after, zones)
    return partialReason === null ? { collected: true, data } : { collected: true, data, partialReason }
  },
}

/**
 * 존 하나의 출처. **전/후 어느 한쪽이라도 `cached` 면 그 존은 `cached` 다.**
 *
 * 왜 before 것 하나로 라벨링하면 안 되는가: `thermalZoneKey` 는 (type, name) 쌍이고
 * **일부러 `source` 를 담지 않는다.** 키에 넣으면 HAL 이 이번 덤프에 안 준 센서가
 * before/after 에서 서로 다른 키가 되어 존 하나가 항목 두 개로 갈라지고,
 * "센서 집합이 달라졌다" 는 없던 사실까지 만들어진다 — M3 가 방금 없앤 결함 그대로다.
 *
 * 그래서 키는 그대로 두고 **라벨을 여기서 보수적으로 고른다.** HAL 이 before 에는 주고
 * after 에는 안 준 센서는 `after_c` 가 Cached 값인데, before 의 `hal` 을 그대로 실으면
 * 스키마가 `cached` 존에 붙여 둔 경고("이 값은 갱신이 올 때만 바뀌므로 delta 0 이
 * '안 변했다' 가 아닐 수 있다")가 **그 존에 적용되지 않는다.** 값 하나라도 그럴 수 있으면
 * 그 경고는 적용되어야 한다.
 *
 * 실기기 8개 덤프에서는 멤버십이 전부 동일해 관측된 적 없는 경로지만, 논리적으로 열려 있다.
 * (after 에만 있는 존은 before 가 없으므로 그쪽 값 하나로 라벨링하는 것이 정확하다.)
 */
function mergedSource(
  before: 'hal' | 'cached',
  after: 'hal' | 'cached' | undefined,
): 'hal' | 'cached' {
  return before === 'cached' || after === 'cached' ? 'cached' : 'hal'
}

/** 정적인 값이라 before 를 우선하고, 없으면 after 를 본다. 둘 다 없으면 null. */
function pickHeadroom(before: ThermalDump, after: ThermalDump | null): (number | null)[] | null {
  return before.headroomThresholds ?? after?.headroomThresholds ?? null
}

/**
 * 사유는 하나만 실린다 — 우선순위를 명시적으로 정한다.
 *
 * 1. **after 스냅샷 자체가 없다** — 이때 "센서 집합이 달라졌다" 고 말하면 관측하지 않은
 *    원인을 대는 것이다. 실제로는 종료 스냅샷을 아예 못 찍었다.
 * 2. 스냅샷은 둘 다 있는데 센서 집합이 달라졌다.
 */
function thermalPartialReason(
  afterText: string | null,
  zones: ThermalZoneReading[],
): MetricReason | null {
  if (afterText === null) {
    return { code: 'snapshot_unavailable', detail: { key: SNAPSHOT_KEY, phase: 'after' } }
  }
  const onlyBefore = zones.filter((z) => z.after_c === null).map((z) => z.name)
  const onlyAfter = zones.filter((z) => z.before_c === null).map((z) => z.name)
  if (onlyBefore.length === 0 && onlyAfter.length === 0) return null
  return { code: 'thermal_zones_changed', detail: { only_before: onlyBefore, only_after: onlyAfter } }
}
