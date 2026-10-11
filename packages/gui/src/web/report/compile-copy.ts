/**
 * 컴파일 상태(baseline-profile)가 **보고서에 새로 내는** 문구 모음 — 머리 옵션 칸 · 맥락 카드 · 진단 카드 ·
 * `slice 수` 새 행.
 *
 * **정본은 이 파일이 아니라 `docs/design/baseline-profile.md` 의 `## 문구` 표다** (gui 줄 · BP-6). 표의 낱말과
 * 이 모음은 양방향으로 같아야 한다 — `test/report-copy.test.ts` 가 대조한다. 문구를 바꾸려면 표를 먼저 고친다.
 * 꼴은 단어다 (DM-15). 상태 문자열(`speed-profile` · `cmdline`)은 기기 원문이라 여기 없다 (결정 2).
 *
 * 머리 행 2 의 필드 이름 넷(`abi` …)은 우리말로 옮기지 않는다 — ⌘F 가 `result.json` 에 닿게 필드 이름 그대로다.
 */
export const COMPILE_REPORT_COPY = {
  /** 머리 `옵션` 칸 꼬리 — `--compile` 세션에만 (`--launch` 뒤). */
  headOption: '--compile {value}',
  /** 맥락 섹션 끝 카드 제목 (결정 16). */
  cardApp: '컴파일 상태 (전 → 후)',
  /** 바꾼 기록 단어 줄 — `session.compile` 의 `value` · `command` · `elapsed_ms`. */
  recValue: '바꾼 값',
  recCommand: '보낸 명령',
  recElapsed: '걸린 시간',
  /** 바꾼 기록이 없는 새 세션 — 단어 줄 · 값 (결정 15 · 배지에 안 셈). */
  recNone: '바꾼 기록',
  notChanged: '바꾸지 않음',
  /** 때 — 못 읽은 때 기록 행의 단어 · 때 행 첫 칸. */
  whenBefore: '바꾸기 전',
  whenStart: '시작',
  whenEnd: '끝',
  /** 표 칸 — 때 · `status` · `reason` · `location`. 앱 `status` 는 컴파일 필터다 (결정 14). */
  colWhen: '때',
  colFilter: '컴파일 필터',
  colReason: '컴파일 이유',
  colLocation: '파일 위치',
  /** 머리 행 2 — 필드 이름 그대로. */
  fieldAbi: 'abi',
  fieldPrimaryAbi: 'primary_abi',
  fieldSecondaryDex: 'secondary_dex',
  fieldPublicDex: 'public_dex',
  /** 그 때 배열에 그 `path` + `abi` 줄이 없음 — `null` 이 아니다 (배지에 안 셈). */
  lineMissing: '줄 없음',
  /** 진단 탭 카드 제목 — `location=…` slice. */
  cardSlices: '컴파일 상태 slice',
  /** 진단 slice 의 `status` — oat 파일 상태 (결정 14 · compiler filter 는 `filter`). */
  colOatStatus: 'oat 파일 상태',
  /** 진단 `[]` — 재 봤더니 0개 (배지에 안 셈). */
  slicesEmpty: '컴파일 상태 slice 없음',
  /** `slice 수` 끝 행 단어 — `target_process_jit_slices`. */
  jitWord: 'JIT 컴파일 slice',
} as const
