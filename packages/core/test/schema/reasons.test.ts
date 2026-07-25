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
