import type { DoctorCheckView } from '../../contract/api.js'
import { useStore } from '../state/StoreContext.jsx'
import { BlueprintCorners } from './ui/Blueprint.jsx'

/**
 * `doctor` 결과. 핸드오프에는 로딩만 있고 결과 화면이 없었는데, 점검을 눌러 놓고 결과를
 * 볼 곳이 없으면 그 버튼은 아무 일도 안 한 것이 된다.
 *
 * requirement 와 capability 를 갈라 놓는다: 앞은 **막힌 것**(고쳐야 잰다), 뒤는
 * **이 기기가 원래 못 재는 것**(고칠 수 없다). 둘을 섞으면 사용자가 고칠 수 없는 항목을
 * 고치려 든다.
 */
export function DoctorPanel({ checks }: { checks: DoctorCheckView[] }) {
  const { dispatch } = useStore()
  const requirements = checks.filter((c) => c.kind === 'requirement')
  const capabilities = checks.filter((c) => c.kind === 'capability')
  const blocked = requirements.filter((c) => !c.ok).length

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) dispatch({ type: 'doctor/dismissed' })
      }}
    >
      <div
        className="dialog blueprint"
        role="dialog"
        aria-modal="true"
        aria-label="환경 점검 결과"
        style={{ width: 'min(560px, 92vw)', maxHeight: '80vh' }}
      >
        <BlueprintCorners />
        <div className="dialog-title">환경 점검</div>
        <div className="dialog-body">
          {blocked === 0
            ? '측정을 막는 항목은 없습니다.'
            : `측정을 막는 항목이 ${blocked}개 있습니다. 아래를 먼저 해결해야 합니다.`}
        </div>

        <div style={{ overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <CheckGroup title="환경" checks={requirements} />
          {capabilities.length > 0 && (
            <CheckGroup title="이 기기가 잴 수 있는 것" checks={capabilities} />
          )}
        </div>

        <div className="dialog-actions">
          <button className="btn btn-secondary" style={{ height: 34 }} onClick={() => dispatch({ type: 'doctor/dismissed' })}>
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}

function CheckGroup({ title, checks }: { title: string; checks: DoctorCheckView[] }) {
  if (checks.length === 0) return null
  return (
    <div>
      <div className="kicker" style={{ marginBottom: 'var(--space-2)' }}>
        {title}
      </div>
      <div className="stack">
        {checks.map((check) => (
          <div
            key={check.name}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 'var(--space-3)',
              padding: '6px 10px',
              border: '1px solid var(--color-divider)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <span style={{ color: check.ok ? 'var(--color-accent-700)' : 'var(--color-neutral-500)', flex: 'none' }}>
              {check.ok ? '✓' : '✗'}
            </span>
            <span className="mono" style={{ fontSize: 11.5, flex: 'none' }}>
              {check.name}
            </span>
            <span style={{ fontSize: 11.5, color: 'var(--color-neutral-700)', minWidth: 0 }}>{check.detail}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
