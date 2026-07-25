/**
 * 테스트용 최소 resources.arsc 를 만든다.
 * 실기기 APK 를 저장소에 커밋하지 않기 위한 장치이며, 파서가 읽는 필드만 정확히 채운다.
 */

const RES_STRING_POOL_TYPE = 0x0001
const RES_TABLE_TYPE = 0x0002
const RES_TABLE_PACKAGE_TYPE = 0x0200
const RES_TABLE_TYPE_TYPE = 0x0201
const UTF8_FLAG = 0x100
const TYPE_STRING = 0x03
const TYPE_REFERENCE = 0x01

/** ResStringPool_ref 의 8비트 varint 길이 인코딩. 127 이하는 1바이트, 아니면 상위비트를 세운 2바이트. */
function encodeVarLen8(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len])
  return Buffer.from([0x80 | (len >> 8), len & 0xff])
}

function utf8Entry(s: string): Buffer {
  const bytes = Buffer.from(s, 'utf8')
  // [utf16 문자 수][utf8 바이트 수][바이트들][NUL] — 두 길이 모두 128 이상이면 2바이트로 인코딩한다.
  return Buffer.concat([encodeVarLen8([...s].length), encodeVarLen8(bytes.length), bytes, Buffer.from([0])])
}

export function buildStringPool(strings: string[]): Buffer {
  const entries = strings.map(utf8Entry)
  const offsets = Buffer.alloc(4 * entries.length)
  let running = 0
  entries.forEach((e, i) => {
    offsets.writeUInt32LE(running, 4 * i)
    running += e.length
  })

  const data = Buffer.concat(entries)
  const headerSize = 28
  const stringsStart = headerSize + offsets.length
  const size = stringsStart + data.length

  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(RES_STRING_POOL_TYPE, 0)
  header.writeUInt16LE(headerSize, 2)
  header.writeUInt32LE(size, 4)
  header.writeUInt32LE(entries.length, 8)
  header.writeUInt32LE(0, 12)
  header.writeUInt32LE(UTF8_FLAG, 16)
  header.writeUInt32LE(stringsStart, 20)
  header.writeUInt32LE(0, 24)

  return Buffer.concat([header, offsets, data])
}

/** ResTable_config: size(4) + imsi(4) + locale(4: language 2, country 2) + 패딩. */
export function buildConfig(language: string | null): Buffer {
  const cfg = Buffer.alloc(64)
  cfg.writeUInt32LE(64, 0)
  if (language) {
    cfg.writeUInt8(language.charCodeAt(0), 8)
    cfg.writeUInt8(language.charCodeAt(1), 9)
  }
  return cfg
}

export interface SyntheticEntry {
  /** 리소스 ID 의 하위 16비트. */
  entryIndex: number
  language: string | null
  /** 전역 문자열 풀에서의 인덱스. TYPE_STRING 엔트리를 만든다. reference 와 배타적이다. */
  stringIndex?: number
  /** 지정하면 TYPE_REFERENCE 엔트리를 만든다 — data 는 대상 리소스 ID(0xPPTTEEEE). stringIndex 와 배타적. */
  reference?: number
  /** true 면 ResTable_entry 의 FLAG_COMPLEX 비트를 세워 bag 엔트리처럼 만든다. */
  complex?: boolean
}

/** RES_TABLE_TYPE 청크 하나 = 하나의 config 변형. */
function buildTypeChunk(typeId: number, entryCount: number, entry: SyntheticEntry): Buffer {
  const config = buildConfig(entry.language)
  const headerSize = 20 + config.length

  const offsets = Buffer.alloc(4 * entryCount, 0xff)
  offsets.writeUInt32LE(0, 4 * entry.entryIndex)

  const dataType = entry.reference !== undefined ? TYPE_REFERENCE : TYPE_STRING
  const data = entry.reference !== undefined ? entry.reference : (entry.stringIndex ?? 0)

  // ResTable_entry(8) + Res_value(8)
  const body = Buffer.alloc(16)
  body.writeUInt16LE(8, 0) // entry size
  body.writeUInt16LE(entry.complex ? 0x0001 : 0, 2) // flags (0x0001 = FLAG_COMPLEX)
  body.writeUInt32LE(0, 4) // key index (파서가 안 씀)
  body.writeUInt16LE(8, 8) // Res_value size
  body.writeUInt8(0, 10) // res0
  body.writeUInt8(dataType, 11)
  body.writeUInt32LE(data, 12)

  const entriesStart = headerSize + offsets.length
  const size = entriesStart + body.length

  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(RES_TABLE_TYPE_TYPE, 0)
  header.writeUInt16LE(headerSize, 2)
  header.writeUInt32LE(size, 4)
  header.writeUInt8(typeId, 8)
  header.writeUInt8(0, 9)
  header.writeUInt16LE(0, 10)
  header.writeUInt32LE(entryCount, 12)
  header.writeUInt32LE(entriesStart, 16)
  config.copy(header, 20)

  return Buffer.concat([header, offsets, body])
}

export interface SyntheticArscOptions {
  packageId: number
  typeId: number
  entryCount: number
  strings: string[]
  entries: SyntheticEntry[]
}

export function buildArsc(opts: SyntheticArscOptions): Buffer {
  const globalPool = buildStringPool(opts.strings)

  const pkgHeaderSize = 288
  const pkgHeader = Buffer.alloc(pkgHeaderSize)
  pkgHeader.writeUInt16LE(RES_TABLE_PACKAGE_TYPE, 0)
  pkgHeader.writeUInt16LE(pkgHeaderSize, 2)
  pkgHeader.writeUInt32LE(opts.packageId, 8)

  // 타입/키 문자열 풀은 파서가 건너뛰지만, 실제 파일과 같은 순서로 넣어 건너뛰기 동작까지 검증한다.
  const typePool = buildStringPool(['string'])
  const keyPool = buildStringPool(['app_name'])
  const typeChunks = opts.entries.map((e) => buildTypeChunk(opts.typeId, opts.entryCount, e))

  const pkgBody = Buffer.concat([typePool, keyPool, ...typeChunks])
  pkgHeader.writeUInt32LE(pkgHeaderSize + pkgBody.length, 4)
  const pkgChunk = Buffer.concat([pkgHeader, pkgBody])

  const tableHeaderSize = 12
  const tableHeader = Buffer.alloc(tableHeaderSize)
  tableHeader.writeUInt16LE(RES_TABLE_TYPE, 0)
  tableHeader.writeUInt16LE(tableHeaderSize, 2)
  tableHeader.writeUInt32LE(tableHeaderSize + globalPool.length + pkgChunk.length, 4)
  tableHeader.writeUInt32LE(1, 8)

  return Buffer.concat([tableHeader, globalPool, pkgChunk])
}
