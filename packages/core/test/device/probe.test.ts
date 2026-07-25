import { describe, expect, it } from 'vitest'
import { evaluateDataSources, REQUIRED_DATA_SOURCES, type DeviceProbe } from '../../src/device/probe.js'

function probe(overrides: Partial<DeviceProbe> = {}): DeviceProbe {
  return { hasPerfetto: true, dataSources: [], sdkInt: 34, ...overrides }
}

describe('evaluateDataSources', () => {
  it('필수 데이터소스가 모두 있으면 전부 ok 를 낸다', () => {
    const result = evaluateDataSources(probe({ dataSources: [...REQUIRED_DATA_SOURCES] }))

    expect(result).toHaveLength(REQUIRED_DATA_SOURCES.length)
    expect(result.every((r) => r.ok)).toBe(true)
    expect(result.every((r) => r.reason === null)).toBe(true)
  })

  it('일부만 없으면 그 항목만 ok:false 이고 이유에 sdk_int 가 담긴다', () => {
    const [first, ...rest] = REQUIRED_DATA_SOURCES
    const result = evaluateDataSources(probe({ dataSources: [...rest], sdkInt: 30 }))

    const missing = result.find((r) => r.name === first)
    expect(missing?.ok).toBe(false)
    expect(missing?.reason).toContain('sdk_int=30')

    for (const name of rest) {
      const hit = result.find((r) => r.name === name)
      expect(hit?.ok).toBe(true)
      expect(hit?.reason).toBeNull()
    }
  })

  it('dataSources 가 비어 있으면(perfetto --query 실패) 전부 ok:false 다', () => {
    const result = evaluateDataSources(probe({ dataSources: [], sdkInt: 28 }))

    expect(result).toHaveLength(REQUIRED_DATA_SOURCES.length)
    expect(result.every((r) => !r.ok)).toBe(true)
    expect(result.every((r) => r.reason?.includes('sdk_int=28'))).toBe(true)
  })
})
