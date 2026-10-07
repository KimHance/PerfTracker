# 진단 모드 — atrace 구간을 평소 측정과 따로 기록

| 항목 | 값 |
|---|---|
| 기능 | diagnostic-mode |
| 마지막 변경 | 2026-10-08 · 처음 — atrace 를 평소 측정에서 떼어 진단 세션으로 |
| 디자인 | docs/design/diagnostic-mode.md |
| 항목 ID | DM-<번호> (예 DM-3) |

지표 · 스키마 · 명령의 정본은 README 다. 이 문서는 **무엇이 되어야 하나**만 적고, 필드 이름 · 옵션 표 · 문구는
README 와 디자인 문서가 정한다. 근거 실측은 2026-10-07 SM-S901N(R5CT0000001 · sdk 36) · YouTube 21.29.366.

## 기획

### 왜

- 평소 세션은 수치만 낸다 — 프레임 · CPU · 메모리 · 시작 시간. 그 시간에 앱이 **무엇을** 했는지(구간 이름)는 없다.
- atrace 를 켜면 구간이 보이지만 비용이 크다. 구간 비용(구간당 ~5µs)은 **앱 프로세스 자신**에게 청구되고
  `measurement_overhead` 에 잡히지 않는다. 평소 세션에 섞으면 README 「이 도구가 지키는 두 가지」 1번과 부딪힌다.
- 그래서 평소 측정과 갈라진 **진단 세션**으로 켠다. 진단 세션의 수치는 평소 세션과 나란히 놓을 수 없다는 사실이
  기계에도 사람에게도 보여야 한다.
- 지금 설정 검증(`assertLowOverheadConfig`)은 `ftrace_events` 만 본다 — atrace 카테고리 · 앱은 검사 없이 통과한다.

### 누구

| 누가 | 언제 쓰나 |
|---|---|
| 앱 성능을 보는 사람 | 평소 세션에서 수치를 본 뒤, 그 구간에 어떤 프레임워크 · 앱 구간이 돌았는지 이름으로 보고 싶을 때 |
| 데이터를 읽는 쪽 (CI · LLM) | `result.json` 에서 진단 세션을 거르거나, 구간 표를 읽을 때 |

### 흐름

1. `perftracker doctor` → 이 기기에서 진단 세션의 앱 구간이 열리는지 한 줄
2. `perftracker start … --<진단 옵션>` (또는 측정 화면 04 세션의 진단 토글) → 세션 표시 줄에 진단 · 못 여는 경우 고지 줄
3. 앱 조작 — 도구는 기기를 건드리지 않는다. `status` 에도 진단 표시
4. `perftracker stop` → `result.json` 경로 + 보고서 명령 (요약 없음 — 평소와 같음)
5. 보고서 → 머리에 진단 표시 · 진단 탭(켠 것 · 앱 구간 상태 · 구간 이름 표 · 원본 경로)
6. 더 깊이 → 원본 `trace.perfetto-trace` 를 Perfetto UI 로
7. 기록 목록(`runs` · 기록 드로어) → 진단 태그로 평소 세션과 갈림

### 결정

