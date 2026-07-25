import type { DeviceSummary } from '@perftracker/core'

/** 수집은 core 의 listDeviceSummaries 가 한다. 여기 남은 것은 한 줄 요약이다. */
export function formatDevices(devices: DeviceSummary[]): string {
  if (devices.length === 0) return '연결된 기기가 없습니다.'

  return devices
    .map((d) => {
      if (d.measurementInProgress) {
        return `${d.serial}  ${d.model ?? ''}  [측정 세션 진행 중 — 스펙 조회를 건너뜁니다]`.replace(/\s+/g, ' ')
      }
      if (d.spec === null) return `${d.serial}  [${d.state}]`

      const s = d.spec
      const ram = Math.round(s.memory_total_kb / 1024 / 1024)
      const hz = s.display.active_refresh_rate_hz
      return (
        `${d.serial}  ${s.model} · Android ${s.android_release} (SDK ${s.sdk_int}) · ` +
        `${s.soc_model ?? 'SoC 미상'} · ${s.cpu.core_count}코어 · ${ram}GB · ` +
        `${s.display.width_px}x${s.display.height_px}${hz !== null ? `@${hz}Hz` : ''}`
      )
    })
    .join('\n')
}
