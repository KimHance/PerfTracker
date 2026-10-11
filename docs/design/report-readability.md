# 보고서 가독성 — 디자인

| 항목 | 값 |
|---|---|
| 기능 | report-readability |
| 기능 문서 | docs/spec/report-readability.md (701a79f) |
| 등급 | 화면 |
| 마지막 변경 | 2026-10-11 · 고침 1 — thermal 낱말 · 표식 · 툴팁 크기 · HANDOFF 어긋남 단위별 · 배지 셈 B30 |

세션 보고서 하나만 — 측정 화면은 그대로. 바꾸는 자리는 **보고서 CSS** 와 매니페스트이고 토큰 값은 그대로다 (결정 11).
컴파일 상태 카드 · 진단 ART 칸 · CLI 줄은 `docs/design/baseline-profile.md` — 같은 시안 파일의 상태로 함께 그렸다.

## 시안

| 차수 | 후보 | 고른 것 | 누가 | 로컬 폴더 | 시안 생성기 | 검사 명령 | Claude Design 파일 |
|---|---|---|---|---|---|---|---|
| 1 | 1 | | | `labs/report-readability-design/v1/claude-design/` · `v1/shots/` | Claude Design iterate (`v1/brief-claude-design.md` → 고침 `report-readability/FIX-1.md` · `FIX-2.md`) · 표본 `v1/gen_samples.py` | `node v1/shoot.mjs` (사진 · 글자 측정 → `v1/shots/measure.json`) · `python3 v1/check_shots.py` | [성능 측정 CLI GUI 도구](https://claude.ai/design/p/9ee5c8ab-33b9-4586-ae73-69f9e53ecd42) · `Report Readability.dc.html` · `design_handoff_report-readability/` |
| 1 · 지금 | — | — | 디자이너 | `v1/before/` | `gen_samples.py` → `perftracker report <id> -o <runs> --file … --no-browser` | `node v1/shoot.mjs <base> v1/before before` | 없음 (비교 기준 = `Session Report.dc.html` · 고치지 않음) |

후보 1 — 순서 · 색 · 크기 바닥이 규칙으로 닫혀 남은 갈림은 필드(정함 · RR 결정 9)이지 모양이 아니다 (feas-design).
시안 기준 = 지금 코드 실렌더 DOM (`v1/before/` · `claude-design/report-readability/ref/`). 원본 `Session Report.dc.html` 은 토큰 · 비교 기준만.
사진 찍는 법 · 고친 기록은 `v1/README.md`.

## 제약

| 종류 | 제약 | 출처 |
|---|---|---|
| 크기 | 바닥 — 모든 글자 ≥ 12px (clamp 최솟값) · 표 · 카드 값 · 라벨 단어 줄 ≥ 13px · 이웃 층 차 ≥ 2px · 섹션 제목이 본문보다 작은 곳 0 | RR-1 · RR-3 · 결정 8 |
| 크기 | 시계열 viewBox 300 고정 — 렌더 배율 390 ≈ 1.10 · 1440(span 4) ≈ 1.30 → 눈금 12 단위면 렌더 13.2 ~ 15.6px. 왼쪽 여백 40 이 12 단위 `1,000` 에 빠듯 | RR-1 · 결정 13 · feas-design 표면 제약 |
| 크기 | 레일 212px · ≤820 가로 줄 · 12칸 그리드 · ≤1180 6칸 · ≤760 카드 1열 · 390 가로 넘침 0 | `report.css:9-50,162-164` |
| 크기 | 간격 토큰은 density 0.85× 그대로 (`--space-*`) — 글자만 키운다 | 결정 11 · `tokens.css:50-56` |
| 그릴 것 | 판정 0 — 값으로 색 · 굵기 · 아이콘 · 순서를 바꾸지 않음 · 위험색 · 강조 · 순위 0 · `references` 안 씀 · 예외 둘(앱 시작 막대 · 16ms 참고선) 그대로 | 루트 규칙 2 · RR-4 · RR-5 · gui AGENTS |
| 그릴 것 | 계열색(`--color-alt-*`)은 그림(막대 · 선 · 점)에만 — 글자 0 | RR-5 · 결정 6 |
| 그릴 것 | 세 상태 — 필드 없음 `수집 안 함` · `null` `값 없음` · `[]` `… 없음` 을 다르게 · 못 잰 블록이 사라지지 않음. 차트 카드의 `[]` 도 목록 카드처럼 `<무엇> 없음` (지금은 `값 없음` 으로 그려 배지가 셈 · rr-badge c1ba773 · plan B22) | HANDOFF ① ④ · RR-8 |
| 그릴 것 | 카드에 읽는 법 문장 0 — 각주는 단어 · DM-15 단어형 | 결정 3 · RR-5 |
| 데이터 | 글자 색 ≥ 4.5:1 은 `neutral-600` 이상만 (surface 5.48 · neutral-200 4.84) — `—` 를 숫자보다 약하게는 새 토큰 없이 못 함 (열린 질문 5 그대로) | RR-2 · 아래 `## 색` |
| 데이터 | 타일 값 = 아래 카드의 같은 문자열 — `memory` 의 `rss.max_kb` 는 지금 어느 카드에도 없다 → `앱 RSS 구성` 카드에 행 하나 더함 | RR-4 · `manifest.ts:516-527` |
| 데이터 | 라벨 경로 줄 = **지금 라벨 문자열 그대로** (`versionCode` · `app.total` · `target_process_slices`) — 바꾸지 않아 ⌘F · grep 이 닿음 | RR-6 · 결정 2 |
| 입력 | 파일 하나 · 외부 요청 0 · 긴 이름 줄바꿈은 `<wbr>` (복사하면 원문 — 보이지 않는 글자 0) | `standalone.test.ts` · RR-7 |
| 입력 | DOM 시험 도구 없음 — 타일 · 배지 · 라벨 모델은 순수 함수 · 렌더 크기는 수동 글자 측정 | 결정 13 · feas-dev |

## 폭

| 이름 | 값 | 바뀌는 것 |
|---|---|---|
| 넓음 | 1440 | 레일 212px · 그리드 12칸 · 타일 4열 × 2줄 |
| 모바일 | 390 | 레일 위 가로 줄 · 카드 1열 · **타일은 2열 × 4줄** (1열이면 첫 화면이 타일로 참 — ≤760 카드 1열 규칙의 예외) |

## 화면

| 화면 | 무엇 | 시안 파일 |
|---|---|---|
| 요약 · `지표` | 맨 위 첫 섹션 — 타일 8 (값 · 단위 · 단어 줄 · 경로 줄) | `Report Readability.dc.html?state=summary` · `missing` |
| 요약 · 앱 시작 | `앱 시작` 카드는 게이지 + 아래 줄만 — 큰 숫자 없음 (결정 10) | 같음 |
| 요약 · 렌더 | 흙색 글자 0 · 설명 문장 → 각주 | `summary` |
| 요약 · 맥락 | 컴파일 상태 카드 (baseline-profile) | `compile` · `end-null` · `legacy` |
| 기기 탭 | 경로 라벨 두 줄 · 긴 값 구분자 뒤 줄바꿈 | `device` |
| 진단 탭 | 카드 라벨 두 줄 · 단위 `diagnose` 0 · slice 표 13px · ART 칸 | `diag` · `diag-noapp` |
| 레일 | 배지 = 그 탭의 `수집 안 함` · `값 없음` 블록 수 (타일 · `없음` · `바꾸지 않음` 밖) | `summary`(배지 없음) · `missing` |

## 상태

상태 × 폭 = 예산 16장 (feas-design) · `v1/shots/report-<상태>-<폭>.png` (fullPage).

| 상태 | 무엇을 보이나 | 1440 | 390 |
|---|---|---|---|
| summary | 평소 세션 · 타일 8 · 크래시 · ANR · 경고 `[]` · **앱 로그 시계열 `[]` → `표본 없음`** (plan B22) → 요약 배지 없음 · 컴파일 `바꾸지 않음` | ✓ | ✓ |
| missing | sdk 30 — frame · network unsupported · cpu app `null` · thermal 종료 `null` → 타일 코드 · 배지 = 블록 수 | ✓ | ✓ |
| compile | `--compile speed` — 머리 옵션 · 컴파일 카드 바꾸기 전 · 시작 · 끝 · 바뀜 경고 | ✓ | ✓ |
| end-null | `extract` — 끝 상태 `값 없음` + 코드 | ✓ | ✓ |
| legacy | 옛 result.json — 컴파일 카드 `수집 안 함` | ✓ | ✓ |
| device | 기기 탭 — 라벨 두 줄 · fingerprint · 진입점 줄바꿈 | ✓ | ✓ |
| diag | 진단 탭 — 라벨 두 줄 · ART 두 칸 · slice 표 13px · `L*;` 행 | ✓ | ✓ |
| diag-noapp | 진단 대상 앱 없음 — 수 칸 · 표 · ART `값 없음` + `process_not_in_trace` · 진단 배지 2 (표 · 컴파일 상태 slice · plan B30) | ✓ | ✓ |

## 크기

층마다 하나 — 숫자는 시안에서 잰 값 (`v1/shots/measure.json` · `## 확인`). `clamp` 는 최솟값이 바닥 위.

| 층 | 자리 (클래스) | 크기 | 글꼴 | 지금 |
|---|---|---|---|---|
| 타일 값 | `.rp-tile-value` | `clamp(26px, 2.2vw, 32px)` | heading 600 | 없음 (`.rp-stat-value` 17–21) |
| 섹션 제목 | `.rp-section-head` | 18px · 대문자 · 자간 0.02em | heading 600 · `neutral-800` | 10.5px 등폭 대문자 |
| 카드 제목 | `.rp-card-title` · 타일 단어 줄 | 15px · 타일 단어 줄은 13px | heading 600 | 12.5px |
| 본문 | `.rp-table` th · td · slice 표 · bars · delta · `.rp-none` · 라벨 단어 줄 · 머리 메타 값 | 13px | body · slice 이름 · 경로 값 등폭 | 11 – 12.5px |
| 보조 | 경로 줄 · 카드 단위 · 배지 · 탭 배지 · 각주 · 코드 · 눈금 · 읽음 줄 · 푸터 · 머리 메타 라벨 · 백분위 머리 · `.rp-marks-label` · `.rp-tip-head` · `.rp-tip-sub` | 12px | 경로 · 코드 · 배지 등폭 | 8.5 – 11px |
| 백분위 · 툴팁 값 | `.rp-pct b` · `.rp-tip-value` | `clamp(18px, 1.4vw, 22px)` · 16px | heading 600 | 15–18 · 16 |
| 머리 | `.rp-name` · `.rp-sid` · 상태 pill | 그대로 · 12px · 12px | — | 26–34 · 11 · 10 |
| 레일 | `.rp-tab` · `.rp-brand-1` · `.rp-brand-2` | 14px · 15px · 12px | — | 13.5 · 15 · 12 |

세 층: 섹션 18 > 카드 제목 15 > 본문 13 (차 3 · 2) · 타일 값 ≥ 26 > 18. 시계열 눈금 viewBox 12 단위 (CSS · rr-type) · 왼쪽 여백 `SPAD.l` 36 → 46 (`blocks.ts` · rr-layout).
slice 표 머리 첫 줄 `line-height: 18px` · 둘째 줄 `top: 27px` 그대로 (13px 가 18px 줄에 들어감).

## 넘침

| 무엇 | 상한 | 넘치면 |
|---|---|---|
| 긴 기계 이름 (slice 이름 · 진입점 · fingerprint · 경로 값 · 경로 줄 · dex 경로) | 없음 (자르지 않음) | 구분자 `/` `:` `$` `.` `;` `,` `_` 공백 **뒤에** `<wbr>` · `overflow-wrap: break-word` (토막이 칸보다 넓을 때만 토막 안) · ellipsis 0 · `word-break: break-all` 0 |
| 라벨 단어 + 경로 줄 | 2줄 | 경로 줄도 같은 줄바꿈 — `target_process_slice_names_unfolded` 는 `_` 뒤에서. 카드 높이가 는다 (brief 정하지 않은 것 11 · 받아들임) |
| 타일 값 | 390 타일 폭 ≈ 165px | 값 `nowrap` · 단위는 다음 줄로 내려갈 수 있음 · `NONE (0)` · `12.3 MB` 가 26px 에 들어감 |
| 표 th | `nowrap` 이었다 | 두 줄 라벨이라 `white-space: normal` · 라벨 열 최대 45% |

## 색

새 색 없음 · 토큰 값 그대로 (`tokens.css` diff 0) · 다크 하나. 보고서 CSS 가 **글자**에 쓰는 토큰만 고른다.
대비 = WCAG 2.x (bg `#1d1f20` · surface `#26282a` · neutral-200 `#2f3133` · accent-100 `#1f2b36`).

| 뜻 | 토큰 | 고정색 | 구별 | ansi 겹침 | 대비 (가장 밝은 바탕) |
|---|---|---|---|---|---|
| 값 · 카드 제목 · 타일 값 | `--color-text` · `neutral-800` | 없음 | — | — | 12.95 · 10.13 (surface) |
| 라벨 단어 줄 · 머리 메타 값 · 읽음 줄 · 타일 단어 줄 | `neutral-700` | 없음 | — | — | 7.57 (surface) |
| 보조 — 경로 줄 · 단위 · 각주 · 코드 · `—` · 화살표 · 눈금 dim · 푸터 · 머리 메타 라벨 · 백분위 머리 | `neutral-600` | 없음 | 값보다 한 단 옅음 | — | 5.48 (surface) · 4.84 (neutral-200 — 배지) |
| 배지 · 탭 배지 글 | `neutral-800` on `neutral-200` | 없음 | — | — | 8.94 |
| 고른 탭 · 호버 값 | `accent-800` · `accent-700` | 없음 | 지금 그대로 | — | 10.79 (accent-100) · 8.52 |
| 렌더 카드 글자 (지금 `alt-700` · `alt-400`) | → `--color-text` · `neutral-800` · `neutral-600` | 없음 | 계열색은 막대에만 | — | 위와 같음 |
| `neutral-500` 글자 | **0** (지금 9곳 · 3.82) | — | 그림(띠 · 보조선 · 참고선)에는 그대로 | — | — |

| 테마 | 확인 |
|---|---|
| 다크 (유일) | `v1/shots/` 16장 · `measure.json` 4.5:1 미만 글자 0% |
| 밝은 | 없음 (안 하는 것) |

## 문구

새 · 바뀐 문구의 **정본** (결정 7 — 이 표 밖 기존 문구는 그대로) · DM-15 단어형 · `{…}` = 값 자리. 패키지는 전부 gui.
컴파일 상태 · ART · CLI 문구는 `docs/design/baseline-profile.md` `## 문구`.

| 패키지 | 자리 | 문구 | 뜻 | 안 쓰는 말 |
|---|---|---|---|---|
| gui | 요약 첫 섹션 머리 | `지표` | 지표마다 타일 하나 | `요약` (탭과 겹침) · `핵심` |
| gui | 타일 단어 · startup | `앱 시작` | `metrics.startup.data.total_time_ms` · 단위 `ms` | — |
| gui | 타일 단어 · hwui | `프레임 수` | `metrics.hwui.data.total_frames` · 단위 `장` | `렌더 점수` |
| gui | 타일 단어 · frame | `시간별 프레임` | `metrics.frame.status` 원문 (`collected` · `partial`) — 개수 0 | `정상` · `수집됨` |
| gui | 타일 단어 · cpu | `앱 CPU 시간` | `metrics.cpu.data.app.total_ms` | — |
| gui | 타일 단어 · memory | `앱 RSS 최대` | `metrics.memory.data.rss.max_kb` (mb0) | — |
| gui | 타일 단어 · log | `앱 로그 줄` | `metrics.log.data.app.total` · 단위 `줄` | `앱 경고·에러` (원본의 틀린 제목) |
| gui | 타일 단어 · thermal | `스로틀 단계 · 종료` | `metrics.thermal.data.device_status_after` (thermal) | `발열` · `최고 온도` |
| gui | 타일 단어 · network | `수신` | `metrics.network.data.rx_bytes` (bytes) | — |
| gui | 타일 단위 (hwui) | `장` | 프레임 장 수 | `개` |
| gui | 타일 단위 (log) | `줄` | logcat 줄 수 | `건` |
| gui | 머리 메타 라벨 | `길이` | `session.duration_ms` (HANDOFF 와 같음) | `duration` |
| gui | 렌더 분포 각주 | `{frames} 프레임 · 버킷 {buckets}칸` | `total_frames` · 버킷 수 | `부드럽` 문장 |
| gui | 타임라인 각주 | `막대 = 프레임 · 아래 칸 앱 · 위 칸 표시 · 가로 = 트레이스 시작 뒤 시각` | 지금 굵은 두 문장의 자리 | `입니다` |
| gui | 시계열 카드 `[]` (재 봤더니 0건 · plan B22) | `표본 없음` | `series` 데이터가 `[]` — 배지에 안 셈 | `값 없음` (null 글자) · `0` 선 |
| gui | 분포 · 시간별 프레임 카드 `[]` | `프레임 없음` | `distribution` · `frametimeline` 데이터 `[]` | `값 없음` |
| gui | 막대 카드 `[]` | `항목 없음` | `bars` 데이터 `[]` | `값 없음` |
| gui | `앱 RSS 구성` 새 행 단어 | `RSS 최대` | 경로 줄 `rss.max_kb` (mb0) — 타일과 같은 문자열 | — |

라벨 단어 줄 (RR-6) — 경로 줄은 지금 라벨 그대로. 기기 원문 라벨(`TotalTime` · `Janky frames` · `user` · `anon` …)은 한 줄 그대로.

| 카드 | 경로 줄 → 단어 줄 |
|---|---|
| 진입점 · 앱 · 네트워크 | `pid` → `프로세스 ID` · `uid` → `사용자 ID` |
| 기기 | `sdk_int` → `SDK 버전` · `fingerprint` → `빌드 지문` |
| 앱 | `versionCode` → `버전 코드` · `debuggable` → `디버그 빌드` · `largeHeap` → `큰 힙` · `minSdk` → `최소 SDK` · `targetSdk` → `대상 SDK` |
| logcat 줄 수 | `min_prio` → `최소 우선순위` · `app.total` → `앱 전체` · `app.by_priority.warn` → `앱 warn` · `app.by_priority.error` → `앱 error` · `app.by_priority.fatal` → `앱 fatal` · `device_total` → `기기 전체` · `device_by_priority.warn` → `기기 warn` · `device_by_priority.error` → `기기 error` |
| 기록 범위 | `atrace_categories` → `켠 카테고리` · `atrace_apps` → `대상 앱` · `app_slices_open` → `앱 slice 열림` |
| slice 수 | `trace_slices` → `트레이스 전체` · `target_process_slices` → `대상 앱` · `target_process_slices_unfinished` → `끝나지 않음` · `target_process_slice_names_unfolded` → `접기 전 이름 수` · `ftrace_overrun_events` → `ftrace 넘침` |
| 원본 | `artifacts.trace` → `원본 파일` · `diagnose.trace_bytes` → `원본 크기` |
| 카드 단위 | 진단 카드 셋의 `diagnose` → 빈 칸 (뜻 없는 글자 0) |

`check_copy.py` 는 없다 — 표 ↔ 코드 대조는 구현 단위의 `RR-5 문구 표 ↔ 코드` · `RR-6 단어 표 ↔ 코드` 시험 몫 (gui 패키지).

## 기능 문서 항목

| 항목 ID | 화면 · 상태 |
|---|---|
| RR-1 · RR-2 · RR-3 | 전 상태 · `## 크기` · `## 색` · `measure.json` |
| RR-4 | summary · missing · compile (타일 8 · 앱 시작 게이지만) |
| RR-5 | summary (렌더 · 타임라인 각주) |
| RR-6 | device · diag · diag-noapp · summary (logcat · 진입점 · 머리 `길이`) |
| RR-7 | device · diag (`$HomeActivity` · `_` 뒤 줄바꿈) |
| RR-8 | summary (배지 0) · missing (배지 = 블록 수) |
| RR-9 | 구현 뒤 실기기 — 이 시안은 `shoot.mjs` · `measure.js` 를 그대로 쓴다 |

## 정한 것

비어 있다 — ⑨ 승격 때 intent 4 의 `사람: 예` 와 후보 고르기 결과가 온다. 이번 차수의 선택은 아래 `## 결정 (이 차수)`.

### 결정 (이 차수)

| # | 결정 | 왜 | 확인 거리 |
|---|---|---|---|
| 1 | refeas 후속 #3 — `startup` 타일 ↔ `측정값` 카드 `TotalTime` 행 · `frame` 타일은 `RR-4 타일 값 = 카드 값` 밖 (`RR-4 frame 타일은 상태만` · 문자열 = `metrics.frame.status`) · `memory` 는 `앱 RSS 구성` 에 `rss.max_kb` 행을 더함 | 맞댈 행이 있음 · frame 은 값 없음 · rss.max_kb 는 화면에 없던 값 | `RR-4 타일 값 = 카드 값` 대상 7 (startup · hwui · cpu · memory · log · thermal · network) |
| 2 | 타일 값 없음 — `값 없음` · `수집 안 함` · reason_code 를 18px heading `neutral-700` + 코드 줄 · 값은 26–32px | 큰 `값 없음` 은 고장으로 읽힘 · 크기는 **있음 · 없음** 으로만 갈림 | `missing` 사진 |
| 3 | 타일 배지 — unsupported · skipped · failed 는 카드와 같은 배지 · partial 은 배지 없이 `title` | HANDOFF ④ 그대로 · 타일만 다른 규칙이면 두 벌 | `missing` 사진 |
| 4 | 섹션 제목을 등폭 대문자에서 heading 18px 로 — 자간 0.16em → 0.02em | 10.5px 등폭이 본문보다 작았음 (S1) · 위계는 크기로 | RR-3 |

## 확인

| 시안 | 골든 | 시험 이름 | 실화면 결과 |
|---|---|---|---|
| 보고서 8상태 × 1440 · 390 | 없음 | `shoot.mjs` · `check_shots.py` (`--break` · 지금 코드 걸림 64) | `v1/shots/` 16장 (2026-10-11 · 고침 3) — **16/16: 12px 미만 0% · 4.5:1 미만 0% · 최소 12px · 5.48 · 층 31.7(390 26) > 18 > 15 > 13 · 390 넘침 0 · 카드 안 가로 스크롤 0** · 배지 0/4/1/2 · 판정 낱말 0 (`v1/README.md`) |
| 지금 코드 8상태 × 1440 · 390 | 골든 없음 | `shoot.mjs … before` | `v1/before/` · 요약 1440 12px 미만 85.1% · 4.5:1 미만 12.3% |
| 구현 rr-type (글자 크기 · 색) 8상태 × 1440 · 390 | 없음 | `packages/gui/test/report-css.test.ts` · `shoot.mjs <base> <runs>/shots/rr-type before` | 2026-10-11 · `samples/` → `perftracker report --file` 실렌더 · **16/16: 12px 미만 0% · 4.5:1 미만 0% · 최소 12px · 4.84 (neutral-200 배지) · 층 18 > 15 > 13 · 넘침 0** · 타일 · 라벨 두 줄 · `<wbr>` 은 rr-layout 뒤 |
| 구현 rr-layout (타일 · 라벨 두 줄 · `<wbr>` · 차트 `[]` · 앱 시작 게이지만) 8상태 × 1440 · 390 | 없음 | `report.test.ts` (`RR-4 …` · `RR-5 …` · `RR-6 …` · `RR-7 …` · `B22 …`) · `report-copy.test.ts` (`RR-5 문구 표 ↔ 코드` · `RR-6 단어 표 ↔ 코드`) · `report-css.test.ts` (`RR-3 요약 타일 값 > 섹션 제목` · `RR-7 줄바꿈은 break-word`) | 2026-10-11 · `samples/` → `perftracker report --file` 실렌더 · **16/16: 12px 미만 0% · 4.5:1 미만 0% · 층 31.68(390 26) > 18 > 15 > 13 · 390 넘침 0 · 카드 안 가로 스크롤 0 · ellipsis 0** · 레일 요약 배지 summary 0 · missing 4 (시안과 같음) · legacy 0 · diag-noapp 진단 1 (시안 1 · 2 는 bp-gui-report 의 컴파일 카드 몫) |

구현 화면 찍는 길: `gen_samples.py` → `perftracker report <id> -o <runs> --file <html> --no-browser` → `shoot.mjs <base> <폴더> before` (시계열 눈금은 SVG 배율로 잼 · 결정 13).

## HANDOFF 와 어긋남

구현 단위가 고친다 — 글자 크기 · 색은 CSS(rr-type · `report.css`), 마크업 · 매니페스트 · `blocks.ts` 는 rr-layout, 컴파일 · ART 는 bp-gui-report (`docs/design/baseline-profile.md`).

| 단위 | 문서 · 절 | 지금 HANDOFF | 이 기능 뒤 |
|---|---|---|---|
| rr-type | report §3 탭 배지 · 헤더 · 섹션 · 카드 · 표식 · 툴팁 | 배지 9.5px · 메타 12.5px · 섹션 10.5px 등폭 · 단위 11px `neutral-500` · 읽음 줄 11.5px | `## 크기` · `## 색` 표 |
| rr-type | report §4 시계열 · slice 표 글자 | 눈금 8.5 · 이름 11px | 눈금 viewBox 12 · 이름 13px |
| rr-layout | report §3 요약 탭 섹션 | `summary` `render` … | `지표`(타일 8) `startup` `render` … `context` |
| rr-layout | report §3 헤더 메타 · 레일 배지 셈 | `duration` · 미수집 블록 수 | `길이` · 그 탭에서 `수집 안 함` · `값 없음` 을 그린 카드 수 (타일 · `… 없음` · `바꾸지 않음` 밖 · 진단 대상 앱 없음 2 · B30) |
| rr-layout | report §4 pairs · slice 표 · 경로 | 라벨 옮겨 적지 않음 · `overflow-wrap:anywhere` · `break-all` | 단어 줄 + 경로 줄 (결정 2) · 구분자 뒤 `<wbr>` · `break-word` |
| rr-layout | report §4 stat · 시계열 · 렌더 | 앱 시작 큰 숫자 · `SPAD.l` 36 · 굵은 읽는 법 문장 · 차트 `[]` = `값 없음` | 게이지만 · 46 · 각주 단어 · `표본 없음` · `프레임 없음` · `항목 없음` |
| bp-gui-report | report §2 · §3 맥락 · 진단 | 블록 8 | `dexstates` · 컴파일 카드 · ART 카드 (baseline-profile 문서) |
| — | report §5 토큰 | 토큰 표 | 값 그대로 |

## 검토

| 날짜 · run | 검토 | 누가 | 판정 | 왕복 |
|---|---|---|---|---|
| 2026-10-11 · baseline-profile | 실현성 (4985424) | 디자인 | 조건부 10 · 사람 4 → plan B13 ~ B16 | 1 |
| 2026-10-11 · baseline-profile | 재검토 (fa572d9) | 개발 · 디자인 | 조건부 1 · 후속 #3 → 이 문서 `### 결정 (이 차수)` 1 | 2 |
| 2026-10-11 · baseline-profile | 부합 · 구현 가능 (b8c2490) | 디자인 | 조건부 11 → 고침 1 | 1 |

## 바뀐 기록

| 날짜 | run | 무엇이 |
|---|---|---|
| 2026-10-11 | baseline-profile | 처음 — 제약 · 크기 · 색 · 타일 8 · 라벨 단어 · 시안 v1 후보 1 (16장) |
| 2026-10-11 | baseline-profile | 고침 1 (디자인 검토 #5 · 6 · 8 · 9 · 11) — `스로틀 단계 · 종료` · 크기 표 셋 · HANDOFF 단위별 · 배지 2 (B30) · 기준 701a79f |
| 2026-10-11 | baseline-profile | 구현 rr-type — `## 확인` 한 줄. `## 넘침` 의 표 th 줄바꿈 · 시계열 `overflow:visible` · 분포 ≤422px 눈금 14 단위는 글자를 키운 결과를 막으려고 rr-type 이 먼저 넣음 (intent rr-type 4) |
| 2026-10-11 | baseline-profile | rr-type 검수 왕복 1 — 머리 메타 값 색은 `## 색` 대로 `neutral-700` (코드 · HANDOFF 를 맞춤 · 시안 CSS 는 800) · 키/값 표 라벨 열 규칙 특정도 `:where()` 로 낮춤 (dex 표 규칙이 이김) · 눈금 렌더 ≈ 362px 미만 창은 12 아래 (측정 폭 밖 · 주석) |
| 2026-10-11 | baseline-profile | 구현 rr-layout — `## 확인` 한 줄. 구분자 없는 긴 토막(dex 경로의 40자 해시)이 키/값 표 최소 폭을 밀던 것은 `anywhere` 대신 값 안쪽 상자(`.rp-wrap-in` 폭 0 · 최소 폭 100%)로 막음 — `## 넘침` 「토막이 칸보다 넓을 때만 토막 안」 그대로 (rr-type 검수 후속 3). 타일 경로의 위가 `null` 이면 `값 없음`(카드와 같은 상태) |
