import { useStore } from '../state/StoreContext.jsx'

/**
 * 푸터의 CLI 로그.
 *
 * 장식이 아니다 — GUI 가 대신 친 명령을 그대로 남겨서, 사람이 같은 일을 터미널에서
 * 재현하거나 무엇이 언제 기기에 나갔는지 되짚을 수 있게 한다. 측정 중에 이 목록이
 * 늘지 않는다는 것 자체가 규칙 1(측정 창 안 기기 접촉 0회)의 눈에 보이는 증거다.
 */
export function CliLogStrip() {
  const { state, dispatch } = useStore()
  const last = state.cliLog[0]

  return (
    <div className="cli">
      <button className="cli-bar" aria-expanded={state.cliOpen} onClick={() => dispatch({ type: 'cli/toggled' })}>
        <span className="kicker">CLI 로그</span>
        <span className="cli-last">{last ? `$ ${last.command}` : '아직 실행한 명령이 없습니다'}</span>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--color-neutral-600)' }}>
          {state.cliOpen ? '접기 ▾' : `펼치기 ▴ (${state.cliLog.length})`}
        </span>
      </button>

      {state.cliOpen && (
        <div className="cli-body">
          {state.cliLog.map((entry, i) => (
            <div key={`${entry.at}-${i}`}>
              <span className="cli-time">{entry.at}</span> <span className="cli-sigil">$</span> {entry.command}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
