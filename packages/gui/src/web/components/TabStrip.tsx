import { formatElapsed } from '../format/time.js'
import { elapsedMs, runningCount } from '../state/derive.js'
import type { Tab } from '../state/model.js'
import { useStore } from '../state/StoreContext.jsx'

let tabSeq = 1
const nextTabKey = (): string => `t${++tabSeq}`

export function TabStrip() {
  const { state, dispatch } = useStore()
  const onlyOne = state.tabs.length <= 1

  const close = (tab: Tab): void => {
    // 측정 중인 탭은 바로 닫지 않는다 — 닫으면 세션이 버려지고 기록이 남지 않는다.
    if (tab.phase === 'running') {
      dispatch({ type: 'confirm/asked', confirm: { kind: 'close-running-tab', tabKey: tab.key } })
      return
    }
    dispatch({ type: 'tab/closed', key: tab.key })
  }

  return (
    <div className="tabstrip" role="tablist" aria-label="측정 세션 탭">
      {state.tabs.map((tab) => (
        <div
          key={tab.key}
          role="tab"
          tabIndex={0}
          aria-selected={tab.key === state.activeTabKey}
          className="tab"
          onClick={() => dispatch({ type: 'tab/selected', key: tab.key })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              dispatch({ type: 'tab/selected', key: tab.key })
            }
          }}
        >
          <span className={tab.phase === 'running' ? 'dot dot-live' : 'dot'} aria-hidden />
          <span className="tab-label">{tab.name.trim() === '' ? '새 세션' : tab.name}</span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--color-neutral-600)' }}>
            {tab.phase === 'running' ? formatElapsed(elapsedMs(tab, state.now)) : '준비'}
          </span>
          <button
            className="tab-close"
            title="탭 닫기"
            aria-label={`${tab.name.trim() === '' ? '새 세션' : tab.name} 탭 닫기`}
            disabled={onlyOne}
            onClick={(e) => {
              // 부모의 탭 선택으로 번지면 "닫으려다 선택" 이 된다.
              e.stopPropagation()
              close(tab)
            }}
          >
            ×
          </button>
        </div>
      ))}

      <button
        className="btn btn-ghost"
        style={{ alignSelf: 'center', height: 26, width: 26, padding: 0, fontSize: 15, marginLeft: 'var(--space-2)' }}
        title="탭 추가"
        aria-label="세션 탭 추가"
        onClick={() => dispatch({ type: 'tab/added', key: nextTabKey() })}
      >
        +
      </button>

      <div
        className="mono"
        style={{
          marginLeft: 'auto',
          alignSelf: 'center',
          paddingRight: 'var(--space-4)',
          fontSize: 10,
          color: 'var(--color-neutral-600)',
          whiteSpace: 'nowrap',
        }}
      >
        {state.tabs.length}개 탭 · 측정 중 {runningCount(state)}
      </div>
    </div>
  )
}
