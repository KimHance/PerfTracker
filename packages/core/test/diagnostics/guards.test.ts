import { describe, expect, it } from 'vitest'
import { listDeviceSummaries } from '../../src/diagnostics/devices.js'
import {
  type DoctorCheck,
  hasBlockingFailure,
  metricSupportChecks,
  runDoctor,
} from '../../src/diagnostics/doctor.js'
import { COLLECTORS } from '../../src/collectors/registry.js'
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

describe('metricSupportChecks — 기기가 못 재는 지표를 미리 말한다', () => {
  const A11 = { sdkInt: 30, dataSources: ['linux.process_stats', 'linux.sys_stats', 'android.log'] }
  const A16 = {
    sdkInt: 36,
    dataSources: [
      'android.surfaceflinger.frametimeline',
      'linux.process_stats',
      'linux.sys_stats',
      'android.log',
    ],
  }

  /**
   * **실측(SM-A405S / Android 11).** 예전에는 이것을 `stop` 뒤 result.json 을 열어야 알았다 —
   * 사람이 30초 조작하고 나서야 "프레임이 없다" 를 아는 것은 측정을 한 번 더 하게 만든다.
   */
  it('Android 11 에서 frame·network 를 못 잰다고 말한다', () => {
    const byId = new Map(metricSupportChecks(A11).map((c) => [c.name, c]))

    expect(byId.get('metric: frame')?.ok).toBe(false)
    expect(byId.get('metric: network')?.ok).toBe(false)
    // 나머지 다섯은 이 기기에서도 나온다 — "이 폰은 아무것도 못 잰다" 가 아니다.
    for (const id of ['startup', 'cpu', 'memory', 'log', 'thermal']) {
      expect(byId.get(`metric: ${id}`)?.ok, id).toBe(true)
    }
  })

  it('사유가 최소 sdk 를 숫자로 말한다 — 데이터소스 이름만으로는 뭘 못 재는지 모른다', () => {
    const frame = metricSupportChecks(A11).find((c) => c.name === 'metric: frame')

    expect(frame?.detail).toContain('sdk_int=30')
    expect(frame?.detail).toContain('31')
  })

  it('전부 지원되는 기기에서는 모두 ok 다', () => {
    expect(metricSupportChecks(A16).every((c) => c.ok)).toBe(true)
  })

  /**
   * **판정의 출처는 하나여야 한다.** doctor 가 따로 판단하면 여기서 "된다" 고 한 것이
   * 실제 측정에서 안 되는 상태가 생긴다.
   */
  it('collector 의 supports() 와 결과가 일치한다', () => {
    for (const c of COLLECTORS) {
      const check = metricSupportChecks(A11).find((x) => x.name === `metric: ${c.id}`)
      expect(check?.ok, c.id).toBe(c.supports(A11).supported)
    }
  })
})

describe('hasBlockingFailure — 고칠 수 있는 것만 실패로 센다', () => {
  /**
   * "Android 11 이라 프레임을 못 잰다" 는 **고칠 수 없는 사실**이다. 그것을 환경 오류로
   * 내보내면 CI 가 멀쩡한 기기를 불합격으로 잡는다. 화면에는 ✗ 로 보이되 종료 코드는 0 이다.
   */
  it('capability 실패는 종료 코드를 바꾸지 않는다', () => {
    const checks: DoctorCheck[] = [
      { name: 'adb', ok: true, kind: 'requirement', detail: '' },
      { name: 'metric: frame', ok: false, kind: 'capability', detail: '' },
    ]

    expect(hasBlockingFailure(checks)).toBe(false)
  })

  it('requirement 실패는 종료 코드를 바꾼다', () => {
    const checks: DoctorCheck[] = [
      { name: 'adb', ok: false, kind: 'requirement', detail: 'adb 를 찾지 못했습니다' },
      { name: 'metric: frame', ok: true, kind: 'capability', detail: '' },
    ]

    expect(hasBlockingFailure(checks)).toBe(true)
  })
})
