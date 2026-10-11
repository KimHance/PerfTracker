/**
 * 진단 모드가 **새로 내는** core 문구 모음.
 *
 * **정본은 이 파일이 아니라 `docs/design/diagnostic-mode.md` 의 `## 문구` 표다** (기능 문서
 * 결정 9 · DM-15). 표의 core 줄과 이 모음은 양방향으로 같아야 한다 — 표에만 있거나 여기에만
 * 있는 문구가 생기면 시험이 깨진다. 문구를 바꾸려면 표를 먼저 고친다.
 *
 * 값 자리는 표와 같은 `{이름}` 자리표시로 둔다. 채우는 것은 `fillCopy` 하나다 — 문구를 템플릿
 * 리터럴로 흩어 쓰면 표와 대조할 원문이 코드에서 사라진다.
 *
 * 문구 꼴은 문장이 아니라 단어다 (DM-15) — 끝 글자 `다`/`요` 없음 · 권유 없음 · 평가 낱말 없음.
 * 기존 문구(`metricSupportChecks` 의 "측정 가능" 같은 합쇼체)는 대상이 아니다 (plan D10).
 */
export const DIAGNOSE_COPY = {
  /** doctor 검사 이름. 이 기기에서 진단 세션의 앱 slice 가 열리나. */
  doctorName: 'diagnose: app slice',
  /** doctor 상세 · ✓ — 조건 표 sdk ≥31 칸. */
  doctorOpen: 'sdk {sdk} · 열림',
  /** doctor 상세 · ✗ — 조건 표 sdk ≤30 칸. 앱을 정하기 전이라 debuggable 을 모른다. */
  doctorDebuggableOnly: 'sdk {sdk} · debuggable 앱만 열림',
  /** start 고지 · running 고지 — "모름" 칸, 앱이 debuggable 이 아님을 확인한 경우. 세션은 열린다. */
  noticeNotDebuggable: '앱 slice 열림 모름 — sdk {sdk} · debuggable 아님',
  /** start 고지 · running 고지 — "모름" 칸, debuggable 을 읽지 못한 경우. */
  noticeDebuggableUnknown: '앱 slice 열림 모름 — sdk {sdk} · debuggable 모름',
  /**
   * `app_slices_open_unknown` 의 reason — 열림이 null 인 이유, debuggable 이 아님을 확인한 경우.
   * `result.json` 의 `diagnose.app_slices_open_reason` 으로 나가고 보고서 열림 행 title 이 된다.
   */
  reasonNotDebuggable: 'sdk {sdk} · debuggable 아님 · profileable 읽을 출처 없음',
  /** `app_slices_open_unknown` 의 reason — debuggable 을 읽지 못한 경우. */
  reasonDebuggableUnknown: 'sdk {sdk} · debuggable 모름 · profileable 읽을 출처 없음',
  /**
   * `ftrace_not_recorded` 의 reason — 원본에 CPU 별 ftrace 통계가 한 행도 없다 (ftrace 가 안 돌았다).
   * 블록 `reason` 으로 나가고 보고서 카드 제목 title 이 된다 (plan D35).
   */
  reasonFtraceNoStats: 'ftrace 기록 없음 · 원본에 ftrace 통계 0행 · slice 수 모름',
  /**
   * `ftrace_setup_errors` 의 reason — traced_probes 가 ftrace 를 켜다 낸 오류가 있다. `{count}` = 오류 수.
   * ftrace 는 돌았으므로 slice 수 · 표는 잰 그대로 싣고, 어느 이벤트가 빠졌는지만 모른다 (plan D37).
   */
  reasonFtraceSetupErrors: 'ftrace 설정 오류 {count}건 · slice 수 잰 그대로 · 빠진 이벤트 모름',
} as const

/**
 * `{이름}` 자리표시를 값으로 채운다. **값이 없는 자리는 그대로 남긴다** — 빈 문자열로 지우면
 * 문구가 사실과 다른 말(`sdk  · 열림`)을 하는데 그것을 알아챌 방법이 없다.
 */
export function fillCopy(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : whole,
  )
}
