/**
 * **모든 시계열이 공유하는 시간 기준점.**
 *
 * `trace_bounds.start_ts` 는 트레이스 전체의 시작이라 지표와 무관하게 같은 값이다.
 * 지표마다 "자기 첫 표본" 을 0 초로 잡으면 안 된다 — 프레임은 앱이 처음 화면을 그린 순간,
 * 메모리는 첫 폴링 순간이라 서로 다르고, 그러면 **여러 그래프를 겹쳐 그렸을 때 시간축이
 * 어긋난다.** 무엇이 언제 일어났는지를 보려고 만드는 값이 정작 그것을 못 하게 된다.
 *
 * frame · memory · cpu · log 가 전부 이 상수를 쓴다. 이 파일에 두는 이유는 그 넷 중 어느
 * 하나에 두면 나머지 셋이 그것을 가져다 쓰는 모양이 되기 때문이다 (cpu 가 frame 의 상수를
 * import 하는 것은 계층을 말해 주지 않는다).
 */
export const TRACE_START_SUBQUERY = '(select start_ts from trace_bounds)'

/** 상대 초를 정수로 내는 SQL 조각. 나노초 컬럼 이름만 받는다. */
export function relativeSecondSql(tsColumn: string): string {
  return `cast((${tsColumn} - ${TRACE_START_SUBQUERY}) / 1000000000 as int)`
}
