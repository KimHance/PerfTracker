import { AdbClient, collectDeviceStatic, defaultLocateAdbDeps, listDevices, locateAdb } from '@perftracker/core'

export async function runDevices(opts: { adb?: string }): Promise<string> {
  const located = locateAdb(opts.adb, defaultLocateAdbDeps())
  const base = new AdbClient({ adbPath: located.path })
  const devices = await listDevices(base)

  if (devices.length === 0) return '연결된 기기가 없습니다.'

  const lines: string[] = []
  for (const d of devices) {
    if (d.state !== 'device') {
      lines.push(`${d.serial}  [${d.state}]`)
      continue
    }
    const spec = await collectDeviceStatic(base.withSerial(d.serial))
    const ram = Math.round(spec.memory_total_kb / 1024 / 1024)
    const hz = spec.display.active_refresh_rate_hz
    lines.push(
      `${d.serial}  ${spec.model} · Android ${spec.android_release} (SDK ${spec.sdk_int}) · ` +
        `${spec.soc_model ?? 'SoC 미상'} · ${spec.cpu.core_count}코어 · ${ram}GB · ` +
        `${spec.display.width_px}x${spec.display.height_px}${hz !== null ? `@${hz}Hz` : ''}`,
    )
  }
  return lines.join('\n')
}
