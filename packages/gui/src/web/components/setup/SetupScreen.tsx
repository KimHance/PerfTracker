import { startSession } from '../../effects/effects.js'
import { startCommand } from '../../format/command.js'
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
        {/* 실행될 명령을 그대로 보여 준다 — 사람이 그 줄을 복사해 터미널에서 재현할 수 있어야 한다. */}
        <span className="startbar-command">$ {startCommand(tab, state.env.outDir)}</span>
        <button
          className="btn btn-primary btn-lg blueprint"
          style={{ minWidth: 150 }}
          disabled={!canStart(tab)}
          onClick={() => void startSession(deps, tab, state.env.outDir)}
        >
          측정 시작
          <BlueprintCorners />
        </button>
      </div>
    </>
  )
}
