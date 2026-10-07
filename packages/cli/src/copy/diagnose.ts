/**
 * 진단 모드가 **새로 내는** cli 문구 모음.
 *
 * **정본은 이 파일이 아니라 `docs/design/diagnostic-mode.md` 의 `## 문구` 표다** (기능 문서
 * 결정 9 · DM-15). 표의 cli 줄과 이 모음은 양방향으로 같아야 한다 — 표에만 있거나 여기에만
 * 있는 문구가 생기면 `test/copy/diagnose.test.ts` 가 깨진다. 문구를 바꾸려면 표를 먼저 고친다.
 *
 * 문구 꼴은 문장이 아니라 단어다 (DM-15) — 끝 글자 `다`/`요` 없음 · 권유 없음 · 평가 낱말 없음.
 * 기존 문구(`측정을 시작했습니다.` 같은 합쇼체)는 대상이 아니다 (plan D10).
 *
 * 남의 문구는 여기 없다 — doctor 진단 줄과 start 고지 줄의 주인은 core 다(`DIAGNOSE_COPY`).
 * cli 는 그 값을 받아 찍기만 한다.
 */
export const DIAGNOSE_CLI_COPY = {
  /** `start --help` 의 `--diagnose` 설명. 기본값 표시 없이 한 줄 (`(default: …)` 가 붙지 않게). */
  helpDiagnose: '진단 세션 — atrace slice 기록 · 최대 10분',
  /**
   * `start` · `status` 라벨 줄 — 진단 세션에만. 라벨은 기존 줄처럼 영어 10칸 고정이다.
   * 값 자리가 없는 고정 문구라, 범위(`am · wm · view`)와 시간(`10분`)이 core 상수와 같은지는
   * 시험이 대조한다.
   */
  labelLine: 'Diagnose  atrace am · wm · view + 앱 slice · 최대 10분',
  /** `runs` 행 꼬리 태그 — 진단 세션 기록에만. 기존 꼬리(`경고 N · …`) 맨 끝에 붙는다. */
  runsTag: '진단',
} as const
