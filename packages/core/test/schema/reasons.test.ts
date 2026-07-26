import { describe, expect, it } from 'vitest'
import { POLL_PERIOD_MS } from '../../src/collectors/blocks.js'
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

/**
 * `sdk_too_low` 의 "Android 12" 와 정확히 같은 계열의 하드코딩이 하나 더 있었다:
 * `insufficient_samples` 가 `"폴링 주기(1초)"` 를 문자열로 박아 두고 있었는데,
 * 진실의 출처는 `collectors/blocks.ts` 의 `POLL_PERIOD_MS` 다. 그 값을 바꾸면 이 문장만
 * 조용히 거짓이 된다 — 렌더러가 그것을 읽지 않았기 때문이다.
 */
describe('insufficient_samples 렌더러', () => {
  it('폴링 주기를 문자열로 박지 않고 POLL_PERIOD_MS 를 읽는다', () => {
    const text = renderReason({
      code: 'insufficient_samples',
      detail: { samples: 1, required: 2 },
    })!
    expect(text).toContain(String(POLL_PERIOD_MS))
    // 1000ms 를 "1초" 라고 다시 쓰면 상수를 안 읽고도 통과할 수 있다.
    expect(text).not.toContain('1초')
  })
})

/**
 * M-5. 한 코드가 세 사실을 내는데 사람용 문장이 그중 둘을 같은 말로 뭉치고 있었다.
 * `detail.found` 를 명시했으니 문장도 갈라야 한다 — 갈리지 않으면 `detail` 을 읽지 않는
 * 사람(터미널 요약을 보는 사람이 그렇다)에게는 여전히 같은 말이다.
 */
describe('snapshot_unparsable 렌더러 — 세 갈래', () => {
  const render = (detail: Record<string, unknown>): string =>
    renderReason({ code: 'snapshot_unparsable', detail })!

  it('절 자체가 없으면 "절이 없다" 고 말한다 — 형식이 달랐다고 말하지 않는다', () => {
    const text = render({ key: 'netstats', section: 'mAppUidStatsMap', phase: 'before', found: false })
    expect(text).toContain('절이 없습니다')
    // 그 안드로이드 버전에 아예 없을 수 있다는 것이 소비자가 알아야 할 대응 정보다.
    expect(text).toMatch(/안드로이드 버전|벤더/)
    // 읽은 줄이 없는데 있는 척하지 않는다.
    expect(text).not.toContain('읽은 줄')
  })

  it('머리글이 다르면 읽은 줄을 그대로 인용한다', () => {
    const text = render({
      key: 'netstats',
      section: 'mAppUidStatsMap',
      phase: 'before',
      found: true,
      header: 'uid rxPackets rxBytes txPackets txBytes',
    })
    expect(text).toContain('읽은 줄')
    expect(text).toContain('uid rxPackets rxBytes txPackets txBytes')
    expect(text).not.toContain('절이 없습니다')
  })

  it('머리는 맞고 행이 0개면 원인을 단정하지 않는다', () => {
    const text = render({
      key: 'netstats',
      section: 'mAppUidStatsMap',
      phase: 'before',
      found: true,
      header: 'uid rxBytes rxPackets txBytes txPackets',
      rows: 0,
      first_line: '    uid=10388 rxBytes=1200000',
    })
    expect(text).toMatch(/구분하지 못합니다/)
    expect(text).toContain('uid=10388 rxBytes=1200000')
    expect(text).not.toContain('절이 없습니다')
  })

  /** 세 문장이 서로 달라야 한다 — 같으면 `found` 를 detail 에만 싣고 말은 안 한 것이다. */
  it('세 갈래의 문장이 서로 다르다', () => {
    const base = { key: 'netstats', section: 'mAppUidStatsMap', phase: 'before' }
    const texts = [
      render({ ...base, found: false }),
      render({ ...base, found: true, header: 'x y z' }),
      render({ ...base, found: true, header: 'uid rxBytes rxPackets txBytes txPackets', rows: 0 }),
    ]
    expect(new Set(texts).size).toBe(3)
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
