import { useEffect, useRef, useState } from 'react'
import {
  type BarsVm,
  type DeltaVm,
  type DistributionVm,
  DH,
  DPAD,
  type PairsVm,
  type SeriesVm,
  SH,
  SPAD,
  type StatVm,
  SW,
} from './blocks.js'

/**
 * 차트 여섯 종의 렌더러. **라이브러리를 쓰지 않는다** — SVG 를 직접 그린다.
 *
 * 이 파일에는 기하 계산이 없다. 전부 `blocks.ts` 가 이미 계산해 둔 좌표를 받아 그리기만
 * 한다 — 그래야 "선을 어디서 끊는가" 같은 판단이 브라우저 없이 테스트된다.
 */

/* ── 시계열 ─────────────────────────────────────────────────── */

export function SeriesChart({
  vm,
  onHover,
  onLeave,
}: {
  vm: SeriesVm
  onHover: (t: number) => void
  onLeave: () => void
}) {
  return (
    <svg
      viewBox={`0 0 ${SW} ${SH}`}
      width="100%"
      className="rp-series"
      role="img"
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        onHover(vm.tAt((e.clientX - r.left) / r.width))
      }}
      onMouseLeave={onLeave}
    >
      {vm.yTicks.map((t, i) => (
        <line key={`g${i}`} className="rp-gridline" x1={SPAD.l} y1={t.gy} x2={SW - SPAD.r} y2={t.gy} />
      ))}

      {/* 표본 없는 초. 선을 잇지 않고 이 띠만 남는다 — 끊긴 이유가 화면에 있어야 한다. */}
      {vm.gaps.map((g, i) => (
        <rect key={`n${i}`} className="rp-gap" x={g.x} y={SPAD.t} width={g.w} height={SH - SPAD.t - SPAD.b} />
      ))}

      {vm.markLines.map((m, i) => (
        <line
          key={`m${i}`}
          className="rp-markline"
          x1={m.x}
          y1={SPAD.t}
          x2={m.x}
          y2={SH - SPAD.b}
          opacity={m.hot ? 0.95 : 0.4}
        />
      ))}

      <line className="rp-axis" x1={SPAD.l} y1={SPAD.t} x2={SPAD.l} y2={SH - SPAD.b} />
      <line className="rp-axis" x1={SPAD.l} y1={SH - SPAD.b} x2={SW - SPAD.r} y2={SH - SPAD.b} />

      {vm.subSegments.map((d, i) => (
        <path key={`s${i}`} className="rp-subline" d={d} />
      ))}
      {vm.segments.map((d, i) => (
        <path key={`l${i}`} className="rp-line" d={d} />
      ))}
      {/* 조각이 한 점이면 선을 못 그린다. 버리면 잰 값이 사라지므로 점으로 남긴다. */}
      {vm.singletons.map((p, i) => (
        <circle key={`p${i}`} className="rp-dot" cx={p.x} cy={p.y} r={1.7} />
      ))}

      {vm.cursor.on && (
        <>
          <line className="rp-cursor" x1={vm.cursor.x} y1={SPAD.t} x2={vm.cursor.x} y2={SH - SPAD.b} />
          {vm.cursor.r > 0 && (
            <circle className="rp-cursor-dot" cx={vm.cursor.x} cy={vm.cursor.y} r={vm.cursor.r} />
          )}
        </>
      )}

      {vm.yTicks.map((t, i) => (
        <text key={`yt${i}`} className="rp-tick" x={SPAD.l - 6} y={t.y} textAnchor="end">
          {t.label}
        </text>
      ))}
      {vm.xTicks.map((t, i) => (
        <text key={`xt${i}`} className="rp-tick" x={t.x} y={SH - 9} textAnchor={t.anchor}>
          {t.label}
        </text>
      ))}
    </svg>
  )
}

/* ── 분포 ───────────────────────────────────────────────────── */

export interface Tip {
  x: number
  y: number
  head: string
  value: string
  sub: string
}

