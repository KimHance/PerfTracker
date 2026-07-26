import { describe, expect, it } from 'vitest'
import { bytesToKb, round } from '../../src/collectors/num.js'

describe('round', () => {
  it('자리수를 지켜 반올림한다', () => {
    expect(round(1 / 3, 2)).toBe(0.33)
    expect(round(0.1 + 0.2, 4)).toBe(0.3)
  })

  it('음수도 같은 규칙으로 다룬다', () => {
    expect(round(-1.005, 2)).toBe(-1)
  })
})

describe('bytesToKb', () => {
  it('1024 로 나누고 정수로 만든다 — 카운터 값은 바이트로 온다', () => {
    expect(bytesToKb(2_070_597_632)).toBe(2_022_068)
    expect(bytesToKb(0)).toBe(0)
  })
})
