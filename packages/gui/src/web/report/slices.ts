import { DIAGNOSE_REPORT_COPY, fillReportCopy } from './diagnose-copy.js'
import { NONE_MISSING, NONE_NULL } from './format.js'
import type { Fmt } from './format.js'
import type { SliceTableBlock } from './manifest.js'
import { MISSING, readPath } from './read.js'

/**
 * **slice 이름별 표의 행 모델 · 정렬.** 전부 순수 함수다 — DOM 시험 도구가 없으므로 DM-13 의
 * "자르지 않음 · 구별 없음 · 코드 단위 순 · 사람이 고를 때만 정렬" 을 여기서 시험한다.
 *
 * 깨면 안 되는 것 (기능 문서 DM-13 · 결정 7 · 규칙 2):
 *
 * - **행을 자르지 않는다.** 행 수 = 블록 표 행 수. 상위 N · "더 보기" 가 없다 — 무엇이 길었는지
 *   고르는 일은 읽는 쪽의 몫이다. 1만 행도 다 그린다 (plan D25 — ⌘F 가 화면 밖 이름도 찾는다).
 * - **이름을 자르지 않는다.** 원문 그대로 싣고 줄바꿈은 그리는 쪽(`overflow-wrap: anywhere`)이 한다.
 * - **행마다 모양이 같다.** 행 뷰모델에는 이름과 칸뿐이다 — 순위 · 강조 · 색 · 굵기를 실을 자리가
 *   없다. 칸의 `nil` 은 빈 칸(`—`)의 표시이고 행을 가르지 않는다.
 * - **처음 순서는 이름의 UTF-16 코드 단위 순이다** (`a < b`). `localeCompare` 를 쓰지 않는다 —
 *   호스트 로캘마다 순서가 달라지고 core 의 표와 어긋난다 (README · `Z` 가 `a` 보다 앞).
 */

export type SortDir = 'asc' | 'desc'

/** 정렬 상태. `key` 는 `name` 이거나 `<갈래 필드>.<수 필드>` (`main_thread.sum_ms`). 저장하지 않는다. */
export interface SliceSort {
  key: string
  dir: SortDir
}

export const NAME_KEY = 'name'

/** 처음 열었을 때 — 이름 오름차순 (코드 단위). */
export const INITIAL_SORT: SliceSort = { key: NAME_KEY, dir: 'asc' }

export interface SliceCellVm {
  text: string
  /** 빈 칸(`—`)인가. 색 하나(`neutral-600`)만 다르고 모든 행에 같은 규칙이다. */
  nil: boolean
}

/** 행 하나. **이름과 칸뿐이다** — 행을 서로 구별하는 필드를 두지 않는다 (DM-13). */
export interface SliceRowVm {
  name: string
  /** 갈래 순(메인 · 그 밖 · 비동기) × 수 순(횟수 · 합 · 최대). */
  cells: SliceCellVm[]
}

export interface SliceColumnVm {
  /** 정렬 키 — `<갈래>.<수>`. */
  key: string
  label: string
  /** 갈래의 첫 열인가 (그리는 쪽이 갈래 사이에 세로선을 긋는다). */
  groupStart: boolean
}

export interface SliceTableVm {
  none?: false
  /** 카드 단위 — `대상 앱 프로세스 · {n}행`. */
  unit: string
  nameLabel: string
  groups: { label: string; span: number }[]
  columns: SliceColumnVm[]
  /** **처음 순서**(이름 코드 단위 오름)의 행. 정렬은 `sortSliceRows` 가 새 배열로 낸다. */
  rows: SliceRowVm[]
  /** 정렬에 쓰는 원값 — `rows[i]` 의 칸과 같은 자리. `null` 은 빈 칸이다. 그리는 쪽은 안 본다. */
  values: (number | null)[][]
}

export interface SliceNoneVm {
  none: true
  label: string
}

/**
 * **이 표에만 쓰는 숫자 포맷.** `format.ts` 의 `nf` 와 같은 글자를 내지만 포맷터를 한 번만 만든다 —
 * `toLocaleString` 은 부를 때마다 포맷터를 새로 만들어, 1만 행 × 9칸이면 그것만으로 눈에 띄게 느려진다.
 */