export function DistributionChart({
  vm,
  hot,
  onHot,
  onTip,
}: {
  vm: DistributionVm
  hot: number | null
  onHot: (idx: number | null) => void
  onTip: (tip: Tip | null) => void
}) {
  return (
    <svg
      viewBox={`0 0 ${vm.width} ${DH}`}
      width="100%"
      height={DH}
      className="rp-dist"
      role="img"
      onMouseLeave={() => {
        onHot(null)
        onTip(null)
      }}
    >
      {vm.yTicks.map((t, i) => (
        <line key={`g${i}`} className="rp-gridline" x1={DPAD.l} y1={t.gy} x2={vm.width - DPAD.r} y2={t.gy} />
      ))}

      {hot !== null && (
        <rect
          className="rp-slot-hot"
          x={vm.hits.find((h) => h.idx === hot)?.x ?? 0}
          y={DPAD.t}
          width={vm.hits.find((h) => h.idx === hot)?.w ?? 0}
          height={DH - DPAD.t - DPAD.b}
        />
      )}

      {vm.bars.map((b) => (
        <rect
          key={b.idx}
          className="rp-bar"
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          rx={b.rx}
          opacity={hot === null ? 0.9 : hot === b.idx ? 1 : 0.28}
        />
      ))}

      {vm.pLines.map((p, i) => (
        <line key={`p${i}`} className="rp-pline" x1={p.x} y1={DPAD.t} x2={p.x} y2={DH - DPAD.b} />
      ))}

      <line className="rp-axis" x1={DPAD.l} y1={DPAD.t} x2={DPAD.l} y2={DH - DPAD.b} />
      <line className="rp-axis" x1={DPAD.l} y1={DH - DPAD.b} x2={vm.width - DPAD.r} y2={DH - DPAD.b} />

      {/* 히트 영역은 슬롯 전체 높이다 — 막대가 아니다. 얇은 막대·빈 칸도 잡히고 틈이 없다. */}
      {vm.hits.map((h) => (
        <rect
          key={`h${h.idx}`}
          x={h.x}
          y={DPAD.t}
          width={h.w}
          height={DH - DPAD.t - DPAD.b}
          fill="transparent"
          onMouseMove={(e) => {
            const tip = vm.tipOf(h.idx)
            if (tip === null) return
            onHot(h.idx)
            onTip({ x: e.clientX, y: e.clientY, ...tip })
          }}
        />
      ))}

      {vm.yTicks.map((t, i) => (
        <text key={`yt${i}`} className="rp-tick" x={DPAD.l - 6} y={t.y} textAnchor="end">
          {t.label}
        </text>
      ))}
      {vm.xLabels.map((t, i) => (
        <text key={`xt${i}`} className="rp-tick" x={t.x} y={DH - 12} textAnchor="middle">
          {t.label}
        </text>
      ))}
      {vm.breaks.map((k, i) => (
        <text key={`bk${i}`} className="rp-tick rp-tick-dim" x={k.x + 3} y={DH - DPAD.b - 4}>
          {k.label}
        </text>
      ))}
    </svg>
  )
}

/** 컨테이너 폭을 재서 막대 두께와 눈금 개수를 맞춘다. 가로 스크롤 없이 한눈에 들어와야 한다. */
export function useWidth(): [number, (el: HTMLDivElement | null) => void] {
  const [w, setW] = useState(900)
  const ro = useRef<ResizeObserver | null>(null)

  useEffect(() => () => ro.current?.disconnect(), [])

  const ref = (el: HTMLDivElement | null): void => {
    ro.current?.disconnect()
    if (el === null) return
    ro.current = new ResizeObserver(() => {
      const next = Math.round(el.clientWidth)
      if (next > 0) setW((prev) => (Math.abs(next - prev) > 2 ? next : prev))
    })
    ro.current.observe(el)
    const next = Math.round(el.clientWidth)
    if (next > 0) setW(next)
  }

  return [w, ref]
}

/* ── 나머지 ─────────────────────────────────────────────────── */

/** `**…**` 만 굵게. 마크다운을 들이지 않는다 — 이 화면이 쓰는 강조는 이것 하나다. */
export function emphasize(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <b key={i}>{part.slice(2, -2)}</b>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}

export function BarsBody({ vm }: { vm: BarsVm }) {
  const noted = vm.rows.some((r) => r.note !== '')
  return (
    <div className={`rp-bars${noted ? ' rp-bars-noted' : ''}`}>
      {vm.rows.map((r, i) => (
        <div className="rp-bar-item" key={i}>
          <div className="rp-bar-row">
            <span className="rp-bar-label">{r.label}</span>
            <span className="rp-bar-track">
              <i style={{ width: `${r.pct}%` }} />
            </span>
            <span className="rp-bar-value num">{r.value}</span>
            <span className="rp-share num">{r.share}</span>
          </div>
          {r.note !== '' && <p className="rp-bar-note">{emphasize(r.note)}</p>}
        </div>
      ))}
    </div>
  )
}

export function DeltaBody({ vm }: { vm: DeltaVm }) {
  return (
    <table className="rp-table rp-delta">
      <tbody>
        {vm.rows.map((r, i) => (
          <tr key={i}>
            <th>{r.label}</th>
            <td className="num rp-before">{r.before}</td>
            <td className="rp-arrow">→</td>
            <td className="num">{r.after}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function PairsBody({ vm }: { vm: PairsVm }) {
  return (
    <table className="rp-table">
      <tbody>
        {vm.rows.map((r, i) => (
          <tr key={i}>
            <th>{r.label}</th>
            <td className={`num${r.wrap ? ' rp-wrap' : ''}`}>{r.value}</td>
          <td className="rp-share num">{r.share}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function StatBody({ vm, title }: { vm: StatVm; title: string }) {
  return (
    <>
      <div className="rp-stat-title">{title}</div>
      <div className={`rp-stat-value num${vm.dim ? ' rp-stat-dim' : ''}`}>
        {vm.value}
        {vm.unit !== '' && <span className="rp-stat-unit">{vm.unit}</span>}
      </div>
      {vm.sub !== '' && <div className="rp-stat-sub num">{vm.sub}</div>}
    </>
  )
}

export function Percentiles({ items }: { items: { k: string; v: string }[] }) {
  return (
    <div className="rp-pcts">
      {items.map((p) => (
        <div className="rp-pct" key={p.k}>
          <span className="rp-pct-k">{p.k.toUpperCase()}</span>
          <b className="num">
            {p.v}
            <span className="rp-pct-u">ms</span>
          </b>
        </div>
      ))}
    </div>
  )
}
