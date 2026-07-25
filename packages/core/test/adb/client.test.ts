import { describe, expect, it } from 'vitest'
import { AdbClient } from '../../src/adb/client.js'
import { MeasurementWindow } from '../../src/adb/window.js'
import { AdbCommandError, MeasurementWindowViolationError } from '../../src/errors.js'
import { FakeProcessRunner } from '../support/fakeProcessRunner.js'

const ADB = '/fake/adb'

describe('AdbClient', () => {
  it('shell 명령의 stdout 을 문자열로 돌려준다', async () => {
    const runner = new FakeProcessRunner().on('shell getprop ro.product.model', { stdout: 'SM-S931N\n' })
    const adb = new AdbClient({ adbPath: ADB, runner })

    await expect(adb.shell('getprop ro.product.model')).resolves.toBe('SM-S931N\n')
    expect(runner.argsOf(0)).toEqual(['shell', 'getprop ro.product.model'])
  })

  it('serial 이 있으면 -s 를 앞에 붙인다', async () => {
    const runner = new FakeProcessRunner().on('-s R3CY0000002 shell echo hi', { stdout: 'hi\n' })
    const adb = new AdbClient({ adbPath: ADB, runner }).withSerial('R3CY0000002')

    await expect(adb.shell('echo hi')).resolves.toBe('hi\n')
  })

  it('exit code 가 0 이 아니면 AdbCommandError 를 던진다', async () => {
    const runner = new FakeProcessRunner().on('shell boom', { code: 1, stderr: 'nope' })
    const adb = new AdbClient({ adbPath: ADB, runner })

    await expect(adb.shell('boom')).rejects.toBeInstanceOf(AdbCommandError)
  })

  it('측정 창이 열려 있으면 adb 를 실행하지 않고 예외를 던진다', async () => {
    const runner = new FakeProcessRunner().on('shell echo hi', { stdout: 'hi\n' })
    const adb = new AdbClient({ adbPath: ADB, runner })

    adb.window.open()
    await expect(adb.shell('echo hi')).rejects.toBeInstanceOf(MeasurementWindowViolationError)
    expect(runner.calls).toHaveLength(0)
    expect(adb.window.adbCallsWhileOpen).toBe(1)
  })

  it('측정 창을 닫으면 다시 실행된다', async () => {
    const runner = new FakeProcessRunner().on('shell echo hi', { stdout: 'hi\n' })
    const adb = new AdbClient({ adbPath: ADB, runner })

    adb.window.open()
    adb.window.close()
    await expect(adb.shell('echo hi')).resolves.toBe('hi\n')
  })

  it('withSerial 로 파생된 클라이언트가 측정 창을 공유한다', async () => {
    const runner = new FakeProcessRunner().on('-s S1 shell echo hi', { stdout: 'hi\n' })
    const window = new MeasurementWindow()
    const adb = new AdbClient({ adbPath: ADB, runner, window }).withSerial('S1')

    window.open()
    await expect(adb.shell('echo hi')).rejects.toBeInstanceOf(MeasurementWindowViolationError)
  })

  it('execOutBinary 는 Buffer 를 그대로 돌려준다', async () => {
    const bytes = Buffer.from([0x02, 0x00, 0x0c, 0x00])
    const runner = new FakeProcessRunner().on('exec-out unzip -p /x/base.apk resources.arsc', { stdout: bytes })
    const adb = new AdbClient({ adbPath: ADB, runner })

    await expect(adb.execOutBinary('unzip -p /x/base.apk resources.arsc')).resolves.toEqual(bytes)
  })
})
