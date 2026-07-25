import { describe, expect, it } from 'vitest'
import { configLocale, parseStringPool, pickLocalizedValue, resolveResourceStrings } from '../../../src/app/label/arsc.js'
import { ArscParseError } from '../../../src/errors.js'
import { buildArsc, buildConfig, buildStringPool } from '../../support/arscBuilder.js'

const LABEL_RES = 0x7f140047

function sample(): Buffer {
  return buildArsc({
    packageId: 0x7f,
    typeId: 0x14,
    entryCount: 0x0048,
    strings: ['Naver Webtoon', '네이버 웹툰', 'unused'],
    entries: [
      { entryIndex: 0x0047, language: null, stringIndex: 0 },
      { entryIndex: 0x0047, language: 'ko', stringIndex: 1 },
    ],
  })
}

describe('parseStringPool', () => {
  it('UTF-8 문자열을 읽는다', () => {
    const pool = buildStringPool(['hello', '네이버 웹툰', ''])
    expect(parseStringPool(pool, 0)).toEqual(['hello', '네이버 웹툰', ''])
  })

  it('2바이트 varint 길이(128 이상)를 읽는다', () => {
    // '가' 50개 = UTF-16 문자 수 50(1바이트 varint), UTF-8 바이트 수 150(2바이트 varint) —
    // 두 길이가 127 경계의 반대편에 있어 두 varint 를 바꿔 읽는 버그도 잡아낸다.
    const long = '가'.repeat(50)
    expect(Buffer.byteLength(long, 'utf8')).toBeGreaterThan(127)
    expect([...long].length).toBeLessThan(128)

    const pool = buildStringPool([long])
    expect(parseStringPool(pool, 0)).toEqual([long])
  })
})

describe('configLocale', () => {
  it('기본 config 는 로케일이 없다', () => {
    expect(configLocale(buildConfig(null).toString('hex'))).toBeNull()
  })

  it('언어 코드를 읽는다', () => {
    expect(configLocale(buildConfig('ko').toString('hex'))).toBe('ko')
  })

  it('실기기에서 관측된 config 를 해석한다', () => {
    expect(configLocale('40000000000000006b6f0000')).toBe('ko')
    expect(configLocale('400000000000000000000000')).toBeNull()
  })

  it('너무 짧은 config 는 null', () => {
    expect(configLocale('4000')).toBeNull()
  })
})

describe('resolveResourceStrings', () => {
  it('리소스 ID 의 config 변형을 모두 찾는다', () => {
    const found = resolveResourceStrings(sample(), LABEL_RES)
    expect(found.map((f) => f.value)).toEqual(['Naver Webtoon', '네이버 웹툰'])
    expect(found.map((f) => f.locale)).toEqual([null, 'ko'])
  })

  it('다른 패키지 ID 는 무시한다', () => {
    expect(resolveResourceStrings(sample(), 0x7e140047)).toEqual([])
  })

  it('다른 타입 ID 는 무시한다', () => {
    expect(resolveResourceStrings(sample(), 0x7f130047)).toEqual([])
  })

  it('없는 엔트리는 빈 배열', () => {
    expect(resolveResourceStrings(sample(), 0x7f140001)).toEqual([])
  })

  it('arsc 가 아니면 오류를 던진다', () => {
    expect(() => resolveResourceStrings(Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), LABEL_RES)).toThrow(
      ArscParseError,
    )
  })

  it('너무 짧은 버퍼도 오류를 던진다', () => {
    expect(() => resolveResourceStrings(Buffer.alloc(4), LABEL_RES)).toThrow(ArscParseError)
  })

  it('패키지 청크 중간에서 잘린 버퍼도 ArscParseError 를 던진다', () => {
    // 매직/길이 검사를 통과할 만큼은 남기되(첫 12바이트가 아님), 마지막 타입 청크의
    // 엔트리 본문이 잘려 나가도록 끝부분을 자른다 — 원시 RangeError 가 아니라
    // ArscParseError 여야 호출자가 폴백 사슬로 내려갈 수 있다.
    const full = sample()
    const truncated = full.subarray(0, full.length - 30)
    expect(truncated.length).toBeGreaterThan(12)
    expect(() => resolveResourceStrings(truncated, LABEL_RES)).toThrow(ArscParseError)
  })

  it('complex(bag) 엔트리는 문자열로 오해하지 않고 건너뛴다', () => {
    const buf = buildArsc({
      packageId: 0x7f,
      typeId: 0x14,
      entryCount: 0x0048,
      strings: ['Naver Webtoon', '네이버 웹툰', 'unused'],
      entries: [
        // dataType/stringIndex 는 유효한 문자열을 가리키지만, complex 플래그가 서 있으므로
        // FLAG_COMPLEX 를 확인하지 않는 파서라면 그럴듯한 값을 잘못 반환하게 된다.
        { entryIndex: 0x0047, language: null, stringIndex: 0, complex: true },
      ],
    })
    expect(resolveResourceStrings(buf, LABEL_RES)).toEqual([])
  })
})

describe('pickLocalizedValue', () => {
  const candidates = [
    { configHex: '', locale: null, value: 'Naver Webtoon' },
    { configHex: '', locale: 'ko', value: '네이버 웹툰' },
  ]

  it('호스트 언어를 우선한다', () => {
    expect(pickLocalizedValue(candidates, 'ko')).toBe('네이버 웹툰')
  })

  it('호스트 언어가 없으면 기본 config 를 쓴다', () => {
    expect(pickLocalizedValue(candidates, 'fr')).toBe('Naver Webtoon')
  })

  it('기본 config 도 없으면 첫 값을 쓴다', () => {
    expect(pickLocalizedValue([candidates[1]!], 'fr')).toBe('네이버 웹툰')
  })

  it('후보가 없으면 null', () => {
    expect(pickLocalizedValue([], 'ko')).toBeNull()
  })
})
