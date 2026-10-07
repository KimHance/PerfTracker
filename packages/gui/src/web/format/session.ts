import type { RunView } from '../../contract/api.js'
import type { Tab } from '../state/model.js'
import { DIAGNOSE_MEASURE_COPY } from './diagnose.js'
import { formatElapsed, formatRunAt } from './time.js'

/**
 * 탭 · 측정 중 화면 · 기록 드로어에 찍히는 **세션 표시 줄**. 순수 함수만 둔다.
 *
 * 컴포넌트 안에서 JSX 조각으로 이어 붙이던 것을 여기로 모았다 — 진단 세션 표시(DM-12)가 넷으로
 * 흩어지는데 DOM 시험 도구가 없어서, 화면이 무슨 글자를 내는지는 이 함수들로만 확인할 수 있다.
 * **평소 세션 · 기록이면 지금까지와 같은 글자**를 내고, 진단 표시는 진단일 때만 붙는다.
 *
 * 진단 여부는 탭의 `diagnose` 다 — 측정 중에는 서버가 실제로 연 세션이 정본이라(`effects` ·
 * `sessions/loaded`) 토글 값이 아니다.
 */

/** 탭 스트립 배지. 측정 중이면 경과 `mm:ss` (진단 세션은 `진단 mm:ss`), 설정 중이면 `준비`. */
export function tabBadge(tab: Tab, elapsedMs: number): string {
  if (tab.phase !== 'running') return '준비'
  const elapsed = formatElapsed(elapsedMs)
  return tab.diagnose ? DIAGNOSE_MEASURE_COPY.tabBadge.replace('{elapsed}', elapsed) : elapsed
}

/** 측정 중 화면 킥커. 기존 `측정 중` 뒤에 진단 세션만 ` · 진단`. */
export function runningKicker(tab: Tab): string {
  return tab.diagnose ? `측정 중 · ${DIAGNOSE_MEASURE_COPY.kickerTail}` : '측정 중'
}

/**
 * 측정 중 화면에 진단 세션만 더하는 두 줄.
 *
 * - `notice` — 앱 slice 열림이 "모름" 칸일 때의 고지. **core 가 쓴 문장 그대로**이고 화면이
 *   판정하지 않는다 (DM-10). 진단 세션이어도 열리면 `null`.
 * - `footnote` — 각주 둘째 줄. slice 비용이 앱 프로세스 몫이라 평소 세션과 수치를 나란히 놓을 수
 *   없다는 사실 (DM-12).
 *
 * 평소 세션이면 둘 다 `null` 이다 — 고지 칸에 무엇이 남아 있어도 진단이 아니면 찍지 않는다.
 */
export function runningDiagnoseLines(tab: Tab): { notice: string | null; footnote: string | null } {
  if (!tab.diagnose) return { notice: null, footnote: null }
  return { notice: tab.diagnoseNotice, footnote: DIAGNOSE_MEASURE_COPY.footnote }
}

/**
 * 기록 드로어의 mono 메타 줄 — `MM/DD HH:MM · mm:ss · launch|attach · 경고 N[ · 미지원 N][ · 마킹 N][ · 진단]`.
 * 진단 태그는 **맨 끝**이다. 드로어가 좁으면(924 에서 295px) 이 줄은 잘리지 않고 줄바꿈된다.
 */
export function runMetaLine(run: RunView): string {
  const parts = [
    formatRunAt(run.at),
    formatElapsed(run.durationMs),
    run.launch ? 'launch' : 'attach',
    `경고 ${run.warningCount}`,
  ]
  if (run.unsupportedCount > 0) parts.push(`미지원 ${run.unsupportedCount}`)
  if (run.markCount > 0) parts.push(`마킹 ${run.markCount}`)
  if (run.diagnose === true) parts.push(DIAGNOSE_MEASURE_COPY.drawerTag)
  return parts.join(' · ')
}
