import type {
  ActiveSessionView,
  AppView,
  DeviceView,
  DoctorCheckView,
  MarkView,
  RunView,
} from '../../contract/api.js'
import type { AppState, Confirm, Loading, Tab } from './model.js'

/**
 * 상태를 바꾸는 모든 방법. 화면은 이 목록 밖의 방법으로 상태를 바꾸지 못한다.
 *
 * 부수효과(fetch, 타이머)는 여기 없다 — 그것은 `effects/` 의 일이고, effects 는
 * 결과를 다시 이 액션으로만 반영한다. 그래서 리듀서는 순수하게 남는다.
 */
export type Action =
  // 환경 · 목록
  | { type: 'env/loaded'; env: AppState['env'] }
  | { type: 'devices/loaded'; devices: DeviceView[] }
  | { type: 'apps/loaded'; serial: string; apps: AppView[] }
  | { type: 'appVersion/loaded'; serial: string; packageName: string; versionName: string | null }
  | { type: 'runs/loaded'; runs: RunView[] }
  | { type: 'doctor/loaded'; checks: DoctorCheckView[] }
  | { type: 'doctor/dismissed' }
  // 탭
  | { type: 'tab/added'; key: string }
  | { type: 'tab/selected'; key: string }
  | { type: 'tab/closed'; key: string }
  | { type: 'tab/patched'; key: string; patch: Partial<Tab> }
  // 마킹
  // 마킹의 정본은 서버다. 화면은 부분 갱신하지 않고 서버가 준 목록으로 통째로 바꾼다 —
  // 두 벌을 각자 고치면 CLI 로 남긴 마킹과 어긋난다.
  | { type: 'marks/loaded'; tabKey: string; marks: MarkView[] }
  /**
   * 서버가 아는 **진행 중인 세션 전부**. 화면의 측정 중 탭을 여기에 맞춘다:
   * 새로고침으로 잃어버린 탭을 되살리고, 밖에서 끝난 세션의 탭을 접고, 마킹을 갱신한다.
   */
  | { type: 'sessions/loaded'; sessions: ActiveSessionView[] }
  // 세션
  | {
      type: 'session/started'
      tabKey: string
      sessionId: string
      name: string
      startedAt: number
      unsupported: { id: string; reason: string }[]
    }
  | { type: 'session/stopped'; tabKey: string; run: RunView | null }
  // 기록
  | { type: 'run/renamed'; runId: string; name: string }
  | { type: 'run/removed'; runId: string }
  | { type: 'runs/cleared' }
  | { type: 'run/opened'; runId: string }
  | { type: 'run/editStarted'; runId: string; draft: string }
  | { type: 'run/editChanged'; draft: string }
  | { type: 'run/editCancelled' }
  // 화면 상태
  | { type: 'drawer/toggled' }
  | { type: 'cli/toggled' }
  | { type: 'cli/logged'; at: string; command: string }
  | { type: 'loading/began'; loading: Loading }
  | { type: 'loading/ended' }
  | { type: 'confirm/asked'; confirm: Confirm }
  | { type: 'confirm/dismissed' }
  | { type: 'error/raised'; message: string }
  | { type: 'error/dismissed' }
  | { type: 'clock/ticked'; now: number }
