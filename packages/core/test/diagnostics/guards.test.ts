import { describe, expect, it } from 'vitest'
import { listDeviceSummaries } from '../../src/diagnostics/devices.js'
import { runDoctor } from '../../src/diagnostics/doctor.js'
import { startSession } from '../../src/session/start.js'
import { clientFor, SERIAL, startableDevice, targetApp, tempDirs } from '../support/fakeDevice.js'
import { FakeProcessRunner } from '../support/fakeProcessRunner.js'

const NOW = new Date('2026-07-25T14:32:10.000Z')
const DEVICES_LINE = `List of devices attached\n${SERIAL}\tdevice usb:0-1 model:SM_S901N\n`

async function withActiveSession(): Promise<string> {
  const { home, out } = tempDirs()
  await startSession({ adb: clientFor(startableDevice()), serial: SERIAL }, targetApp(), {
    launch: false,
    video: false,
    outDir: out,
    force: false,
    now: NOW,
    home,
  })
  return home
}

function runner(): FakeProcessRunner {
  return new FakeProcessRunner()
    .on('devices -l', { stdout: DEVICES_LINE })
    .on('version', { stdout: 'Android Debug Bridge version 1.0.41\n' })
    .on(`-s ${SERIAL} shell which perfetto`, { stdout: '/system/bin/perfetto\n' })
    .on(`-s ${SERIAL} shell wm size`, { stdout: 'Physical size: 1080x2340\n' })
}

/**
 * doctor 와 devices 도 기기를 만진다. 측정 중에 그것들이 그냥 도는 것은 규칙 1 위반이다 —
 * 진단이 진단 대상을 바꾼다.
 */
describe('진단 명령은 측정 중인 기기를 건드리지 않는다', () => {
  it('doctor 가 프로브를 건너뛰고 그 사실을 항목으로 남긴다', async () => {
    const home = await withActiveSession()
    const r = runner()

    const checks = await runDoctor({ adb: process.execPath, runner: r, home })

    expect(checks.map((c) => c.name)).toContain('measurement window')
    expect(checks.every((c) => c.ok)).toBe(true)
    expect(r.commands.some((c) => c.includes('perfetto --query'))).toBe(false)
    expect(checks.some((c) => c.name.startsWith('data source'))).toBe(false)
  })

  it('세션이 없으면 doctor 가 평소대로 프로브한다', async () => {
    const { home } = tempDirs()
    const r = runner()

    const checks = await runDoctor({ adb: process.execPath, runner: r, home })

    expect(checks.map((c) => c.name)).not.toContain('measurement window')
    expect(r.commands.some((c) => c.includes('perfetto --query'))).toBe(true)
  })

  it('devices 가 측정 중인 기기의 스펙을 조회하지 않는다', async () => {
    const home = await withActiveSession()
    const r = runner()

    const summaries = await listDeviceSummaries({ adb: process.execPath, runner: r, home })

    expect(summaries).toHaveLength(1)
    expect(summaries[0]?.measurementInProgress).toBe(true)
    expect(summaries[0]?.spec).toBeNull()
    expect(r.commands).toEqual(['devices -l'])
  })

  it('세션이 없으면 devices 가 스펙을 모은다', async () => {
    const { home } = tempDirs()
    const r = runner()

    const summaries = await listDeviceSummaries({ adb: process.execPath, runner: r, home })

    expect(summaries[0]?.measurementInProgress).toBe(false)
    expect(summaries[0]?.spec?.display.width_px).toBe(1080)
  })
})
