import { stopSession } from '../../effects/effects.js'
import { formatClock, formatElapsed } from '../../format/time.js'
import { elapsedMs, selectedApp, selectedDevice } from '../../state/derive.js'
import type { Tab } from '../../state/model.js'
import { useStore } from '../../state/StoreContext.jsx'
import { BlueprintCorners } from '../ui/Blueprint.jsx'
import { MarkBlock } from './MarkBlock.jsx'

/**
 * 측정 중 화면. 할 수 있는 일은 **마킹과 정지 둘뿐**이다 — 이 창 안에서 기기를 만지는
 * 버튼을 두지 않는다. 새로고침도, 스펙 다시 읽기도 없다 (core 규칙 1).
 */
export function RunningScreen({ tab }: { tab: Tab }) {
  const { state, deps } = useStore()
  const device = selectedDevice(state, tab)
  const app = selectedApp(state, tab)
  const elapsed = elapsedMs(tab, state.now)

  return (
    <div className="running">
      <div className="running-kicker">
        <span className="dot dot-live" aria-hidden />
        측정 중
      </div>

      <div className="timer" aria-live="off">
        {formatElapsed(elapsed)}
      </div>

      <div className="running-meta">
        <div className="running-name">{tab.name.trim() === '' ? '새 세션' : tab.name}</div>
        <div className="running-app">
          {app !== null ? `${app.label} · ${app.packageName}` : (tab.packageName ?? '앱 미상')}
        </div>
        <div className="running-device">
          {device?.model ?? '모델 미상'} ({tab.serial}) · 시작{' '}
          {tab.startedAt !== null ? formatClock(new Date(tab.startedAt)) : '-'}
        </div>
      </div>

      {/*
        정지 버튼이 마킹 블록 **위**에 있다.
        핸드오프의 알려진 이슈: 마킹이 쌓이고 창이 낮으면 정지 버튼이 스크롤 아래로 밀린다.
        측정을 끝내는 버튼이 보이지 않는 것은 데이터를 잃는 길이라, 순서를 바꿔 정지를 위로
        올리고 마킹 목록에는 max-height 를 걸었다 (app.css 의 `.marks-list`).
      */}
      <button
        className="btn btn-primary btn-xl blueprint"
        style={{ minWidth: 190 }}
        onClick={() => void stopSession(deps, tab)}
      >
        정지 · 기록 생성
        <BlueprintCorners />
      </button>

      <MarkBlock tab={tab} />

      <p className="running-note">
        측정 중에는 기기에 어떤 adb 명령도 보내지 않습니다. 다른 탭의 세션은 이 탭과 독립적으로 흘러갑니다.
      </p>
    </div>
  )
}
