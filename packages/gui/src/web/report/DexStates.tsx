import { Wbr } from './BlockCard.jsx'
import type { DexLineVm, DexRecordVm, DexStatesVm } from './blocks.js'

/**
 * **dex 줄 표** (`dexstates` · baseline-profile BP-8). 계산은 `blocks.ts` 의 `buildDexStates` 가 다 했고 여기는
 * 그리기뿐이다.
 *
 * - **칠하지 않는다** (결정 6) — 상태 문자열 · 불 값은 모든 행이 같은 색 · 굵기 · 등폭이다. 바뀐 칸을 가르는
 *   클래스가 없다 (뷰모델에 그런 칸이 없다).
 * - **상자 스크롤이 없다** — 경로 · 위치는 칸 전부를 쓰는 행에서 구분자 뒤 줄바꿈(`<wbr>`), 값 칸(`status` ·
 *   `reason` 19자까지)은 `nowrap` 이라 390 에서도 카드 안에 든다 (디자인 `## 넘침`).
 */
export function DexStatesBody({ vm }: { vm: DexStatesVm }) {
  const span = vm.cols.length
  return (
    <>
      {vm.records.length > 0 && <Records rows={vm.records} />}
      {vm.lines.length > 0 && (
        <table className={`rp-table rp-dex${vm.locationLabel !== undefined ? ' rp-dex-when' : ''}`}>
          <thead>
            <tr>
              {vm.cols.map((c, i) => (
                <th key={i}>
                  {c.path === undefined ? (
                    c.word
                  ) : (
                    <>
                      <span className="rp-lbl">{c.word}</span>
                      <span className="rp-lbl-path">{c.path}</span>
                    </>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vm.lines.map((line, i) => (
              <Line key={i} line={line} span={span} vm={vm} />
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

/** 위 기록 칸 — 키/값 표와 같은 모양 (라벨 두 줄 · 값 없음이면 코드 · 문장은 행 title). */
function Records({ rows }: { rows: DexRecordVm[] }) {
  return (
    <table className="rp-table">
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} title={r.title}>
            <th>
              <span className="rp-lbl">{r.word}</span>
              <span className="rp-lbl-path">
                <Wbr text={r.path} />
              </span>
            </th>
            <td className={`num${r.wrap ? ' rp-wrap' : ''}${r.mono ? ' mono rp-path' : ''}`}>
              {r.wrap ? (
                <span className="rp-wrap-in">
                  <Wbr text={r.value} />
                </span>
              ) : (
                r.value
              )}
              {r.code !== undefined && <code className="rp-none-code">{r.code}</code>}
            </td>
            <td className="rp-share num" />
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** dex 줄 하나 — 머리 행(경로 · 필드) + 때 행(+ 위치 행) 또는 값 행 하나. */
function Line({ line, span, vm }: { line: DexLineVm; span: number; vm: DexStatesVm }) {
  return (
    <>
      <tr className="rp-dex-head">
        <td colSpan={span}>
          <Wbr text={line.head} />
          <span className="rp-dex-kvs">
            {line.fields.map((f) => (
              <span className="rp-dex-kv" key={f.name}>
                {f.word !== undefined && <span className="rp-dex-w">{f.word}</span>}
                <span className="rp-dex-k">{f.name}</span>
                <span className="rp-dex-val">{f.value}</span>
              </span>
            ))}
          </span>
        </td>
      </tr>
      {line.rows.map((r, i) => {
        const when = r.when === undefined ? null : <th>{r.when}</th>
        if (r.cells === null) {
          return (
            <tr className="rp-dex-row" key={i}>
              {when}
              <td colSpan={span - 1}>{vm.lineMissing}</td>
            </tr>
          )
        }
        return [
          <tr className="rp-dex-row" key={`${i}v`}>
            {when}
            {r.cells.map((c, j) => (
              <td className="mono rp-dex-v" key={j}>
                {c}
              </td>
            ))}
          </tr>,
          r.location !== undefined && vm.locationLabel !== undefined && (
            <tr className="rp-dex-loc" key={`${i}l`}>
              <td colSpan={span}>
                <span className="rp-lbl">{vm.locationLabel.word}</span>
                <span className="rp-lbl-path">{vm.locationLabel.path}</span>
                <Wbr text={r.location} />
              </td>
            </tr>
          ),
        ]
      })}
    </>
  )
}
