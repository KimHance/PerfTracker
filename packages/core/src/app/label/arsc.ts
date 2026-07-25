import { ArscParseError } from '../../errors.js'

const RES_TABLE_TYPE = 0x0002
const RES_TABLE_PACKAGE_TYPE = 0x0200
const RES_TABLE_TYPE_TYPE = 0x0201
const UTF8_FLAG = 0x100
const TYPE_STRING = 0x03
const NO_ENTRY = 0xffffffff

export interface ResolvedResourceString {
  configHex: string
  locale: string | null
  value: string
}

function readVarLen8(buf: Buffer, p: number): { len: number; next: number } {
  const b0 = buf[p]!
  if (b0 & 0x80) return { len: ((b0 & 0x7f) << 8) | buf[p + 1]!, next: p + 2 }
  return { len: b0, next: p + 1 }
}

function readVarLen16(buf: Buffer, p: number): { len: number; next: number } {
  const v = buf.readUInt16LE(p)
  if (v & 0x8000) return { len: ((v & 0x7fff) << 16) | buf.readUInt16LE(p + 2), next: p + 4 }
  return { len: v, next: p + 2 }
}

/** ResStringPool 청크를 문자열 배열로 편다. UTF-8/UTF-16 두 인코딩을 모두 다룬다. */
export function parseStringPool(buf: Buffer, offset: number): string[] {
  const count = buf.readUInt32LE(offset + 8)
  const flags = buf.readUInt32LE(offset + 16)
  const stringsStart = buf.readUInt32LE(offset + 20)
  const isUtf8 = (flags & UTF8_FLAG) !== 0

  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const entryOffset = buf.readUInt32LE(offset + 28 + 4 * i)
    let p = offset + stringsStart + entryOffset

    if (isUtf8) {
      // 첫 길이는 UTF-16 문자 수라 버리고, 두 번째 길이(바이트 수)를 쓴다.
      p = readVarLen8(buf, p).next
      const { len, next } = readVarLen8(buf, p)
      out.push(buf.subarray(next, next + len).toString('utf8'))
    } else {
      const { len, next } = readVarLen16(buf, p)
      out.push(buf.subarray(next, next + len * 2).toString('utf16le'))
    }
  }
  return out
}

/** ResTable_config 의 언어 코드. size(4)+imsi(4) 다음 2바이트가 언어다. */
export function configLocale(configHex: string): string | null {
  const b = Buffer.from(configHex, 'hex')
  if (b.length < 10) return null
  const a = b[8]!
  const c = b[9]!
  // 최상위 비트가 서면 3글자 패킹 로케일이다 — 흔치 않고 라벨 선택에 필요 없어 무시한다.
  if (a === 0 || (a & 0x80) !== 0) return null
  return String.fromCharCode(a, c)
}

/**
 * 리소스 ID(0xPPTTEEEE)를 문자열 값들로 해석한다.
 * 하나의 ID 가 로케일마다 다른 값을 가지므로 config 변형을 전부 돌려준다.
 * sparse 엔트리와 complex 엔트리는 다루지 않는다 — 라벨은 항상 단순 문자열이며,
 * 해석에 실패하면 호출자가 폴백 사슬로 내려간다.
 */
export function resolveResourceStrings(buf: Buffer, resourceId: number): ResolvedResourceString[] {
  if (buf.length < 12) throw new ArscParseError('resources.arsc 가 너무 짧습니다.')
  if (buf.readUInt16LE(0) !== RES_TABLE_TYPE) {
    throw new ArscParseError('resources.arsc 가 아닙니다 (RES_TABLE_TYPE 매직 불일치).')
  }

  const packageId = (resourceId >>> 24) & 0xff
  const typeId = (resourceId >>> 16) & 0xff
  const entryIndex = resourceId & 0xffff

  const globalPool = parseStringPool(buf, 12)
  const results: ResolvedResourceString[] = []

  // 전역 문자열 풀 청크를 건너뛰면 첫 패키지 청크가 나온다.
  let pos = 12 + buf.readUInt32LE(16)

  while (pos + 8 <= buf.length) {
    const chunkType = buf.readUInt16LE(pos)
    const headerSize = buf.readUInt16LE(pos + 2)
    const chunkSize = buf.readUInt32LE(pos + 4)
    if (chunkSize === 0) break

    if (chunkType === RES_TABLE_PACKAGE_TYPE && (buf.readUInt32LE(pos + 8) & 0xff) === packageId) {
      let p = pos + headerSize
      while (p + 8 <= pos + chunkSize) {
        const innerType = buf.readUInt16LE(p)
        const innerHeaderSize = buf.readUInt16LE(p + 2)
        const innerSize = buf.readUInt32LE(p + 4)
        if (innerSize === 0) break

        if (innerType === RES_TABLE_TYPE_TYPE && buf[p + 8] === typeId) {
          const entryCount = buf.readUInt32LE(p + 12)
          const entriesStart = buf.readUInt32LE(p + 16)
          const configSize = buf.readUInt32LE(p + 20)
          const configHex = buf.subarray(p + 20, p + 20 + configSize).toString('hex')

          if (entryIndex < entryCount) {
            const entryOffset = buf.readUInt32LE(p + innerHeaderSize + 4 * entryIndex)
            if (entryOffset !== NO_ENTRY) {
              const e = p + entriesStart + entryOffset
              const valueType = buf[e + 11]
              const data = buf.readUInt32LE(e + 12)
              const value = globalPool[data]
              if (valueType === TYPE_STRING && value !== undefined) {
                results.push({ configHex, locale: configLocale(configHex), value })
              }
            }
          }
        }
        p += innerSize
      }
    }
    pos += chunkSize
  }

  return results
}

/** 호스트 언어 → 기본 config → 첫 값 순으로 고른다. */
export function pickLocalizedValue(
  candidates: ResolvedResourceString[],
  preferredLanguage: string,
): string | null {
  return (
    candidates.find((c) => c.locale === preferredLanguage)?.value ??
    candidates.find((c) => c.locale === null)?.value ??
    candidates[0]?.value ??
    null
  )
}
