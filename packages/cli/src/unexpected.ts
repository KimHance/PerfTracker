/**
 * 예상 못 한 오류(PerfTrackerError 가 아닌 것)를 사람에게 보이는 꼴. **한 곳에 둔다** — 진입점(`index.ts`)과
 * compile 뒤 실패의 되돌림 줄(`commands/compile.ts`)이 같이 부른다. 두 곳에 문자열로 적으면 한쪽만 고쳐져
 * 같은 종류의 오류가 명령마다 다른 머리로 나간다.
 *
 * 사용자가 보는 첫 줄은 한국어 문장이고, 진단용 스택은 그 뒤에 붙인다.
 */
export const UNEXPECTED_ERROR_HEAD = '예상치 못한 오류가 발생했습니다. 아래 내용과 함께 이슈로 알려주세요.'

export function unexpectedErrorText(e: unknown): string {
  return `${UNEXPECTED_ERROR_HEAD}\n${e instanceof Error ? (e.stack ?? e.message) : String(e)}`
}
