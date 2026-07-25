import { describe, expect, it } from 'vitest'
import { shellQuote } from '../../src/adb/shell.js'

describe('shellQuote', () => {
  it('평범한 값을 작은따옴표로 감싼다', () => {
    expect(shellQuote('com.nhn.android.webtoon')).toBe("'com.nhn.android.webtoon'")
  })

  it('공백과 셸 메타문자를 중화한다', () => {
    expect(shellQuote('a b; rm -rf /')).toBe("'a b; rm -rf /'")
    expect(shellQuote('$(whoami)')).toBe("'$(whoami)'")
  })

  it('작은따옴표를 탈출시킨다', () => {
    // POSIX 규칙: 작은따옴표 안에서는 ' 만 특별하다 → '\'' 로 끊었다 붙인다.
    expect(shellQuote("it's")).toBe("'it'\\''s'")
  })

  it('빈 문자열도 빈 인자 하나로 남는다', () => {
    expect(shellQuote('')).toBe("''")
  })
})
