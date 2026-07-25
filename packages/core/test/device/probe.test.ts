import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AdbClient } from '../../src/adb/client.js'
import {
  evaluateDataSources,
  probeDevice,
  REQUIRED_DATA_SOURCES,
  type DeviceProbe,
} from '../../src/device/probe.js'
import { FakeProcessRunner } from '../support/fakeProcessRunner.js'

/** 실기기(Galaxy S22 / Android 16)에서 그대로 뜬 `perfetto --query` 출력. */
const QUERY = readFileSync(fileURLToPath(new URL('../fixtures/perfetto-query.txt', import.meta.url)), 'utf8')

function probe(overrides: Partial<DeviceProbe> = {}): DeviceProbe {
  return { hasPerfetto: true, dataSources: [], sdkInt: 34, ...overrides }
}

function device(overrides: (r: FakeProcessRunner) => void = () => {}): AdbClient {
  const runner = new FakeProcessRunner()
    .on('shell which perfetto', { stdout: '/system/bin/perfetto\n' })
    .on('shell perfetto --query', { stdout: QUERY })
    .on('shell getprop ro.build.version.sdk', { stdout: '36\n' })
  overrides(runner)
  return new AdbClient({ adbPath: '/fake/adb', runner })
}

describe('probeDevice — 실기기 출력 파싱', () => {
  it('DATA SOURCES 표에서 데이터소스 이름만 뽑는다', async () => {
    const result = await probeDevice(device())

    expect(result.hasPerfetto).toBe(true)
    expect(result.sdkInt).toBe(36)
    for (const name of REQUIRED_DATA_SOURCES) expect(result.dataSources).toContain(name)
  })

  it('프로듀서 프로세스 표와 헤더를 데이터소스로 오해하지 않는다', async () => {
    const { dataSources } = await probeDevice(device())

    // PRODUCER PROCESSES 표의 이름들(traced / perfetto.traced_probes)은 둘째 열이라 잡히면 안 된다.
    expect(dataSources).not.toContain('traced')
    expect(dataSources).not.toContain('NAME')
    expect(dataSources).not.toContain('===')
    // 하이픈이 들어간 cronet-* 프로듀서 이름도 마찬가지다.
    expect(dataSources.some((n) => n.startsWith('cronet'))).toBe(false)
  })

  it('중복 등록된 데이터소스를 한 번만 센다', async () => {
    const { dataSources } = await probeDevice(device())

    // android.inputmethod 는 7개 프로세스가 등록했지만 이름은 하나다.
    expect(dataSources.filter((n) => n === 'android.inputmethod')).toHaveLength(1)
    expect([...dataSources].sort()).toEqual(dataSources)
  })

  it('perfetto --query 가 실패하면 데이터소스를 비운다 — 추측하지 않는다', async () => {
    const { dataSources } = await probeDevice(
      device((r) => r.on('shell perfetto --query', { code: 1, stderr: 'not found' })),
    )

    expect(dataSources).toEqual([])
  })

  it('which perfetto 가 빈 결과면 perfetto 없음으로 본다', async () => {
    const result = await probeDevice(device((r) => r.on('shell which perfetto', { stdout: '\n' })))

    expect(result.hasPerfetto).toBe(false)
  })

  it('sdk 를 못 읽으면 0 이다', async () => {
    const result = await probeDevice(
      device((r) => r.on('shell getprop ro.build.version.sdk', { stdout: '' })),
    )

    expect(result.sdkInt).toBe(0)
  })
})

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
