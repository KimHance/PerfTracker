/**
 * 진단 모드가 측정 화면에 **새로 내는** 문구 모음.
 *
 * **정본은 이 파일이 아니라 `docs/design/diagnostic-mode.md` 의 `## 문구` 표다** (기능 문서
 * 결정 9 · DM-15). 표의 gui 줄 중 측정 화면 자리(04 옵션 행 · 탭 배지 · running 킥커 · 각주 ·
 * 기록 드로어)와 이 모음은 양방향으로 같아야 한다 — 표에만 있거나 여기에만 있는 문구가 생기면
 * `test/format/diagnose-copy.test.ts` 가 깨진다. 문구를 바꾸려면 표를 먼저 고친다.
 * 보고서 자리의 gui 줄은 보고서 쪽 모음이 갖는다.
 *
 * 문구 꼴은 문장이 아니라 단어다 (DM-15). 기존 문구(`측정 중` · `준비` · `경고 N` 같은 것)는
 * 대상이 아니고 그대로 둔다 (plan D10).
 *
 * 남의 문구는 여기 없다 — running 고지 줄과 환경 점검 진단 줄의 주인은 core 다. 화면은 서버가
 * 실어 준 그 글자를 찍기만 한다 (`Tab.diagnoseNotice` · `DoctorCheckView`).
 */
export const DIAGNOSE_MEASURE_COPY = {
  /** 04 세션 옵션 행 설명 (`--diagnose`). 무엇을 · 얼마나. */
  optionDesc: 'atrace slice 기록 (am · wm · view · dalvik + 대상 앱) · 최대 10분',
  /** 탭 배지 — 진단 세션 측정 중. `{elapsed}` = 경과 `mm:ss`. */
  tabBadge: '진단 {elapsed}',
  /** running 킥커 꼬리 — 기존 `측정 중` 뒤에 ` · ` 로 붙는다. */
  kickerTail: '진단',
  /** running 각주 둘째 줄 — slice 비용이 앱 프로세스 몫 · 평소 세션과 비교 불가 (DM-12) · 최대 시간. */
  footnote: '진단 · slice 비용 앱 프로세스 몫 · 평소 세션과 비교 불가 · 최대 10분',
  /** 기록 드로어 메타 줄 꼬리 — 진단 세션 기록에만. 기존 꼬리 맨 끝에 ` · ` 로 붙는다. */
  drawerTag: '진단',
} as const
