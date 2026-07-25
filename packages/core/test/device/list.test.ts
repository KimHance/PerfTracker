import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AdbClient } from '../../src/adb/client.js'
import { listDevices, parseDevicesOutput, selectDevice } from '../../src/device/list.js'
import { AmbiguousDeviceError, DeviceNotFoundError } from '../../src/errors.js'
import { FakeProcessRunner } from '../support/fakeProcessRunner.js'

const REAL = readFileSync(fileURLToPath(new URL('../fixtures/devices-l.txt', import.meta.url)), 'utf8')

describe('parseDevicesOutput', () => {
  it('실기기 출력에서 serial 과 속성을 뽑는다', () => {
    expect(parseDevicesOutput(REAL)).toEqual([
      {
        serial: 'R3CY0000002',
        state: 'device',
        product: 'pa1qksx',
        model: 'SM_S931N',
        transportId: '2',
      },
    ])
  })

  it('헤더와 데몬 메시지를 무시한다', () => {
    const text = '* daemon not running; starting now at tcp:5037\n* daemon started successfully\nList of devices attached\n'
    expect(parseDevicesOutput(text)).toEqual([])
  })

  it('unauthorized 와 offline 상태를 구분한다', () => {
    const text = 'List of devices attached\nAAA device\nBBB unauthorized\nCCC offline\n'
    expect(parseDevicesOutput(text).map((d) => d.state)).toEqual(['device', 'unauthorized', 'offline'])
  })
})

describe('listDevices', () => {
  it('목록이 비면 서버를 재기동하고 한 번 더 조회한다', async () => {
    const runner = new FakeProcessRunner()
      .on('devices -l', { stdout: 'List of devices attached\n' }, { stdout: REAL })
      .on('kill-server', {})
      .on('start-server', { stdout: '* daemon started successfully\n' })
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    const devices = await listDevices(adb)

    expect(devices).toHaveLength(1)
    expect(runner.calls.map((c) => c.args[0])).toEqual(['devices', 'kill-server', 'start-server', 'devices'])
  })

  it('처음부터 기기가 있으면 서버를 건드리지 않는다', async () => {
    const runner = new FakeProcessRunner().on('devices -l', { stdout: REAL })
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    await listDevices(adb)

    expect(runner.calls).toHaveLength(1)
  })

  it('allowServerRestart 가 false 면 재기동하지 않는다', async () => {
    const runner = new FakeProcessRunner().on('devices -l', { stdout: 'List of devices attached\n' })
    const adb = new AdbClient({ adbPath: '/fake/adb', runner })

    await expect(listDevices(adb, { allowServerRestart: false })).resolves.toEqual([])
    expect(runner.calls).toHaveLength(1)
  })
})

describe('selectDevice', () => {
  const ok = { serial: 'A', state: 'device' as const }
  const ok2 = { serial: 'B', state: 'device' as const }

  it('한 대면 그것을 고른다', () => {
    expect(selectDevice([ok])).toBe(ok)
  })

  it('요청한 serial 을 고른다', () => {
    expect(selectDevice([ok, ok2], 'B')).toBe(ok2)
  })

  it('요청한 serial 이 없으면 오류를 던진다', () => {
    expect(() => selectDevice([ok], 'ZZZ')).toThrow(DeviceNotFoundError)
  })

  it('여러 대면 자동 선택하지 않는다', () => {
    expect(() => selectDevice([ok, ok2])).toThrow(AmbiguousDeviceError)
  })

  it('기기가 없으면 오류를 던진다', () => {
    expect(() => selectDevice([])).toThrow(DeviceNotFoundError)
  })

  it('unauthorized 만 있으면 승인 안내를 담은 오류를 던진다', () => {
    try {
      selectDevice([{ serial: 'A', state: 'unauthorized' }])
      expect.unreachable('던졌어야 한다')
    } catch (e) {
      expect((e as Error).message).toContain('USB 디버깅')
    }
  })
})
