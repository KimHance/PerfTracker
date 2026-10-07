# 진단 모드 — atrace slice 를 평소 측정과 따로 기록

| 항목 | 값 |
|---|---|
| 기능 | diagnostic-mode |
| 마지막 변경 | 2026-10-08 · 실현성 검토 반영 — 진단 세션에만 싣기 · slice 표 갈래 셋 · 문구 정본 표 · 최대 10분 |
| 디자인 | docs/design/diagnostic-mode.md |
| 항목 ID | DM-<번호> (예 DM-3) |

지표 · 스키마 · 명령의 정본은 README 다. 이 문서는 **무엇이 되어야 하나**만 적고, 필드 이름 · 옵션 표 · 문구는
README 와 디자인 문서가 정한다. 근거 실측은 2026-10-07 SM-S901N(R5CT0000001 · sdk 36) · YouTube 21.29.366.
화면 · CLI 에서 atrace 한 칸을 부르는 낱말은 `slice` 다 — 이 문서도 그 낱말을 쓴다.

## 기획

### 왜

- 평소 세션은 수치만 낸다 — 프레임 · CPU · 메모리 · 시작 시간. 그 시간에 앱이 **무엇을** 했는지(slice 이름)는 없다.
- atrace 를 켜면 slice 가 보이지만 비용이 크다. slice 비용(하나에 ~5µs)은 **앱 프로세스 자신**에게 청구되고
  `measurement_overhead` 에 잡히지 않는다. 평소 세션에 섞으면 README 「이 도구가 지키는 두 가지」 1번과 부딪힌다.
- 그래서 평소 측정과 갈라진 **진단 세션**으로 켠다. 진단 세션의 수치는 평소 세션과 나란히 놓을 수 없다는 사실이
  기계에도 사람에게도 보여야 한다.
- 지금 설정 검증(`assertLowOverheadConfig`)은 `ftrace_events` 만 본다 — atrace 카테고리 · 앱은 검사 없이 통과한다.

### 누구

| 누가 | 언제 쓰나 |
|---|---|
| 앱 성능을 보는 사람 | 평소 세션에서 수치를 본 뒤, 그때 어떤 프레임워크 · 앱 slice 가 돌았는지 이름으로 보고 싶을 때 |
| 데이터를 읽는 쪽 (CI · LLM) | `result.json` 에서 진단 세션을 거르거나, slice 표를 읽을 때 |

### 흐름

1. `perftracker doctor` → 이 기기에서 진단 세션의 앱 slice 가 열리는지 한 줄
2. `perftracker start … --diagnose` (또는 측정 화면 04 세션의 진단 토글) → 세션 표시 줄에 진단 · 앱 slice 를 못 여는 경우 고지 줄
3. 앱 조작 — 도구는 기기를 건드리지 않는다. `status` 에도 진단 표시. 최대 10분
4. `perftracker stop` → `result.json` 경로 + 보고서 명령 (요약 없음 — 평소와 같음)
5. 보고서 → 머리에 진단 표시 · 진단 탭(켠 것 · 앱 slice 열림 · 수 · slice 이름 표 · 원본 경로)
6. 더 깊이 → 원본 `trace.perfetto-trace` 를 Perfetto UI 로
7. 기록 목록(`runs` · 기록 드로어) → 진단 태그로 평소 세션과 갈림

### 결정

