import { describe, expect, it } from 'vitest'
import { formatLocalTimestamp, runDirName, slugifySessionName } from '../../src/session/paths.js'

describe('slugifySessionName', () => {
  it('공백을 하이픈으로 바꾸고 한글은 보존한다', () => {
    expect(slugifySessionName('홈 스크롤')).toBe('홈-스크롤')
  })

  it('경로 구분자와 제어문자를 제거한다', () => {
    expect(slugifySessionName('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij')
    expect(slugifySessionName('탭\t줄바꿈\n')).toBe('탭줄바꿈')
  })

  it('연속 공백을 하나의 하이픈으로 접는다', () => {
    expect(slugifySessionName('a   b')).toBe('a-b')
  })

  it('앞뒤 하이픈과 점을 제거한다', () => {
    expect(slugifySessionName('  ..name-- ')).toBe('name')
  })

  it('60자를 넘으면 자른다', () => {
    expect(slugifySessionName('가'.repeat(100))).toHaveLength(60)
  })

  it('60자는 코드유닛이 아니라 코드포인트 기준으로 센다', () => {
    const result = slugifySessionName('🙂'.repeat(100))
    expect([...result].length).toBe(60)
  })

  it('자른 위치가 하이픈/점이면 한 번 더 제거한다', () => {
    const result = slugifySessionName('a'.repeat(59) + ' ' + 'b')
    expect(result).toBe('a'.repeat(59))
    expect(result.endsWith('-')).toBe(false)
    expect(result.endsWith('.')).toBe(false)
  })

  it('결과가 비면 session 으로 대체한다', () => {
    expect(slugifySessionName('///')).toBe('session')
    expect(slugifySessionName('   ')).toBe('session')
  })
})

describe('formatLocalTimestamp', () => {
  it('로컬 시각을 파일명 안전한 형태로 만든다', () => {
    expect(formatLocalTimestamp(new Date(2026, 6, 25, 14, 32, 10))).toBe('2026-07-25T14-32-10')
  })
})

describe('runDirName', () => {
  it('타임스탬프와 슬러그를 결합한다', () => {
    expect(runDirName(new Date(2026, 6, 25, 14, 32, 10), '홈 스크롤')).toBe('2026-07-25T14-32-10_홈-스크롤')
  })
})
