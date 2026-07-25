import type { AdbClient } from '../adb/client.js'
import { AmbiguousDeviceError, DeviceNotFoundError } from '../errors.js'

export interface DeviceEntry {
  serial: string
  state: 'device' | 'unauthorized' | 'offline' | 'unknown'
  model?: string
  product?: string
  transportId?: string
}

export function parseDevicesOutput(text: string): DeviceEntry[] {
  const out: DeviceEntry[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('*') || trimmed.startsWith('List of devices')) continue

    const [serial, state, ...rest] = trimmed.split(/\s+/)
    if (!serial || !state) continue

    const props: Record<string, string> = {}
    for (const token of rest) {
      const idx = token.indexOf(':')
      if (idx > 0) props[token.slice(0, idx)] = token.slice(idx + 1)
    }

    out.push({
      serial,
      state:
        state === 'device' || state === 'unauthorized' || state === 'offline'
          ? state
          : 'unknown',
      ...(props['model'] !== undefined ? { model: props['model'] } : {}),
      ...(props['product'] !== undefined ? { product: props['product'] } : {}),
      ...(props['transport_id'] !== undefined ? { transportId: props['transport_id'] } : {}),
    })
  }
  return out
}

/**
 * 기기가 물리적으로 붙어 있어도 오래된 adb 서버 때문에 빈 목록이 오는 일이 실제로 있다.
 * 그래서 비었을 때는 "기기 없음"으로 단정하지 않고 서버를 한 번 재기동한 뒤 다시 본다.
 */
export async function listDevices(
  adb: AdbClient,
  opts: { allowServerRestart?: boolean } = {},
): Promise<DeviceEntry[]> {
  const first = parseDevicesOutput(await adb.check(['devices', '-l']))
  if (first.length > 0 || opts.allowServerRestart === false) return first

  await adb.raw(['kill-server'])
  await adb.raw(['start-server'])
  return parseDevicesOutput(await adb.check(['devices', '-l']))
}

export function selectDevice(devices: DeviceEntry[], requestedSerial?: string): DeviceEntry {
  if (requestedSerial !== undefined) {
    const hit = devices.find((d) => d.serial === requestedSerial)
    if (!hit) {
      throw new DeviceNotFoundError(
        `serial "${requestedSerial}" 인 기기를 찾지 못했습니다. 연결된 기기: ` +
          (devices.length > 0 ? devices.map((d) => d.serial).join(', ') : '(없음)'),
      )
    }
    return hit
  }

  const usable = devices.filter((d) => d.state === 'device')
  if (usable.length === 1) return usable[0]!
  if (usable.length > 1) throw new AmbiguousDeviceError(usable.map((d) => d.serial))

  const unauthorized = devices.filter((d) => d.state === 'unauthorized')
  if (unauthorized.length > 0) {
    throw new DeviceNotFoundError(
      `기기가 USB 디버깅 승인 대기 상태입니다 (${unauthorized.map((d) => d.serial).join(', ')}). ` +
        `기기 화면의 승인 대화상자를 확인하세요.`,
    )
  }

  throw new DeviceNotFoundError(
    '사용 가능한 기기가 없습니다. USB 연결과 개발자 옵션의 USB 디버깅을 확인하세요.',
  )
}
