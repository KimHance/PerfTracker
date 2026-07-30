import { describe, expect, it } from 'vitest'
import { metricChips, unsupportedChips } from '../../src/web/format/metrics.js'

const v = (id: string, ok: boolean, reason = ''): never => ({ id, ok, reason }) as never

describe('metricChips — 칩은 지표가 아니라 "무엇을 잴 수 있나"', () => {
  it('자리는 서버 응답과 무관하게 늘 같다 — 응답이 정하는 것은 ✓/✗ 와 사유뿐이다', () => {
    const chips = metricChips([v('hwui', true), v('cpu', true)])
    expect(chips.map((c) => c.label)).toEqual(['hwui', 'startup', 'cpu', 'memory', 'log', 'thermal', 'network'])
  })

  it('판정을 받은 것만 ✓ 다', () => {
    expect(metricChips([v('hwui', true)])[0]!.ok).toBe(true)
    expect(metricChips([v('hwui', false)])[0]!.ok).toBe(false)
  })

  /** 기기를 고르기 전에는 모른다 — 모르는 것을 "가능" 으로 그리지 않는다. */
  it('판정이 없으면 ✗ 이고 그렇게 말한다', () => {
    const chips = metricChips([])
    expect(chips.every((c) => !c.ok)).toBe(true)
    expect(chips[0]!.reason).toContain('기기를 선택하면')
  })
})

describe('unsupportedChips — 두 곳이 같은 수를 말한다', () => {
  const all = (hwuiOk: boolean, networkOk: boolean): never[] => [
    v('hwui', hwuiOk), v('startup', true), v('cpu', true),
    v('memory', true), v('log', true), v('thermal', true), v('network', networkOk),
  ]

  it('판정받은 것 중 안 되는 것만 센다', () => {
    expect(unsupportedChips(all(true, false)).map((c) => c.label)).toEqual(['network'])
    expect(unsupportedChips(all(false, true)).map((c) => c.label)).toEqual(['hwui'])
  })
})