| # | 날짜 · run | 결정 | 왜 | 누가 | 상태 |
|---|---|---|---|---|---|
| 1 | 2026-10-07 · diagnostic-mode | atrace 는 평소 측정과 떼어 진단 세션에서만 | "진단 모드로 돌리게끔 하는 게 목적" | 나 | 정함 |
| 2 | 2026-10-07 · diagnostic-mode | 실기기 검증은 SM-S901N · YouTube | "유튜브로 테스트하면서 해" | 나 | 정함 |
| 3 | 2026-10-07 · diagnostic-mode | 표기는 문장보다 단어 · AI 말투 없이 | 지시 원문 | 나 | 정함 |
| 4 | 2026-10-08 · diagnostic-mode | sdk ≥31 에서 앱 slice 는 profileable 을 요구하지 않는다 | profileable 이 아닌 YouTube(heapprofd · java_hprof 거부 로그)에서 15초 앱 slice 23,762–26,479개 실측. profileable 이 여는 Trace API 는 Android 11 이하 한정(문서) | 워커 | 정함 |
| 5 | 2026-10-08 · diagnostic-mode | 진단 데이터는 `metrics` 밖 별도 자리 | 지표 8개는 모든 세션의 계약 · README 지표 개수 시험 · 진단은 세션 종류에 딸린 것 | 워커 | 정함 |
| 6 | 2026-10-08 · diagnostic-mode | slice 를 시간축 그림(트랙 · 불꽃)으로 그리지 않는다 — 이름별 표 + 원본 경로 | 원본을 남기므로 Perfetto UI 가 그 일을 한다 · 15초에 slice 8–10만 | 워커 | 정함 |
| 7 | 2026-10-08 · diagnostic-mode | slice 표는 자르지 않고, 처음 순서는 이름의 코드 단위 순 | "느린 slice Top N" 도 판정이다 (규칙 2) · 로캘 정렬은 호스트마다 달라 DM-8 재산출이 흔들림 | 워커 | 정함 |
| 8 | 2026-10-08 · diagnostic-mode | slice 수 · 표는 **대상 앱 프로세스의 slice 전체**(프레임워크 + 앱, 가르지 않음). 앱 slice 가 실릴 수 있었는지는 따로 "앱 slice 열림" 칸이 말한다 | atrace 마커에 태그가 없어 트레이스에서 둘을 가를 수 없다(개발 검토) · 잰 프레임워크 slice 를 null 로 지우지 않는다(규칙 3) | 워커 | 정함 |
| 9 | 2026-10-08 · diagnostic-mode | 새 문구의 정본은 디자인 문서 `## 문구` 표 · 패키지마다(cli · gui · core) 시험이 그 표와 코드를 양방향으로 대조 | 문구가 세 패키지에 흩어져 있고 기존 문구가 이미 규칙을 어겨 새것만 골라낼 장치가 필요(디자인 검토) · gui 는 cli 를 못 본다(규칙 4) | 워커 | 정함 |

### 안 하는 것

| 안 한다 | 왜 (한 마디) |
|---|---|
| slice 시간축 그림 (트랙 · 불꽃 그래프) | Perfetto UI 몫 · 원본을 남긴다 |
| 느린 slice Top N · 순위 · 강조 · 기준 비교 | 판정 (규칙 2) |
| gfx · input · sched 기록 | 비용 — gfx 15초 37 MiB(am · wm · view 6.5–8.1 MiB 의 약 5배) · sched 는 고빈도 |
| CPU 콜스택(simpleperf · linux.perf) · 힙(heapprofd · java_hprof) | atrace 가 아님 · profileable 필요 · YouTube 거부 실측 |
| 프레임워크 slice 와 앱 slice 를 가른 수 · 표 | 트레이스에 가를 태그가 없다 (결정 8) |
| 마킹 사이 slice 집계 | 이번 범위 밖 |
| 대상 앱 말고 다른 앱의 앱 slice | 대상 앱 하나 |
| `target_app` 에 profileable 싣기 | 읽을 출처 미확인 — 열린 질문 3 |
| 기기 atrace 속성을 읽거나 되돌리기 | perfetto 몫 · 평소 세션 명령 목록 그대로 (plan D15) |
| 기존 화면 · CLI 문구를 단어형으로 바꾸기 | 새 문구만 (plan D10) |
| 평소 세션과의 비교 · 차이 계산 | 판정 · 읽는 쪽 몫 |
| 시간축 결함(트레이스 이전 프레임) 고치기 | 진단 모드와 별개 · 실기기 재현 안 됨 |

## 명세

### 동작

