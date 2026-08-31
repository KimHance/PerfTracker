import { useEffect, useState } from 'react'
import { INLINE_REPORT_GLOBAL, type ReportDocument } from '../../contract/api.js'
import { computeMaxT, readMarks } from './axis.js'
import {
  buildBars,
  buildDelta,
  buildDistribution,
  buildPairs,
  buildSeries,
  buildStat,
  metricState,
  type NoneVm,
} from './blocks.js'
import { BlockCard, NoneBody } from './BlockCard.jsx'
import {
  BarsBody,
  DeltaBody,
  DistributionChart,
  PairsBody,
  Percentiles,
  emphasize,
  SeriesChart,
  StatBody,
  type Tip,
  useWidth,
} from './Charts.jsx'
import { clock } from './format.js'
import { buildHeader } from './header.js'
import { type Block, MANIFEST, SECTIONS, type TabId, TABS } from './manifest.js'

/**
 * **한 파일로 만 보고서가 심어 둔 데이터.** `perftracker report` 가 `result.json` 을 여기
 * 넣어 두면 서버가 없어도 화면이 뜬다 (`report/standalone.ts`).
 */
function inlineReport(): ReportDocument | null {
  const v = (globalThis as Record<string, unknown>)[INLINE_REPORT_GLOBAL]
  return v === undefined || v === null || typeof v !== 'object' ? null : (v as ReportDocument)
}

/**
 * 세션 보고서. 기록 목록에서 항목을 누르면 `?report=<id>` 로 새 창이 열린다.
 *
 * **데이터는 두 곳에서 온다.** GUI 에서는 서버가 주고(`/api/runs/:id/report`), `perftracker
 * report` 가 만든 한 파일에서는 문서 안에 이미 심겨 있다. 후자에는 부를 서버가 없다 —
 * `file://` 로 열리기 때문이다.
 *
 * **화면 전체가 `hoverT` 하나를 공유한다.** 한 시계열에 마우스를 올리면 나머지 시계열이 같은
 * 초를 가리키고, 마커를 짚어도 같은 값이 움직인다 — "CPU 가 튄 그 순간 메모리는" 을 눈을
 * 옮기지 않고 읽으라는 것이 이 화면의 요점이다.
 */
