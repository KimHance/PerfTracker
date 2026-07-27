import { describe, expect, it } from 'vitest'
import { frameCollector } from '../../src/collectors/frame/index.js'
import { networkCollector } from '../../src/collectors/network/index.js'
import {
  COLLECTORS,
  collectSnapshotSpecs,
  collectTraceConfigBlocks,
  supportedCollectors,
  unsupportedReasons,
} from '../../src/collectors/registry.js'
import { startupCollector } from '../../src/collectors/startup.js'
import { thermalCollector } from '../../src/collectors/thermal/index.js'
import { buildTraceConfig } from '../../src/perfetto/config.js'

const OK = {
  sdkInt: 36,
  dataSources: [
    'android.surfaceflinger.frametimeline',
    'linux.process_stats',
    'linux.sys_stats',
    'linux.ftrace',
    'android.log',
  ],
}
const OLD = { sdkInt: 30, dataSources: [] }

describe('COLLECTORS 레지스트리', () => {
  it('id 가 유일하다 — result.json 의 metrics 키가 되기 때문이다', () => {
    const ids = COLLECTORS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('frame 과 startup 이 등록되어 있다', () => {
    expect(COLLECTORS).toContain(frameCollector)
    expect(COLLECTORS).toContain(startupCollector)
  })

  it('thermal 과 network 가 등록되어 있다 — 배열에 없으면 extract 가 아예 부르지 않는다', () => {
    expect(COLLECTORS).toContain(thermalCollector)
    expect(COLLECTORS).toContain(networkCollector)
  })
})

describe('collectTraceConfigBlocks', () => {
  it('지원되는 collector 의 블록만 모은다', () => {
    expect(collectTraceConfigBlocks(OK)).toEqual(
      expect.arrayContaining(frameCollector.traceConfigBlocks({ sdkInt: 36, dataSources: [] })),
    )
    // startup 은 지원되지만 블록을 하나도 안 낸다 — 구형 기기에서는 config 가 빈다.
    expect(collectTraceConfigBlocks(OLD)).toEqual([])
  })

  it('모은 블록은 저부하 불변식을 통과한다', () => {
    expect(() => buildTraceConfig({ dataSourceBlocks: collectTraceConfigBlocks(OK) })).not.toThrow()
  })

  it('중복 데이터소스를 접는다 — 두 collector 가 같은 것을 요구해도 블록은 한 번만 나간다', () => {
    // 오늘은 collector 가 하나지만, 규칙은 지금 고정한다.
    const doubled = [...frameCollector.traceConfigBlocks({ sdkInt: 36, dataSources: [] }), ...frameCollector.traceConfigBlocks({ sdkInt: 36, dataSources: [] })]
    const config = buildTraceConfig({
      dataSourceBlocks: [...new Set(doubled)],
    })
    expect(config.split('linux.process_stats').length - 1).toBe(1)
  })

  it('두 collector 가 요구하는 linux.process_stats 가 한 번만 나간다', () => {
    const config = buildTraceConfig({ dataSourceBlocks: collectTraceConfigBlocks(OK) })
    expect(config.split('name: "linux.process_stats"').length - 1).toBe(1)
    expect(config.split('name: "linux.sys_stats"').length - 1).toBe(1)
  })

  /**
   * D9. M3 는 데이터소스도 ftrace 이벤트도 늘리지 않는다. 이 단언이 깨진다는 것은
   * 누가 새 데이터소스를 켰다는 뜻이고, 그때 "그것을 읽는 collector 가 어디 있나" 라는
   * 질문이 반드시 따라와야 한다. 개수가 아니라 **이름 집합**으로 고정하는 이유는,
   * 개수만 세면 하나가 늘고 하나가 사라진 경우를 못 잡기 때문이다.
   */
  it('M3 collector 들이 TraceConfig 를 한 블록도 늘리지 않는다', () => {
    const names = collectTraceConfigBlocks(OK).map((b) => /name:\s*"([^"]+)"/.exec(b)?.[1])
    expect(new Set(names)).toEqual(
      new Set([
        'android.surfaceflinger.frametimeline',
        'linux.process_stats',
        'linux.sys_stats',
        'linux.ftrace',
        'android.log',
      ]),
    )
    expect(() =>
      buildTraceConfig({ dataSourceBlocks: collectTraceConfigBlocks(OK) }),
    ).not.toThrow()
  })
})

describe('supportedCollectors / unsupportedReasons', () => {
  it('지원 여부로 거른다', () => {
    expect(supportedCollectors(OK)).toHaveLength(COLLECTORS.length)
    // startup 은 어디서나 지원된다 — 구형 기기에서도 목록이 비지 않는다.
    // thermal 은 sdk 29 하한이라 sdk 30 인 이 기기에서도 지원된다.
    expect(supportedCollectors(OLD)).toEqual([startupCollector, thermalCollector])
  })

  it('sdk 28 기기에서는 thermal 이 미지원이고 사유가 Android 10 을 말한다', () => {
    const reasons = unsupportedReasons({ sdkInt: 28, dataSources: [] })
    expect(reasons.find((r) => r.startsWith('thermal:'))).toContain('Android 10')
  })

  it('sdk 29 기기에서 thermal 은 지원된다 — frame(31)이 안 되는 기기에서도', () => {
    const ids = supportedCollectors({ sdkInt: 29, dataSources: [] }).map((c) => c.id)
    expect(ids).toContain('thermal')
    expect(ids).not.toContain('frame')
  })

  it('sdk 33 기기에서 network 는 미지원이고 thermal 은 지원된다', () => {
    const env = { sdkInt: 33, dataSources: [] }
    const ids = supportedCollectors(env).map((c) => c.id)
    expect(ids).toContain('thermal')
    expect(ids).not.toContain('network')
    expect(unsupportedReasons(env).find((r) => r.startsWith('network:'))).toContain('Android 14')
  })

  it('미지원 항목만 사유와 함께 한국어로 낸다', () => {
    const reasons = unsupportedReasons(OLD)
    expect(reasons.length).toBe(COLLECTORS.length - supportedCollectors(OLD).length)
    expect(reasons.some((r) => r.startsWith('frame:'))).toBe(true)
    expect(reasons.join('\n')).toContain('sdk_int=30')
    // 지원되는 항목은 "알 수 없음" 같은 잡음으로 목록을 채우지 않는다.
    expect(reasons.some((r) => r.startsWith('startup:'))).toBe(false)
  })

  it('전부 지원되면 사유가 하나도 없다', () => {
    expect(unsupportedReasons(OK)).toEqual([])
  })
})

describe('collectSnapshotSpecs', () => {
  /**
   * G4. 미지원 기기에 명령이 나가면 원칙 1 의 취지가 무너진다 —
   * 읽지 않을 데이터를 위해 기기를 건드리는 것이기 때문이다.
   */
  it('network 가 미지원인 기기에는 그 스냅샷 명령이 하나도 나가지 않는다', () => {
    expect(collectSnapshotSpecs({ sdkInt: 33, dataSources: [] })).toEqual([])
    expect(collectSnapshotSpecs({ sdkInt: 34, dataSources: [] }).map((s) => s.key)).toEqual([
      'netstats',
      'packages',
    ])
  })

  /**
   * D3. `dumpsys thermalservice` 는 `collectDeviceState()` 가 이미 찍는다. thermal collector 가
   * 그것을 다시 선언하면 같은 명령이 세션당 두 번 나가고, `mergeSnapshotSpecs` 가 던진다.
   */
  it('thermal 은 스냅샷을 하나도 선언하지 않는다 — 원문은 이미 찍히고 있다', () => {
    expect(collectSnapshotSpecs({ sdkInt: 33, dataSources: [] })).toEqual([])
    expect(collectSnapshotSpecs(OK).map((s) => s.key)).not.toContain('thermalservice')
  })
})
