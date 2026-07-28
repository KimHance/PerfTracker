import { selectApp } from '../../effects/effects.js'
import { filterApps, selectedApp } from '../../state/derive.js'
import { appVersionKey } from '../../state/reducer.js'
import type { Tab } from '../../state/model.js'
import { useStore } from '../../state/StoreContext.jsx'
import { SectionHead } from '../ui/SectionHead.jsx'

export function AppSection({ tab }: { tab: Tab }) {
  const { state, dispatch, deps } = useStore()
  const hasDevice = tab.serial !== null
  const apps = hasDevice ? (state.appsBySerial[tab.serial!] ?? []) : []
  const filtered = filterApps(apps, tab.appQuery)
  const selected = selectedApp(state, tab)
  const version =
    tab.serial !== null && tab.packageName !== null
      ? state.appVersions[appVersionKey(tab.serial, tab.packageName)]
      : undefined

  const patch = (p: Partial<Tab>): void => dispatch({ type: 'tab/patched', key: tab.key, patch: p })

  return (
    <section>
      <SectionHead
        num="03"
        title="앱 선택"
        aside={hasDevice ? `perftracker apps -d ${tab.serial}` : 'perftracker apps'}
      />

      <input
        className="input"
        disabled={!hasDevice}
        value={tab.appQuery}
        placeholder={hasDevice ? '라벨 또는 패키지명으로 검색' : '기기를 먼저 선택하세요'}
        onChange={(e) => patch({ appQuery: e.target.value })}
      />

      {!hasDevice ? (
        <div className="empty" style={{ marginTop: 'var(--space-2)' }}>
          <div className="empty-body" style={{ marginTop: 0 }}>
            설치된 앱 목록은 선택한 기기에서 읽어옵니다. 위에서 기기를 먼저 고르면{' '}
            <span className="mono" style={{ fontSize: 11 }}>
              pm list packages
            </span>{' '}
            결과가 여기에 채워집니다.
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty" style={{ marginTop: 'var(--space-2)' }}>
          <div style={{ fontSize: 12.5 }}>검색 결과가 없습니다</div>
          <div
            className="mono"
            style={{ fontSize: 11, color: 'var(--color-neutral-600)', wordBreak: 'break-all', marginTop: 'var(--space-2)' }}
          >
            {tab.appQuery}
          </div>
          <button
            className="btn btn-ghost"
            style={{ height: 28, fontSize: 11.5, marginTop: 'var(--space-3)' }}
            onClick={() => patch({ appQuery: '' })}
          >
            검색어 지우기
          </button>
        </div>
      ) : (
        <div className="applist">
          {filtered.map((app) => (
            <button
              key={app.packageName}
              className="app-row"
              aria-pressed={app.packageName === tab.packageName}
              onClick={() => void selectApp(deps, tab.key, tab.serial!, app.packageName)}
            >
              <span className="app-label">{app.label}</span>
              {/* 버전은 여기 없다 — 앱마다 기기에 따로 물어야 나오는 값이라 목록에 싣지 않는다.
                  고른 앱 하나만 아래에 표시한다. */}
              <span className="app-pkg">{app.packageName}</span>
            </button>
          ))}
        </div>
      )}

      {selected !== null && (
        <div className="app-selected">
          선택 <b>{selected.label}</b>{' '}
          <span className="mono">
            {/* 아직 안 왔으면 `읽는 중`, 못 읽었으면 `버전 미상`. 빈칸으로 두면
                "버전이 없다" 로 읽힌다. */}
            {version === undefined ? '버전 읽는 중…' : version === null ? '버전 미상' : `v${version}`}
          </span>
        </div>
      )}
    </section>
  )
}
