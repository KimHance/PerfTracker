import { mergeThermalReadings } from '../../device/state.js'
import type { MetricReason } from '../../schema/reasons.js'
import type { ThermalData, ThermalZoneReading } from '../../schema/result.js'
import type { BaseExtractContext, CaptureCollector, ExtractOutcome, SupportResult } from '../types.js'
import {
  collectThermalSnapshots,
  THERMAL_MIN_SDK,
  THERMAL_SNAPSHOT_KEY,
} from './sources/dumpsysThermal.js'
import { mergeZones, toThermalData } from './toDomain.js'

export * from './model.js'
export * from './toDomain.js'
export * from './sources/dumpsysThermal.js'

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
    return { code: 'snapshot_unavailable', detail: { key: THERMAL_SNAPSHOT_KEY, phase: 'after' } }
  }
  const onlyBefore = zones.filter((z) => z.after_c === null).map((z) => z.name)
  const onlyAfter = zones.filter((z) => z.before_c === null).map((z) => z.name)
  if (onlyBefore.length === 0 && onlyAfter.length === 0) return null
  return { code: 'thermal_zones_changed', detail: { only_before: onlyBefore, only_after: onlyAfter } }
}

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
    const pair = collectThermalSnapshots(ctx)
    if (pair === null) {
      return {
        collected: false,
        reason: {
          code: 'snapshot_unavailable',
          detail: { key: THERMAL_SNAPSHOT_KEY, phase: 'before' },
        },
      }
    }

    const zones = mergeZones(pair)
    if (zones.length === 0) {
      // "센서가 없다" 와 "HAL 이 안 붙었다" 는 다른 사실이다. 기기가 말해 준 쪽을 쓴다.
      const anyAfter = pair.after !== null && mergeThermalReadings(pair.after).length > 0
      if (!anyAfter) {
        return {
          collected: false,
          reason:
            pair.before.halReady === false
              ? { code: 'thermal_hal_not_ready' }
              : { code: 'no_thermal_zones' },
        }
      }
    }

    const data = toThermalData(pair, zones)
    const partialReason = thermalPartialReason(pair.afterText, zones)
    return partialReason === null
      ? { collected: true, data }
      : { collected: true, data, partialReason }
  },
}
