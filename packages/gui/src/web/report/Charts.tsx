import { useEffect, useRef, useState } from 'react'
import {
  type BarsVm,
  type DeltaVm,
  type DistributionVm,
  DH,
  DPAD,
  FH,
  FPAD,
  type FrameTimelineVm,
  type GaugeVm,
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
  sub?: string
  /** 여러 줄. 프레임 한 장에 대해 말할 것이 넷이라(앱·표시·마감·주사율) 한 줄로는 안 된다. */
  lines?: string[]
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

/* ── 프레임 시간축 ──────────────────────────────────────────── */

/**
 * **막대 하나가 프레임 한 장.** 아래 칸이 앱이 그린 시간, 위 칸이 그 뒤 화면에 나가기까지
 * 걸린 시간이다.
 *
 * **표시 시간이 `null` 이면 위 칸을 아예 안 그린다.** 높이 0 으로 그린 것과 화면은 같지만
 * 툴팁이 달라야 한다 — `0.00ms` 가 아니라 `모름` 이다.
 *
 * 16ms 선은 **참고선이고 판정이 아니다.** 넘은 막대를 다른 색으로 칠하거나 이름을 붙이지
 * 않는다 (규칙 2). 그 프레임의 진짜 마감은 툴팁에 따로 있다 — 실측 기기는 8.33ms 였고
 * 같은 세션 안에서 41.67ms 로 바뀌었다.
 */
export function FrameTimelineChart({
  vm,
  hot,
  onHot,
  onTip,
  onHover,
  onLeave,
}: {
  vm: FrameTimelineVm
  hot: number | null
  onHot: (idx: number | null) => void
  onTip: (tip: Tip | null) => void
  onHover: (t: number) => void
  onLeave: () => void
}) {
  const plotH = FH - FPAD.t - FPAD.b
  const hotBar = hot === null ? undefined : vm.bars[hot]

  return (
    <>
      <div className="rp-ftl-legend">
        <span className="rp-ftl-key">
          <i className="rp-ftl-sw rp-ftl-sw-app" />앱이 그린 시간
        </span>
        <span className="rp-ftl-key">
          <i className="rp-ftl-sw rp-ftl-sw-present" />화면에 나가기까지
        </span>
        {/* 출처가 툴팁에 있다 — 이 선이 우리가 정한 기준이 아니라는 표시다. */}
        <span className="rp-ftl-key rp-ftl-key-guide" title={vm.guide.source}>
          <i className="rp-ftl-sw rp-ftl-sw-guide" />
          {vm.guide.ms}ms 참고선
        </span>
      </div>

      {/* 넓은 것은 **자기 안에서** 스크롤한다. 페이지가 옆으로 밀리면 안 된다. */}
      <div className="rp-ftl-scroll">
        <svg
          viewBox={`0 0 ${vm.width} ${FH}`}
          width={vm.width}
          height={FH}
          className="rp-ftl"
          role="img"
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            const idx = vm.idxAt((e.clientX - r.left) / r.width)
            const tip = idx === null ? null : vm.tipOf(idx)
            onHot(idx)
            onTip(tip === null ? null : { x: e.clientX, y: e.clientY, ...tip })
            if (idx !== null) onHover(vm.bars[idx]!.tSec)
          }}
          onMouseLeave={() => {
            onHot(null)
            onTip(null)
            onLeave()
          }}
        >
          {vm.yTicks.map((t, i) => (
            <line key={`g${i}`} className="rp-gridline" x1={FPAD.l} y1={t.gy} x2={vm.width - FPAD.r} y2={t.gy} />
          ))}

          {vm.markLines.map((m, i) => (
            <line
              key={`m${i}`}
              className="rp-markline"
              x1={m.x}
              y1={FPAD.t}
              x2={m.x}
              y2={FH - FPAD.b}
              opacity={m.hot ? 0.95 : 0.4}
            >
              <title>{m.label}</title>
            </line>
          ))}

          {hotBar !== undefined && (
            <rect
              className="rp-slot-hot"
              x={hotBar.x - 1.5}
              y={FPAD.t}
              width={hotBar.w + 3}
              height={plotH}
            />
          )}

          {/* 아래 칸 · 위 칸. 두 칸은 명도만 다르다 — 색으로 좋고 나쁨을 말하지 않는다. */}
          {vm.bars.map((b, i) =>
            b.present === null ? null : (
              <rect
                key={`p${i}`}
                className="rp-ftl-present"
                x={b.x}
                y={b.present.y}
                width={b.w}
                height={b.present.h}
              />
            ),
          )}
          {vm.bars.map((b, i) => (
            <rect key={`a${i}`} className="rp-ftl-app" x={b.x} y={b.app.y} width={b.w} height={b.app.h} />
          ))}

          <line className="rp-guide" x1={FPAD.l} y1={vm.guide.y} x2={vm.width - FPAD.r} y2={vm.guide.y}>
            <title>{vm.guide.source}</title>
          </line>

          <line className="rp-axis" x1={FPAD.l} y1={FPAD.t} x2={FPAD.l} y2={FH - FPAD.b} />
          <line className="rp-axis" x1={FPAD.l} y1={FH - FPAD.b} x2={vm.width - FPAD.r} y2={FH - FPAD.b} />

          {vm.yTicks.map((t, i) => (
            <text key={`yt${i}`} className="rp-tick" x={FPAD.l - 6} y={t.y} textAnchor="end">
              {t.label}
            </text>
          ))}
          {vm.xTicks.map((t, i) => (
            <text key={`xt${i}`} className="rp-tick" x={t.x} y={FH - 10} textAnchor={t.anchor}>
              {t.label}
            </text>
          ))}
        </svg>
      </div>
    </>
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
  return (
    <div className="rp-bars">
      {vm.rows.map((r, i) => (
        // 설명은 **툴팁이다.** 줄로 깔면 항목 다섯짜리 카드가 열 줄이 되고, 그 화면에서
        // 읽는 사람이 먼저 보는 것(개수와 비율)이 글에 묻힌다.
        <div className="rp-bar-row" key={i} title={r.note === '' ? undefined : stripEmphasis(r.note)}>
          <span className="rp-bar-label">{r.label}</span>
          <span className="rp-bar-track">
            <i style={{ width: `${r.pct}%` }} />
          </span>
          <span className="rp-bar-value num">{r.value}</span>
          <span className="rp-share num">{r.share}</span>
        </div>
      ))}
    </div>
  )
}

