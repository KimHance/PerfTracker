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
  parseThermalZones,
} from '../../src/device/state.js'
import { FakeProcessRunner } from '../support/fakeProcessRunner.js'

const read = (n: string): string =>
  readFileSync(fileURLToPath(new URL(`../fixtures/${n}`, import.meta.url)), 'utf8')

const BATTERY = read('dumpsys-battery.txt')
const THERMAL = read('dumpsys-thermalservice.txt')
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

describe('parseThermalZones', () => {
  it('부위별 온도를 뽑는다', () => {
    const zones = parseThermalZones(THERMAL)
    expect(zones).toContainEqual({ name: 'AP', celsius: 37.1 })
    expect(zones).toContainEqual({ name: 'SKIN', celsius: 35.4 })
    expect(zones).toHaveLength(6)
  })

  it('센서가 없으면 빈 배열', () => {
    expect(parseThermalZones('')).toEqual([])
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

    expect(state.battery_level).toBe(68)
    expect(state.charging).toBe(true)
    expect(state.connection).toBe('usb')
    expect(state.network).toBe('wifi')
    expect(state.thermal_zones).toHaveLength(6)
    expect(raw['battery']).toBe(BATTERY)
    expect(raw['thermalservice']).toBe(THERMAL)
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
