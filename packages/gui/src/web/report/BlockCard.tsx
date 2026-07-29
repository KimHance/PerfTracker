import { BADGED_STATUS, STATUS_LABEL } from './format.js'
import type { MetricState } from './blocks.js'

/**
 * 블록 하나의 껍데기. 제목 · 단위 · 상태 배지 · 판독줄이 전부 여기 있다.
 *
 * **결측이어도 카드가 사라지지 않는다.** 없어진 카드는 "이 도구가 원래 안 재는 것" 처럼
 * 보이고, 그러면 화면이 자기가 못 잰 사실을 감춘 셈이 된다.
 */
export function BlockCard({
  title,
  unit,
  span,
  metric,
  showHead,
  readout,
  readoutKind,
  footnote,
  children,
}: {
  title: string
  unit: string
  span: number
  metric: MetricState
  showHead: boolean
  readout?: string
  readoutKind?: 'idle' | 'value' | 'nosample'
  footnote?: string
  children: React.ReactNode
}) {
  // partial 은 배지를 달지 않는다 — 지표 넷이 동시에 partial 인 세션이 흔해서 노이즈가 된다.
  // 대신 이유는 제목 툴팁으로 남긴다. 배지가 없다고 이유까지 사라지면 안 된다.
  const badge =
    metric.status !== null && BADGED_STATUS.includes(metric.status)
      ? (STATUS_LABEL[metric.status] ?? metric.status)
      : null

  return (
    <section className="rp-card" style={{ gridColumn: `span ${span}` }}>
      {showHead && (
        <header className="rp-card-head">
          <h3 className="rp-card-title" title={metric.reason ?? undefined}>
            {title}
          </h3>
          {unit !== '' && <span className="rp-card-unit">{unit}</span>}
          {badge !== null && (
            <span className="rp-badge" title={metric.reason ?? undefined}>
              {badge}
            </span>
          )}
        </header>
      )}
      {readout !== undefined && readout !== '' && (
        <div className={`rp-readout rp-readout-${readoutKind ?? 'idle'}`}>{readout}</div>
      )}
      {children}
      {footnote !== undefined && footnote !== '' && <p className="rp-footnote">{footnote}</p>}
    </section>
  )
}

/**
 * 값이 없는 자리. **`수집 안 함` 과 `값 없음` 이 다른 문장인 것이 요점이다** —
 * 앞은 이 도구가 그 값을 낼 줄 모르던 시절의 세션이고, 뒤는 재려다 못 잰 것이다.
 */
export function NoneBody({ label, code }: { label: string; code: string | null }) {
  return (
    <div className="rp-none">
      <span>{label}</span>
      {code !== null && <code className="rp-none-code">{code}</code>}
    </div>
  )
}