export function ReportPage({ runId }: { runId: string }) {
  const [doc, setDoc] = useState<ReportDocument | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabId>('summary')
  const [sub, setSub] = useState<Record<string, string>>({})
  const [hoverT, setHoverT] = useState<number | null>(null)
  const [hotBucket, setHotBucket] = useState<number | null>(null)
  const [tip, setTip] = useState<Tip | null>(null)
  const [distW, distRef] = useWidth()

  useEffect(() => {
    // 심겨 있으면 부를 곳이 없다 — `file://` 에서 `/api/…` 는 어차피 실패한다.
    const inline = inlineReport()
    if (inline !== null) {
      setDoc(inline)
      return
    }

    let alive = true
    fetch(`/api/runs/${encodeURIComponent(runId)}/report`)
      .then(async (r) => {
        const body: unknown = await r.json()
        if (!r.ok) throw new Error((body as { message?: string }).message ?? `HTTP ${r.status}`)
        return body as ReportDocument
      })
      .then((d) => { if (alive) setDoc(d) })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [runId])

  useEffect(() => {
    if (doc === null) return
    const name = doc['session'] as { name?: string } | undefined
    document.title = `${name?.name ?? runId} · PerfTracker`
  }, [doc, runId])

  if (error !== null) {
    return (
      <div className="rp-shell">
        <Rail tab={tab} setTab={setTab} counts={{ summary: 0, device: 0 }} />
        <main className="rp-main">
          <p className="rp-error">{error}</p>
        </main>
      </div>
    )
  }
  if (doc === null) {
    return (
      <div className="rp-shell">
        <Rail tab={tab} setTab={setTab} counts={{ summary: 0, device: 0 }} />
        <main className="rp-main">
          <p className="rp-loading">불러오는 중…</p>
        </main>
      </div>
    )
  }

  const head = buildHeader(doc)
  const marks = readMarks(doc)
  const maxT = computeMaxT(doc, marks)

  const built = MANIFEST.map((b, i) => ({
    key: `b${i}`,
    block: b,
    metric: metricState(doc, b.metric),
    vm: buildOne(b, doc, maxT, marks, hoverT, distW),
  }))

  const missingIn = (t: TabId): number =>
    built.filter(
      (x) =>
        (x.vm as NoneVm).none === true &&
        SECTIONS.find((s) => s.id === x.block.section)?.tab === t,
    ).length

  const sections = SECTIONS.filter((s) => s.tab === tab)
    .map((s) => {
      // 서브탭이 없는 섹션은 `active` 가 없다 — 그때는 모든 블록을 그린다. 서브탭이 있는
      // 섹션은 처음엔 첫 서브탭이 켜져 있고, `sub` 상태가 이 섹션에 대해 아무것도 안
      // 골랐으면 그 첫 탭을 기본으로 쓴다.
      const active = s.subTabs === undefined ? undefined : (sub[s.id] ?? s.subTabs[0]!.id)
      const all = built.filter((x) => x.block.section === s.id)
      return {
        ...s,
        active,
        // 섹션 자체를 접을지는 **어느 서브탭에도 블록이 없을 때**만 정한다 — 지금 켜진
        // 서브탭이 마침 비어 있다고(`timeline` 처럼) 섹션째로 접으면 서브탭 버튼까지
        // 같이 사라져서 되돌아갈 길이 없어진다.
        hasAny: all.length > 0,
        items: active === undefined ? all : all.filter((x) => x.block.sub === active),
      }
    })
    .filter((s) => s.hasAny)

  return (
    <div className="rp-shell">
      <Rail tab={tab} setTab={setTab} counts={{ summary: missingIn('summary'), device: missingIn('device') }} />

      <main className="rp-main">
        <header className="rp-head">
          <div className="rp-head-top">
            <span className="rp-sid mono">{head.id}</span>
            <h1 className="rp-name">{head.name}</h1>
            <span className={`rp-state${head.running ? ' rp-state-on' : ''}`}>{head.stateLabel}</span>
          </div>
          <div className="rp-meta">
            {head.meta.map((m) => (
              <span className="rp-meta-item" key={m.k}>
                <i>{m.k}</i>
                {m.v}
              </span>
            ))}
          </div>
        </header>

        {tab === 'summary' && marks.length > 0 && (
          <div className="rp-marks">
            <span className="rp-marks-label">마커</span>
            {marks.map((m, i) => (
              <button
                key={i}
                className={`rp-mark${hoverT === m.t ? ' rp-mark-on' : ''}`}
                onMouseEnter={() => setHoverT(m.t)}
                onMouseLeave={() => setHoverT(null)}
              >
                <span className="rp-mark-at mono">{clock(m.t)}</span>
                {m.label}
              </button>
            ))}
          </div>
        )}

        {sections.map((s) => (
          <section className="rp-section" key={s.id}>
            <h2 className="rp-section-head">
              <span>{s.label}</span>
              <i />
            </h2>
            {s.subTabs !== undefined && (
              <div className="rp-subtabs">
                {s.subTabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`rp-subtab${s.active === t.id ? ' rp-subtab-on' : ''}`}
                    aria-current={s.active === t.id}
                    onClick={() => setSub((prev) => ({ ...prev, [s.id]: t.id }))}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
            {s.note !== undefined && <p className="rp-section-note">{emphasize(s.note)}</p>}
            <div className="rp-grid">
              {s.items.map(({ key, block, metric, vm }) => {
                const isNone = (vm as NoneVm).none === true
                const stat = block.kind === 'stat'
                return (
                  <BlockCard
                    key={key}
                    title={block.title}
                    unit={stat && !isNone ? (vm as { unit: string }).unit : (block.unit ?? '')}
                    span={block.span}
                    tone={block.tone}
                    metric={metric}
                    showHead={!stat}
                    readout={
                      block.kind === 'series' && !isNone
                        ? (vm as { readout: string }).readout
                        : undefined
                    }
                    readoutKind={
                      block.kind === 'series' && !isNone
                        ? (vm as { readoutKind: 'idle' | 'value' | 'nosample' }).readoutKind
                        : undefined
                    }
                    footnote={
                      !isNone && (block.kind === 'series' || block.kind === 'distribution')
                        ? (vm as { footnote: string }).footnote
                        : undefined
                    }
                  >
                    {block.note !== undefined && (
                      <p className="rp-section-note">{emphasize(block.note)}</p>
                    )}
                    <Body
                      block={block}
                      vm={vm}
                      metric={metric}
                      hotBucket={hotBucket}
                      setHotBucket={setHotBucket}
                      setTip={setTip}
                      setHoverT={setHoverT}
                      distRef={distRef}
                    />
                  </BlockCard>
                )
              })}
            </div>
          </section>
        ))}

        <footer className="rp-footer">
          <span className="mono">{head.footerTool}</span>
          <span className="mono">{head.footerSchema}</span>
          {head.schemaMismatch && (
            <span className="rp-footer-warn">이 화면은 schema major 1 을 압니다</span>
          )}
          {head.footerIgnored !== '' && <span className="rp-footer-warn">{head.footerIgnored}</span>}
        </footer>
      </main>

      {tip !== null && (
        <div className="rp-tip" style={{ left: tip.x + 14, top: tip.y + 14 }}>
          <div className="rp-tip-head">{tip.head}</div>
          <div className="rp-tip-value num">{tip.value}</div>
          <div className="rp-tip-sub num">{tip.sub}</div>
        </div>
      )}
    </div>
  )
}

function Rail({
  tab,
  setTab,
  counts,
}: {
  tab: TabId
  setTab: (t: TabId) => void
  counts: Record<TabId, number>
}) {
  return (
    <nav className="rp-rail">
      <div className="rp-brand">
        <div className="rp-brand-1">PERFTRACKER</div>
        <div className="rp-brand-2">세션 데이터</div>
      </div>
      {TABS.map((t) => (
        <button
          key={t.id}
          className={`rp-tab${tab === t.id ? ' rp-tab-on' : ''}`}
          aria-current={tab === t.id}
          onClick={() => {
            setTab(t.id)
            window.scrollTo(0, 0)
          }}
        >
          <span>{t.label}</span>
          {counts[t.id] > 0 && <span className="rp-tab-count mono">{counts[t.id]}</span>}
        </button>
      ))}
    </nav>
  )
}

/** 매니페스트의 `kind` 하나가 빌더 하나로 간다. 지표 이름은 어디에도 안 나온다. */
function buildOne(
  b: Block,
  doc: ReportDocument,
  maxT: number,
  marks: { t: number; label: string }[],
  hoverT: number | null,
  distW: number,
): unknown {
  switch (b.kind) {
    case 'series': return buildSeries(b, doc, maxT, marks, hoverT)
    case 'distribution': return buildDistribution(b, doc, distW)
    case 'bars': return buildBars(b, doc)
    case 'delta': return buildDelta(b, doc)
    case 'pairs': return buildPairs(b, doc)
    case 'stat': return buildStat(b, doc)
  }
}

function Body({
  block,
  vm,
  metric,
  hotBucket,
  setHotBucket,
  setTip,
  setHoverT,
  distRef,
}: {
  block: Block
  vm: unknown
  metric: { reasonCode: string | null }
  hotBucket: number | null
  setHotBucket: (i: number | null) => void
  setTip: (t: Tip | null) => void
  setHoverT: (t: number | null) => void
  distRef: (el: HTMLDivElement | null) => void
}) {
  if ((vm as NoneVm).none === true) {
    return <NoneBody label={(vm as NoneVm).label} code={metric.reasonCode} />
  }

  switch (block.kind) {
    case 'series':
      return (
        <SeriesChart
          vm={vm as Parameters<typeof SeriesChart>[0]['vm']}
          onHover={setHoverT}
          onLeave={() => setHoverT(null)}
        />
      )
    case 'distribution': {
      const d = vm as Parameters<typeof DistributionChart>[0]['vm']
      return (
        <>
          <Percentiles items={d.percentiles} share={d.share} />
          <div ref={distRef}>
            <DistributionChart vm={d} hot={hotBucket} onHot={setHotBucket} onTip={setTip} />
          </div>
        </>
      )
    }
    case 'bars': return <BarsBody vm={vm as Parameters<typeof BarsBody>[0]['vm']} />
    case 'delta': return <DeltaBody vm={vm as Parameters<typeof DeltaBody>[0]['vm']} />
    case 'pairs': return <PairsBody vm={vm as Parameters<typeof PairsBody>[0]['vm']} />
    case 'stat': return <StatBody vm={vm as Parameters<typeof StatBody>[0]['vm']} title={block.title} />
  }
}