| ID | 동작 | 받아들임 기준 | 확인 |
|---|---|---|---|
| DM-1 | CLI 로 켜기 — `start --diagnose` | `--diagnose` 를 주면 그 세션이 진단 세션으로 열린다. 안 주면 평소 세션이고 기기로 나가는 config 가 지금과 글자 하나 다르지 않다. `packages/cli/test/readme.test.ts` 가 (1) `start` 에 등록된 옵션 전부가 README 어딘가에 있는지 (지금 6개는 이미 있음) (2) `--diagnose` 가 README 「명령 전체」 절 안에 있는지 대조한다 — 각각 README 에서 지우면 RED. `packages/cli/AGENTS.md` 에 옵션이 있다 | `DM-1 start --diagnose` · `DM-1 README 옵션 대조` |
| DM-2 | 화면으로 켜기 — 측정 화면 04 세션에 진단 토글 | 토글을 켜고 시작하면 서버가 core 에 진단 옵션을 넘기고, 시작 바 명령 예고에 `--diagnose` 가 붙는다. 끄면 둘 다 없다. cli 시험이 gui 의 명령 예고 함수를 불러, 예고의 옵션 철자가 cli 에 등록된 옵션과 같은지 대조한다 (cli → gui 방향) | `DM-2 진단 토글 → 시작 요청` · `DM-2 명령 예고` · `DM-2 예고 철자 = 등록 옵션` |
| DM-3 | 기록 범위 — atrace `am` · `wm` · `view` + 대상 앱 하나의 앱 slice | 진단 config 의 atrace 카테고리가 정확히 {am, wm, view}, 앱 slice 대상이 대상 패키지 하나다. `ftrace_events` 는 평소 세션과 같은 집합. 평소 세션 config 에는 atrace 키가 0개 | `DM-3 진단 config 범위` · `DM-3 평소 config 에 atrace 없음` |
| DM-4 | 설정 검증이 atrace 를 본다 | 평소 세션 config 에 `atrace_` 로 시작하는 키가 하나라도 있으면 거부된다. 진단 config 라도 허용한 두 키(카테고리 · 앱) 밖의 `atrace_` 키 · {am, wm, view} 밖 카테고리 · 대상 앱이 아닌 패키지 · 와일드카드(`*`) · 앱 둘 이상이면 거부된다. 거부되면 perfetto 세션 시작 · `am force-stop` · 시작 스냅샷 명령이 하나도 나가지 않는다 (그때까지 나간 것은 기기 조회 — probe · 앱 해석 — 뿐) | `DM-4 평소 config atrace 거부` · `DM-4 진단 config 허용 밖 거부` · `DM-4 거부는 perfetto · force-stop · 스냅샷 전` |
| DM-5 | 기기 원상 — 끝나면 atrace 상태가 시작 전으로 | 진단 세션이 `stop` 으로 끝난 뒤 · `start --force` 나 화면의 중단으로 버려지고 평소 세션이 열린 뒤 · 최대 시간에 닿아 멈춘 뒤, 어느 경우든 기기의 `debug.atrace.tags.enableflags` 가 0, `debug.atrace.app_*` 가 빈 값이다. 도구는 이 속성을 읽거나 고치지 않는다 — perfetto 가 되돌린 것을 사람이 창 밖에서 확인한다 | 수동 (R5CT0000001 · `stop` 뒤 `getprop`) |
| DM-6 | 결과 자리 — 진단 세션일 때만 싣는다 | 진단 세션의 `result.json` 에만 `session.options` 의 진단 여부(true)와 최상위 진단 블록이 있다. 평소 세션의 `result.json` 은 지금과 키가 같다 — 진단 관련 키 0 (없음 = 평소 또는 옛 문서 = 진단 아님). 이 필드들이 없는 옛 `result.json` 이 새 스키마를 그대로 통과한다. `schema_version` 은 1.2.0 (1.1.0 은 npm 0.1.0 ~ 0.2.1 로 출시됨 → optional 추가 = minor) 이고, "1.1.0 은 출시된 적이 없다" 는 문장이 코드 · README · STATUS 에 0 이다. README 「`result.json` 읽는 법」 최상위 구조 표 · 진단 블록 절에 자리가 적혀 있다 | `DM-6 진단 세션만 진단 키` · `DM-6 평소 result.json 키 그대로` · `DM-6 옛 result.json 통과` · `DM-6 schema_version 1.2.0` |
| DM-7 | 진단 블록 내용 | 블록에: 켠 카테고리 · 앱 slice 대상 · 블록 `status` · `reason_code`(메트릭과 같은 껍데기) · **앱 slice 열림**(true 또는 null + `reason_code` — 앱 slice 가 실릴 수 있던 조건이었나, 앱이 실제로 남겼나가 아님) · 트레이스 전체 slice 수(스레드 트랙 + 비동기 트랙, frametimeline 제외) · 대상 앱 slice 수 · 끝나지 않은 slice 수 · ftrace 손실 수(커널 ftrace 버퍼 overrun 합, 못 읽으면 null) · 원본 크기(바이트) · 접기 전 고유 이름 수 · **slice 이름 표**. 표: 행 = 접은 이름 하나 (숫자 · 16진 · 숫자가 섞인 영숫자 토큰을 접음 — plan D16) · 열 = 갈래 셋(메인 스레드 · 그 밖 스레드 · 비동기 트랙) × (횟수 · 합 ms · 최대 ms). 행 수 = 접은 고유 이름 수 (자르지 않음) · 이름 원문 길이 그대로. 처음 순서는 이름의 코드 단위 순 (호스트 로캘 무관). 끝나지 않은 slice 는 횟수에만 들고 합 · 최대에서 빠진다. 순위 · 등급 · 기준선 · 비율 필드 0개. "안쪽 slice 도 각자 세므로 합 ms 를 행끼리 더하면 안 됨 · 표는 프레임워크와 앱 slice 를 가르지 않음" 이 스키마 설명에 있다 | `DM-7 표 자르지 않음 · 코드 단위 순` · `DM-7 접기 규칙` · `DM-7 갈래 셋 · 끝나지 않은 slice` · `DM-7 판정 필드 없음` · `DM-7 한정 describe` |
| DM-8 | 원본 · 재산출 | 원본은 평소처럼 run 디렉토리의 `trace.perfetto-trace` 하나 (`artifacts.trace`). 별도 파일을 만들지 않는다. `perftracker extract <진단 run>` 이 기기 없이 같은 진단 블록을 다시 낸다 — 같은 원본으로 두 번 돌리면 블록이 바이트 단위로 같다 | `DM-8 extract 가 같은 블록` |
| DM-9 | 못 잴 때 — 0 이 아니라 null + 이유 | 아래 조건 표의 "모름" 칸이면 앱 slice 열림이 null + `reason_code`(새 코드 하나)이고, slice 수 · 표는 잰 그대로 싣는다 (null 로 지우지 않음 · 결정 8). 트레이스 안에서 대상 앱 프로세스를 못 찾으면 블록 `partial` + `process_not_in_trace` 이고 표 · 대상 앱 slice 수가 null (0행 · 0 아님). 이름이 낡았으면 pid 로 찾아 `partial` + `process_name_stale_in_trace` 이고 표가 있다 (`appProcess` 규칙 그대로). 원본이 없으면 `failed` + `trace_missing`. README 의 `reason_code` 개수 문장이 `packages/core/test/schema/readme.test.ts` 와 맞는다 | `DM-9 모름 칸 열림 null · 표 있음` · `DM-9 프로세스 못 찾음 표 null` · `DM-9 낡은 이름` · 기존 readme 개수 시험 |
| DM-10 | 미리 알림 — 시작 전에 못 여는 것을 말한다 | `doctor` 가 기기 단위로 진단 앱 slice 가 열리는지 한 줄 낸다 (sdk ≤30 이면 ✗ · `capability` · 종료 코드 0). 측정 화면 환경 점검 패널에 같은 줄. `start --diagnose` 의 대상 앱이 조건 표의 "모름" 칸이면 세션은 열되 고지 줄을 내고, running 화면에 같은 고지가 나온다 (설정 화면은 앱의 debuggable 을 모르므로 미리 안 보임). 판정 출처는 core 하나 — doctor · start · 화면이 같은 함수 | `DM-10 doctor 진단 줄` · `DM-10 start 고지` · `DM-10 running 고지` · `DM-10 판정 출처 하나` |
| DM-11 | CLI 표시 | `start` · `status` 라벨 줄에 진단 표시가 붙는다. `runs` 행 꼬리에 진단 태그. `status --json` · `runs --json` 은 진단 세션에만 진단 표시를 싣는다 (DM-6 과 같은 규칙). `stop` · `extract` 출력은 평소와 같다 (slice 요약을 찍지 않음). 진단 표시는 80칸 안에 든다 | `DM-11 start·status 진단 줄` · `DM-11 runs 태그 · --json` · `DM-11 stop 출력 그대로` |
| DM-12 | 측정 화면 표시 | 진단 세션 탭의 배지 · running 킥커 · 각주에 진단 표시, 기록 드로어 메타 줄에 진단 태그. 평소 세션에는 넷 다 없다. 각주는 두 사실을 담는다 — slice 비용이 앱 프로세스 몫 · 평소 세션과 비교 불가. 확인은 배지 · 메타 줄을 만드는 순수 함수로 (DOM 시험 도구 없음) | `DM-12 진단 표시 4곳` · `DM-12 평소 세션엔 없음` |
| DM-13 | 보고서 표시 | 진단 세션 보고서에: 머리에 진단 표시 · 진단 탭(진단 세션에만). 탭에 진단 블록의 **모든 필드**가 나온다 (파일에만 있는 필드 0). slice 표는 행을 자르지 않고, 이름을 자르지 않으며(줄바꿈 또는 표 안 가로 스크롤), 처음 코드 단위 순이고, 색 · 굵기 · 아이콘으로 행을 구별하지 않는다. 정렬은 보는 사람이 열 머리를 누르거나 키보드로 고를 때만 바뀐다. 원본 경로가 보인다. 측정 비용 카드의 "앱 프로세스 몫 미포함" 은 진단 세션에만 붙는다. 390 폭에서 페이지 가로 넘침 0. 평소 세션 보고서는 지금과 같다. 보고서 파일 하나 · 외부 요청 0 그대로 | `DM-13 진단 탭 전 필드` · `DM-13 행 모델 자르지 않음 · 구별 없음` · `DM-13 평소 보고서 그대로` · 수동 (1440 · 390 렌더) |
| DM-14 | 비교 불가 조건이 스키마에 적힌다 | `perftracker schema` 출력에서 진단 여부 필드와 `measurement_overhead.tracing_processes_*` 설명이 "진단 세션은 atrace slice 비용이 앱 프로세스에 청구되어 여기 안 잡힘 · 평소 세션과 수치를 나란히 놓을 수 없음" 을 말한다. README `measurement_overhead` 절에도 같은 한정 | `DM-14 schema describe 한정` |
| DM-15 | 표기 — 문장보다 단어 | 진단 모드가 **새로 내는** 사용자 문구(CLI 줄 · `--help` 설명 · 화면 라벨 · 각주 · 보고서 제목 · 고지 줄 · 새 `reason` 문구)의 정본은 디자인 문서 `## 문구` 표다 (결정 9). cli · gui · core 마다 시험이: (1) 표의 자기 패키지 줄과 코드의 진단 문구 모음이 양방향으로 같다 — 표에만 · 코드에만 있는 문구 0 (2) 각 문구가: 끝 글자(문장부호 · 공백 빼고)가 `다` · `요` 가 아님 · `니다` 없음 · 권유 · 1인칭(`세요` · `십시오` · `바랍니다` · `해야` · `드립니다` · `저희`) 0 · 평가 어간(`느리` · `느린` · `빠르` · `빠른` · `좋` · `나쁘` · `나쁜` · `부드러` · `무거` · `무겁` · `가벼` · `심각` · `주의` · `문제` · `병목` · `권장`) 0. 규칙마다 어긴 문구 하나를 넣으면 RED 인지 깨 본다. 기존 문구는 대상이 아니다 | `DM-15 문구 표 ↔ 코드` (패키지마다) · `DM-15 단어형 규칙` |
| DM-16 | 실기기 — YouTube 진단 세션 | R5CT0000001 에서 `start --app com.google.android.youtube --launch --diagnose` → 다른 터미널 `adb shell input swipe` 4회(결정 2) → `stop`. `result.json`: 진단 여부 true · `adb_commands_during_session` 0 · `trace_buffer_overrun` false · ftrace 손실 수가 null 아님 · 블록 `collected`, 또는 앱이 `<pre-initialized>` · `zygote64` 로 남은 회면 `partial` + `process_name_stale_in_trace` · 앱 slice 열림 true · 표에 이름이 `bindApplication` 으로 시작하는 행 · `Choreographer#doFrame` 으로 시작하는 행 · `RV Scroll` 행이 있다 · 접기 전 고유 이름 수 ≥ 표 행 수. 보고서 행 모델의 행 수 = 블록 표 행 수. 같은 조건 평소 세션 1회는 진단 관련 키 0. 끝난 뒤 DM-5 의 두 속성. `bindApplication` 행이 atrace 켜짐을 기다릴지의 확인이다 (plan D14 — diag-capture 가 이 실기기 1회로 정함) | 수동 (R5CT0000001) · `packages/cli/test/on-device/` `DM-16` 스펙 |
| DM-17 | 진단 세션 최대 시간 10분 | 진단 세션 config 의 최대 시간이 10분, 평소 세션은 30분 그대로. `status` 의 최대 시간 넘음 고지가 진단 세션엔 10분 기준으로 나온다 | `DM-17 진단 최대 10분 · 평소 30분` · `DM-17 status 넘음 기준` |

