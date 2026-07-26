import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AdbClient } from '../../src/adb/client.js'
import {
  collectDeviceState,
  connectionKindFromSerial,
  parseBattery,
  parseMemAvailableKb,
  parseNetworkFromIpRoute,
  parseSettingsLine,
  parseThermalDump,
  parseThermalZones,
  mergeThermalReadings,
  runSnapshots,
} from '../../src/device/state.js'
import { FakeProcessRunner } from '../support/fakeProcessRunner.js'

const read = (n: string): string =>
  readFileSync(fileURLToPath(new URL(`../fixtures/${n}`, import.meta.url)), 'utf8')

const BATTERY = read('dumpsys-battery.txt')
const THERMAL = read('dumpsys-thermalservice.txt')
const THERMAL_EMU = read('dumpsys-thermalservice-emu.txt')
const SETTINGS = 'brightness=131 low_power=0 anim=1.0\n'
const IP_ROUTE = '8.8.8.8 via 192.168.0.1 dev wlan0 table 1045 src 192.168.0.5 uid 2000 \n    cache \n'

describe('parseBattery', () => {
  it('레벨과 온도와 충전 여부를 읽는다', () => {
    expect(parseBattery(BATTERY)).toEqual({ level: 68, tempC: 34.8, charging: true })
  })

  it('어떤 전원도 안 붙었으면 charging 은 false', () => {
    expect(parseBattery('  AC powered: false\n  USB powered: false\n  level: 50\n').charging).toBe(false)
  })

  it('필드가 없으면 null 로 둔다', () => {
    expect(parseBattery('nothing')).toEqual({ level: null, tempC: null, charging: null })
  })
})

/**
 * 픽스처는 실기기(SM-S901N / Android 16)와 에뮬레이터(API 35) 의 `dumpsys thermalservice`
 * 원문을 **구조 그대로** 옮기고 값만 합성한 것이다. 이 파서의 결함은 전부 구조에서 나왔다.
 */
