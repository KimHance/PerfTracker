import { describe, expect, it } from 'vitest'
import { buildWarnings, parseAmStart } from '../../src/session/start.js'

const state = {
  captured_at: '2026-07-25T14:32:10.000Z',
  battery_level: 68,
  battery_temp_c: 34.8,
  charging: true,
  connection: 'usb' as const,
  screen_brightness: 131,
  power_save_mode: false,
  network: 'wifi',
  mem_available_kb: 3511516,
  animator_duration_scale: 1,
  thermal_zones: [],
}

describe('parseAmStart', () => {
  it('TotalTime 과 LaunchState 를 읽는다', () => {
    const text = [
      'Starting: Intent { act=android.intent.action.MAIN }',
      'Status: ok',
      'LaunchState: COLD',
      'Activity: com.foo/.Main',
      'TotalTime: 1842',
      'WaitTime: 1850',
    ].join('\n')

    expect(parseAmStart(text)).toEqual({ totalTimeMs: 1842, launchState: 'COLD' })
  })

  it('없으면 null', () => {
    expect(parseAmStart('Error: Activity not started')).toEqual({ totalTimeMs: null, launchState: null })
  })
})

describe('buildWarnings', () => {
  it('충전 중이면 사실을 기록한다', () => {
    const warnings = buildWarnings(state, { video: false })
    expect(warnings.map((w) => w.code)).toContain('charging_during_session')
  })

  it('비디오 캡처를 켜면 오염 사실을 기록한다', () => {
    expect(buildWarnings({ ...state, charging: false }, { video: true }).map((w) => w.code)).toEqual([
      'video_capture_enabled',
    ])
  })

  it('저전력 모드를 기록한다', () => {
    const warnings = buildWarnings({ ...state, charging: false, power_save_mode: true }, { video: false })
    expect(warnings.map((w) => w.code)).toContain('power_save_mode_on')
  })

  it('평가가 아니라 관측만 담는다', () => {
    for (const w of buildWarnings(state, { video: true })) {
      expect(w.message).not.toMatch(/느림|나쁨|권장|개선/)
    }
  })

  it('아무 조건도 없으면 빈 배열', () => {
    expect(buildWarnings({ ...state, charging: false }, { video: false })).toEqual([])
  })
})