/** 툴팁은 평문이라 `**…**` 를 그대로 두면 별표가 보인다. */
function stripEmphasis(text: string): string {
  return text.replace(/\*\*/g, '')
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
            <td className="num rp-delta-v">{r.delta}</td>
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
      {vm.why !== null && (
        <div className="rp-stat-why" title={vm.why.full ?? undefined}>
          {vm.why.code}
        </div>
      )}
      {vm.gauge !== null && <Gauge vm={vm.gauge} />}
      {vm.sub !== '' && <div className="rp-stat-sub num">{vm.sub}</div>}
    </>
  )
}

/**
 * 기준선 막대. **구간에 이름도 점수도 붙이지 않는다** — 색과 위치뿐이다.
 * 경계의 출처는 축 오른쪽 라벨의 툴팁에 있다: 이 화면이 매긴 등급이 아니라는 표시다.
 */
function Gauge({ vm }: { vm: GaugeVm }) {
  return (
    <div className="rp-gauge">
      <div className="rp-gauge-track">
        <div
          className={`rp-gauge-fill rp-gauge-l${vm.level}${vm.measured ? '' : ' rp-gauge-unmeasured'}`}
          style={{ width: `${(vm.fill * 100).toFixed(2)}%` }}
        />
      </div>
      <div className="rp-gauge-axis num">
        <span>0</span>
        <span title={vm.source}>{vm.axisLabel}</span>
      </div>
    </div>
  )
}

export function Percentiles({
  items,
  share,
}: {
  items: { k: string; v: string }[]
  /** 백분위 옆에 서는 비율(jank %). 못 읽었으면 `null` 이고, 그때는 아무것도 그리지 않는다. */
  share: { k: string; v: string } | null
}) {
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
      {share !== null && (
        <div className="rp-pct rp-pct-sep">
          <span className="rp-pct-k">{share.k.toUpperCase()}</span>
          <b className="num">
            {share.v}
            <span className="rp-pct-u">%</span>
          </b>
        </div>
      )}
    </div>
  )
}
