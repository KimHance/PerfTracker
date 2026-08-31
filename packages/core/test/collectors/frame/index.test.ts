import { describe, expect, it } from 'vitest'
import { frameCollector } from '../../../src/collectors/frame/index.js'

const env = (sdkInt: number, dataSources: string[] = ['android.surfaceflinger.frametimeline']) =>
  ({ sdkInt, dataSources, packageName: 'com.example' })

describe('frameCollector.supports', () => {
  it('sdk 31 미만은 sdk_too_low 로 말한다', () => {
    const r = frameCollector.supports(env(30, ['android.surfaceflinger.frame']))
    expect(r.supported).toBe(false)
    if (!r.supported) expect(r.reason.code).toBe('sdk_too_low')
  })

  it('sdk 31 이상이면 지원한다', () => {
    expect(frameCollector.supports(env(31)).supported).toBe(true)
  })

  /**
   * **sdk 는 맞는데 데이터소스가 없는 기기가 실제로 있다.** "새 기기인데 이 데이터소스를
   * 등록하지 않았다" 와 "안드로이드가 낮다" 는 서로 다른 사실이다 — 전자를 후자(`sdk_too_low`)
   * 로 말하면 sdk 는 충분한 기기에 대고 "버전을 올리라" 는 거짓 조언을 하는 셈이다.
   * `supports()` 가 sdk 검사 하나로 끝나면 이 갈래가 사라지고 이 테스트만 그것을 잡는다.
   */
  it('sdk 는 충분해도 데이터소스가 없으면 data_source_not_registered 로 말한다', () => {
    const r = frameCollector.supports(env(31, []))
    expect(r.supported).toBe(false)
    if (!r.supported) expect(r.reason.code).toBe('data_source_not_registered')
  })

  /** hwui 와 달리 이쪽은 버전을 탄다. 그 사실을 숨기지 않는다. */
  it('트레이스가 필요하다고 선언한다', () => {
    expect(frameCollector.needsTrace).toBe(true)
  })

  /** 규칙 1 — 측정 창 안에서 기기 접촉 0회. 스냅샷을 선언하지 않는다. */
  it('capture 스냅샷을 선언하지 않는다', () => {
    expect(frameCollector.captureSnapshots).toBeUndefined()
  })
})
