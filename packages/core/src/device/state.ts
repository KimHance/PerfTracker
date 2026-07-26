import type { AdbClient } from '../adb/client.js'
import type { SnapshotSpec } from '../collectors/snapshots.js'
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

/** `dumpsys thermalservice` 의 온도 항목 하나. 이름은 벤더 문자열이고 `type` 이 표준이다. */
export interface ThermalReading {
  /**
   * `mName`. **벤더가 정하는 임의 문자열이다** (`AP` / `SKIN` / `test temperature sensor`).
   * 이 값으로 CPU/피부 온도를 판별하면 안 된다 — 그 판별은 `type` 으로 한다.
   */
  name: string
  /**
   * `mType`. `android.hardware.thermal` 의 `TemperatureType` 표준 enum:
   * 0=CPU, 1=GPU, 2=BATTERY, 3=SKIN, 4=USB_PORT, 5=POWER_AMPLIFIER, 6=BCL_VOLTAGE,
   * 7=BCL_CURRENT, 8=BCL_PERCENTAGE, 9=NPU. 없으면 null.
   */
  type: number | null
  celsius: number
  /** `mStatus`. 이 센서 기준의 throttling 단계(THERMAL_STATUS_*). 없으면 null. */
  status: number | null
}

/** `dumpsys thermalservice` 한 판의 전체 구조. */
export interface ThermalDump {
  /** `Thermal Status: N` — 기기 전체의 throttling 단계. */
  deviceStatus: number | null
  /** `IsStatusOverride: true|false` — 상태가 강제 설정된 것인지. */
  statusOverride: boolean | null
  /** `HAL Ready: true|false`. */
  halReady: boolean | null
  /** `Current temperatures from HAL:` 절. */
  hal: ThermalReading[]
  /** `Cached temperatures:` 절. HAL 에 없는 센서가 여기 있을 수 있다 (실측: `PA1THM`). */
  cached: ThermalReading[]
  /** `Temperature headroom thresholds:` 의 배열. **`NaN` 은 null 이다** (JSON 에 NaN 이 없다). */
  headroomThresholds: (number | null)[] | null
}

/**
 * 섹션 하나의 줄들을 집는다.
 *
 * `dumpsys thermalservice` 의 섹션 머리는 **들여쓰기 없는 줄**이고 내용은 들여쓰기된 줄이다.
 * 그래서 `Cached temperatures:` 아래를 훑다가 `HAL Ready: true` 를 만나면 끝난다.
 * (유일한 예외가 `Temperature headroom thresholds:` 인데, 그 배열은 따로 집는다.)
 */
function sectionLines(lines: string[], header: string): string[] {
  const at = lines.findIndex((l) => l.trimEnd() === header)
  if (at < 0) return []
  const out: string[] = []
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i]!
    if (/^\S/.test(line)) break
    out.push(line)
  }
  return out
}

/**
 * 두 단계로 읽는다. `Temperature{...}` 를 통째로 잡은 뒤 안에서 필드를 하나씩 꺼낸다 —
 * 필드 **순서**를 한 정규식에 박으면 그 순서를 안 지키는 벤더의 출력에서 값이 null 이 되는
 * 게 아니라 **존 자체가 사라진다.** (값이 없는 것과 존이 없는 것은 다른 사실이고, 사라진
 * 존은 "센서 집합이 달라졌다" 는 없던 사실까지 만든다.)
 *
 * 그래서 블록 안쪽을 `mValue=` 로 시작하도록 **묶지 않는다.** 오탐 후보
 * (`CoolingDevice{mValue=...}` / `TemperatureThreshold{mType=...}`, 에뮬레이터 실측)는
 * 두 겹으로 이미 배제된다:
 *   1. `sectionLines` 가 온도 절(`Current temperatures from HAL:` / `Cached temperatures:`)
 *      의 줄만 넘긴다 — 둘은 각각 다른 절에 있다.
 *   2. `Temperature\{` 리터럴 — `TemperatureThreshold{` 는 `Temperature` 다음이 `{` 가
 *      아니라 매칭되지 않고, `CoolingDevice{` 는 접두사부터 다르다.
 * 즉 `mValue=` 앵커가 막아 주던 것은 하나도 없었고 필드 순서 의존만 남아 있었다.
 */
function parseReadings(text: string): ThermalReading[] {
  const out: ThermalReading[] = []
  for (const m of text.matchAll(/Temperature\{([^}]*)\}/g)) {
    const body = m[1]!
    const value = /mValue=(-?[\d.]+)/.exec(body)?.[1]
    const name = /mName=([^,}]*)/.exec(body)?.[1]?.trim()
    if (value === undefined || name === undefined || name.length === 0) continue
    const type = /mType=(-?\d+)/.exec(body)?.[1]
    const status = /mStatus=(-?\d+)/.exec(body)?.[1]
    out.push({
      name,
      type: type !== undefined ? Number(type) : null,
      celsius: Number(value),
      status: status !== undefined ? Number(status) : null,
    })
  }
  return out
}

function boolOrNull(text: string, re: RegExp): boolean | null {
  const m = re.exec(text)?.[1]
  return m === undefined ? null : m === 'true'
}

