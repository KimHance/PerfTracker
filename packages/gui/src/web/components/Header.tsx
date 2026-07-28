import { runDoctor } from '../effects/effects.js'
import { activeTab } from '../state/derive.js'
import { useStore } from '../state/StoreContext.jsx'

export function Header() {
  const { state, dispatch, deps } = useStore()
  const tab = activeTab(state)

  return (
    <header className="app-header">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
        <span className="wordmark">PerfTracker</span>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--color-neutral-600)' }}>
          v{state.env.version}
        </span>
      </div>

      <div className="adb-chip">
        <span className="dot dot-live" aria-hidden />
        <span>adb</span>
        {/* 경로를 모르면 감추지 않고 모른다고 쓴다 — adb 를 못 찾은 것은 사용자가 알아야 할 사실이다. */}
        <span className="truncate" style={{ color: 'var(--color-neutral-500)' }}>
          {state.env.adbPath ?? '경로 미상'}
        </span>
      </div>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <button className="btn btn-ghost btn-md" onClick={() => void runDoctor(deps, tab.serial)}>
          환경 점검 (doctor)
        </button>
        <button
          className="btn btn-secondary btn-md"
          aria-expanded={state.drawerOpen}
          onClick={() => dispatch({ type: 'drawer/toggled' })}
        >
          기록
          <span className="badge badge-accent">{state.runs.length}</span>
        </button>
      </div>
    </header>
  )
}
