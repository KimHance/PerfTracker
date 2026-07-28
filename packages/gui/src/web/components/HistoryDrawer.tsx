import type { RunView } from '../../contract/api.js'
import { renameRun } from '../effects/effects.js'
import { formatClock, formatElapsed, formatRunAt } from '../format/time.js'
import { useStore } from '../state/StoreContext.jsx'

/**
 * 기록 드로어. **항상 최신순**이고 여러 탭이 동시에 끝나도 즉시 반영된다 —
 * 정렬은 리듀서가 `at` 으로 다시 세운다 (state/reducer.ts 의 `session/stopped`).
 */
export function HistoryDrawer() {
  const { state, dispatch } = useStore()

  return (
    <aside className="drawer" aria-label="측정 기록">
      <div className="drawer-head">
        <span className="drawer-title">기록</span>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--color-neutral-600)' }}>
          {state.runs.length}건 · 항상 최신
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <button
            className="btn btn-ghost btn-sm"
            disabled={state.runs.length === 0 && state.incompleteRunCount === 0}
            onClick={() =>
              dispatch({
                type: 'confirm/asked',
                confirm: {
                  kind: 'clear-runs',
                  count: state.runs.length,
                  incomplete: state.incompleteRunCount,
                },
              })
            }
          >
            전체 지우기
          </button>
          <button
            className="btn btn-ghost btn-sm"
            aria-label="기록 닫기"
            onClick={() => dispatch({ type: 'drawer/toggled' })}
          >
            ×
          </button>
        </div>
      </div>

      <div className="drawer-list">
        {state.runs.length === 0 ? (
          <div className="empty" style={{ padding: 'var(--space-8) var(--space-4)' }}>
            <div style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>
              기록이 없습니다. 세션을 정지하면 여기에 쌓입니다.
            </div>
          </div>
        ) : (
          state.runs.map((run) => <RunRow key={run.id} run={run} />)
        )}
      </div>
    </aside>
  )
}

function RunRow({ run }: { run: RunView }) {
  const { state, dispatch, deps } = useStore()
  const editing = state.editingRunId === run.id
  const fresh = state.freshRunIds.includes(run.id)

  /**
   * 기록을 열면 세션 대시보드로 간다 — **아직 없다.**
   * 여기는 그 자리를 표시해 두는 지점이고, 지금은 CLI 로그에 run 디렉토리만 남긴다.
   * 없는 화면으로 보내는 대신 아무 데도 가지 않는 쪽을 골랐다.
   */
  const open = (): void => {
    dispatch({ type: 'run/opened', runId: run.id })
    dispatch({
      type: 'cli/logged',
      at: formatClock(new Date()),
      command: `open ${run.runDir}  # 대시보드는 아직 없습니다`,
    })
  }

  return (
    <div className="run-row">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        {editing ? (
          <input
            className="input"
            style={{ height: 28, fontSize: 13 }}
            autoFocus
            value={state.editDraft}
            onChange={(e) => dispatch({ type: 'run/editChanged', draft: e.target.value })}
            onBlur={() => void renameRun(deps, run.id, state.editDraft)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void renameRun(deps, run.id, state.editDraft)
              if (e.key === 'Escape') dispatch({ type: 'run/editCancelled' })
            }}
          />
        ) : (
          <>
            <button className="run-name truncate" onClick={open}>
              {run.name}
            </button>
            {fresh && <span className="badge badge-solid">NEW</span>}
          </>
        )}
      </div>

      <div className="run-body">
        <button className="run-meta" onClick={open}>
          <div className="truncate">
            {run.model ?? '모델 미상'} · {run.serial}
          </div>
          <div className="truncate">
            {run.appLabel}
            {run.appVersion !== null ? ` v${run.appVersion}` : ''}
          </div>
          <div className="run-meta-mono">
            {formatRunAt(run.at)} · {formatElapsed(run.durationMs)} · {run.launch ? 'launch' : 'attach'} · 경고{' '}
            {run.warningCount}
            {run.unsupportedCount > 0 ? ` · 미지원 ${run.unsupportedCount}` : ''}
            {run.markCount > 0 ? ` · 마킹 ${run.markCount}` : ''}
          </div>
        </button>

        <div className="run-actions">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => dispatch({ type: 'run/editStarted', runId: run.id, draft: run.name })}
          >
            이름 변경
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() =>
              dispatch({ type: 'confirm/asked', confirm: { kind: 'delete-run', runId: run.id, runName: run.name } })
            }
          >
            삭제
          </button>
        </div>
      </div>
    </div>
  )
}
