import { describe, expect, it } from 'vitest'
import { METRIC_REASON_CODES, type MetricReason, renderReason } from '../../src/schema/reasons.js'

describe('renderReason', () => {
  it('모든 코드에 사람이 읽는 문장이 있다', () => {
    for (const code of METRIC_REASON_CODES) {
      const rendered = renderReason({ code } as MetricReason)
      expect(rendered, code).not.toBeNull()
      expect(rendered, code).not.toBe(code)
    }
  })

  it('사유가 없으면 null 이다', () => {
    expect(renderReason(null)).toBeNull()
  })

  it('detail 을 문장에 녹인다', () => {
    expect(renderReason({ code: 'sdk_too_low', detail: { sdk_int: 30, min_sdk: 31 } })).toContain(
      'sdk_int=30',
    )
    expect(
      renderReason({ code: 'query_failed', detail: { message: 'no such table: x' } }),
    ).toContain('no such table: x')
  })

  it('모르는 코드는 조용히 비우지 않고 코드를 그대로 남긴다', () => {
    expect(renderReason({ code: 'not_a_real_code' } as unknown as MetricReason)).toBe('not_a_real_code')
  })

  it('메시지는 한국어이고 판정을 담지 않는다', () => {
    for (const code of METRIC_REASON_CODES) {
      const rendered = renderReason({ code } as MetricReason)!
      expect(rendered, code).toMatch(/[가-힣]/)
      expect(rendered, code).not.toMatch(/느림|나쁨|권장|개선|PASS|FAIL/)
    }
  })
})

describe('sdk_too_low 렌더러', () => {
  /**
   * 이 테스트가 존재하는 이유: 옛 렌더러는 "Android 12" 를 하드코딩했다. 하한이 29 인
   * collector(thermal)가 생기는 순간 그 문장은 거짓이 된다.
   */
  it('하한에 맞는 안드로이드 릴리즈를 말한다 — 12 를 하드코딩하지 않는다', () => {
    const text = renderReason({ code: 'sdk_too_low', detail: { sdk_int: 28, min_sdk: 29 } })
    expect(text).toContain('Android 10')
    expect(text).not.toContain('Android 12')
    expect(text).toContain('29')
    expect(text).toContain('28')
  })

  it('sdk 34 하한(Network)은 Android 14 라고 말한다', () => {
    expect(renderReason({ code: 'sdk_too_low', detail: { sdk_int: 33, min_sdk: 34 } })).toContain(
      'Android 14',
    )
  })

  it('sdk 31 하한(Frame)은 그대로 Android 12 다 — 기존 동작이 죽지 않았다', () => {
    expect(renderReason({ code: 'sdk_too_low', detail: { sdk_int: 30, min_sdk: 31 } })).toContain(
      'Android 12',
    )
  })

  it('표에 없는 하한은 릴리즈 이름을 지어내지 않고 숫자만 말한다', () => {
    const text = renderReason({ code: 'sdk_too_low', detail: { sdk_int: 36, min_sdk: 99 } })
    expect(text).toContain('99')
    expect(text).not.toMatch(/Android \d/)
  })
})
