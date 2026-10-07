import { memo, useMemo, useRef, useState } from 'react'
import {
  ariaSort,
  INITIAL_SORT,
  NAME_KEY,
  nextSort,
  type SliceSort,
  type SliceTableVm,
  sortMark,
  sortSliceRows,
} from './slices.js'

/**
 * **slice 이름별 표.** 계산은 `slices.ts` 가 다 했고 여기는 그리기와 정렬 상태 하나뿐이다.
 *
 * - **다 그린다** (plan D25) — 1만 행도 창 안 행만 그리지 않는다. 브라우저 찾기(⌘F)가 상자 밖
 *   이름까지 찾고, 가변 높이 행(이름 줄바꿈)을 재는 코드가 필요 없다.
 * - 상자 안에서 위아래 · 옆으로 스크롤한다. 머리 두 줄과 이름 열이 붙어 있다 (sticky).
 *   **페이지는 옆으로 밀리지 않는다** — 390 폭에서 열 열 개가 넘치는 것은 이 상자 몫이다.
 * - 정렬은 열 머리 버튼(누름 · Enter · Space)만 바꾼다. 상태는 저장하지 않는다 — 다시 열면 이름 순.
 *   정렬하면 상자를 맨 위로 올린다: 새 순서의 첫 행부터 보여야 정렬한 뜻이 있다. 가로 위치 ·
 *   페이지 스크롤 · 포커스(머리 버튼 — sticky 라 보인다)는 그대로 둔다.
 */
export const SliceTable = memo(function SliceTable({ vm }: { vm: SliceTableVm }) {
  const [sort, setSort] = useState<SliceSort>(INITIAL_SORT)
  const box = useRef<HTMLDivElement>(null)
  const rows = useMemo(() => sortSliceRows(vm, sort), [vm, sort])
  // 행의 React 키. 이름은 접은 뒤 고유하지만, 그 가정이 깨진 문서에서도 행이 사라지지 않도록
  // 처음 순서의 자리를 키로 쓴다 — 정렬해도 같은 행은 같은 키다.
  const keyOf = useMemo(() => new Map(vm.rows.map((r, i) => [r, i])), [vm])

  const press = (key: string): void => {
    setSort((s) => nextSort(s, key))
    if (box.current !== null) box.current.scrollTop = 0
  }

  const head = (key: string, label: string): React.ReactNode => (
    <button type="button" className="rp-slice-sort" onClick={() => press(key)}>
      <span>{label}</span>
      <span className="rp-slice-mark" aria-hidden="true">
        {sortMark(sort, key)}
      </span>
    </button>
  )

  return (
    <div className="rp-slice-scroll" ref={box}>
      <table className="rp-table rp-slice">
        <thead>
          <tr>
            <th scope="col" rowSpan={2} className="rp-slice-name-h" aria-sort={ariaSort(sort, NAME_KEY)}>
              {head(NAME_KEY, vm.nameLabel)}
            </th>
            {vm.groups.map((g) => (
              <th key={g.label} scope="colgroup" colSpan={g.span} className="rp-slice-group">
                {g.label}
              </th>
            ))}
          </tr>
          <tr>
            {vm.columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={c.groupStart ? 'rp-slice-gs' : undefined}
                aria-sort={ariaSort(sort, c.key)}
              >
                {head(c.key, c.label)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={keyOf.get(r)}>
              <th scope="row" className="rp-slice-name">
                {r.name}
              </th>
              {r.cells.map((c, i) => (
                <td
                  key={i}
                  className={
                    `num${vm.columns[i]!.groupStart ? ' rp-slice-gs' : ''}${c.nil ? ' rp-slice-nil' : ''}`
                  }
                >
                  {c.text}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
})
