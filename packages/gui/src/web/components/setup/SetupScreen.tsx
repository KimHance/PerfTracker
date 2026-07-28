import { startSession } from '../../effects/effects.js'
import { startPreview } from '../../format/preview.js'
import { canStart } from '../../state/derive.js'
import type { Tab } from '../../state/model.js'
import { useStore } from '../../state/StoreContext.jsx'
import { BlueprintCorners } from '../ui/Blueprint.jsx'
import { AppSection } from './AppSection.jsx'
import { DeviceSection } from './DeviceSection.jsx'
import { MetricSection } from './MetricSection.jsx'
import { SessionSection } from './SessionSection.jsx'

/**
 * 세션 설정. 좁아지면 2단 → 1단으로 접힌다 (`.setup-grid` 의 auto-fit).
 * 좌단은 기기·지표, 우단은 앱·세션이지만 그것은 폭이 넓을 때의 결과일 뿐 순서는 01→04 다.
 */
export function SetupScreen({ tab }: { tab: Tab }) {
  const { state, deps } = useStore()

  return (
    <>
      <div className="setup-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(20px,3vw,34px)' }}>
          <DeviceSection tab={tab} />
          <MetricSection tab={tab} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(20px,3vw,34px)' }}>
          <AppSection tab={tab} />
          <SessionSection tab={tab} />
        </div>
      </div>

      <div className="startbar">
        {/*
          아직 실행 전이라 서버에게 물어볼 것이 없다 — 이 줄은 "누르면 이렇게 된다" 는 예고다.
          실제로 실행된 줄은 서버가 응답에 실어 보내고 하단 CLI 로그에 남는다.
        */}
        <span className="startbar-command">$ {startPreview(tab, state.env.outDir)}</span>
        <button
          className="btn btn-primary btn-lg blueprint"
          style={{ minWidth: 150 }}
          disabled={!canStart(state, tab)}
          onClick={() => void startSession(deps, tab, state.env.outDir)}
        >
          측정 시작
          <BlueprintCorners />
        </button>
      </div>
    </>
  )
}