const NF: Record<number, Intl.NumberFormat> = {}
function num(v: number, digits: number): string {
  const f = (NF[digits] ??= new Intl.NumberFormat('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }))
  return f.format(v)
}

/** 표가 쓰는 포맷만 — 정수 · 소수 한 자리. 그 밖의 포맷은 정수 그대로 낸다. */
function fmtStat(v: number, f: Fmt): string {
  if (f === 'n1') return num(v, 1)
  return num(v, 0)
}

/** 이름의 코드 단위 비교. 같으면 0. */
export function compareName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

export function buildSliceTable(b: SliceTableBlock, res: unknown): SliceTableVm | SliceNoneVm {
  const raw = readPath(res, b.path)
  // **`null` 은 0행이 아니다.** 프로세스를 못 찾았거나 원본이 없다 — 이유 코드는 카드가 블록
  // 껍데기에서 붙인다. 필드 부재는 진단 블록을 모르던 문서다.
  if (raw === MISSING) return { none: true, label: `${NONE_MISSING} — ${b.path} 없음` }
  if (!Array.isArray(raw)) return { none: true, label: NONE_NULL }

  const items = raw.map((r) => {
    const o = (r !== null && typeof r === 'object' ? r : {}) as Record<string, unknown>
    const nm = o[b.nameField]
    const name = typeof nm === 'string' ? nm : String(nm ?? '')
    const values: (number | null)[] = []
    const cells: SliceCellVm[] = []
    for (const g of b.groups) {
      const gv = o[g.field]
      const go = gv !== null && typeof gv === 'object' ? (gv as Record<string, unknown>) : null
      for (const s of b.stats) {
        const v = go === null ? null : go[s.field]
        if (isNum(v)) {
          values.push(v)
          cells.push({ text: fmtStat(v, s.fmt), nil: false })
        } else {
          // 갈래가 없거나(그 이름의 slice 가 그 갈래에 없음) 끝난 slice 가 없어 합 · 최대가 없다.
          // `0` 으로 채우지 않는다 — slice 가 없으면 최대는 0 이 아니라 없다.
          values.push(null)
          cells.push({ text: DIAGNOSE_REPORT_COPY.empty, nil: true })
        }
      }
    }
    return { row: { name, cells }, values }
  })

  // 처음 순서를 여기서 정한다 — 들어온 순서를 믿지 않는다. core 의 표가 이미 이 순서지만,
  // 화면이 "처음은 코드 단위 순" 을 약속하는 이상 그것을 지키는 것도 화면이다.
  items.sort((x, y) => compareName(x.row.name, y.row.name))

  const columns: SliceColumnVm[] = []
  for (const g of b.groups) {
    b.stats.forEach((s, i) => columns.push({ key: `${g.field}.${s.field}`, label: s.label, groupStart: i === 0 }))
  }

  return {
    unit: fillReportCopy(b.rowsUnit, { n: num(items.length, 0) }),
    nameLabel: b.nameLabel,
    groups: b.groups.map((g) => ({ label: g.label, span: b.stats.length })),
    columns,
    rows: items.map((x) => x.row),
    values: items.map((x) => x.values),
  }
}

/**
 * 정렬된 행 — **새 배열**이고 `vm.rows` 는 그대로다.
 *
 * - 이름: 코드 단위 순.
 * - 숫자 열: 그 값. **빈 칸은 방향과 무관하게 끝**이다 — 내림에서 빈 칸이 맨 위로 오면 "가장 큰
 *   값" 자리에 값 없는 행이 선다.
 * - 같은 값은 이름 코드 단위 오름 (방향과 무관) — 같은 입력이면 늘 같은 순서다.
 */
export function sortSliceRows(vm: SliceTableVm, sort: SliceSort): SliceRowVm[] {
  const idx = vm.rows.map((_, i) => i)
  if (sort.key === NAME_KEY) {
    if (sort.dir === 'asc') return idx.map((i) => vm.rows[i]!)
    return idx.reverse().map((i) => vm.rows[i]!)
  }
  const col = vm.columns.findIndex((c) => c.key === sort.key)
  if (col < 0) return [...vm.rows]
  const sign = sort.dir === 'asc' ? 1 : -1
  idx.sort((a, b) => {
    const x = vm.values[a]![col]!
    const y = vm.values[b]![col]!
    if (x === null && y === null) return compareName(vm.rows[a]!.name, vm.rows[b]!.name)
    if (x === null) return 1
    if (y === null) return -1
    if (x !== y) return (x - y) * sign
    return compareName(vm.rows[a]!.name, vm.rows[b]!.name)
  })
  return idx.map((i) => vm.rows[i]!)
}

/**
 * 머리를 눌렀을 때의 다음 정렬. 같은 열을 다시 누르면 방향을 뒤집고, 다른 열이면 **숫자는 내림 ·
 * 이름은 오름**으로 시작한다 (디자인 문서 `## 조작`).
 */
export function nextSort(prev: SliceSort, key: string): SliceSort {
  if (prev.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: key === NAME_KEY ? 'asc' : 'desc' }
}

/** 머리의 `aria-sort`. 정렬된 열만 방향을 말한다. */
export function ariaSort(sort: SliceSort, key: string): 'ascending' | 'descending' | 'none' {
  if (sort.key !== key) return 'none'
  return sort.dir === 'asc' ? 'ascending' : 'descending'
}

/** 정렬된 열에만 붙는 표시 (`▲` · `▼`). 나머지 열은 빈 문자열이다. */
export function sortMark(sort: SliceSort, key: string): string {
  if (sort.key !== key) return ''
  return sort.dir === 'asc' ? DIAGNOSE_REPORT_COPY.sortAsc : DIAGNOSE_REPORT_COPY.sortDesc
}
