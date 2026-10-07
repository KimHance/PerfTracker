import { stopSession } from '../../effects/effects.js'
import { runningDiagnoseLines, runningKicker } from '../../format/session.js'
import { formatClock, formatElapsed } from '../../format/time.js'
import { elapsedMs, selectedApp, selectedDevice } from '../../state/derive.js'
import { appVersionKey } from '../../state/reducer.js'
import type { Tab } from '../../state/model.js'
import { useStore } from '../../state/StoreContext.jsx'
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
  const version =
    tab.serial !== null && tab.packageName !== null
      ? state.appVersions[appVersionKey(tab.serial, tab.packageName)]
      : undefined
  const diagnose = runningDiagnoseLines(tab)

  return (
    <div className="running">
      <div className="running-kicker">
        <span className="dot dot-live" aria-hidden />
        {runningKicker(tab)}
      </div>

      <div className="timer" aria-live="off">
        {formatElapsed(elapsed)}
      </div>

      <div className="running-meta">
        <div className="running-name">{tab.name.trim() === '' ? '새 세션' : tab.name}</div>
        <div className="running-app">
          {app !== null ? `${app.label} · ${app.packageName}` : (tab.packageName ?? '앱 미상')}
          {version !== undefined && version !== null ? ` v${version}` : ''}
        </div>
        <div className="running-device">
          {device?.model ?? '모델 미상'} ({tab.serial}) · 시작{' '}
          {tab.startedAt !== null ? formatClock(new Date(tab.startedAt)) : '-'}
        </div>
        {/*
          **이 기기에서 못 재는 지표를 측정 중에도 말한다.** 기기를 고를 때 02 섹션에서 이미
          보여 주지만, 시작 버튼을 누른 뒤로는 아무 말도 하지 않았다 — 사람이 30초 조작하고
          나서야 "프레임이 안 잡혔다" 를 아는 것은 측정을 한 번 더 하게 만드는 정보다.
          세션을 막지는 않으므로 경고가 아니라 사실로 적는다.
        */}
        {tab.unsupported.length > 0 && (
          <div className="running-unsupported">
            ✗ 이 기기에서 못 재는 지표 {tab.unsupported.length}개 —{' '}
            {tab.unsupported.map((u) => u.id).join(' · ')} (나머지는 정상 수집)
          </div>
        )}
        {/*
          앱 slice 를 못 여는지 모르는 진단 세션의 고지 (DM-10). 문장은 core 가 쓴 그대로다 —
          `start --diagnose` 가 터미널에 찍는 줄과 같은 글자. 세션을 막지 않는 측정 조건이라 못 재는
          지표 줄과 같은 모양(클래스)으로, 기호 없이 적는다. 설정 화면은 앱의 debuggable 을 모르므로
          여기에만 나온다.
        */}
        {diagnose.notice !== null && <div className="running-unsupported">{diagnose.notice}</div>}
      </div>

      {/*
        정지 버튼이 마킹 블록 **위**에 있다.
        핸드오프의 알려진 이슈: 마킹이 쌓이고 창이 낮으면 정지 버튼이 스크롤 아래로 밀린다.
        측정을 끝내는 버튼이 보이지 않는 것은 데이터를 잃는 길이라, 순서를 바꿔 정지를 위로
        올리고 마킹 목록에는 max-height 를 걸었다 (app.css 의 `.marks-list`).
      */}
      <button
        className="btn btn-primary btn-xl"
        style={{ minWidth: 190 }}
        onClick={() => void stopSession(deps, tab)}
      >
        정지 · 기록 생성
      </button>

      <MarkBlock tab={tab} />

      <p className="running-note">
        측정 중에는 기기에 어떤 adb 명령도 보내지 않습니다. 다른 탭의 세션은 이 탭과 독립적으로 흘러갑니다.
        {/*
          진단 세션의 둘째 줄 (DM-12) — slice 비용이 앱 프로세스 몫이라 평소 세션과 나란히 놓을 수 없다.
          첫 줄과 같은 각주라 같은 문단 안에 블록으로 둔다 (래퍼의 큰 gap 이 끼면 다른 블록처럼 읽힌다).
        */}
        {diagnose.footnote !== null && (
          <span style={{ display: 'block', marginTop: 'var(--space-2)' }}>{diagnose.footnote}</span>
        )}
      </p>
    </div>
  )
}
