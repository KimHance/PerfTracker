import type { Tab } from '../../state/model.js'
import { useStore } from '../../state/StoreContext.jsx'
import { SectionHead } from '../ui/SectionHead.jsx'

/** CLI 플래그를 그대로 노출한다 — GUI 가 무엇을 대신 치고 있는지 숨기지 않는다. */
const OPTIONS: { key: 'launch' | 'force' | 'offline'; flag: string; desc: string }[] = [
  { key: 'launch', flag: '--launch', desc: '앱을 콜드로 띄우고 시작 시간을 측정' },
  { key: 'force', flag: '--force', desc: '이 기기에 남은 기존 세션을 버리고 시작' },
  { key: 'offline', flag: '--offline', desc: 'trace_processor 를 내려받지 않음 (캐시만 사용)' },
]

export function SessionSection({ tab }: { tab: Tab }) {
  const { dispatch } = useStore()
  const patch = (p: Partial<Tab>): void => dispatch({ type: 'tab/patched', key: tab.key, patch: p })

  return (
    <section>
      <SectionHead num="04" title="세션" aside={`-o ${tab.outDir}`} />

      <div className="field" style={{ marginBottom: 'var(--space-4)' }}>
        <label htmlFor={`name-${tab.key}`}>세션 이름</label>
        <input
          id={`name-${tab.key}`}
          className="input"
          value={tab.name}
          placeholder="예: 홈 스크롤"
          onChange={(e) => patch({ name: e.target.value })}
        />
        <div style={{ fontSize: 11.5, color: 'var(--color-neutral-600)', marginTop: 5 }}>
          비워 두면 시작할 때 자동으로 붙습니다.
        </div>
      </div>

      <div className="stack">
        {OPTIONS.map((opt) => (
          <button
            key={opt.key}
            className="option-row"
            aria-pressed={tab[opt.key]}
            onClick={() => patch({ [opt.key]: !tab[opt.key] } as Partial<Tab>)}
          >
            <span className={tab[opt.key] ? 'checkbox checkbox-on' : 'checkbox'} aria-hidden>
              {tab[opt.key] ? '✓' : ''}
            </span>
            <span>
              <span className="option-flag">{opt.flag}</span>
              <span className="option-desc"> — {opt.desc}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
