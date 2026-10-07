# 진단 모드 — 디자인

| 항목 | 값 |
|---|---|
| 기능 | diagnostic-mode |
| 기능 문서 | docs/spec/diagnostic-mode.md (1c475d4) |
| 등급 | 화면 |
| 마지막 변경 | 2026-10-08 · 처음 — 시안 v1 후보 1 · `## 문구` 정본 |

측정 화면 · 보고서 · CLI 의 **지금 자리에 한 칸씩** 덧붙인다. 새 화면은 보고서 진단 탭 하나(R-c · plan D22).
낱말 `slice`(D9) · 옵션 `--diagnose`(D8) · 진단 세션 최대 10분(D11) · 후보 하나(D22).

## 시안

| 차수 | 후보 | 고른 것 | 누가 | 로컬 폴더 | 시안 생성기 | 검사 명령 | Claude Design 파일 |
|---|---|---|---|---|---|---|---|
| 1 | 1 | | | `labs/diagnostic-mode-design/v1/claude-design/` · 사진 `v1/shots/` | Claude Design (입력 `v1/brief-claude-design.md` · 표본 `v1/gen_sample.py`) · 사진 `v1/shoot.md` | `python3 labs/diagnostic-mode-design/v1/check_shots.py` | [성능 측정 CLI GUI 도구](https://claude.ai/design/p/9ee5c8ab-33b9-4586-ae73-69f9e53ecd42) · `diagnostic-mode/Measure.html` · `diagnostic-mode/Report.html` |
| 1 · CLI | 1 | | | `labs/diagnostic-mode-design/v1/cli/` | `gen_cli.py` → `cli/blocks.txt` | `python3 labs/diagnostic-mode-design/v1/check_cli.py` | 없음 |
| 1 · 문구 | — | — | 디자이너 | 이 문서 `## 문구` | 없음 | `python3 labs/diagnostic-mode-design/v1/check_copy.py` | 없음 |

시안 기준 = 지금 코드 실렌더 DOM (측정 `gui:dev` + `?mock` · 보고서 `report-f48507.html`) 을 Claude Design `diagnostic-mode/ref/` 에 올려 그 위에 생성. 옛 프로토타입(`*.dc.html` · 19곳 낡음)은 안 씀. 지금 화면 사진 `v1/before/`.

## 제약

| 종류 | 제약 | 출처 |
|---|---|---|
| 그릴 것 | 기존 자리에 한 칸씩 (04 옵션 행 · 예고 · 탭 배지 · 킥커 · 각주 · 못 재는 지표 줄 자리 · 드로어 메타 · 환경 점검 줄) · 새 패널 · 배너 없음 | `SessionSection.tsx:6-10` · `format/preview.ts` · `TabStrip.tsx:40-42` · `RunningScreen.tsx:25-55,73-75` · `HistoryDrawer.tsx:120-124` · `DoctorPanel.tsx` |
| 그릴 것 | slice 표는 kind 7 어디에도 안 맞음(pairs = 3열 · 정렬 없음) → 새 kind + 정렬 상태 | `manifest.ts:15-16` · feas-design 표면 제약 |
| 그릴 것 | 탭이 정적 배열 — 진단 세션에만 나오는 세 번째 탭은 새 장치 | `manifest.ts:261-264` · `ReportPage.tsx:302` |
| 그릴 것 | 머리 플래그 줄은 코드에 없음 → 진단 표시 = 상태 pill 옆 pill. `옵션` 메타 칸은 손대지 않음 | `header.ts:7-18` · brief 정하지 않은 것 14 |
| 그릴 것 | 측정 비용 한정은 카드 단위 칸(경고 카드 `측정 조건 관측 · 평가 아님` 선례) — 단위가 정적이라 진단 세션 조건이 필요 | `manifest.ts:555-572` |
| 그릴 것 | 시간축 그림 · 순위 · 강조 · Top N · 행 구별(색 · 굵기 · 아이콘 · 줄무늬) 없음 | 기능 문서 결정 6 · 7 · DM-13 · 규칙 2 |
| 그릴 것 | 카드에 읽는 법을 쓰지 않음 — "합 ms 를 행끼리 더하지 않음" 은 스키마 설명 몫 | gui AGENTS 「카드에 읽는 법을 설명하지 않는다」 · DM-7 |
| 크기 | 이름 중앙 28 · p95 68–70 · 최대 435자 → 자르지 않고 줄바꿈 | feas-dev 표면 제약 · DM-13 |
| 크기 | 행 15초 924–1,090 · 10분 추정 10³–10⁴ → 카드 안 스크롤 상자 · 창 안 행만 그리기(새 의존성 없이) | feas-dev · brief 정하지 않은 것 13 |
| 크기 | 값 폭 횟수 ≤ 8,818 · 합 ≤ 18,574 ms → 정수 5–6자리 + 소수 한 자리 | feas-dev |
| 크기 | 보고서 ≤820 레일 위 가로 줄 · ≤760 카드 1열 · 390 페이지 가로 넘침 0 → 표만 상자 안 가로 스크롤 | `report.css:14-50,162-164` · DM-13 |
| 크기 | 탭 라벨 max 150px + 배지 mono 10px | `app.css` `.tab-label` · gui HANDOFF §2 |
| 크기 | 드로어 clamp(280px, 32vw, 392px) — 924 에서 295px · 메타 줄 mono 10.5px → 진단 꼬리가 줄바꿈 | `app.css:858,930` |
| 크기 | 측정 화면 폭 미디어 쿼리 0 · `setup-grid` auto-fit 360px → 924 는 드로어가 열리면 한 단 · 시작 바 예고는 한 줄 끝 ellipsis | `app.css` `.setup-grid` · `.startbar-command` · plan D13 |
| 크기 | CLI 라벨 영어 10칸 고정 · doctor 이름 38칸 → 상세 ≤ 39칸 · 새 줄 ≤ 80칸 | `status.ts:84-87` · `doctor.ts:5` · DM-11 |
| 입력 | 정렬은 열 머리 누름 · 키보드만 (`<button>` in `<th aria-sort>`) · 포커스 링 = 기존 `:focus-visible` | DM-13 · `app.css:39-42` |
| 입력 | 토글은 기존 `option-row` 버튼(`aria-pressed`) 한 줄 | `SessionSection.tsx:35-50` |
| 데이터 | "모름" 고지는 debuggable 을 알아야 함 — 설정 화면은 모름 → running 에만 | `api.ts:135-139` · DM-10 |
| 데이터 | 측정 화면 계약에 최대 시간 필드 없음 → 10분은 문구(토글 설명 · 각주)로만 | refeas-design #6 · plan D20 |
| 데이터 | 진단 블록 필드 이름 · 접은 자리 표기 · 새 reason_code 이름은 diag-extract 가 README 에 정함 — 시안 라벨(`atrace_categories` …) · `*` · `app_slices_open_unknown` 은 자리표시 | brief 단위 순서 |
| 데이터 | 시안 표본은 합성 — 이름은 SM-S901N · YouTube 실측 이름을 접은 꼴, 값은 지어 붙임 (`v1/gen_sample.py`) | research/atrace-youtube.md |
| 데이터 | DOM 시험 도구 없음 → 탭 배지 · 드로어 메타 · 표 행 모델은 순수 함수 | feas-dev · DM-12 · DM-13 |

## 폭

| 이름 | 값 | 바뀌는 것 |
|---|---|---|
| 측정 · 넓음 | 1440 × 900 | 01·02 \| 03·04 두 단 · 드로어 392px |
| 측정 · 좁음 | 924 × 700 | 드로어 닫힘 두 단 · 열림(295px) 한 단 · 메타 꼬리 줄바꿈 · 예고 끝 잘림 (사진은 04 로 스크롤) |
| 보고서 · 넓음 | 1440 | 레일 212px · 그리드 12칸 · 표 이름 열 약 38% |
| 보고서 · 모바일 | 390 | 레일 위 가로 줄(탭 셋) · 카드 1열 · 표 상자 안 가로 스크롤 · 이름 열 140px 고정 |
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
| CLI | doctor · start · status · runs · `--help` | `cli/blocks.txt` 블록 1–8 |

## 상태

상태 × 폭 = 시안 장수 예산 (refeas-design `## 시안 예산` 그대로 24장 + 8블록). 사진 `v1/shots/<화면>-<상태>-<폭>.png`.

| 상태 | 1440 | 924 | 390 |
|---|---|---|---|
| 측정 toggle-off (04 꺼짐) | ✓ | ✓ | |
| 측정 toggle-on (04 켜짐 · 예고) | ✓ | ✓ | |
| 측정 doctor-sdk30 (환경 점검 ✗ 줄) | ✓ | ✓ | |
| 측정 running (킥커 · 각주 · 탭 셋 배지) | ✓ | ✓ | |
| 측정 running-unknown (+ 모름 고지) | ✓ | ✓ | |
| 측정 drawer (진단 행 + 평소 행) | ✓ | ✓ | |
| 보고서 summary (머리 pill · 측정 비용 단위) | ✓ | | ✓ |
| 보고서 diag (collected · 코드 단위 순) | ✓ | | ✓ |
| 보고서 sorted (정렬 뒤 · 포커스 · aria-sort) | ✓ | | ✓ |
| 보고서 open-null (열림 null + reason · 표 있음) | ✓ | | ✓ |
| 보고서 no-process (partial · 표 null) | ✓ | | ✓ |
| 보고서 failed (trace_missing) | ✓ | | ✓ |

빈 칸: 측정 화면은 390 을 재지 않고(D13 · 폭 미디어 쿼리 0) 보고서는 924 를 재지 않는다(D13).
partial 낡은 이름(`process_name_stale_in_trace`)은 collected 와 모양이 같아 0장. 회귀(평소 보고서 · 평소 running · `stop`)는 `v1/before/` 와 현황 사진 — 0장.

## 조작

| 키 | 클릭 | 하는 일 | 포커스 | 키 겹침 |
|---|---|---|---|---|
| Enter · Space | `--diagnose` 행 | 진단 켬 · 끔 (`aria-pressed`) · 예고에 `--diagnose` | 그 행 | 없음 — 기존 옵션 행과 같은 버튼 |
| Enter · Space | 레일 `진단` | 진단 탭 · 맨 위로 | 그 탭 | 없음 — 기존 레일 탭 |
| Tab · Shift+Tab | — | slice 표 머리 버튼 10개 사이 이동 | 머리 버튼 (`:focus-visible` 링) | 없음 — 브라우저 기본 |
| Enter · Space | slice 표 머리 | 그 열로 정렬 — 숫자 열 첫 누름 내림 · 다시 오름 · `이름` 첫 누름 오름. 정렬된 열만 `▲`/`▼` · `aria-sort` | 그 머리 버튼에 남음 | 없음 |

정렬은 사람이 고를 때만 바뀐다 — 처음 열면 이름 코드 단위 순(오름). 빈 칸은 방향과 무관하게 끝 · 같은 값은 이름 코드 단위 순. 정렬 상태는 저장하지 않는다.

## 넘침

| 무엇 | 상한 | 넘치면 |
|---|---|---|
| slice 표 행 | 없음 (자르지 않음 · 1,055 · 10⁴) | 카드 안 스크롤 상자 `max-height: min(70vh, 640px)` · 머리 두 줄 sticky · 구현은 창 안 행만 그림 |
| slice 이름 | 없음 (435자) | 줄바꿈 `overflow-wrap: anywhere` · ellipsis · 툴팁 대체 없음 · 이름 열 sticky |
| slice 표 열 10개 | 390 에서 상자 폭 초과 | 상자 안 가로 스크롤 · 페이지 가로 넘침 0 |
| 원본 경로 | 없음 | 줄바꿈 (`rp-wrap`) |
| 탭 배지 `진단 mm:ss` | 라벨 150px | 라벨만 ellipsis(지금 그대로) · 배지는 줄지 않음 |
| 드로어 메타 꼬리 | 드로어 폭 | 줄바꿈 (truncate 아님) |
| 시작 바 예고 · CLI 로그 | 한 줄 | 지금처럼 끝 ellipsis — 924 에서 끝이 잘리므로 `--diagnose` 를 `start` 바로 뒤에 둔다 (`perftracker start --diagnose --app …`) |
| runs 행 | 80칸 | `경고 N · 진단` 행 77칸이 기준. 기존 꼬리(미지원 · 마킹)로 이미 넘치는 행은 그대로 (D20 후속) |

## 색

새 색 없음 — 기존 토큰만. 진단 표시에 색 뜻을 싣지 않는다 (규칙 2). 테마는 다크 하나(토큰에 밝은 테마 없음).

| 뜻 | 토큰 | 고정색 | 구별 | ansi 겹침 | 대비 (WCAG) |
|---|---|---|---|---|---|
| 진단 pill (보고서 머리) | 글 `--color-neutral-700` · 테두리 `--color-divider` · 바탕 없음 | 없음 | 상태 pill(바탕 `neutral-200`)과 모양으로 갈림 — 색 뜻 없음 | 해당 없음 | 글 8.47 (bg) |
| 각주 둘째 줄 · 고지 줄 · 드로어 꼬리 | `--color-neutral-600` | 없음 | 기존 각주 · 못 재는 지표 줄과 같음 | 해당 없음 | 6.13 (bg) · 5.48 (neutral-100) |
| slice 표 이름 · 숫자 | `--color-text` · `--color-neutral-800` | 없음 | 행 구별 없음 | 해당 없음 | 12.95 · 10.13 (surface) |
| slice 표 머리 | `--color-neutral-600` | 없음 | — | 해당 없음 | 5.48 (surface) |
| slice 표 빈 칸 `—` | `--color-neutral-600` | 없음 | — | 해당 없음 | 5.48 (surface) — `neutral-500` 은 3.82 라 안 씀 |
| 정렬 머리 포커스 링 | `--color-accent` 2px | 없음 | 기존 `:focus-visible` | 해당 없음 | 비글자 5.19 (surface) |

| 테마 | 확인 |
|---|---|
| 다크 (유일) | `v1/shots/` 24장 |
| 밝은 | 없음 — 토큰에 밝은 테마 없음 |

## 문구

새 문구의 **정본** (기능 문서 결정 9 · DM-15). 패키지마다 시험이 자기 줄과 코드의 진단 문구 모음을 양방향 대조한다.
`{…}` 는 값 자리 — 코드 쪽 문구도 같은 자리표시를 쓴다. 기존 문구는 대상이 아니다(D10). 화면 라벨 중 필드 경로(`atrace_categories` …)는 스키마 이름이라 이 표 밖 — README 가 정한다.
다른 패키지의 문구를 그대로 보여 주는 자리(running 고지 = core 문구 · doctor 줄 = core)는 주인 패키지 줄 하나만 둔다.

| 패키지 | 자리 | 문구 | 뜻 | 안 쓰는 말 |
|---|---|---|---|---|
| core | doctor 검사 이름 | `diagnose: app slice` | 이 기기에서 진단 세션의 앱 slice 가 열리나 | `atrace` 만 · `profileable` |
| core | doctor 상세 · ✓ (sdk ≥31) | `sdk {sdk} · 열림` | 조건 표 sdk ≥31 칸 | `지원` · `가능` |
| core | doctor 상세 · ✗ (sdk ≤30) | `sdk {sdk} · debuggable 앱만 열림` | 조건 표 sdk ≤30 칸 | `미지원` · `불가` |
| core | start 고지 · running 고지 (debuggable false) | `앱 slice 열림 모름 — sdk {sdk} · debuggable 아님` | 조건 표 "모름" 칸 — 세션은 열림 | `앱 slice 없음` · `프레임워크 slice 만` |
| core | start 고지 · running 고지 (debuggable null) | `앱 slice 열림 모름 — sdk {sdk} · debuggable 모름` | 같은 칸 · debuggable 을 못 읽음 | 같음 |
| core | 새 reason (열림 null · debuggable false) | `sdk {sdk} · debuggable 아님 · profileable 읽을 출처 없음` | 열림 null 의 이유 — result.json · 보고서 열림 행 title | `실패` |
| core | 새 reason (열림 null · debuggable null) | `sdk {sdk} · debuggable 모름 · profileable 읽을 출처 없음` | 같음 | `실패` |
| cli | `start --help` 의 `--diagnose` 설명 | `진단 세션 — atrace slice 기록 · 최대 10분` | 옵션 한 줄 (`default` 를 주지 않아 꼬리 없음 · 66칸) | `측정한다` 꼴 |
| cli | `start` · `status` 라벨 줄 | `Diagnose  atrace am · wm · view + 앱 slice · 최대 10분` | 진단 세션 표시 · 54칸 | `Mode` · `구간` |
| cli | `runs` 행 꼬리 태그 | `진단` | 진단 세션 기록 | `diag` · `atrace` |
| gui | 04 옵션 행 설명 (`--diagnose`) | `atrace slice 기록 (am · wm · view + 대상 앱) · 최대 10분` | 무엇을 · 얼마나 | `디버그` |
| gui | 탭 배지 (진단 세션 측정 중) | `진단 {elapsed}` | 진단 세션 탭 · 경과 | `DIAG` |
| gui | running 킥커 꼬리 (`측정 중 · ` 뒤) | `진단` | 진단 세션 | — |
| gui | running 각주 둘째 줄 | `진단 · slice 비용 앱 프로세스 몫 · 평소 세션과 비교 불가 · 최대 10분` | DM-12 두 사실 + 최대 시간 | `오버헤드 큼` 같은 평가 |
| gui | 기록 드로어 메타 줄 꼬리 | `진단` | 진단 세션 기록 | 배지 · 색 |
| gui | 보고서 레일 세 번째 탭 | `진단` | 진단 탭 | `atrace` |
| gui | 보고서 머리 pill (상태 pill 옆) | `진단` | 진단 세션 보고서 | — |
| gui | 진단 탭 섹션 머리 | `atrace slice` | 섹션 이름 | `구간` |
| gui | 카드 제목 | `기록 범위` | 카테고리 · 대상 앱 · 열림 · 상태 | `설정` |
| gui | 카드 제목 | `slice 수` | 수 칸들 | `통계` |
| gui | 카드 제목 | `원본` | `artifacts.trace` · 크기 | — |
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

`check_copy.py` 를 이 표에 돌린 결과 (2026-10-08): **줄 34 (cli 3 · core 7 · gui 24) · 규칙에 걸림 0**. 깨 봄 `--break` — 끝 글자 · `니다` · 권유 6 · 평가 낱말 28 마다 넣은 표본 41개가 전부 걸리고 통과해야 할 5개(`조회` 포함)는 통과 (어긋남 0).

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

구현 단위가 고친다 (brief) — 여기는 목록만. `기존` = 진단 모드 전부터 어긋나 있던 곳.

| 문서 · 절 | 지금 HANDOFF | 진단 모드 뒤 |
|---|---|---|
| gui §2 탭 스트립 | 배지 `mm:ss` · `준비` | 진단 세션은 `진단 mm:ss` |
| gui §3 04 세션 | 옵션 3개 표 · 예고 `start --app … [--launch] [--force] -o runs` | 옵션 4개(`--diagnose` 끝 행) · 예고 `start [--diagnose] --app …` (기존: `npx` · `-o runs 고정` 도 낡음) |
| gui §4 측정 중 화면 | 킥커 `측정 중` · 각주 한 문장 | 킥커 `측정 중 · 진단` · 각주 둘째 줄 · 정보 아래 고지 줄 (기존: 못 재는 지표 줄 · 정지 위치도 HANDOFF 에 없음) |
| gui §5 기록 드로어 | 메타 `… · 경고 N[ · 미지원 N][ · 마킹 N]` | 끝에 `[ · 진단]` |
| gui (절 없음) 환경 점검 패널 | 없음 (기존) | capability 끝에 `diagnose: app slice` 줄 |
| report §2 블록 | 6종 (기존: 코드는 7) | 8 — slice 표 kind |
| report §3 탭 · 헤더 | 탭 2개 · 플래그 줄 (기존: 코드에 없음) | 진단 세션 탭 3개 · 상태 pill 옆 `진단` pill · 측정 비용 카드 단위 조건부 |
| report §4 차트 | slice 표 없음 | 정렬 · 키보드 · `aria-sort` · 머리 · 이름 열 sticky · 상자 안 스크롤 · 이름 줄바꿈 |
| report §7 상태 | `tab: 'summary'\|'device'` | `\|'diagnose'` + 정렬 `{열, 방향}` |

## 정한 것

없음 — ⑨ 승격 때 디자이너 intent 4 의 `사람: 예` 와 후보 고르기 결과가 온다.

## 확인

| 시안 | 골든 | 시험 이름 | 실화면 결과 |
|---|---|---|---|
| 측정 6상태 × 1440 · 924 | 골든 없음 | playwright 사진 (`v1/shoot.md`) | `v1/shots/measure-*-{1440,924}.png` 12장 · 2026-10-08 · 12장 전부 열어 봄 (확인 2회 — 2회째 예고 순서 고침) |
| 보고서 6상태 × 1440 · 390 | 골든 없음 | playwright 사진 · `check_shots.py` | `v1/shots/report-*-{1440,390}.png` 12장 전부 열어 봄 · 390 가로 넘침 6/6 상태 0 · `check_shots.py` 24칸 어긋남 0 |
| CLI 8블록 | 없음 | `check_cli.py` (깨 봄 `--break` → exit 1) | 새 줄 10개 · 80칸 넘침 0 (최대 77칸 runs 행) |
| `## 문구` | 없음 | `check_copy.py` (깨 봄 `--break`) | 위 `## 문구` 끝 줄 |

구현 확인은 패키지 시험이 한다 — `DM-12 진단 표시 4곳` · `DM-13 행 모델 …` · `DM-15 문구 표 ↔ 코드` (기능 문서 `### 동작`).

## 검토

기록 없음 — 이 문서의 첫 판. 실현성 검토(feas-dev · feas-design · refeas-design)는 기능 문서 단계였고 `## 제약` 의 출처다.

## 바뀐 기록

| 날짜 | run | 무엇이 |
|---|---|---|
| 2026-10-08 | diagnostic-mode | 처음 — 제약 · 시안 v1 후보 1 (24장 + CLI 8블록) · `## 문구` 정본 34줄 |
