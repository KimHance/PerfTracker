import { useEffect } from 'react'
import { CliLogStrip } from './components/CliLogStrip.jsx'
import { ConfirmDialog } from './components/ConfirmDialog.jsx'
import { DoctorPanel } from './components/DoctorPanel.jsx'
import { Header } from './components/Header.jsx'
import { HistoryDrawer } from './components/HistoryDrawer.jsx'
import { LoadingOverlay } from './components/LoadingOverlay.jsx'
import { RunningScreen } from './components/running/RunningScreen.jsx'
import { SetupScreen } from './components/setup/SetupScreen.jsx'
import { TabStrip } from './components/TabStrip.jsx'
import { bootstrap, syncSessions } from './effects/effects.js'
import { activeTab, needsClock } from './state/derive.js'
import { useStore } from './state/StoreContext.jsx'

/** 라우팅이 없다. 한 페이지 안에서 상태만 바뀐다 — 대시보드가 정해지면 그때 라우트를 붙인다. */
export function App({ mock = false }: { mock?: boolean }) {
  const { state, dispatch, deps } = useStore()
  const tab = activeTab(state)
  const clockRunning = needsClock(state)

  useEffect(() => {
    void bootstrap(deps)
  }, [deps])

  useEffect(() => {
    // 측정 중 탭이 하나도 없으면 인터벌을 아예 걸지 않는다 — 아무도 안 보는 시계 때문에
    // 500ms 마다 전체를 다시 그릴 이유가 없다.
    if (!clockRunning) return
    dispatch({ type: 'clock/ticked', now: Date.now() })
    const id = setInterval(() => dispatch({ type: 'clock/ticked', now: Date.now() }), 500)
    return () => clearInterval(id)
  }, [clockRunning, dispatch])

  useEffect(() => {
    /**
     * 측정 중에는 서버에 세션 상태를 되묻는다. **기기가 아니라 서버의 파일을 읽는 것**이라
     * 측정에 영향이 없다 (규칙 1 은 기기 접촉을 금지하는 것이지 호스트 파일을 금지하지 않는다).
     *
     * 3초인 이유: 터미널에서 `perftracker mark` 를 친 사람이 화면을 봤을 때 "안 들어갔나?"
     * 하고 다시 치지 않을 정도면 충분하다. 더 짧게 할 이유가 없다.
     */
    if (!clockRunning) return
    const id = setInterval(() => void syncSessions(deps), 3000)
    return () => clearInterval(id)
  }, [clockRunning, deps])

  return (
    <div className="shell">
      <Header />

      {mock && (
        <div className="banner banner-mock">
          <span className="banner-text">
            <b>목업 모드</b> — 기기·앱·기록은 전부 지어낸 값입니다. 실제로 측정하지 않습니다.
          </span>
        </div>
      )}

      {state.error !== null && (
        <div className="banner banner-error" role="alert">
          <span className="banner-text">{state.error}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => dispatch({ type: 'error/dismissed' })}>
            닫기
          </button>
        </div>
      )}

      <TabStrip />

      <div className="shell-middle">
        <main className="shell-main">
          {tab.phase === 'setup' ? <SetupScreen tab={tab} /> : <RunningScreen tab={tab} />}
        </main>
        {state.drawerOpen && <HistoryDrawer />}
      </div>

      <CliLogStrip />

      {state.confirm !== null && <ConfirmDialog confirm={state.confirm} />}
      {state.doctor !== null && <DoctorPanel checks={state.doctor} />}
      {state.loading !== null && <LoadingOverlay loading={state.loading} />}
    </div>
  )
}