describe('parseThermalDump', () => {
  it('두 섹션을 따로 읽는다 — 예전 파서는 둘을 한 배열로 뭉쳐 중복을 만들었다', () => {
    const dump = parseThermalDump(THERMAL)
    expect(dump.cached).toHaveLength(8)
    expect(dump.hal).toHaveLength(7)
  })

  it('mType 과 mStatus 를 버리지 않는다 — throttling 상태는 mStatus 에만 있다', () => {
    const dump = parseThermalDump(THERMAL)
    expect(dump.hal).toContainEqual({ name: 'AP', type: 0, celsius: 37.1, status: 0 })
    expect(dump.hal).toContainEqual({ name: 'PATHM', type: 5, celsius: 37.2, status: 1 })
  })

  it('Thermal Status / IsStatusOverride / HAL Ready 를 읽는다', () => {
    const dump = parseThermalDump(THERMAL)
    expect(dump.deviceStatus).toBe(0)
    expect(dump.statusOverride).toBe(false)
    expect(dump.halReady).toBe(true)
  })

  /** JSON 에는 NaN 이 없다. null 로 접지 않으면 result.json 이 파싱 불가능해진다. */
  it('headroom 임계 배열을 읽고 NaN 을 null 로 바꾼다', () => {
    expect(parseThermalDump(THERMAL).headroomThresholds).toEqual([
      null, 0.8666667, 0.93333334, 1.0, 1.1333333, 1.4333333, 2.4333334,
    ])
  })

  /**
   * G2. `NaN` 은 null 로 접으면서 **빈 배열만 뚫려 있었다**:
   * `''.split(',')` → `['']` → `Number('')` → `0` → `Number.isFinite(0)` 이 참이라
   * `[0]` 이 나왔다. THERMAL_STATUS_NONE(0단계) 에 임계 0 이 정의된 것처럼 보이는데,
   * 기기는 임계를 하나도 보고하지 않았다. 없는 임계를 지어내는 것이고,
   * 바로 그 자리의 주석이 "0 으로 접으면 없던 임계를 지어내는 것" 이라고 쓰여 있었다.
   */
  it('빈 headroom 배열은 [0] 이 아니라 [] 다 — 없는 임계를 지어내지 않는다', () => {
    const dump = parseThermalDump('Temperature headroom thresholds:\n[]\n')
    expect(dump.headroomThresholds).toEqual([])
  })

  it('공백만 있는 headroom 배열도 [] 다', () => {
    expect(parseThermalDump('Temperature headroom thresholds:\n[  ]\n').headroomThresholds).toEqual(
      [],
    )
  })

  /** 절 자체가 없는 것은 "빈 배열" 과 다른 사실이다 — 그쪽은 null 이다. */
  it('headroom 절이 아예 없으면 [] 가 아니라 null 이다', () => {
    expect(parseThermalDump('Thermal Status: 0\n').headroomThresholds).toBeNull()
  })

  it('CoolingDevice 와 TemperatureThreshold 를 온도로 오탐하지 않는다', () => {
    const dump = parseThermalDump(THERMAL_EMU)
    expect(dump.hal).toEqual([
      { name: 'test temperature sensor', type: 3, celsius: 30.8, status: 0 },
    ])
    expect(dump.cached).toHaveLength(1)
  })

  it('섹션이 통째로 없으면 빈 배열이고 던지지 않는다', () => {
    const dump = parseThermalDump('')
    expect(dump).toEqual({
      deviceStatus: null,
      statusOverride: null,
      halReady: null,
      hal: [],
      cached: [],
      headroomThresholds: null,
    })
  })

  /** 벤더가 mStatus 를 안 찍는 경우에도 온도는 살려야 한다 — 값이 없는 것과 존이 없는 것은 다르다. */
  it('mStatus 가 없는 항목도 온도는 살리고 status 만 null 로 둔다', () => {
    const dump = parseThermalDump(
      'Current temperatures from HAL:\n\tTemperature{mValue=41.5, mType=0, mName=CPU}\n',
    )
    expect(dump.hal).toEqual([{ name: 'CPU', type: 0, celsius: 41.5, status: null }])
  })
})

