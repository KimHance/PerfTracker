# 진단 모드 — atrace slice 를 평소 측정과 따로 기록

| 항목 | 값 |
|---|---|
| 기능 | diagnostic-mode |
| 마지막 변경 | 2026-10-11 · ⑨ 승격 (baseline-profile) — DM-16 ART 칸 · 회귀 실측 · 결정 38 (잠금 풀린 기기 전제) · 결정 20 집합 넷 · 열린 질문 21 |
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
| 10 | 2026-10-08 · diagnostic-mode | DM-15 평가 낱말은 음절 단위 닫힌 목록 — 명사형 · 불규칙 활용형까지 적는다. NFD 자모 비교는 안 한다 | 어간만으론 `느림`(음절이 `느리` 와 다름) · `빨라` · `나빠` 를 못 잡는다 · 자모로 비교하면 음절 경계를 넘어 `좋`(ㅈㅗㅎ)이 `조회`(ㅈㅗ + ㅎㅚ)에 걸린다 (디자인 재검토) | 워커 | 정함 |
| 11 | 2026-10-08 · diagnostic-mode | 진단 + `--launch` 는 측정 창 전에 atrace 가 켜졌는지 읽고 기다린 뒤 앱을 띄운다 — 같은 셸 호출 · 최대 5초 · 읽기만. 평소 세션 · `--launch` 없는 진단은 안 읽는다 | 실기기 R5CT0000001 4회: 기다림 없이 `bindApplication` 행 0 · 기다림 넣고 1 · 1 (68.2 · 66.2 ms). 래치 전이라 측정 창 안 기기 접촉 0 그대로 (plan D14 · D29) | 메인 | 정함 |
| 12 | 2026-10-08 · diagnostic-mode | DM-5 기준에서 `debug.atrace.app_*` 빈 값을 뺀다 — `enableflags` 0 · `app_number` 빈 값 · perfetto 세션 0 · 원격 파일 0 만. `app_0` 에 마지막 패키지가 남는 것은 관측 사실로 적고 도구는 지우지 않는다 | stop · `--force` 뒤 평소 stop · 10분 자동 종료, 네 번 모두 `app_0` = `com.google.android.youtube` · 도구는 속성을 고치지 않는다 · 누수 감시 안 함 (plan D15 · D30) | 메인 | 정함 |
| 13 | 2026-10-08 · diagnostic-mode | `start` 진단 옵션 이름은 `--diagnose` | 선택지 창 (plan D8) | 나 | 정함 |
| 14 | 2026-10-08 · diagnostic-mode | 화면 · CLI 에서 atrace 한 칸을 부르는 낱말은 `slice` | 선택지 창 (plan D9) · 기존 '구간' 4곳과 안 겹침 | 나 | 정함 |
| 15 | 2026-10-08 · diagnostic-mode | 단어형 문구 규칙(DM-15)은 진단 모드의 새 문구에만 — 기존 화면 · CLI 문구는 그대로 | 선택지 창 (plan D10) | 나 | 정함 |
| 16 | 2026-10-08 · diagnostic-mode | 진단 세션 최대 시간 10분 · 평소 30분 그대로 | 선택지 창 (plan D11) | 나 | 정함 |
| 17 | 2026-10-08 · diagnostic-mode | 진단 기록에 gfx 를 넣지 않는다 — am · wm · view + 대상 앱만 | 선택지 창 (plan D21) · gfx 15초 37 MiB(am · wm · view 의 약 5배) · 64 MiB 링을 30초 쓰기 주기 안에 넘칠 수 있음 | 나 | 정함 (gfx 는 그대로 · 범위는 결정 36) |
| 18 | 2026-10-08 · diagnostic-mode | 진단 여부는 켤 때만 키로 싣고 `true` 만 진단으로 본다 — `result.json` · `--diagnose`(기본값 없음) · 화면의 시작 요청 모두 평소엔 키 0 (`false` 도 안 실음 · 스키마가 `false` 를 거부). `false` · 문자열 · 블록만 있는 문서는 평소 | `session.options` 가 닫힌 객체라 늘 실으면 캐시한 스키마로 검사하는 CI 가 새 파일을 모두 거부 · 평소 세션 입구 · 파일 모양 그대로 (plan D12 · intent diag-cli 4-1 · diag-gui-server 4-1 · diag-gui-report 4-1) | 메인 | 정함 (진단 키 한정 — 컴파일 상태는 모든 세션에 · baseline-profile 결정 7) |
| 19 | 2026-10-08 · diagnostic-mode | 설정 검증을 probe 바로 뒤로 당기면서 트레이스 블록 0개 기기의 기존 거부도 같은 자리로 — 실패 경로의 기기 명령은 줄기만 하고 성공 경로의 명령 목록 · 순서는 그대로 | 같은 config 조립이라 둘로 나눌 이유 없음 · 거부될 config 로 force-stop 이 먼저 나가면 앱만 죽은 채 남음 (intent diag-capture 4-3) | 워커 | 정함 |
| 20 | 2026-10-08 · diagnostic-mode | 진단 config 검증은 거부 조건만 본다 — {am, wm, view} 의 일부만 켜거나 앱 0개는 통과 | DM-4 는 거부 조건만 적음 · 비용이 줄어드는 쪽은 막지 않음 · 빌더는 늘 셋 + 하나 (intent diag-capture 4-4) | 워커 | 정함 (집합은 {am, wm, view, dalvik} · 빌더는 늘 넷 + 하나 — 결정 36) |
| 21 | 2026-10-08 · diagnostic-mode | 따옴표 밖 `#` · 닫히지 않은 따옴표가 있는 config 는 평소 · 진단 모두 거부 | 빌더는 `#` 를 안 낸다 — 주석은 손으로 고친 흔적 · 주석 줄의 따옴표로 다음 줄 atrace 키를 숨기는 꼴을 막음 (코드 검수 · intent diag-capture 4-13) | 워커 | 정함 |
| 22 | 2026-10-08 · diagnostic-mode | slice 이름 접기 — 연속한 ASCII 영숫자 가운데 숫자가 든 토큰을 `*` 하나로 (`_` 는 경계 · 숫자 없는 토큰은 그대로) · 접기 전 고유 이름 수를 함께 | 숫자 · 16진만 접으면 `tk-trace-id` base36 토큰이 남아 15초 2,387–2,489행 · 실측 4,921 → 1,082행 · `tk-trace-id` 1,317 중 1,315 접힘 (plan D16 · D34 · intent diag-extract 4-8) | 메인 | 정함 (클래스 디스크립터 규칙을 결정 37 이 더함) |
| 23 | 2026-10-08 · diagnostic-mode | ftrace 손실 수 = overrun · commit overrun · 버린 이벤트를 CPU 마다 더한 값 · 통계가 없으면 null | 하나만 세면 다른 쪽으로 잃어도 0 (거짓 청정) · perfetto 버퍼 넘침(`trace_buffer_overrun`)은 이 손실을 못 봄 (plan D18 · intent diag-extract 4-1) | 워커 | 정함 |
| 24 | 2026-10-08 · diagnostic-mode | null 범위 — 대상 앱 프로세스를 못 찾으면 대상 앱 몫 넷(수 · 끝나지 않은 수 · 접기 전 이름 수 · 표)만 null · 빈 갈래 칸은 null (0 아님) · 전부 끝나지 않은 갈래는 횟수만 있고 합 · 최대 null | 모르는 것만 모른다 — 전체 수 · 손실 · 원본 크기는 잰 사실 · 최대 0 ms 는 "0 ms 썼다" 로 읽힘 (규칙 3 · plan D18 · intent diag-extract 4-2 · 4-3) | 워커 | 정함 |
| 25 | 2026-10-08 · diagnostic-mode | 앱 slice 열림은 블록 `status` 와 따로 — 열림이 null 이어도 블록은 `collected` 일 수 있고, 원본이 없어도(`failed`) 열림은 sdk · debuggable 로 낸다 | 결정 8 — 열림은 트레이스 사실이 아니라 조건 · 낡은 이름과 열림 모름이 같이 오면 블록 코드 하나로 못 말함 (plan D18 · D34 · intent diag-extract 4-4 · 4-5). 약점: 블록 `status` 만 보는 CI 는 열림 모름을 못 거름 (열린 질문 7) | 메인 | 정함 |
| 26 | 2026-10-08 · diagnostic-mode | 못 잰 원본 — 기기에 `linux.ftrace` 가 없으면 `unsupported`, 쿼리가 하나라도 실패하면 `failed` · 둘 다 트레이스에서 읽는 칸 전부 null | perfetto 는 등록 안 된 소스를 조용히 무시 — slice 0 은 "재 봤더니 없었다" 가 아님 · 반쯤 찬 블록이 collected 처럼 읽히지 않게 (intent diag-extract 4-6 · 4-7) | 워커 | 정함 |
| 27 | 2026-10-08 · diagnostic-mode | 켠 범위(카테고리 · 앱)는 세션 기록 그대로 · 기록이 없으면 null (상수에서 다시 만들지 않음) | 상수가 바뀐 뒤 옛 run 이 거짓이 됨 (intent diag-extract 4-11) | 워커 | 정함 |
| 28 | 2026-10-08 · diagnostic-mode | 표 값 — ms 는 ns 정수 합 뒤 한 번 반올림해 소수 셋째 자리 · 이름 없는 slice 도 `''` 행으로 센다 | 데이터는 정밀도를 남기고 보여 주는 쪽이 줄임 · DM-8 바이트 같음 · 센 slice 를 지우지 않음 (intent diag-extract 4-12 · 4-13) | 워커 | 정함 |
| 29 | 2026-10-08 · diagnostic-mode | ftrace 를 다 믿을 수 없는 원본 — CPU 별 ftrace 통계가 0행이면 `partial` 이고 slice 수 · 손실 · 대상 앱 몫이 null, 통계는 있고 켜기 오류만 있으면 `partial` 이되 잰 수 · 표는 그대로 | 통계 0행은 ftrace 가 안 돈 것 — slice 0 · [] 는 거짓 청정 (규칙 3) · 켜기 오류는 atrace 만 세지 않음 — gfx · input 을 켠 실측 원본은 오류 28 에 slice 33만–38만 (plan D35 · D37) | 메인 | 정함 |
| 30 | 2026-10-08 · diagnostic-mode | 새 `reason_code` 셋 — 열림 모름 `app_slices_open_unknown` · 통계 0행 `ftrace_not_recorded` · 켜기 오류 `ftrace_setup_errors`, 공용 enum 에 (39개) | 값 있음 · 없음이 정반대인 둘을 한 코드로 두면 CI 가 못 가름 · 1.2.0 미출시라 지금이 가장 쌈 · 진단 전용 enum 대신 README 개수 시험 하나로 (plan D34 · D38) | 메인 | 정함 |
| 31 | 2026-10-08 · diagnostic-mode | 블록 코드는 하나 — 겹치면 `ftrace_not_recorded` > `process_not_in_trace` > `ftrace_setup_errors` > `process_name_stale_in_trace` | 칸이 null 인 이유가 먼저 · 수를 믿어도 되는지가 프로세스를 어떻게 찾았는지보다 먼저 (plan D37 · intent diag-extract 4-23). 약점: 프로세스 못 찾음이 켜기 오류를 가림 (열린 질문 12) | 메인 | 정함 |
| 32 | 2026-10-08 · diagnostic-mode | DM-13 「모든 필드」 는 필드가 나오는 자리 다섯으로 센다 — 행 · 카드 배지 · 카드 제목 title · 열림 행 title · null 값 자리의 코드 (partial 의 status · 이유는 제목 title · null 칸 코드는 열림 행과 표 자리에만) | 그려질 것이 근거여야 "파일에만 있는 필드 0" 의 증거 · 디자인 왕복 대신 (plan D27) | 메인 | 정함 |
| 33 | 2026-10-08 · diagnostic-mode | `runs` 행 폭 — `경고 N` 만 있는 행 + 진단 태그 77칸이 기준 · 마킹이 있는 진단 행 86칸은 받아들인다 | 기존 꼬리 `경고 · 마킹` 이 이미 79칸 — 줄이면 결정 15 위반 (plan D20 · D33 · intent diag-cli 4-4) | 메인 | 정함 |
| 34 | 2026-10-08 · diagnostic-mode | 측정 화면에서 세션을 정지하면 진단 토글이 꺼진다 — `--launch` · `--force` 는 남음 · 밖에서 끝난 세션도 같음 | 진단은 수치의 성질을 바꾸는 옵션 — 다음 세션이 말없이 진단으로 열리면 평소 기록인 줄 알고 나란히 놓음 · CLI 도 `start` 마다 `--diagnose` (plan D41) | 메인 | 정함 |
| 35 | 2026-10-08 · diagnostic-mode | 측정 중 탭의 진단 표시 · 고지는 서버가 연 세션을 따른다 — 토글이 켜져 있어도 서버가 평소 세션을 열면 없음 · 세션 목록 동기화가 서버 값으로 덮음 | 계약 「서버가 정본」 · 새로고침 복구와 같은 출처 (intent diag-gui-server 4-4 · diag-gui-measure 4-2) | 워커 | 정함 |
| 36 | 2026-10-11 · baseline-profile | 진단 기록에 `dalvik` 을 더한다 — am · wm · view · dalvik + 대상 앱. 따로 켜는 옵션을 두지 않는다 | 진단 세션 자체가 옵트인이고 평소 세션과 이미 갈림 · 실기기 15초에 slice 약 1.4만 더함 · 원본 크기 · traced_probes CPU 차이는 회차 변동 안 · 트레이스 안에서 컴파일 상태 · JIT 를 읽는 유일한 길 (baseline-profile BP-7) | 워커 | 정함 |
| 37 | 2026-10-11 · baseline-profile | slice 이름 접기에 클래스 디스크립터 규칙을 더한다 — 이름 전체가 `L` 로 시작해 `;` 로 끝나고 공백이 없는 slice 는 한 행 `L*;` 로 접는다. 결정 22 의 숫자 토큰 규칙은 그대로 · 접기 전 고유 이름 수는 접기 전 그대로 센다 | `dalvik` 을 켜면 숫자 없는 난독화 디스크립터가 결정 22 로 안 접혀 표가 1,099 → 6,227 ~ 27,335행(그중 `L…;` 5,233 · 25,523) · 보고서는 표 전 행을 그린다 · 가독성 목표와 부딪힘 (plan B18 · baseline-profile 개발 검토 사람 #2) | 메인 | 정함 |
| 38 | 2026-10-11 · baseline-profile | 실기기 스펙은 화면이 켜지고 잠금이 풀린 기기를 전제한다 — 잠긴 채 돈 회의 실패(`DM-16 RV Scroll 행` · `m0` 포그라운드 · 25/27)로 기대값을 바꾸지 않는다. 시험 쪽 깨우기는 비보안 잠금만 · 보안 잠금은 사람 | 잠긴 화면에선 스와이프가 피드를 못 굴리고 포커스가 잠금 화면 · PIN 은 사람 몫 (plan B36 · B38) | 메인 | 정함 |

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
| 기기 atrace 속성을 고치거나 되돌리기 (읽기는 DM-5 · 진단 + `--launch` 때 창 전에만) | perfetto 몫 · 평소 세션 명령 목록 그대로 (결정 12) |
| 기존 화면 · CLI 문구를 단어형으로 바꾸기 | 새 문구만 (결정 15) |
| 평소 세션과의 비교 · 차이 계산 | 판정 · 읽는 쪽 몫 |
| 시간축 결함(트레이스 이전 프레임) 고치기 | 진단 모드와 별개 · 실기기 재현 안 됨 |

## 명세

### 동작

| ID | 동작 | 받아들임 기준 | 확인 |
|---|---|---|---|
| DM-1 | CLI 로 켜기 — `start --diagnose` | `--diagnose` 를 주면 그 세션이 진단 세션으로 열린다. 안 주면 평소 세션이고 기기로 나가는 config 가 지금과 글자 하나 다르지 않다. `packages/cli/test/readme.test.ts` 가 (1) `start` 에 등록된 옵션 전부가 README 어딘가에 있는지 (지금 6개는 이미 있음) (2) `--diagnose` 가 README 「명령 전체」 절 안에 있는지 대조한다 — 각각 README 에서 지우면 RED. `packages/cli/AGENTS.md` 에 옵션이 있다 | `DM-1 start --diagnose` · `DM-1 README 옵션 대조` |
| DM-2 | 화면으로 켜기 — 측정 화면 04 세션에 진단 토글 | 토글을 켜고 시작하면 서버가 core 에 진단 옵션을 넘기고, 시작 바 명령 예고에 `--diagnose` 가 붙는다. 끄면 둘 다 없다. cli 시험이 gui 의 명령 예고 함수를 불러, 예고의 옵션 철자가 cli 에 등록된 옵션과 같은지 대조한다 (cli → gui 방향) | `DM-2 진단 토글 → 시작 요청` · `DM-2 명령 예고` · `DM-2 예고 철자 = 등록 옵션` |
| DM-3 | 기록 범위 — atrace `am` · `wm` · `view` · `dalvik` + 대상 앱 하나의 앱 slice | 진단 config 의 atrace 카테고리가 정확히 {am, wm, view, dalvik} (결정 36), 앱 slice 대상이 대상 패키지 하나다. `ftrace_events` 는 평소 세션과 같은 집합. 평소 세션 config 에는 atrace 키가 0개. 범위를 글자로 적은 고정 문구(`start` · `status` 라벨 줄 · 04 옵션 행 설명 · `docs/design/gui/HANDOFF.md` 옵션 표)도 넷을 적는다 — 정본인 디자인 문서 `## 문구` 표를 먼저 고치고 코드가 따른다 (결정 9 · 80칸 안) | `DM-3 진단 config 범위` · `DM-3 평소 config 에 atrace 없음` · 기존 `DM-15 문구 표 ↔ 코드` (cli · gui) |
| DM-4 | 설정 검증이 atrace 를 본다 | 평소 세션 config 에 `atrace_` 로 시작하는 키가 하나라도 있으면 거부된다. 진단 config 라도 허용한 두 키(카테고리 · 앱) 밖의 `atrace_` 키 · {am, wm, view, dalvik} 밖 카테고리 · 대상 앱이 아닌 패키지 · 와일드카드(`*`) · 앱 둘 이상이면 거부된다. {am, wm, view, dalvik} 의 일부만 켜거나 앱이 0개인 진단 config 는 통과한다 (결정 20). 따옴표 밖 `#` 나 닫히지 않은 따옴표가 있는 config 는 평소 · 진단 모두 거부된다 (결정 21). 거부되면 perfetto 세션 시작 · `am force-stop` · 시작 스냅샷 명령이 하나도 나가지 않는다 (그때까지 나간 것은 기기 조회 — probe · 앱 해석 — 뿐 · 결정 19) | `DM-4 평소 config atrace 거부` · `DM-4 진단 config 허용 밖 거부` · `DM-4 진단 config 허용 범위는 통과한다` · `DM-4 주석(#) 안의 따옴표에 속지 않는다` · `DM-4 거부는 perfetto · force-stop · 스냅샷 전` |
| DM-5 | 기기 원상 — 끝나면 atrace 가 꺼진다 | 진단 세션이 `stop` 으로 끝난 뒤 · `start --force` 나 화면의 중단으로 버려지고 평소 세션이 열린 뒤 · 최대 시간에 닿아 멈춘 뒤, 어느 경우든 기기의 `debug.atrace.tags.enableflags` 가 0 · `debug.atrace.app_number` 가 빈 값 · perfetto 세션 0 · 그 세션이 기기에 만든 원격 파일 0 이다. `debug.atrace.app_0` 은 기준이 아니다 — perfetto 가 마지막 패키지를 남기는 것이 관측 사실이고(실기기 세 경우 네 번 모두 `com.google.android.youtube`) 도구는 지우지 않는다 (결정 12). 도구는 atrace 속성을 고치지 않는다. 읽기는 진단 + `--launch` 일 때만 — 측정 창 전에, 앱을 띄우는 것과 같은 셸 호출 안에서 `enableflags` · `app_number` 가 켜지길 최대 5초 기다리고, 넘으면 그냥 띄운다 (결정 11 · 실기기: 기다림 없이 `bindApplication` 행 0 · 기다림 넣고 1 · 1, 68.2 · 66.2 ms). 평소 세션 · `--launch` 없는 진단 세션은 이 속성을 읽지 않는다. perfetto 가 되돌린 것은 사람이 창 밖에서 확인한다 | 수동 (R5CT0000001 · 끝난 뒤 `getprop` · perfetto 세션 · 원격 파일) · on-device `DM-5 stop 뒤 기기 원상` (`packages/cli/test/on-device/diagnose.test.ts`) · `D14 진단 --launch 는 같은 호출 안에서 atrace 가 켜지길 기다린 뒤 앱을 띄운다` · `D14 평소 세션 · --launch 없는 진단 세션은 atrace 속성을 읽지 않는다` |
| DM-6 | 결과 자리 — 진단 세션일 때만 싣는다 | 진단 세션의 `result.json` 에만 `session.options` 의 진단 여부(true)와 최상위 진단 블록이 있다. 평소 세션의 `result.json` 에는 진단 관련 키 0 (없음 = 평소 또는 옛 문서 = 진단 아님). 평소 세션의 키가 1.1.0 과 같지는 않다 — `target_app` 의 컴파일 상태가 모든 세션에 실리므로(baseline-profile BP-1 · 결정 7) 캐시한 1.1.0 스키마는 평소 산출물도 거부하고, README 1.2.0 문단이 그렇게 말한다. 이 필드들이 없는 옛 `result.json` 이 새 스키마를 그대로 통과한다. `schema_version` 은 1.2.0 (1.1.0 은 npm 0.1.0 ~ 0.2.1 로 출시됨 → optional 추가 = minor) 이고, "1.1.0 은 출시된 적이 없다" 는 문장이 코드 · README · STATUS 에 0 이다. README 「`result.json` 읽는 법」 최상위 구조 표 · 진단 블록 절에 자리가 적혀 있다 | `DM-6 진단 세션만 진단 키` · `DM-6 평소 result.json 진단 키 0` · `DM-6 옛 result.json 통과` · `DM-6 schema_version 1.2.0` |
| DM-7 | 진단 블록 내용 | 블록에: 켠 카테고리 · 앱 slice 대상(세션 기록 그대로 · 기록이 없으면 null — 결정 27) · 블록 `status` · `reason_code`(메트릭과 같은 껍데기) · **앱 slice 열림**(true 또는 null + `reason_code` — 앱 slice 가 실릴 수 있던 조건이었나, 앱이 실제로 남겼나가 아님) · 트레이스 전체 slice 수(스레드 트랙 + 비동기 트랙, frametimeline 제외) · 대상 앱 slice 수 · 끝나지 않은 slice 수 · ftrace 손실 수(커널 ftrace 링버퍼가 잃은 이벤트 — overrun · commit overrun · 버린 이벤트를 CPU 마다 더한 수, 못 읽으면 null · 결정 23) · 원본 크기(바이트) · 접기 전 고유 이름 수 · **slice 이름 표** · ART 칸 둘(컴파일 상태 slice 목록 · JIT slice 수 — 기준은 baseline-profile BP-7 · 켠 카테고리 기록에 `dalvik` 이 없거나 기록이 null 이면 두 칸 null + `reason_code`). 블록의 slice 는 전부 atrace slice 다 — frametimeline 트랙(Actual · Expected Timeline · 이름이 프레임 토큰 숫자)의 slice 는 트레이스 전체 slice 수 · 대상 앱 slice 수 · 끝나지 않은 slice 수 · 접기 전 고유 이름 수 · 표(비동기 갈래 포함) 어디에도 들지 않는다. 표: 행 = 접은 이름 하나 (연속한 ASCII 영숫자 가운데 숫자가 든 토큰을 `*` 하나로 접음 — 결정 22 · 이름 전체가 클래스 디스크립터 `L…;`(공백 없음)이면 한 행 `L*;` — 결정 37) · 열 = 갈래 셋(메인 스레드 · 그 밖 스레드 · 비동기 트랙) × (횟수 · 합 ms · 최대 ms). 행 수 = 접은 고유 이름 수 (자르지 않음) · 이름 원문 길이 그대로. 처음 순서는 이름의 코드 단위 순 (호스트 로캘 무관). 끝나지 않은 slice 는 횟수에만 들고 합 · 최대에서 빠진다. 빈 갈래 칸은 null (0 아님) · 한 갈래의 slice 가 전부 끝나지 않았으면 그 칸은 횟수만 있고 합 · 최대 null (결정 24). 순위 · 등급 · 기준선 · 비율 필드 0개. "안쪽 slice 도 각자 세므로 합 ms 를 행끼리 더하면 안 됨 · 표는 프레임워크와 앱 slice 를 가르지 않음" 이 스키마 설명에 있다 | `DM-7 표 자르지 않음 · 코드 단위 순` · `DM-7 접기 규칙` · `DM-7 클래스 디스크립터 접기` · `BP-7 dalvik 안 켠 원본은 null` · `DM-7 frametimeline 제외` · `DM-7 갈래 셋 · 끝나지 않은 slice` · `DM-7 켠 범위는 session.json 기록 그대로` · `DM-7 README 손실 통계 이름 ↔ FTRACE_LOSS_STATS` · `DM-7 판정 필드 없음` · `DM-7 한정 describe` |
| DM-8 | 원본 · 재산출 | 원본은 평소처럼 run 디렉토리의 `trace.perfetto-trace` 하나 (`artifacts.trace`). 별도 파일을 만들지 않는다. `perftracker extract <진단 run>` 이 기기 없이 같은 진단 블록을 다시 낸다 — 같은 원본으로 두 번 돌리면 블록이 바이트 단위로 같다 | `DM-8 extract 가 같은 블록` |
| DM-9 | 못 잴 때 — 0 이 아니라 null + 이유 | 아래 조건 표의 "모름" 칸이면 앱 slice 열림이 null + `app_slices_open_unknown` 이고, 블록 `status` 는 그것 때문에 바뀌지 않으며(`collected` 일 수 있음) slice 수 · 표는 잰 그대로 싣는다 (null 로 지우지 않음 · 결정 8 · 25 · frametimeline 제외는 DM-7 그대로). 열림은 원본이 없어도 sdk · debuggable 로 낸다. 블록 상태: 원본에 CPU 별 ftrace 통계가 0행이면 `partial` + `ftrace_not_recorded` 이고 slice 수 · 손실 수 · 대상 앱 몫 넷(수 · 끝나지 않은 수 · 접기 전 이름 수 · 표)이 null (0 · [] 아님). 통계는 있는데 ftrace 켜기 오류가 있으면 `partial` + `ftrace_setup_errors` 이고 잰 값은 그대로 (결정 29). 트레이스 안에서 대상 앱 프로세스를 못 찾으면 `partial` + `process_not_in_trace` 이고 대상 앱 몫 넷만 null (0행 · 0 아님 · 전체 수 · 손실 · 원본 크기는 그대로 · 결정 24). 이름이 낡았으면 pid 로 찾아 `partial` + `process_name_stale_in_trace` 이고 표가 있다 (`appProcess` 규칙 그대로). 둘 이상이 겹치면 블록 코드는 `ftrace_not_recorded` > `process_not_in_trace` > `ftrace_setup_errors` > `process_name_stale_in_trace` 순으로 하나 (결정 31). 기기에 `linux.ftrace` 가 없으면 `unsupported` + `data_source_not_registered`, 원본이 없으면 `failed` + `trace_missing`, 쿼리가 하나라도 실패하면 `failed` + `query_failed` — 셋 다 트레이스에서 읽는 칸 전부 null (결정 26). 새 `reason_code` 는 셋(결정 30)이고 README 의 `reason_code` 개수 문장(진단 모드 때 39개 · baseline-profile BP-2 · BP-7 이 더 늘림 — 개수는 README 정본)이 `packages/core/test/schema/readme.test.ts` 와 맞는다. README 진단 블록 상태 표가 코드와 줄마다 같다 | `DM-9 모름 칸 열림 null · 표 있음` · `DM-9 프로세스 못 찾음 표 null` · `DM-9 낡은 이름` · `DM-9 원본 없음` · `DM-9 쿼리 실패` · `DM-9 linux.ftrace 미등록` · `D35 ftrace 통계 0행` · `D37 · D38 ftrace 설정 오류` · `D38 통계 0행이면 켜기 오류가 있어도 ftrace_not_recorded` · `DM-9 README 상태 표 ↔ extractDiagnose` · 기존 `reason_code 개수가 METRIC_REASON_CODES 와 같다` |
| DM-10 | 미리 알림 — 시작 전에 못 여는 것을 말한다 | `doctor` 가 기기 단위로 진단 앱 slice 가 열리는지 한 줄 낸다 (sdk ≤30 이면 ✗ · `capability` · 종료 코드 0). 측정 화면 환경 점검 패널에 같은 줄. `start --diagnose` 의 대상 앱이 조건 표의 "모름" 칸이면 세션은 열되 고지 줄을 내고, running 화면에 같은 고지가 나온다 (설정 화면은 앱의 debuggable 을 모르므로 미리 안 보임). 판정 출처는 core 하나 — doctor · start · 화면이 같은 함수 | `DM-10 doctor 진단 줄` · `DM-10 start 고지` · `DM-10 running 고지` · `DM-10 판정 출처 하나` |
| DM-11 | CLI 표시 | `start` · `status` 라벨 줄에 진단 표시가 붙는다. `runs` 행 꼬리에 진단 태그. `status --json` · `runs --json` 은 진단 세션에만 진단 표시를 싣는다 (DM-6 과 같은 규칙). `stop` · `extract` 출력은 평소와 같다 (slice 요약을 찍지 않음). `start` · `status` 진단 줄은 80칸 안에 든다. `runs` 행은 `경고 N` 만 있는 행에 진단 태그를 붙여 77칸이 기준이고, 마킹이 있는 진단 행은 86칸이다 — 기존 꼬리(`경고 · 마킹` 79칸)를 줄이지 않는다 (결정 15 · 33) | `DM-11 start·status 진단 줄` · `DM-11 runs 태그 · --json` · `DM-11 stop 출력 그대로` |
| DM-12 | 측정 화면 표시 | 진단 세션 탭의 배지 · running 킥커 · 각주에 진단 표시, 기록 드로어 메타 줄에 진단 태그. 평소 세션에는 넷 다 없다. 각주는 두 사실을 담는다 — slice 비용이 앱 프로세스 몫 · 평소 세션과 비교 불가. 측정 중 탭의 진단 표시는 서버가 연 세션을 따른다 — 토글이 켜져 있어도 평소 세션이면 없다 (결정 35). 정지하면 진단 토글이 꺼지고 `--launch` · `--force` 는 남는다 (결정 34). 확인은 배지 · 메타 줄을 만드는 순수 함수로 (DOM 시험 도구 없음) | `DM-12 진단 표시 4곳` · `DM-12 평소 세션엔 없음` · `DM-12 측정 중 동기화는 진단 → 평소로도 내려간다` · `DM-12 정지 뒤 진단은 남지 않는다` |
| DM-13 | 보고서 표시 | 진단 세션 보고서에: 머리에 진단 표시 · 진단 탭(진단 세션에만). 탭에 진단 블록의 **모든 필드**가 나온다 (파일에만 있는 필드 0 — 나오는 자리는 행 · 카드 배지 · 카드 제목 title · 열림 행 title · null 값 자리의 코드 다섯 · 결정 32). slice 표는 행을 자르지 않고, 이름을 자르지 않으며(줄바꿈 또는 표 안 가로 스크롤), 처음 코드 단위 순이고, 색 · 굵기 · 아이콘으로 행을 구별하지 않는다. 정렬은 보는 사람이 열 머리를 누르거나 키보드로 고를 때만 바뀐다. 원본 경로가 보인다. 측정 비용 카드의 "앱 프로세스 몫 미포함" 은 진단 세션에만 붙는다. 390 폭에서 페이지 가로 넘침 0. 평소 세션 보고서는 지금과 같다. 보고서 파일 하나 · 외부 요청 0 그대로 | `DM-13 진단 탭 전 필드` · `DM-13 행 모델 자르지 않음 · 구별 없음` · `DM-13 평소 보고서 그대로` · 수동 (1440 · 390 렌더) |
| DM-14 | 비교 불가 조건이 스키마에 적힌다 | `perftracker schema` 출력에서 진단 여부 필드와 `measurement_overhead.tracing_processes_*` 설명이 "진단 세션은 atrace slice 비용이 앱 프로세스에 청구되어 여기 안 잡힘 · 평소 세션과 수치를 나란히 놓을 수 없음" 을 말한다. README `measurement_overhead` 절에도 같은 한정 | `DM-14 schema describe 한정` |
| DM-15 | 표기 — 문장보다 단어 | 진단 모드가 **새로 내는** 사용자 문구(CLI 줄 · `--help` 설명 · 화면 라벨 · 각주 · 보고서 제목 · 고지 줄 · 새 `reason` 문구)의 정본은 디자인 문서 `## 문구` 표다 (결정 9). cli · gui · core 마다 시험이: (1) 표의 자기 패키지 줄과 코드의 진단 문구 모음이 양방향으로 같다 — 표에만 · 코드에만 있는 문구 0 (2) 각 문구가: 끝 글자(문장부호 · 공백 빼고)가 `다` · `요` 가 아님 · `니다` 없음 · 권유 · 1인칭(`세요` · `십시오` · `바랍니다` · `해야` · `드립니다` · `저희`) 0 · 평가 낱말 0 — 음절 그대로 부분 일치 · 닫힌 목록(결정 10): `느리` `느린` `느림` `느려` `느릴` · `빠르` `빠른` `빠름` `빨라` `빨리` `빠를` · `좋` · `나쁘` `나쁜` `나쁨` `나빠` `나쁠` · `부드러` `부드럽` · `무거` `무겁` · `가벼` `가볍` · `심각` · `주의` · `문제` · `병목` · `권장`. 규칙마다, 평가 낱말은 목록의 낱말마다 그것을 넣은 문구가 RED 인지 깨 본다 (`느림` · `빨라짐` · `빨리` · `나빠짐` 포함). 기존 문구는 대상이 아니다 | `DM-15 문구 표 ↔ 코드` (패키지마다) · `DM-15 단어형 규칙` |
| DM-16 | 실기기 — YouTube 진단 세션 | R5CT0000001 에서 `start --app com.google.android.youtube --launch --diagnose` → 다른 터미널 `adb shell input swipe` 4회(결정 2) → `stop`. `result.json`: 진단 여부 true · `adb_commands_during_session` 0 · `trace_buffer_overrun` false · ftrace 손실 수가 null 아님 · 블록 `collected`, 또는 잰 값을 싣는 `partial` 둘 — 앱이 `<pre-initialized>` · `zygote64` 로 남은 회의 `process_name_stale_in_trace` · ftrace 켜기 오류가 있던 회의 `ftrace_setup_errors` (결정 29 · 30) — 이고, 어느 쪽이든 slice 칸 다섯(트레이스 전체 slice 수 · 대상 앱 slice 수 · 끝나지 않은 수 · 접기 전 고유 이름 수 · 표)이 null 아님 · 앱 slice 열림 true · 블록 코드가 `ftrace_setup_errors` 가 아니면 표에 이름이 `bindApplication` 으로 시작하는 행 · `Choreographer#doFrame` 으로 시작하는 행 · `RV Scroll` 행이 있다 (켜기 오류 회는 어느 카테고리가 빠졌는지 원본이 말하지 않아 행을 보지 않는다) · 접기 전 고유 이름 수 ≥ 표 행 수 · 대상 앱 slice 수 · 비동기 갈래 · 접기 전 고유 이름 수에 대상 앱의 `actual_frame_timeline_slice` · `expected_frame_timeline_slice` 행이 들지 않는다 (같은 원본을 trace_processor 로 대조). 보고서 행 모델의 행 수 = 블록 표 행 수. 같은 조건 평소 세션 1회는 진단 관련 키 0. 끝난 뒤 DM-5 의 두 속성. `bindApplication` 행은 atrace 켜짐 대기(결정 11)의 증거가 아니다 — 대기 없이도 잡힌 회차가 있다 (대기 없이 1/2 · 대기 넣고 11/11). 대기는 유닛 `D14 진단 --launch …` 이 지킨다 (열린 질문 14). 실측 2026-10-08 (YouTube 21.29.366 · 수동 1회 18.6초): `collected` · 열림 true · 대상 앱 slice 116,165 (끝나지 않음 1) · 손실 0 · 접기 전 이름 8,314 → 표 1,088행 · `bindApplication` 1행 115.2 ms · `RV Scroll` 메인 795회 · trace_processor 로 따로 센 프로세스 트랙 118,050 = 116,165 + frametimeline 1,885 · 보고서 slice 표 DOM 행 1,088 · 같은 조건 평소 세션 진단 키 0 · 두 원본의 config 차이는 atrace 넷 · 최대 시간뿐 · 창 안 adb 0. ART 칸(결정 36 · baseline-profile BP-7): 켠 카테고리가 {am, wm, view, dalvik} · 컴파일 상태 slice 중 base 줄 `filter` = 같은 세션 시작 상태 base.apk `status` · JIT 수 · 컴파일 상태 줄 수가 같은 원본을 trace_processor 로 다시 센 수와 같다. 회귀 2026-10-11 (YouTube 21.40.161 · `npm run test:device` 27/27 — 화면이 잠긴 앞 회 25/27 · 결정 38): 진단 1회(잠금 푼 회) JIT 27 · 컴파일 상태 6줄 · 접기 전 이름 9,597 → 표 1,476행 · `RV Scroll` 행 있음 · 블록 `partial` (`process_name_stale_in_trace` — 값은 다 있음) | 수동 (R5CT0000001) · on-device `packages/cli/test/on-device/diagnose.test.ts` — `DM-16 진단 세션 result.json — 진단 여부 true · 창 안 adb 0 · 버퍼 넘침 없음 · 손실 칸 · 블록 상태 · 앱 slice 열림` · `DM-16 slice 표 — bindApplication · Choreographer#doFrame 행 · 행 수 ≤ 접기 전 이름 수 · count 합 = 대상 앱 slice 수 · 코드 단위 순` · `DM-16 RV Scroll 행 — 스와이프가 굴린 피드의 앱 slice (대상 YouTube · 앱 slice 열림일 때)` · `DM-16 frametimeline 제외 — 같은 원본을 trace_processor 로 다시 세면 대상 앱 slice 수 · 비동기 갈래 · 접기 전 이름 수가 블록과 같다` · `DM-16 보고서 행 모델의 행 수 = 블록 표 행 수` · `DM-16 평소 세션 — result.json · session.json 에 진단 관련 키 0 · 최대 30분` · `DM-16 ART 칸 — 컴파일 상태 slice 의 base 줄 filter = 시작 상태 base status · …` |
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
| 평소 세션의 config · 지표 8개 그대로 · 진단 관련 키 0 (`stop` 기기 명령 한 줄 · `target_app` 컴파일 상태 키는 baseline-profile BP-1 이 더함) | DM-3 · DM-6 시험 · 기존 `start.test.ts` 「기기로 나가는 명령 전체가 이 목록과 정확히 같다」 · 기존 `packages/core/test/schema/readme.test.ts` |
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
| 5 | 쓰기 주기 30초 · 영상 재생 · 연속 스크롤에서 ftrace 손실 | 실측은 쓰기 주기 2.5초 15초 두 회 손실 0 · 스와이프 4회 18–20초 진단 세션 세 회 손실 0 · 64 MiB 링에 4배 여유(추정) — 손실은 DM-7 칸이 사실로 싣는다 | 2026-10-08 · diagnostic-mode |
| 6 | 트레이스 이전 프레임이 시간축을 끌어당김 — emulator 에서만 확인 · SM-S901N 은 재현 안 됨 (tracing_started 가 bounds 보다 119.4 ms 앞 · 이전 프레임 0행) | 이 기능 밖 (안 하는 것) — emulator 재현으로 따로 | 2026-10-08 · diagnostic-mode |
| 7 | 블록 `status` 만 보는 CI 는 앱 slice 열림 모름을 못 거른다 (열림 null 이어도 `collected`) | 열림은 자기 칸 — 열림 값 · 이유 코드로 거른다 (결정 25) | 2026-10-08 · diagnostic-mode |
| 8 | DM-15 규칙의 빈 곳 — 끝 글자를 ` · ` 로 이은 조각마다 볼지 · 개조식 권유(`바람` · `요망` · `할 것` · `하라` · `하시오`)를 목록에 넣을지 · 끝 글자 `다` 규칙이 `다` 로 끝나는 명사를 잡을 수 있음 | 문구 전체의 끝 글자만 · 지금 목록 그대로 · 걸리면 문구를 바꾼다 | 2026-10-08 · diagnostic-mode |
| 9 | DM-15 낱말 목록이 cli 시험에 따로 한 벌 있다 — 기능 문서 목록과 대조되는 것은 core 것뿐 (gui 는 core 것을 가져다 씀) | 그대로 — 지금 두 벌이 같음 | 2026-10-08 · diagnostic-mode |
| 10 | `runs` 행 80칸 — 기존 꼬리만으로 넘는 행(`경고 · 미지원` 81 · `+ 마킹` 90) · 10분 한도는 `최대 10분` 글자로만 있고 남은 시간 표시 없음 | 그대로 — 기존 문구를 줄이지 않는다 (결정 15 · 33) | 2026-10-08 · diagnostic-mode |
| 11 | 설정 검증기와 perfetto 파서의 경계 — 키 뒤 따옴표 · 붙은 문자열 · `ftrace_events` 콜론 꼴 · `ftrace_events` 리스트 문법(`ftrace_events: ["…"]` · 진단 전부터 있던 구멍) | 막지 않음 — 빌더는 그 꼴을 안 냄 (config 18,688개 거부 0) | 2026-10-08 · diagnostic-mode |
| 12 | ftrace 기록 판정의 빈 곳 — 통계 행 수 증거 쿼리는 trace_processor 바이너리가 있을 때만 시험으로 지켜짐 · `process_not_in_trace` 가 켜기 오류를 가림 (블록 코드 하나) | 그대로 — 바이너리가 없으면 SQL 문자열 시험만 · 앞세움 순서 그대로 (결정 31) | 2026-10-08 · diagnostic-mode |
| 13 | 측정 시작 때 화면 스크롤 — 924 에서 running 킥커가 위로 밀림 (기존 동작) | 그대로 — 배지 · 각주는 보임 | 2026-10-08 · diagnostic-mode |
| 14 | 실기기 `bindApplication` 단언이 atrace 켜짐 대기(결정 11)를 못 지킨다 — 대기를 뺀 빌드에서도 1회 잡힘 | 대기는 유닛 `D14 …` 이 지킴 · 실기기 단언은 그대로 (여러 회 돌려 확률을 보지 않음) | 2026-10-08 · diagnostic-mode |
| 15 | 실기기 스펙의 스와이프는 perftracker 를 거치지 않고 adb 를 직접 부른다 — 측정 창 안의 기기 입력 | 결정 2 의 시나리오 입력 · perftracker 가 낸 창 안 adb 0 (`adb_commands_during_session`) 으로 본다 | 2026-10-08 · diagnostic-mode |
| 16 | R5CT0000001 의 `debug.atrace.app_0` 이 `com.google.android.youtube` 로 남아 있음 (시작 전 빈 값) | 그대로 — 도구는 안 고침 (결정 12) · 되돌릴지는 사람 | 2026-10-08 · diagnostic-mode |
| 17 | 10분 진단 원본 — extract 쿼리 시간 · 출력 크기 · 표 행 수(10⁴ 를 크게 넘으면 보고서 그리기 · 첫 정렬) · 실기기 원본 보고서의 390 폭 넘침 | 실측은 18–20초 세션(표 1,029–1,095행) · 10⁴행은 합성으로만(그리기 0.47–0.75초) · 실기기 보고서는 1440 만 | 2026-10-08 · diagnostic-mode |
| 18 | README · STATUS 의 빈 곳 — README 진단 절이 보고서 진단 탭을 말하지 않음 · STATUS 에 CLI 진단 표시 없음 · on-device 스펙 수(19)를 다섯 곳에서 숫자로 말하는데 대조 시험 없음 · README 「개발」 에 진단 스펙이 화면을 스와이프한다는 말 없음 · STATUS §3 「실기기 확인은 DM-16 이 맡음」 이 낡음 | 다음 문서 작업 — README 정본 · 이 문서 범위 밖 | 2026-10-08 · diagnostic-mode |
| 19 | 디자인 문서 낡은 줄 — 디자인 고침 1 에서 빠진 HANDOFF 어긋남 사실 · `값 없음` + 코드 범위 문장(구현은 열림 행과 표 자리에만 · 결정 32) · `## 확인` 측정 화면 결과 칸 · `check_copy.py` 요약 줄 34 → 36 | 디자이너가 디자인 문서에서 | 2026-10-08 · diagnostic-mode |
| 20 | 이 기능 밖에서 본 것 — README 최상위 표 `metrics` 행 수집기 목록에 `frame` 없음 · `docs/design/report/samples/*.json` 의 `schema_version` 1.1.0 | 이 기능에서 안 고침 (samples 는 메이저만 비교라 무해) | 2026-10-08 · diagnostic-mode |
| 21 | 이 문서가 48 KB 를 넘음 — 기능 문서를 나눌지 (예: 실기기 · 조건 표 · 지난 결정을 따로) | 그대로 — 기존 문장을 줄이거나 쪼개지 않음 · 다음 문서 작업 | 2026-10-11 · baseline-profile |

## 바뀐 기록

| 날짜 | run | 항목 | 무엇이 |
|---|---|---|---|
| 2026-10-08 | diagnostic-mode | DM-1 ~ DM-16 | 처음 |
| 2026-10-08 | diagnostic-mode | DM-1 ~ DM-13 · DM-15 · DM-16 고침 · DM-17 추가 | 실현성 검토 왕복 1 (개발 조건부 10 · 디자인 조건부 8) · plan D8 ~ D16 — `--diagnose` · 낱말 slice · 진단 세션에만 싣기 · schema 1.2.0 · 열림 칸과 수 · 표 분리 · 갈래 셋 · 이름 접기 · ftrace 손실 수 · 거부 시점 · `atrace_` 키 전부 · 재산출 바이트 같음 · 문구 정본 표 · 최대 10분. DM-14 는 낱말만 |
| 2026-10-08 | diagnostic-mode | DM-7 · DM-9 · DM-15 · DM-16 고침 | 실현성 재검토 왕복 2 (개발 조건부 3 · 디자인 조건부 2) — slice 수 · 비동기 갈래 · 접기 전 이름 수에도 frametimeline 제외 · DM-15 평가 낱말을 명사형 · 불규칙 활용형까지 닫힌 목록으로 (결정 10) |
| 2026-10-08 | diagnostic-mode | DM-5 고침 · 안 하는 것 한 줄 | diag-capture 실기기 4회 (intent 4-1 · 4-2 · plan D29 · D30) — 진단 + `--launch` 때 창 전 atrace 켜짐 읽기 · 최대 5초 (결정 11) · 기준에서 `app_*` 빈 값을 빼고 `enableflags` 0 · `app_number` 빈 값 · 세션 0 · 원격 파일 0 만, `app_0` 남음은 관측 사실 (결정 12) · 안 하는 것 「읽거나 되돌리기」 → 「고치거나 되돌리기」 |
| 2026-10-08 | diagnostic-mode | DM-4 · DM-5 · DM-7 · DM-9 · DM-11 · DM-12 · DM-13 · DM-16 고침 · 결정 13–35 · 열린 질문 6–20 | ⑨ 승격 — plan 결정 칸 · intent 4 · 9 · brief 정하지 않은 것을 옮김. DM-9 ftrace 두 코드 · 못 잰 원본 · 코드 앞세움 · reason_code 39 · DM-11 runs 86칸 · DM-16 실기기 결과 · 확인 칸에 on-device `diagnose.test.ts` · DM-7 손실 셋 합 · 빈 갈래 null · 접기 글자 정의 · DM-4 `#` 거부 · 부분집합 통과 · DM-12 서버 정본 · 정지 뒤 토글 꺼짐 · 안 하는 것의 plan 참조를 결정 번호로 |
| 2026-10-08 | diagnostic-mode | DM-16 고침 | diag-device 리뷰 고칠 것 #1 (plan D37 · D38 · 결정 29 · 30) — `partial` 은 잰 값을 싣는 둘(`process_name_stale_in_trace` · `ftrace_setup_errors`)을 받고 slice 칸 다섯이 null 아님 · 표 행(`bindApplication` · `Choreographer#doFrame` · `RV Scroll`) 기준은 `ftrace_setup_errors` 가 아닐 때만 · 확인 칸을 on-device 스펙 실제 이름으로 (`DM-16 RV Scroll 행 …` 추가) |
| 2026-10-11 | baseline-profile | DM-3 · DM-4 · DM-7 고침 · 결정 36 | 진단 기록 카테고리에 `dalvik` (결정 36) · 허용 집합 {am, wm, view, dalvik} · 진단 블록에 ART 칸 둘 — 기준은 baseline-profile BP-7 |
| 2026-10-11 | baseline-profile | DM-3 · DM-6 · DM-7 · DM-9 고침 · 결정 37 · 결정 18 · 22 상태 칸 · 안 바뀔 것 한 줄 | baseline-profile 실현성 검토 왕복 1 · plan B17 · B18 — 범위 고정 문구도 넷 · 평소 산출물에 컴파일 상태 키(1.1.0 스키마가 거부 · 결정 18 과 다른 길) · 클래스 디스크립터 `L…;` 한 행 접기 · `dalvik` 안 켠 원본의 ART 칸 null · reason_code 개수는 README 정본 |
| 2026-10-11 | baseline-profile | DM-6 확인 칸 | baseline-profile 실현성 재검토 왕복 2 (#2) — 시험 이름 `DM-6 평소 result.json 키 그대로` → `DM-6 평소 result.json 진단 키 0` (평소 키가 1.1.0 과 같지 않다는 기준과 맞춤) |
| 2026-10-11 | baseline-profile | DM-16 고침 · 결정 38 · 결정 20 상태 칸 · 열린 질문 21 | ⑨ 승격 — DM-16 에 ART 칸 기준 · 회귀 실측(27/27 · 잠긴 앞 회 25/27) · 확인 칸 `DM-16 ART 칸` · 실기기 스펙은 잠금 풀린 기기 전제 (plan B36 · B38) · 결정 20 의 집합을 넷으로 (검수 bp-core-art 후속) · 문서 크기 |