| # | 날짜 · run | 결정 | 왜 | 누가 | 상태 |
|---|---|---|---|---|---|
| 1 | 2026-10-07 · diagnostic-mode | atrace 는 평소 측정과 떼어 진단 세션에서만 | "진단 모드로 돌리게끔 하는 게 목적" | 나 | 정함 |
| 2 | 2026-10-07 · diagnostic-mode | 실기기 검증은 SM-S901N · YouTube | "유튜브로 테스트하면서 해" | 나 | 정함 |
| 3 | 2026-10-07 · diagnostic-mode | 표기는 문장보다 단어 · AI 말투 없이 | 지시 원문 | 나 | 정함 |
| 4 | 2026-10-08 · diagnostic-mode | sdk ≥31 에서 앱 구간은 profileable 을 요구하지 않는다 | profileable 이 아닌 YouTube(heapprofd · java_hprof 거부 로그)에서 15초 앱 구간 23,762–26,479개 실측. profileable 이 여는 Trace API 는 Android 11 이하 한정(문서) | 워커 | 정함 |
| 5 | 2026-10-08 · diagnostic-mode | 진단 데이터는 `metrics` 밖 별도 자리 | 지표 8개는 모든 세션의 계약 · README 지표 개수 시험 · 진단은 세션 종류에 딸린 것 | 워커 | 정함 |
| 6 | 2026-10-08 · diagnostic-mode | 구간을 시간축 그림(트랙 · 불꽃)으로 그리지 않는다 — 이름별 표 + 원본 경로 | 원본을 남기므로 Perfetto UI 가 그 일을 한다 · 15초에 구간 8–10만 | 워커 | 정함 |
| 7 | 2026-10-08 · diagnostic-mode | 구간 표는 자르지 않고, 처음 순서는 이름순 | "느린 구간 Top N" 도 판정이다 (규칙 2) | 워커 | 정함 |

### 안 하는 것

| 안 한다 | 왜 (한 마디) |
|---|---|
| 구간 시간축 그림 (트랙 · 불꽃 그래프) | Perfetto UI 몫 · 원본을 남긴다 |
| 느린 구간 Top N · 순위 · 강조 · 기준 비교 | 판정 (규칙 2) |
| gfx · input · sched 기록 | 비용 — gfx 15초 37 MiB(am · wm · view 6.5–8.1 MiB 의 약 5배) · sched 는 고빈도 |
| CPU 콜스택(simpleperf · linux.perf) · 힙(heapprofd · java_hprof) | atrace 가 아님 · profileable 필요 · YouTube 거부 실측 |
| 마킹 사이 구간별 집계 | 이번 범위 밖 |
| 대상 앱 말고 다른 앱의 앱 구간 | 대상 앱 하나 |
| `target_app` 에 profileable 싣기 | 읽을 출처 미확인 — 열린 질문 3 |
| 평소 세션과의 비교 · 차이 계산 | 판정 · 읽는 쪽 몫 |
| 시간축 결함(트레이스 이전 프레임) 고치기 | 진단 모드와 별개 · 실기기 재현 안 됨 |

## 명세

### 동작

앱 구간이 열리는 조건 (DM-9 가 이 표를 따른다):

| 기기 · 앱 | 앱 구간 | 근거 |
|---|---|---|
| sdk ≥31 | 켬 · 열림 | 문서(`profileable-element`) · 실측 sdk 35 emulator · sdk 36 SM-S901N. sdk 31–34 실측 없음 |
| sdk 30 · `debuggable` true | 켬 · 열림 | 문서. 실측 없음 |
| sdk 30 · `debuggable` false 또는 null | 켬 · 열렸는지 모름 | profileable 을 읽을 출처 없음 |

