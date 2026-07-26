import { describe, expect, it } from 'vitest'
import { frameCollector } from '../../src/collectors/frame.js'
import {
  COLLECTORS,
  collectTraceConfigBlocks,
  supportedCollectors,
  unsupportedReasons,
} from '../../src/collectors/registry.js'
import { startupCollector } from '../../src/collectors/startup.js'
import { buildTraceConfig } from '../../src/perfetto/config.js'

const OK = {
  sdkInt: 36,
  dataSources: ['android.surfaceflinger.frametimeline', 'linux.sys_stats', 'linux.ftrace'],
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
})

describe('collectTraceConfigBlocks', () => {
  it('지원되는 collector 의 블록만 모은다', () => {
    expect(collectTraceConfigBlocks(OK)).toEqual(
      expect.arrayContaining(frameCollector.traceConfigBlocks()),
    )
    // startup 은 지원되지만 블록을 하나도 안 낸다 — 구형 기기에서는 config 가 빈다.
    expect(collectTraceConfigBlocks(OLD)).toEqual([])
  })

  it('모은 블록은 저부하 불변식을 통과한다', () => {
    expect(() => buildTraceConfig({ dataSourceBlocks: collectTraceConfigBlocks(OK) })).not.toThrow()
  })

  it('중복 데이터소스를 접는다 — 두 collector 가 같은 것을 요구해도 블록은 한 번만 나간다', () => {
    // 오늘은 collector 가 하나지만, 규칙은 지금 고정한다.
    const doubled = [...frameCollector.traceConfigBlocks(), ...frameCollector.traceConfigBlocks()]
    const config = buildTraceConfig({
      dataSourceBlocks: [...new Set(doubled)],
    })
    expect(config.split('linux.process_stats').length - 1).toBe(1)
  })
})

describe('supportedCollectors / unsupportedReasons', () => {
  it('지원 여부로 거른다', () => {
    expect(supportedCollectors(OK)).toHaveLength(COLLECTORS.length)
    // startup 은 어디서나 지원된다 — 구형 기기에서도 목록이 비지 않는다.
    expect(supportedCollectors(OLD)).toEqual([startupCollector])
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
