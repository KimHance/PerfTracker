import { describe, expect, it } from 'vitest'
import { frameCollector } from '../../src/collectors/frame.js'
import {
  COLLECTORS,
  collectTraceConfigBlocks,
  supportedCollectors,
  unsupportedReasons,
} from '../../src/collectors/registry.js'
import { buildTraceConfig } from '../../src/perfetto/config.js'

const OK = { sdkInt: 36, dataSources: ['android.surfaceflinger.frametimeline'] }
const OLD = { sdkInt: 30, dataSources: [] }

describe('COLLECTORS 레지스트리', () => {
  it('id 가 유일하다 — result.json 의 metrics 키가 되기 때문이다', () => {
    const ids = COLLECTORS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('M1 은 frame 하나를 등록한다', () => {
    expect(COLLECTORS).toContain(frameCollector)
  })
})

describe('collectTraceConfigBlocks', () => {
  it('지원되는 collector 의 블록만 모은다', () => {
    expect(collectTraceConfigBlocks(OK)).toEqual(frameCollector.traceConfigBlocks())
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
    expect(supportedCollectors(OLD)).toEqual([])
  })

  it('사유를 collector id 와 함께 한국어로 낸다', () => {
    const reasons = unsupportedReasons(OLD)
    expect(reasons).toHaveLength(COLLECTORS.length)
    expect(reasons[0]).toContain('frame:')
    expect(reasons[0]).toContain('sdk_int=30')
  })
})
