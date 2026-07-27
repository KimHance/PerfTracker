import { mergeThermalReadings, type ThermalDump, thermalZoneKey } from '../../device/state.js'
import type { ThermalData, ThermalZoneReading } from '../../schema/result.js'
import { round } from '../num.js'
import type { ThermalSnapshotPair } from './model.js'

/**
 * 존 하나의 출처. **전/후 어느 한쪽이라도 `cached` 면 그 존은 `cached` 다.**
 *
 * 왜 before 것 하나로 라벨링하면 안 되는가: `thermalZoneKey` 는 (type, name) 쌍이고
 * **일부러 `source` 를 담지 않는다.** 키에 넣으면 HAL 이 이번 덤프에 안 준 센서가
 * before/after 에서 서로 다른 키가 되어 존 하나가 항목 두 개로 갈라지고,
 * "센서 집합이 달라졌다" 는 없던 사실까지 만들어진다.
 *
 * 그래서 키는 그대로 두고 **라벨을 여기서 보수적으로 고른다.** 값 하나라도 cached 일 수
 * 있으면 스키마가 cached 존에 붙여 둔 경고가 그 존에 적용되어야 한다.
 */
export function mergedSource(
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
 * before 의 순서를 지키고, after 에만 있는 존을 뒤에 붙인다. 델타 크기로 정렬하지 않는다 —
 * 어느 센서가 중요한지는 이 도구가 말하지 않는 종류의 것이다.
 *
 * **"기기가 준 순서" 가 아니다.** `mergeThermalReadings` 가 HAL 절을 먼저 훑고 cached
 * 전용을 뒤에 붙이므로, 원문이 `Cached temperatures:` 를 먼저 찍는 실기기에서는 원문
 * 순서와 다르다. 스키마의 `.describe()` 가 그 규칙을 그대로 말한다.
 */
export function mergeZones(pair: ThermalSnapshotPair): ThermalZoneReading[] {
  const beforeZones = mergeThermalReadings(pair.before)
  const afterZones = pair.after !== null ? mergeThermalReadings(pair.after) : []

  const afterByKey = new Map(afterZones.map((z) => [thermalZoneKey(z), z]))
  const beforeKeys = new Set(beforeZones.map((z) => thermalZoneKey(z)))

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

  return zones
}

/** **데이터 모델 → 도메인 모델.** 기기도 dumpsys 도 모른다. */
export function toThermalData(pair: ThermalSnapshotPair, zones: ThermalZoneReading[]): ThermalData {
  return {
    zones,
    device_status_before: pair.before.deviceStatus,
    device_status_after: pair.after?.deviceStatus ?? null,
    status_override_before: pair.before.statusOverride,
    status_override_after: pair.after?.statusOverride ?? null,
    hal_ready_before: pair.before.halReady,
    hal_ready_after: pair.after?.halReady ?? null,
    headroom_thresholds: pickHeadroom(pair.before, pair.after),
  }
}
