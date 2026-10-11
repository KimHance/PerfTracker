# 다시 볼 결정 — DECISIONS-TO-REVISIT

메인(오케스트레이터)이 대신 정했거나, 구조 · 기술로 정해서 기능 문서 · 디자인 문서에는 결과만 남은 결정.
뒤집을 때는 지우지 않고 상태를 `뒤집힘 → <새 줄>` 로 바꾼다.

## 2026-10-08 · diagnostic-mode (진단 모드)

| # | 결정 | 고른 것 | 왜 | 누가 | 다시 볼 때 |
|---|---|---|---|---|---|
| 1 | 진단 여부를 result.json 에 싣는 자리 | 진단 세션일 때만 `session.options.diagnose` · 최상위 `diagnose` — 평소 파일엔 키 0 | 평소 파일 모양 그대로 · `additionalProperties:false` 캐시 스키마 CI 가 모든 새 파일을 거부하지 않게 | 메인 | 평소에도 `diagnose: false` 를 싣고 싶어질 때 |
| 2 | atrace 켜짐 대기 | 진단 + `--launch` 일 때만 같은 셸 호출 안 최대 5초 · 측정 창 전에 속성 읽기만 | 실기기에서 대기 없으면 bindApplication 0 · 넣고 1 · 1 (68.2 · 66.2 ms) | 메인 | 5초를 넘긴 회가 흔적 없이 지나가는 게 문제가 될 때 |
| 3 | 기기 atrace 속성 | 도구는 고치지도 되돌리지도 않는다 · perfetto 가 `debug.atrace.app_0` 에 마지막 패키지를 남기는 것은 관측 사실 | 측정 창 규칙 · 감시를 넣으면 평소 세션 명령 목록이 바뀜 | 메인 | 다른 도구가 그 속성 때문에 앱 slice 를 잘못 켤 때 |
| 4 | 설정 검증기 | 허용 목록 (am · wm · view + 대상 앱 하나) · 따옴표 밖 `#` 거부 · textproto 를 파싱하지 않고 따옴표 경계만 훑음 | 블랙리스트는 옛 FORBIDDEN_FTRACE_EVENTS 구멍과 같음 | 메인 | **후속**: 키 뒤 따옴표 · 붙은 문자열(perfetto main) · `ftrace_events` 콜론 꼴은 perfetto 와 경계가 다름 — 빌더는 그 꼴을 안 냄 (config 18,688개 거부 0) |
| 5 | slice 이름 접기 | 숫자가 섞인 ASCII 영숫자 토큰 → `*` · 접기 전 고유 이름 수 함께 | 실측 4,921 → 1,082행 · `tk-trace-id` 1,317 중 1,315 접힘 | 메인 | 숫자 없는 base36 토큰이 행을 불릴 때 |
| 6 | ftrace 못 잼 · 켜기 오류 | 통계 0행 → `ftrace_not_recorded` (slice 칸 null) · 켜기 오류만 → `ftrace_setup_errors` (잰 값 그대로 · partial) · reason_code 39 | 값 있음 · 없음이 정반대인 둘을 한 코드로 두면 CI 가 못 가름 · 1.2.0 미출시라 지금이 가장 쌈 | 메인 | **후속**: `ftrace_cpu_*` 행 수 증거 쿼리는 trace_processor 바이너리가 있을 때만 시험으로 지켜짐 · `process_not_in_trace` 가 켜기 오류를 가림 |
| 7 | 열림 모름일 때 블록 status | `collected` — 열림은 `app_slices_open_reason_code` 가 따로 말함 | 기능 문서 결정 8 (열림은 따로 칸) | 메인 | `status === 'collected'` 만 보는 CI 가 열림 모름을 거르고 싶을 때 |
| 8 | slice 표 그리기 | 다 그림 (가상 스크롤 없음) | 10⁴행 mount 0.47–0.75 s · ⌘F 가 화면 밖 이름을 찾음 · 가변 행 높이 측정 코드 0 | 메인 | 10분 진단에서 행이 10⁴ 를 크게 넘을 때 (390 첫 정렬 최대 1.4 s) |
| 9 | 정지 뒤 `--diagnose` 토글 | 끈다 (`--launch` · `--force` 는 남김) | 진단은 무거운 세션 — 다음 세션이 실수로 진단으로 시작하지 않게 | 메인 | 진단을 여러 번 연달아 돌리는 쓰임이 잦을 때 |
| 10 | 마킹 있는 진단 기록의 `runs` 행 | 86칸을 받아들임 (DM-11 「80칸 안」 의 예외) | 기존 꼬리(`경고 · 마킹` 79칸)를 줄이면 기존 문구 그대로(D10) 위반 | 메인 | 기존 문구를 손볼 작업이 생길 때 |
| 11 | 디자인 문서 `## 문구` 표 core 줄 2개를 개발 워커가 더함 | 주인 예외 | DM-15 「표에만 · 코드에만 0」 을 깨지 않으려면 표가 먼저 · 디자이너는 그때 없었음 | 메인 | — |
| 12 | 오피스 진행 — 검수 2차를 코드 하나에 명세를 합쳐 돌림 · gui 화면 둘을 gui-server 검수와 동시에 시작 | 단계 5 시간 절약 | 고칠 것이 기계적일 때 | 메인 | 합친 검수가 놓친 것이 나오면 |
| 13 | 메인 정지 (04:32–06:43) | 워커 보고 알림이 메인 터미널에 안 들어와 2시간 넘게 멈춤 → 메인이 백그라운드 `check --wait` 로 스스로 깸 | 알림 주입은 best-effort (Orca 가이드) | 메인 | 오피스 모드 플러그인에 기본 동작으로 넣을지 |

