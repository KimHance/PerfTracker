# 진단 모드 — 디자인

| 항목 | 값 |
|---|---|
| 기능 | diagnostic-mode |
| 기능 문서 | docs/spec/diagnostic-mode.md (a3e329c) |
| 등급 | 화면 |
| 마지막 변경 | 2026-10-11 · baseline-profile — `## 문구` 범위 두 줄에 `dalvik` (DM-3 · 결정 36) |

측정 화면 · 보고서 · CLI 의 **지금 자리에 한 칸씩**. 새 화면은 보고서 진단 탭 하나(R-c). `slice`(D9) · `--diagnose`(D8) · 최대 10분(D11) · 후보 하나(D22).

## 시안

| 차수 | 후보 | 고른 것 | 누가 | 로컬 폴더 | 시안 생성기 | 검사 명령 | Claude Design 파일 |
|---|---|---|---|---|---|---|---|
| 1 | 1 | 1 | 메인 (D22) | `labs/diagnostic-mode-design/v1/claude-design/` · `v1/shots/` | Claude Design (`v1/brief-claude-design.md` · `gen_sample.py`) · `v1/shoot.md` | `python3 labs/diagnostic-mode-design/v1/check_shots.py` | [성능 측정 CLI GUI 도구](https://claude.ai/design/p/9ee5c8ab-33b9-4586-ae73-69f9e53ecd42) · `diagnostic-mode/Measure.html` · `diagnostic-mode/Report.html` |
| 1 · CLI | 1 | 1 | 메인 (D22) | `labs/diagnostic-mode-design/v1/cli/` | `gen_cli.py` → `cli/blocks.txt` | `python3 labs/diagnostic-mode-design/v1/check_cli.py` | 없음 |
| 1 · 문구 | — | — | 디자이너 | 이 문서 `## 문구` | 없음 | `python3 labs/diagnostic-mode-design/v1/check_copy.py` | 없음 |

시안 기준 = 지금 코드 실렌더 DOM (`?mock` · `report-f48507.html`) → Claude Design `diagnostic-mode/ref/`. 옛 프로토타입은 안 씀. 지금 화면 `v1/before/`.

## 제약

| 종류 | 제약 | 출처 |
|---|---|---|
| 그릴 것 | 기존 자리에 한 칸씩 (04 옵션 행 · 예고 · 탭 배지 · 킥커 · 각주 · 못 재는 지표 줄 자리 · 드로어 메타 · 환경 점검 줄) · 새 패널 · 배너 없음 | `SessionSection.tsx:6-10` · `TabStrip.tsx:40-42` · `RunningScreen.tsx:25-75` · `HistoryDrawer.tsx:120-124` |
| 그릴 것 | slice 표는 kind 7 어디에도 안 맞음(pairs = 3열 · 정렬 없음) → 새 kind + 정렬 상태 | `manifest.ts:15-16` · feas-design 표면 제약 |
| 그릴 것 | 탭이 정적 배열 — 진단 세션에만 나오는 세 번째 탭은 새 장치 | `manifest.ts:261-264` · `ReportPage.tsx:302` |
| 그릴 것 | 머리 플래그 줄은 코드에 없음 → 진단 표시 = 상태 pill 옆 pill · `옵션` 칸 그대로 | `header.ts:7-18` · brief #14 |
| 그릴 것 | 측정 비용 한정은 카드 단위 칸(경고 카드 선례) — 단위가 정적이라 진단 세션 조건 필요 | `manifest.ts:555-572` |
| 그릴 것 | 시간축 그림 · 순위 · 강조 · Top N · 행 구별(색 · 굵기 · 아이콘 · 줄무늬) 없음 | 기능 문서 결정 6 · 7 · DM-13 · 규칙 2 |
| 그릴 것 | 카드에 읽는 법을 쓰지 않음 ("합 ms 를 더하지 않음" 은 스키마 몫) | gui AGENTS · DM-7 |
| 크기 | 이름 중앙 28 · p95 68–70 · 최대 435자 → 자르지 않고 줄바꿈 | feas-dev 표면 제약 · DM-13 |
| 크기 | 행 15초 924–1,090 · 10분 10³–10⁴ → 카드 안 스크롤 상자 · **다 그림** (10⁴행 mount 0.37–0.49 s · 정렬 0.52–0.61 s · ⌘F 가 화면 밖 이름도 찾음) | plan D25 · `<runs>/shots/impl-review-slice-bench.txt` |
| 크기 | 값 폭 횟수 ≤ 8,818 · 합 ≤ 18,574 ms → 정수 5–6자리 + 소수 한 자리 | feas-dev |
| 크기 | 보고서 ≤820 레일 가로 줄 · ≤760 카드 1열 · 390 가로 넘침 0 → 표만 상자 안 가로 스크롤 | `report.css:14-50,162-164` · DM-13 |
| 크기 | 탭 라벨 max 150px + 배지 mono 10px | `app.css` `.tab-label` · gui HANDOFF §2 |
| 크기 | 드로어 clamp(280px, 32vw, 392px) — 924 에서 295px → 메타 꼬리 줄바꿈 | `app.css:858,930` |
| 크기 | 측정 화면 폭 미디어 쿼리 0 → 924 는 드로어가 열리면 한 단 · 예고는 끝 ellipsis | `app.css` `.setup-grid` · `.startbar-command` · D13 |
| 크기 | CLI 라벨 영어 10칸 고정 · doctor 이름 38칸 → 상세 ≤ 39칸 · 새 줄 ≤ 80칸 | `status.ts:84-87` · `doctor.ts:5` · DM-11 |
| 입력 | 정렬은 열 머리 누름 · 키보드만 (`<button>` in `<th aria-sort>`) · 포커스 링 = 기존 `:focus-visible` | DM-13 · `app.css:39-42` |
| 입력 | 토글은 기존 `option-row` 버튼(`aria-pressed`) 한 줄 | `SessionSection.tsx:35-50` |
| 데이터 | "모름" 고지는 debuggable 이 필요 — 설정 화면은 모름 → running 에만 | `api.ts:135-139` · DM-10 |
| 데이터 | 측정 화면 계약에 최대 시간 필드 없음 → 10분은 문구(토글 설명 · 각주)로만 | refeas-design #6 · plan D20 |
| 데이터 | 필드 이름 · 접은 자리 표기 · 새 reason_code 는 diag-extract 가 README 에 정함 — 시안의 `atrace_categories` … · `*` · `app_slices_open_unknown` 은 자리표시 | brief 단위 순서 |
| 데이터 | 시안 표본은 합성 — 실측 이름을 접은 꼴 + 지은 값 (`v1/gen_sample.py`) | research/atrace-youtube.md |
| 데이터 | DOM 시험 도구 없음 → 배지 · 메타 · 표 행 모델은 순수 함수 | feas-dev · DM-12 · DM-13 |

## 폭

| 이름 | 값 | 바뀌는 것 |
|---|---|---|
| 측정 · 넓음 | 1440 × 900 | 01·02 \| 03·04 두 단 · 드로어 392px |
| 측정 · 좁음 | 924 × 700 | 드로어 열리면 한 단 · 메타 꼬리 줄바꿈 · 예고 끝 잘림 (사진은 04 로 스크롤) |
| 보고서 · 넓음 | 1440 | 레일 212px · 그리드 12칸 · 표 이름 열 약 38% |
| 보고서 · 모바일 | 390 | 레일 위 가로 줄 · 카드 1열 · 표 상자 안 가로 스크롤 · 이름 열 140px 고정 |
| CLI | 80칸 | 새 줄 ≤ 80 |

## 화면

| 화면 | 무엇 | 시안 파일 |
|---|---|---|
| 측정 · 04 세션 | `--diagnose` 옵션 행 + 예고에 `--diagnose` (`start` 바로 뒤) | `Measure.html?state=toggle-off` · `toggle-on` |
| 측정 · 환경 점검 | capability 끝에 `diagnose: app slice` 줄 | `Measure.html?state=doctor-sdk30` |
| 측정 · running | 탭 배지 `진단 mm:ss` · 킥커 `측정 중 · 진단` · 각주 둘째 줄 · 고지 줄 | `Measure.html?state=running` · `running-unknown` |
| 측정 · 기록 드로어 | 메타 줄 꼬리 `· 진단` | `Measure.html?state=drawer` |
| 보고서 · 요약 | 상태 pill 옆 `진단` pill · 레일 탭 셋 · 측정 비용 단위 | `Report.html?state=summary` |
| 보고서 · 진단 탭 | 카드 셋(기록 범위 · slice 수 · 원본) + slice 표 | `Report.html?state=diag` · `sorted` · `open-null` · `no-process` · `failed` |
| 보고서 · 상태 · 이유 자리 | 블록 `status` = 카드 배지(unsupported · skipped · failed) · 블록 `reason` = 카드 제목 · 배지 `title` · 열림 `reason` = 열림 행 `title` · 코드는 값이 null 일 때만 값 자리 — 행으로 안 실음 (report HANDOFF ④) | `open-null` · `no-process` · `failed` · `v1/shots/reason-titles.txt` |
| CLI | doctor · start · status · runs · `--help` | `cli/blocks.txt` 블록 1–8 |

## 상태

상태 × 폭 = 예산 (refeas-design 그대로 24장 + 8블록) · `v1/shots/<화면>-<상태>-<폭>.png`.

| 상태 | 1440 | 924 | 390 |
|---|---|---|---|
| 측정 toggle-off (04 꺼짐) | ✓ | ✓ | |
| 측정 toggle-on (04 켜짐 · 예고) | ✓ | ✓ | |
| 측정 doctor-sdk30 (환경 점검 ✗ 줄) | ✓ | ✓ | |
| 측정 running (킥커 · 각주 · 배지) | ✓ | ✓ | |
| 측정 running-unknown (+ 모름 고지) | ✓ | ✓ | |
| 측정 drawer (진단 행 + 평소 행) | ✓ | ✓ | |
| 보고서 summary (pill · 측정 비용 단위) | ✓ | | ✓ |
| 보고서 diag (collected · 코드 단위 순) | ✓ | | ✓ |
| 보고서 sorted (정렬 뒤 · 포커스 · aria-sort) | ✓ | | ✓ |
| 보고서 open-null (열림 null · 표 있음) | ✓ | | ✓ |
| 보고서 no-process (partial · 표 null) | ✓ | | ✓ |
| 보고서 failed (trace_missing) | ✓ | | ✓ |

빈 칸은 D13. 낡은 이름(`process_name_stale_in_trace`)은 collected 와 모양이 같아 0장 · 회귀는 `v1/before/` · 현황 사진 — 0장.

## 조작

| 키 | 클릭 | 하는 일 | 포커스 | 키 겹침 |
|---|---|---|---|---|
| Enter · Space | `--diagnose` 행 | 진단 켬 · 끔 (`aria-pressed`) · 예고에 `--diagnose` | 그 행 | 없음 (기존 옵션 행) |
| Enter · Space | 레일 `진단` | 진단 탭 · 맨 위로 | 그 탭 | 없음 (기존 레일 탭) |
| Tab · Shift+Tab | — | 표 머리 버튼 10개 사이 | 머리 버튼 (`:focus-visible`) | 없음 |
| Enter · Space | slice 표 머리 | 그 열로 정렬 — 숫자 열 첫 누름 내림 · 다시 오름 · `이름` 첫 누름 오름. 정렬된 열만 `▲`/`▼` · `aria-sort` | 그 머리 버튼에 남음 | 없음 |

정렬은 사람이 고를 때만 바뀐다 — 처음 열면 이름 코드 단위 순(오름). 빈 칸은 방향과 무관하게 끝 · 같은 값은 이름 코드 단위 순. 정렬 상태는 저장하지 않는다.
정렬하면 표 상자를 맨 위로(`scrollTop = 0`) — 새 순서의 첫 행부터 보인다. 가로 위치 · 페이지 스크롤 · 포커스(머리 버튼, sticky 라 보임)는 그대로.

## 넘침

| 무엇 | 상한 | 넘치면 |
|---|---|---|
| slice 표 행 | 없음 (자르지 않음 · 1,055 · 10⁴) | 카드 안 스크롤 상자 `max-height: min(70vh, 640px)` · 머리 두 줄 sticky · 행은 다 그림 (D25) |
| slice 이름 | 없음 (435자) | 줄바꿈 `overflow-wrap: anywhere` · ellipsis 없음 · 이름 열 sticky |
| slice 표 열 10개 | 390 에서 상자 폭 초과 | 상자 안 가로 스크롤 · 페이지 가로 넘침 0 |
| 원본 경로 | 없음 | 줄바꿈 (`rp-wrap`) |
| 탭 배지 `진단 mm:ss` | 라벨 150px | 라벨만 ellipsis (지금 그대로) |
| 드로어 메타 꼬리 | 드로어 폭 | 줄바꿈 (truncate 아님) |
| 시작 바 예고 · CLI 로그 | 한 줄 | 끝 ellipsis 그대로 — 924 에서 끝이 잘려 `--diagnose` 를 `start` 바로 뒤에 |
| runs 행 | 80칸 | `경고 N · 진단` 행 77칸이 기준 · 마킹 있는 진단 행 86칸은 그대로 (D33) |

## 색

새 색 없음 — 기존 토큰만 · 색 뜻 없음 (규칙 2) · 테마는 다크 하나. ansi 칸은 웹이라 `—`.

| 뜻 | 토큰 | 고정색 | 구별 | ansi 겹침 | 대비 (WCAG) |
|---|---|---|---|---|---|
| 진단 pill (보고서 머리) | 글 `neutral-700` · 테두리 `divider` · 바탕 없음 | 없음 | 상태 pill(바탕 `neutral-200`)과 모양으로 갈림 | — | 글 8.47 (bg) |
| 각주 둘째 줄 · 고지 줄 · 드로어 꼬리 | `neutral-600` | 없음 | 기존 각주와 같음 | — | 6.13 (bg) · 5.48 (neutral-100) |
| slice 표 이름 · 숫자 | `neutral-800` | 없음 | 행 구별 없음 | — | 10.13 (surface) |
| slice 표 머리 | `neutral-600` | 없음 | — | — | 5.48 (surface) |
| slice 표 빈 칸 `—` | `neutral-600` | 없음 | — | — | 5.48 (surface) — `neutral-500` 은 3.82 라 안 씀 |
| 정렬 머리 포커스 링 | `accent` 2px | 없음 | 기존 `:focus-visible` | — | 비글자 5.19 (surface) |

| 테마 | 확인 |
|---|---|
| 다크 (유일) | `v1/shots/` 24장 |
| 밝은 | 없음 |

## 문구

새 문구의 **정본** (결정 9 · DM-15) — 패키지마다 시험이 자기 줄과 코드를 양방향 대조. `{…}` = 값 자리(코드도 같은 표기). 기존 문구 · 필드 경로 라벨은 표 밖(D10 · README). 남의 문구를 보여 주는 자리(running 고지 · doctor 줄 = core)는 주인 줄 하나.

| 패키지 | 자리 | 문구 | 뜻 | 안 쓰는 말 |
|---|---|---|---|---|
| core | doctor 검사 이름 | `diagnose: app slice` | 기기 단위 앱 slice 열림 | `atrace` 만 · `profileable` |
| core | doctor 상세 · ✓ (sdk ≥31) | `sdk {sdk} · 열림` | 조건 표 sdk ≥31 칸 | `지원` · `가능` |
| core | doctor 상세 · ✗ (sdk ≤30) | `sdk {sdk} · debuggable 앱만 열림` | 조건 표 sdk ≤30 칸 | `미지원` · `불가` |
| core | start 고지 · running 고지 (debuggable false) | `앱 slice 열림 모름 — sdk {sdk} · debuggable 아님` | 조건 표 "모름" 칸 · 세션은 열림 | `앱 slice 없음` |
| core | start 고지 · running 고지 (debuggable null) | `앱 slice 열림 모름 — sdk {sdk} · debuggable 모름` | 같은 칸 · debuggable 을 못 읽음 | 같음 |
| core | 새 reason (열림 null · debuggable false) | `sdk {sdk} · debuggable 아님 · profileable 읽을 출처 없음` | 열림 null 이유 — 보고서 열림 행 title | `실패` |
| core | 새 reason (열림 null · debuggable null) | `sdk {sdk} · debuggable 모름 · profileable 읽을 출처 없음` | 같음 | `실패` |
| core | 새 reason (블록 partial · ftrace 통계 0행) | `ftrace 기록 없음 · 원본에 ftrace 통계 0행 · slice 수 모름` | `ftrace_not_recorded` — 보고서 카드 제목 title | `실패` |
| core | 새 reason (블록 partial · ftrace 설정 오류) | `ftrace 설정 오류 {count}건 · slice 수 잰 그대로 · 빠진 이벤트 모름` | `ftrace_setup_errors` — `{count}` 오류 수 · 수 · 표는 잰 그대로 | `실패` |
| cli | `start --help` 의 `--diagnose` 설명 | `진단 세션 — atrace slice 기록 · 최대 10분` | `default` 없이 66칸 | `측정한다` 꼴 |
| cli | `start` · `status` 라벨 줄 | `Diagnose  atrace am · wm · view · dalvik + 앱 slice · 최대 10분` | 진단 세션 표시 · 63칸 | `Mode` · `구간` |
| cli | `runs` 행 꼬리 태그 | `진단` | 진단 세션 기록 | `diag` · `atrace` |
| gui | 04 옵션 행 설명 (`--diagnose`) | `atrace slice 기록 (am · wm · view · dalvik + 대상 앱) · 최대 10분` | 무엇을 · 얼마나 | `디버그` |
| gui | 탭 배지 (진단 세션 측정 중) | `진단 {elapsed}` | 진단 세션 탭 · 경과 | `DIAG` |
| gui | running 킥커 꼬리 (`측정 중 · ` 뒤) | `진단` | 진단 세션 | — |
| gui | running 각주 둘째 줄 | `진단 · slice 비용 앱 프로세스 몫 · 평소 세션과 비교 불가 · 최대 10분` | DM-12 두 사실 + 최대 시간 | 평가 |
| gui | 기록 드로어 메타 줄 꼬리 | `진단` | 진단 세션 기록 | 배지 · 색 |
| gui | 보고서 레일 세 번째 탭 | `진단` | 진단 탭 | `atrace` |
| gui | 보고서 머리 pill (상태 pill 옆) | `진단` | 진단 세션 보고서 | — |
| gui | 진단 탭 섹션 머리 | `atrace slice` | 섹션 이름 | `구간` |
| gui | 카드 제목 | `기록 범위` | 카테고리 · 대상 앱 · 열림 (상태 = 배지) | `설정` |
| gui | 카드 제목 | `slice 수` | 수 칸들 | `통계` |
| gui | 카드 제목 | `원본` | 라벨 루트 경로 하나 — `artifacts.trace` · `diagnose.trace_bytes` | — |
| gui | 카드 제목 | `slice 이름별` | 접은 이름별 표 | `Top` · `상위` |
| gui | slice 표 카드 단위 | `대상 앱 프로세스 · {n}행` | 범위 · 행 수 (= 접은 이름 수) | `앱 slice` (가르지 않음 · 결정 8) |
| gui | slice 표 머리 | `이름` | 접은 이름 | — |
| gui | slice 표 머리 (갈래) | `메인 스레드` | tid = pid | `UI 스레드` |
| gui | slice 표 머리 (갈래) | `그 밖 스레드` | 대상 앱의 다른 스레드 | — |
| gui | slice 표 머리 (갈래) | `비동기 트랙` | 프로세스 비동기 트랙 | — |
| gui | slice 표 머리 (열) | `횟수` | 끝나지 않은 slice 포함 | — |
| gui | slice 표 머리 (열) | `합 ms` | 끝난 slice 의 합 | `총 시간` |
| gui | slice 표 머리 (열) | `최대 ms` | 끝난 slice 의 최대 | — |
| gui | slice 표 빈 칸 | `—` | 그 갈래에 그 이름 slice 없음 | `0` |
| gui | slice 표 정렬 표시 (오름) | `▲` | — | — |
| gui | slice 표 정렬 표시 (내림) | `▼` | — | — |
| gui | 측정 비용 카드 단위 (진단 세션에만) | `앱 프로세스 몫 미포함` | DM-13 · DM-14 한정 | — |

`check_copy.py` (2026-10-08 · ⑨ 승격): **줄 36 (cli 3 · core 9 · gui 24) · 걸림 0** · `--break` 표본 46 (규칙 · 낱말마다) 어긋남 0.

## 기능 문서 항목

| 항목 ID | 화면 · 상태 |
|---|---|
| DM-2 | 측정 toggle-off · toggle-on (토글 · 예고) |
| DM-10 | 측정 doctor-sdk30 · running-unknown · CLI 1 · 2 · 4 |
| DM-11 | CLI 3 · 4 · 5 · 7 · 8 (`stop` · `extract` 는 그대로 — 0블록) |
| DM-12 | 측정 running · running-unknown (배지 · 킥커 · 각주) · drawer (메타 꼬리) |
| DM-13 | 보고서 summary · diag · sorted · open-null · no-process · failed |
| DM-15 | `## 문구` · `check_copy.py` |
| DM-17 | 토글 설명 · 각주 `최대 10분` · CLI 3 · 5 · 6 (넘김은 기존 문구 · 값 10:00) |

## HANDOFF 와 어긋남

구현 단위가 고친다 (brief) — 목록만. `기존` = 전부터 어긋난 곳.

| 문서 · 절 | 지금 HANDOFF | 진단 모드 뒤 |
|---|---|---|
| gui §2 탭 스트립 | 배지 `mm:ss` · `준비` | 진단 세션은 `진단 mm:ss` |
| gui §3 04 세션 | 옵션 3개 · 예고 `start --app … -o runs` | 옵션 4개(`--diagnose` 끝) · 예고 `start [--diagnose] --app …` (기존: `npx` 낡음) |
| gui §4 측정 중 화면 | 킥커 `측정 중` · 각주 한 문장 | 킥커 `측정 중 · 진단` · 각주 둘째 줄 · 고지 줄 (기존: 못 재는 지표 줄도 없음) |
| gui §5 기록 드로어 | 메타 `… · 경고 N[ · 미지원 N][ · 마킹 N]` | 끝에 `[ · 진단]` |
| gui (절 없음) 환경 점검 패널 | 없음 (기존) | capability 끝에 `diagnose: app slice` 줄 |
| report §2 블록 | 6종 (기존: 코드는 7) | 8 — slice 표 kind |
| report §3 탭 · 헤더 | 탭 2개 · 플래그 줄 (기존: 코드에 없음) | 탭 3개 · `진단` pill · 측정 비용 단위 조건부 |
| report §4 차트 | slice 표 없음 | 정렬 · `aria-sort` · 머리 · 이름 열 sticky · 상자 안 스크롤 · 줄바꿈 · 다 그림 |
| report ④ · §4 pairs | 배지 · title 은 `metrics.*` 카드만 · pairs 행 title 없음 | 진단 블록에도 배지 · 제목 title · 열림 행 title · 값 칸 `값 없음` + 코드 (④ 관례를 넓힘) |
| report §7 상태 | `tab: 'summary'\|'device'` | `\|'diagnose'` + 정렬 `{열, 방향}` |

## 정한 것

⑨ 승격 — 디자이너 intent 4 의 색 · 문구 · 키 `사람: 예` 와 plan 디자인 결정. 단계 5 라 메인이 정함 (D9 만 사람).

| # | 날짜 · run | 결정 | 확인 거리 |
|---|---|---|---|
| 1 | 2026-10-08 · diagnostic-mode | 후보 하나 · 진단 자리 = 보고서 레일 세 번째 탭 `진단` (R-c · D22) | `## 시안` · `report-diag-*` |
| 2 | 2026-10-08 · diagnostic-mode | 낱말 `slice` (D9) | `## 문구` · `check_copy.py` |
| 3 | 2026-10-08 · diagnostic-mode | 폭 측정 1440 · 924 · 보고서 1440 · 390 · CLI 80칸 (D13) | `## 폭` · `## 상태` |
| 4 | 2026-10-08 · diagnostic-mode | slice 표 다 그림 — 가상 스크롤 없음 (D25) | `## 넘침` · `DM-13 행 모델 자르지 않음 · 구별 없음` |
| 5 | 2026-10-08 · diagnostic-mode | 필드 자리 다섯 (행 · 카드 배지 · 제목 title · 열림 행 title · null 값 자리 코드) · status · reason 은 행 아님 (D27) | `DM-13 진단 탭 전 필드` |
| 6 | 2026-10-08 · diagnostic-mode | 마킹 있는 진단 runs 행 86칸 받아들임 — 꼬리를 줄이면 D10 위반 (D33) | `## 넘침` · `check_cli.py` `*` 줄 |
| 7 | 2026-10-08 · diagnostic-mode | core reason 2줄은 개발이 `## 문구` 에 먼저 더함 — 주인 예외 (D36) | `DM-15 문구 표 ↔ 코드 (core)` |
| 8 | 2026-10-08 · diagnostic-mode | 정지 뒤 `--diagnose` 꺼짐 · `--launch` · `--force` 는 남김 (D41) | `DM-12 정지 뒤 진단은 남지 않는다` |
| 9 | 2026-10-08 · diagnostic-mode | 보고서 표기 다섯 — 값 구분자 ` · ` · 원본 경로 등폭 · 끝나지 않은 갈래 합 · 최대 `—` · `[]` = 0행 표 · 포커스 링 안쪽 (D43) | `report-*` 사진 |
| 10 | 2026-10-08 · diagnostic-mode | 진단 pill 테두리만 · 새 색 · 행 구별 없음 | `## 색` |
| 11 | 2026-10-08 · diagnostic-mode | 측정 화면 진단 = 글자만 (배지 · 킥커 · 각주 · 고지 · 드로어 꼬리) | `DM-12 진단 표시 4곳` |
| 12 | 2026-10-08 · diagnostic-mode | 칸 라벨 = 필드 경로 · 카드 제목만 우리말 · 한도는 `최대 10분` 글자 · debuggable `아님` · `모름` 두 줄 | `## 문구` |
| 13 | 2026-10-08 · diagnostic-mode | 정렬 — 숫자 열 첫 누름 내림 · `이름` 오름 · 저장 안 함 · 정렬 뒤 맨 위 | `## 조작` · `DM-13 정렬은 사람이 고를 때만` |
| 14 | 2026-10-08 · diagnostic-mode | 표 숫자 — 횟수 정수 · 합 · 최대 소수 한 자리 · 빈 갈래 `—` | `report-diag-*` |
| 15 | 2026-10-08 · diagnostic-mode | `--diagnose` 는 `start` 바로 뒤 · `Diagnose` 줄 · 고지 · doctor 줄 자리 · `--help` default 없음 | `cli/blocks.txt` · `check_cli.py` |

## 확인

| 시안 | 골든 | 시험 이름 | 실화면 결과 |
|---|---|---|---|
| 측정 6상태 × 1440 · 924 | 골든 없음 | playwright 사진 (`v1/shoot.md`) | `v1/shots/measure-*` 12장 전부 열어 봄 (2026-10-08 · 확인 2회) |
| 보고서 6상태 × 1440 · 390 | 골든 없음 | playwright 사진 · `check_shots.py` | `v1/shots/report-*` 12장 (고침 1 에 다시 찍고 열어 봄) · 390 넘침 6/6 상태 0 · title · 라벨 · 정렬 스크롤 `reason-titles.txt` · `check_shots.py` 37칸 어긋남 0 |
| CLI 8블록 | 없음 | `check_cli.py` (깨 봄 `--break` → exit 1) | 새 줄 10개 · 80칸 넘침 0 (최대 77칸 runs 행) · `*` 마킹 있는 진단 행 86칸 (D33) |
| `## 문구` | 없음 | `check_copy.py` (깨 봄 `--break`) | 위 `## 문구` 끝 줄 |

구현 화면 찍는 길 (단위 몫 · 골든 없음 — 폭마다 playwright):

| 단위 | 무엇을 | 어떻게 |
|---|---|---|
| diag-gui-report | 합성 `result.json` 상태 6 (평소 · collected · open-null · no-process · failed · 낡은 이름) + 10⁴행 1 | `perftracker report <id> -o <dir> --no-browser` → `file://` 1440 · 390 사진 · `scrollWidth − clientWidth` = 0 · sorted 는 머리 클릭 뒤 · 10⁴행 mount · 정렬 시간 |
| diag-gui-measure | 측정 화면 6상태 × 1440 · 924 | `npm run gui:dev` + `?mock` — 진단 목업 데이터(`web/api/mock.ts`)는 diag-gui-server 몫 (겹침 · 적어 둠) |
| diag-extract 뒤 | 자리표시 라벨 · 코드가 README 이름으로 바뀜 | 390 가로 넘침을 다시 잰다 — pairs `th` 가 nowrap (`report.css:286-289`) |

시험은 패키지가 한다 — `DM-12 진단 표시 4곳` · `DM-13 행 모델 …` · `DM-15 문구 표 ↔ 코드`.

## 검토

| 날짜 · run | 검토 | 누가 | 판정 | 왕복 |
|---|---|---|---|---|
| 2026-10-08 · diagnostic-mode | 부합 (1ede47f) | 기획 | 조건부 1 — reason 자리 (고침 1) · #2 후속 D18 | 1 |
| 2026-10-08 · diagnostic-mode | 구현 가능 (1ede47f) | 개발 | 조건부 4 (고침 1) · 사람 1 → D25 다 그림 | 1 |

## 바뀐 기록

| 날짜 | run | 무엇이 |
|---|---|---|
| 2026-10-08 | diagnostic-mode | 처음 — 제약 · 시안 v1 후보 1 (24장 + CLI 8블록) · `## 문구` 정본 34줄 |
| 2026-10-08 | diagnostic-mode | 고침 1 — reason 자리 · 상태 행 뺌 · 원본 라벨 · 정렬 뒤 맨 위 · 구현 찍는 길 · D25 다 그림 · 보고서 사진 12장 다시 |
| 2026-10-08 | diagnostic-mode | ⑨ 승격 — `## 정한 것` 15줄 · 고른 후보 1 · D33 runs 행 86칸 (`## 넘침` · `check_cli.py`) · `## 문구` 36줄 (D36 core 2줄) |
| 2026-10-11 | baseline-profile | `## 문구` 범위 두 줄(cli `start` · `status` 라벨 줄 54 → 63칸 · gui 04 옵션 행 설명)에 `dalvik` — DM-3 · 기능 문서 결정 36 · 낱말 하나 더하는 기계적 변경 (bp-core-art) |