| ID | 동작 | 받아들임 기준 | 확인 |
|---|---|---|---|
| DM-1 | CLI 로 켜기 — `start` 에 진단 옵션 하나 | 옵션을 주면 그 세션이 진단 세션으로 열린다. 안 주면 평소 세션이고 기기로 나가는 config 가 지금과 글자 하나 다르지 않다. README 「명령 전체」 에 옵션이 있고, `packages/cli/test/readme.test.ts` 가 `start` 에 등록된 옵션이 전부 README 에 있는지 대조한다 (옵션을 README 에서 지우면 RED) | `DM-1 start 진단 옵션` · `DM-1 README 옵션 대조` |
| DM-2 | 화면으로 켜기 — 측정 화면 04 세션에 진단 토글 | 토글을 켜고 시작하면 서버가 core 에 진단 옵션을 넘기고, 시작 바 명령 예고에 같은 옵션이 붙는다. 끄면 둘 다 없다 | `DM-2 진단 토글 → 시작 요청` · `DM-2 명령 예고` |
| DM-3 | 기록 범위 — atrace `am` · `wm` · `view` + 대상 앱 하나의 앱 구간 | 진단 config 의 atrace 카테고리가 정확히 {am, wm, view}, 앱 구간 대상이 대상 패키지 하나다. `ftrace_events` 는 평소 세션과 같은 집합. 평소 세션 config 에는 atrace 카테고리 · 앱이 0개 | `DM-3 진단 config 범위` · `DM-3 평소 config 에 atrace 없음` |
| DM-4 | 설정 검증이 atrace 를 본다 | 평소 세션 config 에 atrace 카테고리나 앱이 하나라도 있으면 거부된다. 진단 config 라도 {am, wm, view} 밖 카테고리 · 대상 앱이 아닌 패키지 · 와일드카드(`*`) · 앱 둘 이상이면 거부된다. 거부는 기기 명령이 나가기 전에 일어난다 (그때까지 기기 명령 0) | `DM-4 평소 config atrace 거부` · `DM-4 진단 config 허용 밖 거부` · `DM-4 거부는 기기 접촉 전` |
| DM-5 | 기기 원상 — 끝나면 atrace 상태가 시작 전으로 | 진단 세션이 `stop` 으로 끝난 뒤 · `start --force` 나 화면의 중단으로 버려지고 평소 세션이 열린 뒤 · 최대 시간에 닿아 멈춘 뒤, 어느 경우든 기기의 `debug.atrace.tags.enableflags` 가 0, `debug.atrace.app_*` 가 빈 값이다 | 수동 (R5CT0000001 · `getprop`) |
| DM-6 | 결과 자리 — `result.json` 에서 진단 세션이 갈린다 | 진단 세션은 `session.options` 에 진단 여부 true, 평소 세션은 false 를 싣는다. 진단 세션에만 최상위 진단 블록이 있다. 이 필드들이 없는 옛 `result.json` 이 스키마를 그대로 통과한다. README 「`result.json` 읽는 법」 최상위 구조 표 · 진단 블록 절에 자리가 적혀 있다 | `DM-6 진단 여부 · 블록 자리` · `DM-6 옛 result.json 통과` |
| DM-7 | 진단 블록 내용 | 블록에: 켠 카테고리 · 앱 구간 대상 · 앱 구간 상태(메트릭과 같은 `status` · `reason_code` 껍데기) · 트레이스 전체 구간 수 · 대상 앱 구간 수 · 원본 크기(바이트) · **대상 앱 프로세스의 구간 이름 표**(이름별 횟수 · 합 ms · 최대 ms, 메인 스레드와 그 밖을 가름). 표의 행 수 = 고유 이름 수 (자르지 않음). 처음 순서는 이름순. 순위 · 등급 · 기준선 · 비율 필드 0개. 안쪽 구간도 각자 세며, 합 ms 를 이름끼리 더하면 안 된다는 한정이 스키마 설명에 있다 | `DM-7 구간 표 자르지 않음 · 이름순` · `DM-7 판정 필드 없음` · `DM-7 겹침 한정 describe` |
| DM-8 | 원본 · 재산출 | 원본은 평소처럼 run 디렉토리의 `trace.perfetto-trace` 하나 (`artifacts.trace`). 별도 파일을 만들지 않는다. `perftracker extract <진단 run>` 이 기기 없이 같은 진단 블록을 다시 낸다 | `DM-8 extract 가 같은 블록` |
| DM-9 | 못 잴 때 — 0 이 아니라 null + 이유 | 위 조건 표대로: sdk 30 이고 `debuggable` 이 true 가 아니면 앱 구간 상태가 `null` 값 + `reason_code` 이고, 대상 앱 구간 수를 0 으로 쓰지 않는다. 트레이스 안에서 대상 앱 프로세스를 못 찾으면 `process_not_in_trace`, 이름이 낡았으면 `process_name_stale_in_trace` (`appProcess` 규칙 그대로). 원본이 없으면 `failed` + `trace_missing`. 새 `reason_code` 를 더하면 README 의 개수 문장이 `packages/core/test/schema/readme.test.ts` 와 맞는다 | `DM-9 sdk30 앱 구간 null` · `DM-9 프로세스 못 찾음` · 기존 readme 개수 시험 |
| DM-10 | 미리 알림 — 시작 전에 못 여는 것을 말한다 | `doctor` 가 이 기기에서 진단 앱 구간이 열리는지 한 줄 낸다 (sdk 30 이면 ✗ · `capability` · 종료 코드 0). `start` 에 진단 옵션을 주고 대상 앱이 조건 표의 "모름" 칸이면 세션은 열되 고지 줄을 낸다. 측정 화면 환경 점검 패널 · running 화면에 같은 사실이 나온다. 판정 출처는 core 하나 (doctor 와 start 가 같은 함수) | `DM-10 doctor 진단 줄` · `DM-10 start 고지` · `DM-10 화면 고지` |
| DM-11 | CLI 표시 | `start` · `status` 라벨 줄에 진단 표시가 붙는다. `runs` 행 꼬리에 진단 태그. `status --json` · `runs --json` 에 진단 여부. `stop` · `extract` 출력은 평소와 같다 (구간 요약을 찍지 않음) | `DM-11 start·status 진단 줄` · `DM-11 runs 태그 · --json` · `DM-11 stop 출력 그대로` |
| DM-12 | 측정 화면 표시 | 진단 세션 탭의 배지 · running 킥커 · 각주에 진단 표시, 기록 드로어 메타 줄에 진단 태그. 평소 세션에는 없다. 각주는 "앱 구간 비용이 앱 프로세스에 들어간다 · 평소 세션과 비교 불가" 두 사실을 담는다 | `DM-12 진단 표시 4곳` · `DM-12 평소 세션엔 없음` |
| DM-13 | 보고서 표시 | 진단 세션 보고서에: 머리에 진단 표시 · 진단 탭(진단 세션에만). 탭에 진단 블록의 **모든 필드**가 나온다 (파일에만 있는 필드 0). 구간 표는 행을 자르지 않고 처음 이름순이며, 색 · 굵기 · 아이콘으로 행을 구별하지 않는다. 정렬은 보는 사람이 열 머리를 누를 때만 바뀐다. 원본 경로가 보인다. 측정 비용 카드에 "앱 프로세스 몫 미포함" 이 붙는다. 평소 세션 보고서는 지금과 같다. 보고서 파일 하나 · 외부 요청 0 그대로 | `DM-13 진단 탭 전 필드` · `DM-13 표 자르지 않음 · 구별 없음` · `DM-13 평소 보고서 그대로` |
| DM-14 | 비교 불가 조건이 스키마에 적힌다 | `perftracker schema` 출력에서 진단 여부 필드와 `measurement_overhead.tracing_processes_*` 설명이 "진단 세션은 atrace 구간 비용이 앱 프로세스에 청구되어 여기 안 잡힘 · 평소 세션과 수치를 나란히 놓을 수 없음" 을 말한다. README `measurement_overhead` 절에도 같은 한정 | `DM-14 schema describe 한정` |
| DM-15 | 표기 — 문장보다 단어 | 진단 모드가 **새로 내는** 사용자 문구(CLI 줄 · `--help` 설명 · 화면 라벨 · 각주 · 보고서 제목 · 고지 줄)를 모은 시험이: `다.` · `요.` · `니다` 로 끝나는 문구 0 · 권유 · 1인칭(`하세요` · `해 보세요` · `드립니다` · `저희`) 0 · 평가 단어(느림 · 빠름 · 좋음 · 나쁨 · 부드러 · 무거 · 심각 · 주의 · 문제 · 병목 · 권장) 0 을 확인한다. 구체 문구는 디자인 문서 | `DM-15 진단 문구 단어형` |
| DM-16 | 실기기 — YouTube 진단 세션 | R5CT0000001 에서 `start --app com.google.android.youtube --launch` + 진단 옵션 → 다른 터미널 `adb shell input swipe` 4회(결정 2) → `stop`. `result.json`: 진단 여부 true · `adb_commands_during_session` 0 · `trace_buffer_overrun` false · 앱 구간 상태 collected · 구간 표에 `bindApplication` · `Choreographer#doFrame` · `RV Scroll` 이 있다. 보고서 진단 탭 행 수 = 블록 이름 수. 같은 조건 평소 세션 1회는 진단 블록 없음 · 진단 여부 false. 끝난 뒤 DM-5 의 두 속성 확인 | 수동 (R5CT0000001) · `packages/cli/test/on-device/` `DM-16` 스펙 |

