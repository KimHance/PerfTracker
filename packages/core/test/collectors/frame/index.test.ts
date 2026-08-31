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

  /** hwui 와 달리 이쪽은 버전을 탄다. 그 사실을 숨기지 않는다. */
  it('트레이스가 필요하다고 선언한다', () => {
    expect(frameCollector.needsTrace).toBe(true)
  })

  /** 규칙 1 — 측정 창 안에서 기기 접촉 0회. 스냅샷을 선언하지 않는다. */
  it('capture 스냅샷을 선언하지 않는다', () => {
    expect(frameCollector.captureSnapshots).toBeUndefined()
  })
})
