import type { DeviceView, MetricSupportView } from '../../contract/api.js'
import { unsupportedChips } from './metrics.js'

/**
 * 기기 스펙 한 줄.
 * `Android 16 (SDK 36) · SM8475 · 8코어 · 11GB · 904x2316@60Hz`
 *
 * 모르는 값은 감추지 않고 `미상` 으로 쓴다 — core 의 규칙 3(모르면 null, 0 으로 채우지 않는다)이
 * 화면까지 이어져야 사람이 "0 이라고 쟀다" 와 "못 읽었다" 를 구분한다.
 */
export function formatSpecLine(device: DeviceView): string {
  const spec = device.spec
  if (!spec) {
    return device.measuring
      ? '측정 중이라 스펙을 읽지 않았습니다'
      : deviceStateLine(device.state)
  }

  const parts = [
    `Android ${spec.androidRelease} (SDK ${spec.sdkInt})`,
    spec.socModel ?? 'SoC 미상',
    `${spec.coreCount}코어`,
    `${Math.round(spec.memoryTotalKb / 1024 / 1024)}GB`,
    `${spec.widthPx}x${spec.heightPx}${spec.refreshHz !== null ? `@${spec.refreshHz}Hz` : ''}`,
  ]

  // **칩과 같은 단위로 말한다.** raw id 로 세던 시절 sdk 30 이 `frame·network 미지원` 이었는데
  // 그 기기는 렌더를 hwui 로 잰다 — 있는 것을 없다고 말하고 있었다 (`format/metrics.ts`).
  const missing = unsupportedChips(device.metrics).map((c) => c.label)
  const tail = missing.length > 0 ? ` — ${missing.join('·')} 미지원` : ''
  return `${parts.join(' · ')}${tail}`
}

function deviceStateLine(state: DeviceView['state']): string {
  switch (state) {
    case 'unauthorized':
      return '기기 화면에서 USB 디버깅을 허용해 주세요'
    case 'offline':
      return '기기가 offline 상태입니다'
    case 'unknown':
      return '기기 상태를 알 수 없습니다'
    case 'device':
      return '스펙을 읽지 못했습니다'
  }
}

/**
 * 못 재는 것의 수. 0 이면 배지를 달지 않는다.
 * **칩과 같은 단위로 센다** — 위 스펙 줄이 나열하는 것과 같은 수여야 한다.
 */
export function unsupportedCount(metrics: MetricSupportView[]): number {
  return unsupportedChips(metrics).length
}
