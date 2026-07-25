import { ArscParseError } from '../../errors.js'

const RES_TABLE_TYPE = 0x0002
const RES_TABLE_PACKAGE_TYPE = 0x0200
const RES_TABLE_TYPE_TYPE = 0x0201
const UTF8_FLAG = 0x100
const TYPE_STRING = 0x03
const TYPE_REFERENCE = 0x01
const NO_ENTRY = 0xffffffff
const FLAG_COMPLEX = 0x0001

/**
 * TYPE_REFERENCE 를 따라갈 수 있는 최대 홉 수.
 * android:label="@string/app_name" 처럼 한 홉이 흔하지만, 방어적으로 몇 홉 더 허용한다.
 * 한계를 넘으면 예외 없이 그 갈래를 후보 없음으로 끝낸다.
 */
export const MAX_REFERENCE_DEPTH = 4

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
 * android:label="@string/app_name" 처럼 TYPE_REFERENCE 로 다른 리소스를 가리키는 엔트리는
 * MAX_REFERENCE_DEPTH 안에서 같은 버퍼 안을 다시 따라가며, 순환은 방문 집합으로 막는다 —
 * 한계를 넘거나 순환에 걸리면 예외 없이 그 갈래만 후보 없음으로 끝난다.
 * sparse 엔트리와 complex 엔트리는 다루지 않는다 — 라벨은 항상 단순 문자열이거나 그 참조이며,
 * 해석에 실패하면 호출자가 폴백 사슬로 내려간다.
 */
export function resolveResourceStrings(buf: Buffer, resourceId: number): ResolvedResourceString[] {
  if (buf.length < 12) throw new ArscParseError('resources.arsc 가 너무 짧습니다.')
  if (buf.readUInt16LE(0) !== RES_TABLE_TYPE) {
    throw new ArscParseError('resources.arsc 가 아닙니다 (RES_TABLE_TYPE 매직 불일치).')
  }

  // 이 지점부터는 잘리거나 손상된 파일이 (경계마다 검사하지 않는) 원시 RangeError 를
  // 던질 수 있다 — 호출자가 폴백 사슬로 내려갈 수 있도록 ArscParseError 로 통일해 던진다.
  try {
    return walkResourceTable(buf, resourceId, 0, new Set([resourceId]))
  } catch (err) {
    if (err instanceof ArscParseError) throw err
    const detail = err instanceof Error ? err.message : String(err)
    throw new ArscParseError(`resources.arsc 파싱 중 오류가 발생했습니다: ${detail}`)
  }
}

/**
 * depth 와 visited 는 TYPE_REFERENCE 를 따라가는 재귀 호출끼리만 주고받는 내부 상태다.
 * 호출마다 새로 시작하므로(모듈 전역이 아니므로) 서로 다른 resolveResourceStrings 호출 사이에 새지 않는다.
 */
function walkResourceTable(
  buf: Buffer,
  resourceId: number,
  depth: number,
  visited: ReadonlySet<number>,
): ResolvedResourceString[] {
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
              const entryFlags = buf.readUInt16LE(e + 2)
              // complex(bag) 엔트리는 Res_value 레이아웃이 다르다 — 단순 문자열이 아니므로 건너뛴다.
              if ((entryFlags & FLAG_COMPLEX) === 0) {
                const valueType = buf[e + 11]
                const data = buf.readUInt32LE(e + 12)
                if (valueType === TYPE_STRING) {
                  const value = globalPool[data]
                  if (value !== undefined) {
                    results.push({ configHex, locale: configLocale(configHex), value })
                  }
                } else if (valueType === TYPE_REFERENCE && depth < MAX_REFERENCE_DEPTH && !visited.has(data)) {
                  // 참조를 따라간 후보는 이 config(configHex) 가 아니라 대상 리소스 자신의
                  // config 변형들을 그대로 유지한다 — 재귀 호출이 그걸 자체적으로 만든다.
                  const nextVisited = new Set(visited)
                  nextVisited.add(data)
                  results.push(...walkResourceTable(buf, data, depth + 1, nextVisited))
                }
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