describe('mergeThermalReadings', () => {
  it('HAL 을 우선하고 Cached 에만 있는 존을 잃지 않는다 — 실기기 15항목이 8존이 된다', () => {
    const zones = mergeThermalReadings(parseThermalDump(THERMAL))
    expect(zones).toHaveLength(8)
    expect(zones.map((z) => z.name)).toContain('PA1THM')
    // PATHM 의 mStatus 는 두 섹션에서 다르다. HAL 이 이겨야 한다.
    expect(zones.find((z) => z.name === 'PATHM')).toEqual({
      name: 'PATHM', type: 5, celsius: 37.2, status: 1, source: 'hal',
    })
    expect(zones.find((z) => z.name === 'PA1THM')?.source).toBe('cached')
  })

  it('중복이 하나도 없다 — 같은 (type,name) 이 두 번 나오지 않는다', () => {
    const zones = mergeThermalReadings(parseThermalDump(THERMAL))
    const keys = zones.map((z) => `${String(z.type)} ${z.name}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('HAL 섹션이 비어 있으면 Cached 를 전부 쓴다', () => {
    const dump = parseThermalDump(THERMAL)
    const zones = mergeThermalReadings({ ...dump, hal: [] })
    expect(zones).toHaveLength(8)
    expect(zones.every((z) => z.source === 'cached')).toBe(true)
  })
})

describe('parseThermalZones (DeviceState 투영)', () => {
  it('중복 없이 존 하나당 한 줄이고 type/status 를 들고 간다', () => {
    const zones = parseThermalZones(THERMAL)
    expect(zones).toHaveLength(8)
    expect(zones).toContainEqual({ name: 'AP', celsius: 37.1, type: 0, status: 0, source: 'hal' })
  })

  it('센서가 없으면 빈 배열', () => {
    expect(parseThermalZones('')).toEqual([])
  })

  /**
   * 계획서 D4: "각 존은 어느 섹션에서 왔는지 `source` 로 들고 다닌다."
   * `mergeThermalReadings` 가 계산해 놓은 `source` 를 이 투영이 버리고 있었다.
   *
   * 왜 중요한가: 실기기(SM-S901N / Android 16) 원본 8개를 대조하니 `Cached` 전용 존인
   * `PA1THM` 이 약 3시간에 걸친 4세션의 전/후 덤프에서 소수점까지 **계속 27.0°C** 였다.
   * 같은 기간 HAL 이 주는 `AP` 는 30.8~41.6°C 로 움직였다. 즉 `cached` 존의 델타 0 은
   * "온도가 안 변했다" 가 아니라 "이 값이 갱신되지 않았다" 일 수 있고, `source` 없이는
   * 소비자가 그 구분을 할 방법이 아예 없다.
   */
  it('source 를 버리지 않는다 — Cached 전용 존의 값은 갱신되지 않을 수 있다', () => {
    const zones = parseThermalZones(THERMAL)
    expect(zones.find((z) => z.name === 'AP')?.source).toBe('hal')
    expect(zones.find((z) => z.name === 'PA1THM')?.source).toBe('cached')
  })
})

describe('parseSettingsLine', () => {
  it('밝기·저전력·애니메이션 배율을 읽는다', () => {
    expect(parseSettingsLine(SETTINGS)).toEqual({ brightness: 131, powerSave: false, animScale: 1 })
  })

  it('low_power=1 이면 저전력 모드', () => {
    expect(parseSettingsLine('brightness=10 low_power=1 anim=0.5').powerSave).toBe(true)
  })

  it('설정이 null 이면 null 로 둔다', () => {
    expect(parseSettingsLine('brightness=null low_power=null anim=null')).toEqual({
      brightness: null,
      powerSave: null,
      animScale: null,
    })
  })
})

describe('parseMemAvailableKb / parseNetworkFromIpRoute / connectionKindFromSerial', () => {
  it('MemAvailable 을 읽는다', () => {
    expect(parseMemAvailableKb('MemAvailable:    3511516 kB\n')).toBe(3511516)
  })

  it('wlan 인터페이스를 wifi 로 본다', () => {
    expect(parseNetworkFromIpRoute(IP_ROUTE)).toBe('wifi')
  })

  it('rmnet 인터페이스를 cellular 로 본다', () => {
    expect(parseNetworkFromIpRoute('8.8.8.8 via 10.0.0.1 dev rmnet_data2 src 10.0.0.2')).toBe('cellular')
  })

  it('경로가 없으면 null', () => {
    expect(parseNetworkFromIpRoute('')).toBeNull()
  })

  it('serial 에 콜론이 있으면 tcp 연결', () => {
    expect(connectionKindFromSerial('192.168.0.5:5555')).toBe('tcp')
    expect(connectionKindFromSerial('R3CY0000002')).toBe('usb')
    expect(connectionKindFromSerial(undefined)).toBe('unknown')
  })
})

describe('collectDeviceState', () => {
  it('상태와 원문을 함께 돌려준다', async () => {
    const runner = new FakeProcessRunner()
      .on('-s R3CY0000002 shell dumpsys battery', { stdout: BATTERY })
      .on('-s R3CY0000002 shell dumpsys thermalservice', { stdout: THERMAL })
      .on(
        '-s R3CY0000002 shell echo "brightness=$(settings get system screen_brightness) low_power=$(settings get global low_power) anim=$(settings get global animator_duration_scale)"',
        { stdout: SETTINGS },
      )
      .on('-s R3CY0000002 shell grep MemAvailable /proc/meminfo', { stdout: 'MemAvailable:    3511516 kB\n' })
      .on('-s R3CY0000002 shell ip route get 8.8.8.8', { stdout: IP_ROUTE })
    const adb = new AdbClient({ adbPath: '/fake/adb', runner }).withSerial('R3CY0000002')

    const { state, raw } = await collectDeviceState(adb, new Date('2026-07-25T14:32:10.000Z'))

    // 10개 상태 필드를 전부 단언한다 — 예전에는 절반만 봐서 수집을 지워도 통과했다.
    expect(state).toEqual({
      captured_at: '2026-07-25T14:32:10.000Z',
      battery_level: 68,
      battery_temp_c: 34.8,
      charging: true,
      connection: 'usb',
      screen_brightness: 131,
      power_save_mode: false,
      network: 'wifi',
      mem_available_kb: 3511516,
      animator_duration_scale: 1,
      thermal_zones: parseThermalZones(THERMAL),
    })
    expect(state.thermal_zones).toHaveLength(8)
    expect(raw['battery']).toBe(BATTERY)
    expect(raw['thermalservice']).toBe(THERMAL)
    expect(Object.keys(raw).sort()).toEqual(['battery', 'iproute', 'meminfo', 'settings', 'thermalservice'])
  })

  it('실패한 명령의 원문은 빈 문자열로 남는다', async () => {
    const runner = new FakeProcessRunner().on('shell dumpsys battery', { stdout: BATTERY })
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    const { raw } = await collectDeviceState(adb, new Date())

    expect(raw['battery']).toBe(BATTERY)
    expect(raw['thermalservice']).toBe('')
  })

  it('일부 명령이 실패해도 나머지를 채운다', async () => {
    const runner = new FakeProcessRunner()
      .on('shell dumpsys battery', { stdout: BATTERY })
      .on('shell dumpsys thermalservice', { code: 1, stderr: 'not supported' })
      .on(
        'shell echo "brightness=$(settings get system screen_brightness) low_power=$(settings get global low_power) anim=$(settings get global animator_duration_scale)"',
        { stdout: SETTINGS },
      )
      .on('shell grep MemAvailable /proc/meminfo', { stdout: 'MemAvailable:    3511516 kB\n' })
      .on('shell ip route get 8.8.8.8', { code: 2, stderr: 'unreachable' })
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    const { state } = await collectDeviceState(adb, new Date())

    expect(state.battery_level).toBe(68)
    expect(state.thermal_zones).toEqual([])
    expect(state.network).toBeNull()
  })
})

describe('runSnapshots', () => {
  it('명세마다 정확히 한 번씩, 선언된 순서대로 셸 명령을 낸다', async () => {
    const runner = new FakeProcessRunner()
      .on('shell dumpsys netstats', { stdout: 'netstats output\n' })
      .on('shell pm list packages -U', { stdout: 'package:com.foo uid:10208\n' })
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    const out = await runSnapshots(adb, [
      { key: 'netstats', command: 'dumpsys netstats' },
      { key: 'packages', command: 'pm list packages -U' },
    ])

    expect(out).toEqual({
      netstats: 'netstats output\n',
      packages: 'package:com.foo uid:10208\n',
    })
    // 두 명령을 한 셸 호출로 합치면 key → 원문 대응이 사라진다. 왕복은 창 밖이라 공짜다.
    expect(runner.commands).toEqual(['shell dumpsys netstats', 'shell pm list packages -U'])
  })

  /**
   * `collectDeviceState` 와 같은 정책이다. 여기서 `tryShell` 대신 던지는 `shell` 을 쓰면
   * 명령 하나가 없는 기기에서 **세션 자체가 시작되지 않는다.**
   */
  it('실패한 명령은 빈 문자열로 흡수하고 던지지 않는다', async () => {
    const runner = new FakeProcessRunner().on('shell dumpsys netstats', {
      code: 1,
      stderr: 'Can’t find service: netstats',
    })
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    await expect(runSnapshots(adb, [{ key: 'netstats', command: 'dumpsys netstats' }])).resolves.toEqual({
      netstats: '',
    })
  })

  it('빈 명세는 기기를 건드리지 않는다', async () => {
    const runner = new FakeProcessRunner()
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    expect(await runSnapshots(adb, [])).toEqual({})
    expect(runner.commands).toEqual([])
  })
})
