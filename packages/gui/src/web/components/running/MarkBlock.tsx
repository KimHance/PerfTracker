import { addMark, removeMark } from '../../effects/effects.js'
import { formatElapsed } from '../../format/time.js'
import { elapsedMs } from '../../state/derive.js'
import type { Tab } from '../../state/model.js'
import { useStore } from '../../state/StoreContext.jsx'

/** 사람이 자주 남기는 사건. 한 번 눌러 바로 마킹된다 — 타이핑하는 동안 순간은 지나간다. */
const QUICK_MARKS = ['앱 진입', '스크롤 시작', '영상 재생', '화면 전환']

/**
 * 마킹 — 측정 중 사람이 남기는 이벤트 라벨.
 *
 * **기기로 나가지 않는다.** 서버가 활성 세션 포인터(호스트의 파일)에 쓰고, 정지할 때
 * `result.json` 의 `session.marks[]` 가 된다. 측정 창 안에서 adb 를 부르지 않는다는
 * 규칙(core 규칙 1)은 GUI 에서도 그대로다.
 *
 * 같은 세션에 터미널에서 `perftracker mark "스크롤 시작"` 을 쳐도 같은 자리에 쌓인다.
 */
export function MarkBlock({ tab }: { tab: Tab }) {
  const { state, dispatch, deps } = useStore()
  const elapsed = elapsedMs(tab, state.now)
  const canAdd = tab.markDraft.trim() !== ''

  const submit = (label: string): void => void addMark(deps, tab, label)

  return (
    <div className="marks">
      <div className="marks-head">
        <span className="kicker">마킹</span>
        <span className="marks-hint">이벤트가 일어난 순간에 이름을 남기면 경과 시간과 함께 기록됩니다</span>
      </div>

      <div className="marks-input-row">
        <input
          className="input"
          style={{ flex: 1, minWidth: 0 }}
          value={tab.markDraft}
          placeholder="예: 홈 진입, 스크롤 시작, 광고 재생"
          onChange={(e) => dispatch({ type: 'tab/patched', key: tab.key, patch: { markDraft: e.target.value } })}
          onKeyDown={(e) => {
            // Enter 로도 등록된다 — 버튼까지 마우스를 옮기는 동안 몇 초가 흐른다.
            if (e.key === 'Enter' && canAdd) submit(tab.markDraft)
          }}
        />
        <button
          className="btn btn-secondary btn-lg"
          style={{ minWidth: 96, fontSize: 12.5 }}
          disabled={!canAdd}
          onClick={() => submit(tab.markDraft)}
        >
          마킹 @ {formatElapsed(elapsed)}
        </button>
      </div>

      <div className="chip-row">
        {QUICK_MARKS.map((label) => (
          <button
            key={label}
            className="btn btn-ghost"
            style={{ height: 28, fontSize: 11.5 }}
            onClick={() => submit(label)}
          >
            + {label}
          </button>
        ))}
      </div>

      {tab.marks.length > 0 && (
        <>
          {/* 화면은 최신순으로 보여 주되 삭제는 서버가 준 원래 인덱스로 한다 —
              뒤집힌 순서의 인덱스를 그대로 보내면 엉뚱한 마킹이 지워진다. */}
          <div className="marks-list">
            {tab.marks
              .map((mark, index) => ({ mark, index }))
              .reverse()
              .map(({ mark, index }) => (
                <div key={`${index}-${mark.offsetMs}`} className="mark-row">
                  <span className="mark-offset">{formatElapsed(mark.offsetMs)}</span>
                  <span className="mark-label">{mark.label}</span>
                  <button
                    className="mark-remove"
                    aria-label={`마킹 "${mark.label}" 삭제`}
                    onClick={() => void removeMark(deps, tab, index)}
                  >
                    ×
                  </button>
                </div>
              ))}
          </div>
          <div className="marks-foot">
            {tab.marks.length}개 · result.json 의 session.marks[] 로 저장됩니다
          </div>
        </>
      )}
    </div>
  )
}