### 안 바뀔 것

| 무엇 | 확인 |
|---|---|
| 측정 창 안 기기 접촉 0 — 진단 세션도 `start` 끝 ~ `stop` 시작 사이 adb 0. `MeasurementWindow` 를 지나지 않는 경로 없음 | 기존 `startSession — 오케스트레이션 불변식` + `DM 진단 세션 창 안 명령 0` · DM-16 |
| 판정하지 않는다 — 순위 · Top N · 강조 · 기준 비교 · 평가 단어 없음. `references` 는 비교에 안 씀 | DM-7 · DM-13 · DM-15 시험 |
| 모르면 null + `reason_code` — 재지 못한 것에 0 · false · [] 를 쓰지 않는다 | DM-9 시험 |
| 의존 방향 cli → gui → core · 화면은 `packages/gui/src/contract/api.ts` 로만 core 를 본다 | 수동 (import grep) |
| 평소 세션의 config · `result.json` 모양 · 지표 8개 그대로 | DM-3 시험 · 기존 `packages/core/test/schema/readme.test.ts` |
| `within_16_67ms_ratio` · `jank_type` 를 되살리지 않는다 (docs/STATUS.md) | 기존 `packages/core/test/schema/result.test.ts` |
| `stop` · `extract` 는 요약을 안 찍는다 — 경로와 보고서 명령만 | 기존 `packages/cli/test/commands/stop.test.ts` · DM-11 |
| 보고서 파일 하나 · 외부 요청 0 | 기존 `packages/gui/test/standalone.test.ts` |
| ftrace 이벤트 허용 목록(`ALLOWED_FTRACE_EVENTS`) 그대로 | 기존 `packages/core/test/perfetto/config.test.ts` |

## 열린 질문

| # | 무엇 | 지금 기본값 | 날짜 · run |
|---|---|---|---|
| 1 | sdk 30 실기기에서 am · wm · view 와 debuggable 앱의 앱 구간이 실제로 잡히나 | 문서 근거로 열림 · 합성 시험만 | 2026-10-08 · diagnostic-mode |
| 2 | sdk 31–34 에서 profileable 아닌 앱의 앱 구간 | 문서 근거로 열림 · 실측은 sdk 35 · 36 뿐 | 2026-10-08 · diagnostic-mode |
| 3 | profileable 을 기기 출력에서 읽을 출처 (YouTube `dumpsys package` 에 표기 없음 · profileable 앱 표본 없음) | 싣지 않음 | 2026-10-08 · diagnostic-mode |
| 4 | 진단 세션에서 앱 프로세스가 낸 구간 비용 | 재지 않음 — 구간 수만 기록 (추정치를 쓰지 않음) | 2026-10-08 · diagnostic-mode |

## 바뀐 기록

| 날짜 | run | 항목 | 무엇이 |
|---|---|---|---|
| 2026-10-08 | diagnostic-mode | DM-1 ~ DM-16 | 처음 |
