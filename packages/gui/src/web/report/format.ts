import { MISSING, type Read } from './read.js'

/**
 * **단위는 필드 이름이 말한다.** `_kb` `_ms` `_pct` `_hz` `_c` `_bytes` — 추측하지 않고
 * 매니페스트가 어느 포맷터를 쓸지 적는다.
 *
 * **함정:** `transform` 으로 이미 MB 로 바꾼 계열에 MB 포맷터(`/1024`)를 또 걸면 이중
 * 변환된다. 변환한 계열은 순수 숫자 포맷(`n0`/`n1`)을 쓰고 단위는 블록의 `unit` 에 적는다.
 */
export type Fmt =
  | 'int' | 'ms0' | 'pct0' | 'pct2' | 'c1' | 'hz'
  | 'mb0' | 'mb1' | 'gb1' | 'ghz2' | 'bytes' | 'bool' | 'list'
  | 'mbTriple' | 'wrap' | 'raw' | 'n0' | 'n1'

export const NONE_MISSING = '수집 안 함'
export const NONE_NULL = '값 없음'

export const nf = (n: number, d: number): string =>
  Number(n).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d })

function fmtBytes(b: number): string {
  if (b < 1024) return `${nf(b, 0)} B`
  if (b < 1048576) return `${nf(b / 1024, 1)} kB`
  if (b < 1073741824) return `${nf(b / 1048576, 2)} MB`
  return `${nf(b / 1073741824, 2)} GB`
}

interface Triple {
  min_kb: number
  avg_kb: number
  max_kb: number
}

/**
 * **`MISSING` 과 `null` 이 서로 다른 문장이 되는 곳이 여기 하나다.** 다른 데서 두 값을
 * 문자열로 바꾸면 그 구분이 그 자리에서 사라진다.
 */
export function fmtValue(v: Read, f: Fmt | undefined): string {
  if (v === MISSING) return NONE_MISSING
  if (v === null || v === undefined) return NONE_NULL

  if (f === 'bool') return v === true ? '예' : v === false ? '아니오' : String(v)
  if (f === 'list') {
    return Array.isArray(v) ? (v.length === 0 ? '없음' : v.join(', ')) : String(v)
  }
  if (f === 'mbTriple') {
    if (typeof v !== 'object') return NONE_NULL
    const t = v as Triple
    return `${nf(t.min_kb / 1024, 0)} / ${nf(t.avg_kb / 1024, 0)} / ${nf(t.max_kb / 1024, 0)} MB`
  }
  if (typeof v !== 'number') return String(v)

  switch (f) {
    case 'int': return nf(v, 0)
    case 'ms0': return `${nf(v, 0)} ms`
    case 'pct0': return `${nf(v, 0)}%`
    case 'pct2': return `${nf(v, 2)}%`
    case 'c1': return `${nf(v, 1)}°C`
    case 'hz': return `${nf(v, 0)} Hz`
    case 'mb0': return `${nf(v / 1024, 0)} MB`
    case 'mb1': return `${nf(v / 1024, 1)} MB`
    case 'gb1': return `${nf(v / 1048576, 1)} GB`
    case 'ghz2': return `${nf(v / 1000000, 2)} GHz`
    case 'bytes': return fmtBytes(v)
    case 'n0': return nf(v, 0)
    case 'n1': return nf(v, 1)
    default: return String(v)
  }
}

/** 시계열 눈금과 표식 칩이 쓰는 `m:ss`. */
export const clock = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export function fmtWhen(iso: Read): string {
  if (typeof iso !== 'string') return NONE_NULL
  const d = new Date(iso)
  const p = (n: number): string => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  )
}

/** 세로축 눈금. 자릿수를 값 크기에 맞춘다 — 0.5% 와 500MB 가 같은 규칙일 수 없다. */
export function fmtAxis(v: number): string {
  if (v === 0) return '0'
  if (v >= 10) return nf(Math.round(v), 0)
  if (v >= 1) return nf(v, 1)
  return nf(v, 2)
}

/** 눈금 간격을 사람이 읽는 수로 올린다. */
export function niceMax(v: number): number {
  if (v <= 0) return 1
  const mag = 10 ** Math.floor(Math.log10(v))
  return Math.ceil(v / (mag / 2)) * (mag / 2)
}

export const STATUS_LABEL: Record<string, string> = {
  collected: '수집됨',
  partial: '일부만',
  skipped: '건너뜀',
  unsupported: '기기 미지원',
  failed: '실패',
}

/**
 * 배지를 다는 상태.
 *
 * **`partial` 은 뺀다.** full 표본에서 지표 넷이 전부 `process_name_stale_in_trace` 로
 * partial 이라, 배지를 달면 화면 절반에 같은 배지가 붙어 노이즈가 된다. 그래도 숨기지는
 * 않는다 — 이유(`reason`)는 카드 제목의 툴팁으로 닿는다.
 */
export const BADGED_STATUS = ['unsupported', 'skipped', 'failed']
