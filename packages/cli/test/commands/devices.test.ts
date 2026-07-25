import type { DeviceSummary } from '@perftracker/core'
import { describe, expect, it } from 'vitest'
import { formatDevices } from '../../src/commands/devices.js'

function summary(overrides: Partial<DeviceSummary> = {}): DeviceSummary {
  return {
    serial: 'R5CT0000001',
    state: 'device',
    model: 'SM_S901N',
    spec: {
      manufacturer: 'samsung',
      model: 'SM-S901N',
      android_release: '16',
      sdk_int: 36,
      build_fingerprint: 'x',
      abis: ['arm64-v8a'],
      soc_model: 'SM8450',
      soc_manufacturer: 'QTI',
      cpu: { core_count: 8, clusters: [] },
      memory_total_kb: 7_812_345,
      display: {
        width_px: 1080,
        height_px: 2340,
        density_dpi: 420,
        active_refresh_rate_hz: 120,
        supported_refresh_rates_hz: [60, 120],
      },
    },
    measurementInProgress: false,
    ...overrides,
  }
}

describe('formatDevices', () => {
  it('기기가 없으면 안내 문구', () => {
    expect(formatDevices([])).toContain('연결된 기기가 없습니다')
  })

  it('스펙 요약을 한 줄로 보여준다', () => {
    const out = formatDevices([summary()])
    expect(out).toContain('SM-S901N')
    expect(out).toContain('SDK 36')
    expect(out).toContain('@120Hz')
  })

  it('측정 중인 기기는 스펙 대신 진행 중임을 알린다', () => {
    const out = formatDevices([summary({ spec: null, measurementInProgress: true })])
    expect(out).toContain('측정 세션 진행 중')
    expect(out).not.toContain('SDK')
  })

  it('쓸 수 없는 상태는 상태만 보여준다', () => {
    const out = formatDevices([summary({ state: 'unauthorized', spec: null })])
    expect(out).toContain('[unauthorized]')
  })
})
