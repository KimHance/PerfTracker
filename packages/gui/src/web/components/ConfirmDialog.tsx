import { abortSession, clearRuns, deleteRun } from '../effects/effects.js'
import type { Confirm } from '../state/model.js'
import { useStore } from '../state/StoreContext.jsx'
import { BlueprintCorners } from './ui/Blueprint.jsx'

/**
 * 되돌릴 수 없는 일 앞의 **하나뿐인** 확인 다이얼로그.
 * 세 종류 모두 같은 컴포넌트를 지난다 — 확인 없이 지우는 경로가 하나도 없어야 하고,
 * 그 사실을 파일 하나로 확인할 수 있어야 한다.
 */
export function ConfirmDialog({ confirm }: { confirm: Confirm }) {
  const { state, dispatch, deps } = useStore()
  const copy = textFor(confirm, state.runs.find((r) => r.id === (confirm as { runId?: string }).runId)?.name)

  const dismiss = (): void => dispatch({ type: 'confirm/dismissed' })

  const proceed = (): void => {
    switch (confirm.kind) {
      case 'delete-run':
        void deleteRun(deps, confirm.runId, confirm.runName)
        break
      case 'clear-runs':
        void clearRuns(deps)
        break
      case 'close-running-tab': {
        const tab = state.tabs.find((t) => t.key === confirm.tabKey)
        dispatch({ type: 'confirm/dismissed' })
        if (tab) void abortSession(deps, tab)
        break
      }
    }
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss()
      }}
    >
      <div className="dialog blueprint" role="dialog" aria-modal="true" aria-label={copy.title}>
        <BlueprintCorners />
        <div className="dialog-title">{copy.title}</div>
        <div className="dialog-body">{copy.body}</div>
        <div className="dialog-actions">
          <button className="btn btn-secondary" style={{ height: 34 }} onClick={dismiss}>
            취소
          </button>
          <button className="btn btn-primary" style={{ height: 34 }} autoFocus onClick={proceed}>
            {copy.confirm}
          </button>
        </div>
      </div>
    </div>
  )
}

function textFor(confirm: Confirm, runName?: string): { title: string; body: string; confirm: string } {
  switch (confirm.kind) {
    case 'delete-run':
      return {
        title: '기록을 삭제할까요?',
        body: `“${runName ?? confirm.runName}” 의 run 디렉토리와 result.json 이 함께 삭제됩니다. 되돌릴 수 없습니다.`,
        confirm: '삭제',
      }
    case 'clear-runs':
      return {
        title: '기록을 전체 지울까요?',
        body: `기록 ${confirm.count}건의 run 디렉토리가 모두 삭제됩니다. 되돌릴 수 없습니다.`,
        confirm: '삭제',
      }
    case 'close-running-tab':
      return {
        title: '측정 중인 탭을 닫을까요?',
        body: '진행 중인 세션이 버려지고 기록이 남지 않습니다. 기기의 Perfetto 세션도 정리합니다.',
        confirm: '세션 버리고 닫기',
      }
  }
}