앱 slice 가 열리는 조건 (DM-7 · DM-9 · DM-10 이 이 표를 따른다):

| 기기 · 앱 | 앱 slice 열림 | 근거 |
|---|---|---|
| sdk ≥31 | true | 문서(`profileable-element`) · 실측 sdk 35 emulator · sdk 36 SM-S901N. sdk 31–34 실측 없음 |
| sdk ≤30 · `debuggable` true | true | 문서. 실측 없음 |
| sdk ≤30 · `debuggable` false 또는 null | 모름 → null + `reason_code` | profileable 을 읽을 출처 없음 |

sdk ≤29 는 README 하한(Android 11) 밖이다 — 진단도 같은 표를 따르고 따로 보증하지 않는다.

### 안 바뀔 것

| 무엇 | 확인 |
|---|---|
| 측정 창 안 기기 접촉 0 — 진단 세션도 `start` 끝 ~ `stop` 시작 사이 adb 0. `MeasurementWindow` 를 지나지 않는 경로 없음 | 기존 `startSession — 오케스트레이션 불변식` + `DM 진단 세션 창 안 명령 0` · DM-16 |
| 판정하지 않는다 — 순위 · Top N · 강조 · 기준 비교 · 평가 단어 없음. `references` 는 비교에 안 씀 | DM-7 · DM-13 · DM-15 시험 |
| 모르면 null + `reason_code` — 재지 못한 것에 0 · false · [] 를 쓰지 않는다 | DM-9 시험 |
| 의존 방향 cli → gui → core · 화면은 `packages/gui/src/contract/api.ts` 로만 core 를 본다 | 수동 (import grep) |
| 평소 세션의 config · 기기 명령 목록 · `result.json` 키 · 지표 8개 그대로 (진단 관련 키 0) | DM-3 · DM-6 시험 · 기존 `start.test.ts` 「기기로 나가는 명령 전체가 이 목록과 정확히 같다」 · 기존 `packages/core/test/schema/readme.test.ts` |
| 평소 세션 최대 시간 30분 | DM-17 시험 |
| 기존 화면 · CLI 문구 그대로 | 수동 (diff — 기존 문구 줄 변경 0) |
| `within_16_67ms_ratio` · `jank_type` 를 되살리지 않는다 (docs/STATUS.md) | 기존 `packages/core/test/schema/result.test.ts` |
| `stop` · `extract` 는 요약을 안 찍는다 — 경로와 보고서 명령만 | 기존 `packages/cli/test/commands/stop.test.ts` · DM-11 |
| 보고서 파일 하나 · 외부 요청 0 | 기존 `packages/gui/test/standalone.test.ts` |
| ftrace 이벤트 허용 목록(`ALLOWED_FTRACE_EVENTS`) 그대로 | 기존 `packages/core/test/perfetto/config.test.ts` |

