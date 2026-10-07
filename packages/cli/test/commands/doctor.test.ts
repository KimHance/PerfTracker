import { diagnoseDoctorCheck, hasBlockingFailure } from '@perftracker/core'
import { describe, expect, it } from 'vitest'
import { formatDoctor } from '../../src/commands/doctor.js'
import { displayWidth } from '../../src/commands/runs.js'

describe('formatDoctor', () => {
  it('통과 항목과 실패 항목을 다른 기호로 표시한다', () => {
    const out = formatDoctor([
      { name: 'adb', ok: true, kind: 'requirement' as const, detail: '/sdk/platform-tools/adb (default-sdk)' },
      { name: 'device', ok: false, kind: 'requirement' as const, detail: '연결된 기기 없음' },
    ])

    expect(out).toContain('✓ adb')
    expect(out).toContain('✗ device')
    expect(out).toContain('연결된 기기 없음')
  })

  it('모두 통과하면 실패 표시가 없다', () => {
    expect(formatDoctor([{ name: 'adb', ok: true, kind: 'requirement' as const, detail: 'ok' }])).not.toContain('✗')
  })
})

/**
 * 진단 세션의 앱 slice 가 이 기기에서 열리는지 — 줄을 만드는 것도 판정도 core 다
 * (`diagnoseDoctorCheck` → `appSliceOpen`). cli 는 다른 줄과 같은 모양으로 찍고 종료 코드를 정한다.
 */
describe('DM-10 doctor 진단 줄', () => {
  it('DM-10 doctor 진단 줄 — sdk ≥31 이면 ✓ · 열림', () => {
    expect(formatDoctor([diagnoseDoctorCheck(36)])).toBe(
      `✓ ${'diagnose: app slice'.padEnd(38)} sdk 36 · 열림`,
    )
  })

  it('DM-10 doctor 진단 줄 — sdk ≤30 이면 ✗ · debuggable 앱만 열림', () => {
    expect(formatDoctor([diagnoseDoctorCheck(30)])).toBe(
      `✗ ${'diagnose: app slice'.padEnd(38)} sdk 30 · debuggable 앱만 열림`,
    )
  })

  it('DM-10 doctor 진단 줄 — ✗ 여도 capability 라 doctor 의 종료 코드는 0 이다', () => {
    const check = diagnoseDoctorCheck(30)

    expect(check.kind).toBe('capability')
    // program.ts 의 doctor 는 이것이 true 일 때만 exitCode 1 을 단다.
    expect(hasBlockingFailure([check])).toBe(false)
  })

  it('DM-10 doctor 진단 줄 — 두 갈래 모두 80칸 안', () => {
    for (const sdk of [36, 30]) {
      expect(displayWidth(formatDoctor([diagnoseDoctorCheck(sdk)]))).toBeLessThanOrEqual(80)
    }
  })
})