## 2026-10-11 · baseline-profile (컴파일 상태 · 보고서 가독성)

| # | 결정 | 고른 것 | 왜 | 누가 | 다시 볼 때 |
|---|---|---|---|---|---|
| 1 | 컴파일 상태를 싣는 세션 (B17) | 모든 세션 — 평소 `result.json` 의 `target_app` 키가 바뀜 · 캐시한 1.1.0 스키마는 평소 산출물도 거부 (README 1.2.0 문단). 위 diagnostic-mode #1(켤 때만 키)과 다른 길 | 상태 비교가 가장 필요한 것이 평소 세션 · 1.2.0 미출시라 지금이 가장 쌈 | 메인 | 1.1.0 스키마를 캐시한 소비자가 있다는 말이 나올 때 |
| 2 | 컴파일 상태 필드 (B23) | `target_app.compile_state_start` · `_end` + 각 `_reason_code` · `_reason` · dex × ABI 한 줄 = 한 항목 · 줄에 `secondary_dex` · `public_dex` · schema 1.2.0 그대로 | 진단 `app_slices_open` 꼴 · `before/after` 는 BP-4 「바꾸기 전」 과 겹침 | 메인 | dex 별로 묶은 꼴이 필요할 때 |
| 3 | 새 reason_code · 진단 ART 칸 이름 (B24 · B29) | `dexopt_state_section_missing` · `_package_missing` · `_unparsable` · `_unavailable` (39 → 43) + `dalvik_not_recorded` · `compile_state_slice_unparsable` (→ 45) · `target_process_compile_state_slices` · `target_process_jit_slices` + 짝 | 갈래마다 대응이 다르고 detail 은 result.json 에 안 실림 | 메인 | 공용 enum 이 너무 커질 때 (진단 전용 enum 으로 나눌지) |
| 4 | 바꾼 기록 자리 (B31) | `session.compile` — `value` · `command` · `elapsed_ms` · `compile_state_before` + 짝 · `--compile` 세션에만 | `session.options` 는 켠 옵션 표시 · #2 꼴 | 메인 | — |
| 5 | compile 뒤 실패 (B32) | `CompileAppliedError` 로 감쌈 — 원래 오류는 `cause` · 늘 PerfTrackerError 라 예상 못 한 오류도 이 길 (cli 가 `cause` 로 갈라 옛 머리 · 스택을 찍음) | 기기는 바뀌었는데 되돌림 줄 0 이던 구멍 (규칙 3) | 메인 | 감싼 오류가 다른 오류 처리(종료 코드 · 로그)를 가릴 때 |
| 6 | `--json` 의 compile 칸 (B33 · B34 #1 #2) | core `RunSummary.compile` (camelCase · `--compile` 기록에만 · 뒤 상태는 result.json 에서만) · `status --json` 은 최상위 `compile` 과 `session.compile`(snake_case 원본)이 같이 나감 | cli 는 파일을 안 읽음(core 몫) · 이웃 칸 꼴 | 메인 | `--json` 소비자가 두 꼴을 헷갈릴 때 |
| 7 | 문구가 디자인 표보다 먼저 (B25) | core 새 문구(경고 1 · 사유 4 + 2)를 코드가 먼저 넣고 디자인 문서 `## 문구` 표로 올림 · 표가 정본 | 디자인 문서가 그때 브랜치에 없었음 — diagnostic-mode #11 과 같은 주인 예외 | 메인 | 디자인 단위를 개발보다 먼저 합칠 수 있을 때 |
| 8 | 디자이너 기본값 (B28) | 사람 몫 11개(글자 층 · 첫 섹션 `지표` · 타일 단위 · 라벨 단어 · 차트 낱말 · dex 표 · `컴파일 필터`/`oat 파일 상태` · CLI 줄 · `지금 모름` 등)를 받음 — 디자인 문서가 정본 | 단계 5 · 기능 문서 바닥값 안 · 검토가 따로 봄 | 메인 | 사용자가 화면을 보고 낱말 · 층을 다시 고를 때 |
| 9 | 보고서 배지 결함을 범위에 (B6 · B22 · B37) | 잰 0(`[]`)을 미수집으로 세던 배지 — 목록 · 차트 · 전/후 표 · 주파수를 낱말로 · 셈은 그린 글자를 따름 · 진단 둘 다 null 이면 2 (B30) | 사용자가 보는 숫자가 틀림 (규칙 3) | 메인 | 배지 셈 규칙이 화면 · 시험 세 벌(`placeholderOf` · `drawn` · `want`)에서 갈릴 때 |
| 10 | 컴파일 카드 위치 행 · `보낸 명령` 줄바꿈 (B42 · B40) | 같은 `location` 은 머리 아래 한 번 · 깃발 토큰 안 줄바꿈 0 | 되풀이가 카드 높이 46 ~ 50% · `-` / `m` 이 갈림 | 메인 | 접힌 위치 줄 때문에 때마다 다른 dex 를 놓쳤다는 말이 나올 때 |
| 11 | 렌더 결과 시험 (B39) | 루트 `tsconfig.test.json` 에 `"jsx": "react-jsx"` · `report.test.ts` 에 `/// <reference lib="dom" />` | 타입 검사를 빼지 않고 새 의존성 0 · 약점: 시험 컴파일 전체에 DOM 타입 | 메인 | 다른 시험이 DOM 전역을 실수로 쓸 때 |
| 12 | 실기기 단위 나눔 (B35 · B41) | device-bp(BP-9 · DM-16 회귀)를 rr-layout 과 나란히 · RR-9 재료(평소 1 · 진단 1)는 잠금이 풀린 때 device-bp 가 녹화 · 그리기 · 측정은 마지막 단위가 기기 없이 | 끝을 당김 · 잠금 해제를 다시 부탁하지 않음 | 메인 | — |
| 13 | 실기기 잠금 (B36 · B38 · B38a) | 비보안 잠금만 adb 로 깨움 · 보안 잠금(PIN)은 사람에게 · 잠긴 채 돈 회 25/27 은 기대값을 안 바꾸고 기록 · 사람이 푼 뒤 27/27 | PIN 은 사람 몫 · 화면 꺼짐 설정 안 바꿈 | 메인 | 온-디바이스 스펙이 잠금 상태를 먼저 확인하게 할 때 |
| 14 | 사용자 폰 상태 (B7 · B12) | 실기기 시험이 YouTube 컴파일 상태를 바꾼 것을 받아들임 — base.apk `reason` `profile-utilization` → `cmdline` · 보조 dex 처음과 다름 · `debug.atrace.app_0` 남음 | "유튜브로 테스트" · 정확히 되돌릴 명령 없음 | 메인 | 사용자가 폰 YouTube 를 되돌리고 싶을 때 (재설치) |
| 15 | diagnostic-mode #4 허용 목록 | am · wm · view · **dalvik** + 대상 앱 하나 (DM 결정 36) — 위 #4 줄은 그때 사실 | 진단 세션에서 ART 신호 (BP-7) | 메인 | — |
| 16 | 운영 — 질문 답이 워커에 안 닿음 (bp-core-art) | 메인 `send` 가 ok 였는데 워커는 답 없음으로 기본값 → `[object Object]` · 고침 1 에서 반영 | 막힌 `ask` 에는 `reply` 로 답해야 닿음 | 메인 | 오피스 모드 플러그인 안내에 넣을지 |