## 열린 질문

| # | 무엇 | 지금 기본값 | 날짜 · run |
|---|---|---|---|
| 1 | sdk 30 실기기에서 am · wm · view 와 debuggable 앱의 앱 slice 가 실제로 잡히나 | 문서 근거로 열림 · 합성 시험만 | 2026-10-08 · diagnostic-mode |
| 2 | sdk 31–34 에서 profileable 아닌 앱의 앱 slice | 문서 근거로 열림 · 실측은 sdk 35 · 36 뿐 | 2026-10-08 · diagnostic-mode |
| 3 | profileable 을 기기 출력에서 읽을 출처 (YouTube `dumpsys package` 에 표기 없음 · profileable 앱 표본 없음) | 싣지 않음 | 2026-10-08 · diagnostic-mode |
| 4 | 진단 세션에서 앱 프로세스가 낸 slice 비용 | 재지 않음 — slice 수만 기록 (추정치를 쓰지 않음) | 2026-10-08 · diagnostic-mode |
| 5 | 쓰기 주기 30초 · 영상 재생 · 연속 스크롤에서 ftrace 손실 | 실측은 쓰기 주기 2.5초 15초 두 회 손실 0 · 64 MiB 링에 4배 여유(추정) — 손실은 DM-7 칸이 사실로 싣는다 | 2026-10-08 · diagnostic-mode |

## 바뀐 기록

| 날짜 | run | 항목 | 무엇이 |
|---|---|---|---|
| 2026-10-08 | diagnostic-mode | DM-1 ~ DM-16 | 처음 |
| 2026-10-08 | diagnostic-mode | DM-1 ~ DM-13 · DM-15 · DM-16 고침 · DM-17 추가 | 실현성 검토 왕복 1 (개발 조건부 10 · 디자인 조건부 8) · plan D8 ~ D16 — `--diagnose` · 낱말 slice · 진단 세션에만 싣기 · schema 1.2.0 · 열림 칸과 수 · 표 분리 · 갈래 셋 · 이름 접기 · ftrace 손실 수 · 거부 시점 · `atrace_` 키 전부 · 재산출 바이트 같음 · 문구 정본 표 · 최대 10분. DM-14 는 낱말만 |