/**
 * `Temperature headroom thresholds:` 다음 줄의 `[...]` 안쪽을 숫자 배열로 바꾼다.
 *
 * 세 상태가 **서로 다른 사실**이라 셋 다 다르게 나온다:
 *   - 절이 없다        → `null` ("이 기기는 그 절을 안 찍는다")
 *   - `[]` 로 비었다   → `[]`   ("찍었는데 임계가 하나도 없다")
 *   - `NaN` 이 섞였다  → 그 자리만 `null` ("이 단계에 임계가 정의되지 않았다")
 *
 * 가운데를 놓치면 `''.split(',')` 가 `['']` 이 되고 `Number('')` 가 **0** 이라
 * `[0]` 이 나온다 — THERMAL_STATUS_NONE 에 임계 0 이 정의된 것처럼 보이는데
 * 기기는 아무것도 보고하지 않았다. 없는 임계를 지어내는 것이다.
 * `NaN` 을 null 로 접는 규칙이 이미 그 이유로 존재하는데 빈 배열만 뚫려 있었다.
 */
function parseHeadroom(raw: string | undefined): (number | null)[] | null {
  if (raw === undefined) return null
  if (raw.trim().length === 0) return []
  return raw.split(',').map((v) => {
    const n = Number(v.trim())
    // JSON 은 NaN 을 실을 수 없다. 0 으로 접으면 없던 임계를 지어내는 것이다.
    return Number.isFinite(n) ? n : null
  })
}

export function parseThermalDump(text: string): ThermalDump {
  const lines = text.split('\n')

  const headroomAt = lines.findIndex((l) => l.trimEnd() === 'Temperature headroom thresholds:')
  const headroomRaw =
    headroomAt >= 0 ? /^\s*\[(.*)\]\s*$/.exec(lines[headroomAt + 1] ?? '')?.[1] : undefined

  const status = /^Thermal Status:\s*(-?\d+)/m.exec(text)?.[1]

  return {
    deviceStatus: status !== undefined ? Number(status) : null,
    statusOverride: boolOrNull(text, /^IsStatusOverride:\s*(true|false)/m),
    halReady: boolOrNull(text, /^HAL Ready:\s*(true|false)/m),
    hal: parseReadings(sectionLines(lines, 'Current temperatures from HAL:').join('\n')),
    cached: parseReadings(sectionLines(lines, 'Cached temperatures:').join('\n')),
    headroomThresholds: parseHeadroom(headroomRaw),
  }
}

/** 존의 동일성 키. **이름만으로는 안 된다** — 벤더 문자열이라 유일성이 보장되지 않는다. */
export function thermalZoneKey(r: { name: string; type: number | null }): string {
  return `${r.type === null ? 'null' : String(r.type)} ${r.name}`
}

/**
 * 두 섹션을 존 하나당 한 줄로 합친다.
 *
 * `Current temperatures from HAL` 은 덤프 시점에 HAL 에 직접 물어본 값이라 우선한다.
 * `Cached temperatures` 는 프레임워크가 콜백으로 들고 있던 값인데, **HAL 이 이번에 안 준
 * 센서가 여기 남아 있을 수 있다** (실기기 실측: `PA1THM`). 그래서 버리지 않고 뒤에 붙인다.
 *
 * 예전 `parseThermalZones` 는 두 섹션을 구분 없이 전역 matchAll 해서, 실기기에서 8존이
 * **15개 항목**으로 나왔다 (`AP` 가 두 번, `BAT` 이 두 번, ...).
 */
export function mergeThermalReadings(
  dump: ThermalDump,
): (ThermalReading & { source: 'hal' | 'cached' })[] {
  const out: (ThermalReading & { source: 'hal' | 'cached' })[] = []
  const seen = new Set<string>()

  for (const r of dump.hal) {
    const key = thermalZoneKey(r)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...r, source: 'hal' })
  }
  for (const r of dump.cached) {
    const key = thermalZoneKey(r)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...r, source: 'cached' })
  }
  return out
}

/**
 * `DeviceState.thermal_zones` 로 가는 투영. `metrics.thermal` 과 **같은 파서를 쓴다** —
 * 파서가 둘이면 결함도 둘이 된다.
 *
 * `source` 를 함께 내보낸다. 예전에는 `mergeThermalReadings` 가 계산한 것을 여기서 버렸는데,
 * 그러면 `cached` 전용 존의 값이 **갱신되지 않은 값일 수 있다는 사실**을 소비자가 알 방법이
 * 없다 (실기기 실측: `PA1THM` 이 4세션 8개 덤프 내내 27.0°C 고정).
 */
export function parseThermalZones(text: string): {
  name: string
  celsius: number
  type: number | null
  status: number | null
  source: 'hal' | 'cached'
}[] {
  return mergeThermalReadings(parseThermalDump(text)).map((z) => ({
    name: z.name,
    celsius: z.celsius,
    type: z.type,
    status: z.status,
    source: z.source,
  }))
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

/**
 * 선언된 스냅샷 명령들을 각 1회 실행한다. `collectDeviceState` 와 같은 정책이다 —
 * 개별 명령의 실패는 빈 문자열로 흡수하고, 명령 하나가 없는 기기 때문에 세션을 죽이지 않는다.
 *
 * **반드시 측정 창 밖에서만 불린다.** start 는 창을 열기 전(그리고 트레이스를 켜기 전),
 * stop 은 창을 닫고 트레이서를 멈춘 뒤다. 창 안에서 불리면 `AdbClient` 의 래치가
 * `MeasurementWindowViolationError` 를 던진다 — 이 함수가 그 규칙을 스스로 검사하지 않는
 * 이유는 검사가 이미 단일 관문(`AdbClient`)에 있기 때문이다.
 *
 * 명령을 한 셸 호출로 합치지 않는다: 이 호출들은 트레이스 밖에서 일어나므로 왕복 횟수가
 * 측정에 청구되지 않는다. 합치면 출력 경계를 가르는 파싱만 늘고 얻는 것이 없다.
 */
export async function runSnapshots(
  adb: AdbClient,
  specs: SnapshotSpec[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const spec of specs) out[spec.key] = await adb.tryShell(spec.command)
  return out
}
