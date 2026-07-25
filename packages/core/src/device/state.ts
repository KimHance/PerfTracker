import type { AdbClient } from '../adb/client.js'
import type { DeviceState } from '../schema/result.js'

const SETTINGS_COMMAND =
  'echo "brightness=$(settings get system screen_brightness) ' +
  'low_power=$(settings get global low_power) ' +
  'anim=$(settings get global animator_duration_scale)"'

export function parseBattery(text: string): {
  level: number | null
  tempC: number | null
  charging: boolean | null
} {
  const level = /^\s*level:\s*(-?\d+)/m.exec(text)
  const temp = /^\s*temperature:\s*(-?\d+)/m.exec(text)

  const powered = [/AC powered:\s*(true|false)/, /USB powered:\s*(true|false)/, /Wireless powered:\s*(true|false)/]
    .map((re) => re.exec(text)?.[1])
    .filter((v): v is string => v !== undefined)

  return {
    level: level ? Number(level[1]) : null,
    // dumpsys battery 의 temperature 는 0.1°C 단위 정수다.
    tempC: temp ? Number(temp[1]) / 10 : null,
    charging: powered.length > 0 ? powered.some((v) => v === 'true') : null,
  }
}

export function parseThermalZones(text: string): { name: string; celsius: number }[] {
  const out: { name: string; celsius: number }[] = []
  for (const m of text.matchAll(/Temperature\{mValue=(-?[\d.]+),\s*mType=\d+,\s*mName=([^,}]+)/g)) {
    out.push({ name: m[2]!.trim(), celsius: Number(m[1]) })
  }
  return out
}

function numberOrNull(raw: string | undefined): number | null {
  if (raw === undefined || raw === 'null' || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export function parseSettingsLine(text: string): {
  brightness: number | null
  powerSave: boolean | null
  animScale: number | null
} {
  const brightness = /brightness=(\S+)/.exec(text)?.[1]
  const lowPower = /low_power=(\S+)/.exec(text)?.[1]
  const anim = /anim=(\S+)/.exec(text)?.[1]

  return {
    brightness: numberOrNull(brightness),
    powerSave: lowPower === undefined || lowPower === 'null' ? null : lowPower === '1',
    animScale: numberOrNull(anim),
  }
}

export function parseMemAvailableKb(text: string): number | null {
  const m = /MemAvailable:\s+(\d+)\s*kB/.exec(text)
  return m ? Number(m[1]) : null
}

/** 기본 경로가 어느 인터페이스로 나가는지로 연결 종류를 본다. 추정이 아니라 관측이다. */
export function parseNetworkFromIpRoute(text: string): string | null {
  const dev = /\bdev\s+(\S+)/.exec(text)?.[1]
  if (!dev) return null
  if (dev.startsWith('wlan')) return 'wifi'
  if (dev.startsWith('rmnet') || dev.startsWith('ccmni') || dev.startsWith('v4-rmnet')) return 'cellular'
  if (dev.startsWith('eth')) return 'ethernet'
  return dev
}

export function connectionKindFromSerial(serial: string | undefined): 'usb' | 'tcp' | 'unknown' {
  if (serial === undefined) return 'unknown'
  return serial.includes(':') ? 'tcp' : 'usb'
}

/** 실패한 명령은 빈 문자열로 흘려보낸다 — 한 항목이 없다고 스냅샷 전체를 버리지 않는다. */
export async function collectDeviceState(
  adb: AdbClient,
  now: Date,
): Promise<{ state: DeviceState; raw: Record<string, string> }> {
  const raw: Record<string, string> = {
    battery: await adb.tryShell('dumpsys battery'),
    thermalservice: await adb.tryShell('dumpsys thermalservice'),
    settings: await adb.tryShell(SETTINGS_COMMAND),
    meminfo: await adb.tryShell('grep MemAvailable /proc/meminfo'),
    iproute: await adb.tryShell('ip route get 8.8.8.8'),
  }

  const battery = parseBattery(raw['battery']!)
  const settings = parseSettingsLine(raw['settings']!)

  return {
    state: {
      captured_at: now.toISOString(),
      battery_level: battery.level,
      battery_temp_c: battery.tempC,
      charging: battery.charging,
      connection: connectionKindFromSerial(adb.serial),
      screen_brightness: settings.brightness,
      power_save_mode: settings.powerSave,
      network: parseNetworkFromIpRoute(raw['iproute']!),
      mem_available_kb: parseMemAvailableKb(raw['meminfo']!),
      animator_duration_scale: settings.animScale,
      thermal_zones: parseThermalZones(raw['thermalservice']!),
    },
    raw,
  }
}
