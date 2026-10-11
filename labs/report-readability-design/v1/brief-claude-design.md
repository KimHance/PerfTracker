# Report Readability — Claude Design 브리프 (v1)

> 이 브리프의 필드 이름(`{dex:[…]}` · `target_process_compile_states` · `compile_state_not_read`)은 1차 자리표시다 — 고침 3(`report-readability/FIX-3.md`)에서 core 실제 이름으로 바뀌었다.

새 디자인 파일 **`Report Readability.dc.html`** 하나 (프로젝트 루트 · `Session Report.dc.html` 과 같은 `.dc.html` 꼴 — `<x-dc>` + `text/x-dc` 스크립트 · `$preview` 1440×980 · 편집기 enum prop).
**`Session Report.dc.html` 은 고치지 않는다** (비교 기준). 정본: 레포 `docs/design/report-readability.md` · `docs/design/baseline-profile.md` — 이 브리프는 그 요약이다.

## 기준과 재료 (이 폴더 `report-readability/`)

| 파일 | 무엇 |
|---|---|
| `diagnostic-mode/Report.html` (`?state=summary` · `diag`) · `diagnostic-mode/ref/report-current.html` | **지금 코드의 실렌더 DOM** 을 옮긴 지난 시안 — 구조 · 클래스(`rp-*`)를 이것과 같게. **출발점으로 복사해 쓴다** (그 파일은 고치지 않음). 레포 `labs/report-readability-design/v1/claude-design/report-readability/ref/dom-*.html` 이 이번 코드의 DOM 원본 |
| `ref/report.css` | 지금 코드의 보고서 CSS (토큰은 `_ds` · 루트 `:root` 와 같은 값). **토큰 값을 바꾸지 않는다** — 아래 크기 · 색 표대로 이 CSS 의 글자 규칙만 고친 판을 시안에 싣는다 |
| `base.json` | 실기기 YouTube 진단 세션 result.json 을 줄인 것 |
| `states.js` | `window.RR_STATES[state] = [build(base) → result.json, 처음 탭]` — 8상태를 base 에서 짓는다. 시안은 `fetch('report-readability/base.json')` 뒤 이 함수로 문서를 만든다 |

## 상태 — `?state=` (URL) 와 편집기 prop `state` 둘 다

`summary` · `missing` · `compile` · `end-null` · `legacy` · `device` · `diag` · `diag-noapp`. 기본 `summary`. 처음 탭은 `RR_STATES` 둘째 값 (레일로 탭은 바꿀 수 있게).
`?shot` 이 있으면 편집기 칩 · 상태 고르는 줄 같은 시안 꾸밈을 숨긴다 (사진용).

## 판정 금지 (깨면 안 됨)

값으로 색 · 굵기 · 아이콘 · 크기 · 순서를 바꾸지 않는다. 위험색 · 강조 · 순위 · ✓ 0. `speed-profile` 을 좋음처럼, `verify` 를 나쁨처럼 보이게 하지 않는다 — 상태 문자열은 전부 같은 색 · 같은 굵기 · 등폭 · 기기 원문 순. 예외 둘(앱 시작 게이지 6색 · 16ms 참고선)만 그대로. 읽는 법 문장 0 — 각주는 단어.

## 크기 (바닥: 모든 글자 ≥ 12px · 표 · 값 · 라벨 단어 줄 ≥ 13px)

| 층 | 클래스 | 크기 |
|---|---|---|
| 타일 값 | `.rp-tile-value` | `clamp(26px, 2.2vw, 32px)` heading 600 `--color-text` |
| 섹션 제목 | `.rp-section-head` | **18px heading 600 · 대문자 아님 · 자간 .02em · `neutral-800`** + 오른쪽 hairline 그대로 |
| 카드 제목 | `.rp-card-title` | 15px heading 600 |
| 본문 | `.rp-table` th · td · slice 표(이름 등폭 포함) · bars · delta · `.rp-none` · 머리 메타 값 · 라벨 단어 줄 | 13px |
| 보조 | 경로 줄 · `.rp-card-unit` · 배지 · `.rp-tab-count` · 각주 · 코드(`.rp-none-code` `.rp-stat-why`) · 눈금 · 읽음 줄 · 푸터 · 머리 메타 라벨 · `.rp-pct-k` · `.rp-sid` · 상태 pill · `.rp-gauge-axis` | 12px |
| 백분위 값 | `.rp-pct b` | `clamp(18px, 1.4vw, 22px)` |
| 레일 탭 | `.rp-tab` | 14px |

시계열 눈금은 viewBox 단위 12 (렌더 ≥ 13px) · 왼쪽 여백 40 → 46. slice 표 머리 `line-height:18px` · 둘째 줄 `top:27px` 그대로.

## 색 (토큰 값 그대로 · 글자에 쓰는 토큰만 고름)

- 글자에 `--color-neutral-500` **0** (지금 9곳 — `.rp-card-unit` `.rp-meta-item i` `.rp-none-code` `.rp-delta .rp-arrow` `.rp-tick-dim` `.rp-stat-dim` `.rp-readout-nosample` `.rp-footer` …) → `neutral-600`.
- 글자에 `--color-alt-*` **0** — `.rp-card-alt` 의 제목 · 숫자 · share 는 중립 (`--color-text` · `neutral-800` · `neutral-600`). 분포 막대 · 막대 채움(그림)은 alt 그대로.
- 값 `neutral-800`/`--color-text` · 라벨 단어 `neutral-700` · 경로 줄 · 단위 · `—` `neutral-600`.

## 바뀌는 것

1. **요약 맨 위 섹션 `지표`** — 타일 8, 순서 고정 `startup · hwui · frame · cpu · memory · log · thermal · network`. 1440 4열 × 2줄 · ≤760 2열 × 4줄 (자기 그리드).
   타일 = 단어 줄(13px `neutral-700`) · 값(타일 값) + 단위(13px `neutral-600`) · 경로 줄(12px 등폭 `neutral-600`) · 상태 배지는 카드와 같은 규칙(unsupported · skipped · failed 만).
   | 단어 | 경로 줄 | 값 (카드와 같은 문자열) | 단위 |
   |---|---|---|---|
   | 앱 시작 | `metrics.startup.data.total_time_ms` | `828` | ms |
   | 프레임 수 | `metrics.hwui.data.total_frames` | int | 장 |
   | 시간별 프레임 | `metrics.frame.status` | `collected` · `partial` 원문 (개수 0) | — |
   | 앱 CPU 시간 | `metrics.cpu.data.app.total_ms` | int | ms |
   | 앱 RSS 최대 | `metrics.memory.data.rss.max_kb` | MB 정수 | MB |
   | 앱 로그 줄 | `metrics.log.data.app.total` | int | 줄 |
   | 스로틀 종료 | `metrics.thermal.data.device_status_after` | `NONE (0)` 꼴 | — |
   | 수신 | `metrics.network.data.rx_bytes` | bytes (`12.3 MB` 꼴) | — |
   값 `null` → `값 없음` · 필드 없음 → `수집 안 함` · status unsupported/skipped/failed → 그 `reason_code`. 이때 값 자리는 18px heading `neutral-700` + 코드 줄 12px 등폭 (타일은 사라지지 않음). 타일은 레일 배지에 세지 않는다.
2. **앱 시작 섹션** — `앱 시작` stat 카드에서 큰 숫자 `828 ms` 를 뺀다 (게이지 · 축 · 아래 줄 `상태 COLD · wait 830 ms` 만). `측정값` · `진입점` 카드 그대로.
3. **렌더** — 분포 머리 굵은 문장 삭제 → 카드 각주 `{total_frames} 프레임 · 버킷 {n}칸`. 타임라인 카드의 두 문장 → 각주 `막대 = 프레임 · 아래 칸 앱 · 위 칸 표시 · 가로 = 트레이스 시작 뒤 시각`.
4. **차트 카드 `[]`** (재 봤더니 0건) — `값 없음` 이 아니라 시계열 `표본 없음` · 분포 · 시간별 프레임 `프레임 없음` · 막대 `항목 없음`. `summary` 상태의 `앱 로그` 시계열이 `[]` 다. 배지에 안 셈.
5. **라벨 두 줄** — 지금 라벨이 필드 이름 · 경로인 행은 위에 우리말 단어 줄(13px `neutral-700`), 아래 **지금 라벨 그대로** 경로 줄(12px 등폭 `neutral-600`). th 는 `white-space:normal` · 최대 45%.
   진입점 · 앱 · 네트워크 `pid`→프로세스 ID · `uid`→사용자 ID / 기기 `sdk_int`→SDK 버전 · `fingerprint`→빌드 지문 / 앱 `versionCode`→버전 코드 · `debuggable`→디버그 빌드 · `largeHeap`→큰 힙 · `minSdk`→최소 SDK · `targetSdk`→대상 SDK /
   logcat `min_prio`→최소 우선순위 · `app.total`→앱 전체 · `app.by_priority.warn`→앱 warn · `…error`→앱 error · `…fatal`→앱 fatal · `device_total`→기기 전체 · `device_by_priority.warn`→기기 warn · `…error`→기기 error /
   기록 범위 `atrace_categories`→켠 카테고리 · `atrace_apps`→대상 앱 · `app_slices_open`→앱 slice 열림 / slice 수 `trace_slices`→트레이스 전체 · `target_process_slices`→대상 앱 · `…_unfinished`→끝나지 않음 · `…_names_unfolded`→접기 전 이름 수 · `ftrace_overrun_events`→ftrace 넘침 · (새) `target_process_jit_slices`→JIT 컴파일 slice / 원본 `artifacts.trace`→원본 파일 · `diagnose.trace_bytes`→원본 크기.
   기기 원문 라벨(`TotalTime` `Janky frames` `user` `anon` …)은 한 줄 그대로. 진단 카드 단위 칸 `diagnose` → 빈 칸. `앱 RSS 구성` 카드 첫 행 새로: `RSS 최대` / `rss.max_kb` (타일과 같은 문자열).
6. **긴 이름 줄바꿈** — slice 이름 · 진입점 · fingerprint · 경로 값 · 경로 줄 · dex 경로 · location: 구분자 `/ : $ . ; , _ 공백` **뒤에** `<wbr>` · `overflow-wrap:break-word` (`anywhere` · `break-all` 쓰지 않음). `…Shell$HomeActivity` 가 `HomeA / ctivity` 로 끊기지 않게.
7. **머리** — 메타 라벨 `duration` → `길이` · 값 13px · 라벨 12px. `옵션` 칸: `--launch` (+ `--compile speed` — compile 상태만).
8. **레일 배지** — 그 탭의 `수집 안 함` · `값 없음` 블록 수 (타일 · `… 없음` · `바꾸지 않음` 은 안 셈). summary 는 배지 없음 · missing 은 셈한 수.
9. **컴파일 상태 카드** (요약 · 맥락 섹션 끝 · span 12 · 제목 `컴파일 상태 (전 → 후)`) — 새 블록 종류 `dexstates`.
   위: 바꾼 기록 — compile 상태면 행 셋 `바꾼 값`/`value` `speed` · `보낸 명령`/`command` 원문 등폭 · `걸린 시간`/`elapsed_ms` `67,500 ms`; 그 밖 새 세션은 한 행 `바꾼 기록`/`session.compile` → `바꾸지 않음`.
   아래: dex 줄마다 **머리 행**(dex 경로 등폭 13px · 칸 전부) + **때 행**(`바꾸기 전`(compile 만) · `시작` · `끝`) 칸 넷 `때` · `ABI`/`abi`(`arm64 · primary-abi`) · `컴파일 필터`/`status` · `컴파일 이유`/`reason` + 그 아래 **위치 행**(`파일 위치`/`location` 원문 12px 등폭 `neutral-600` · 칸 전부). 순서 = 원문 순.
   end-null: 끝 행 칸 자리에 `값 없음` + 코드 `compile_state_not_read`. legacy: 카드 본문 `수집 안 함 — target_app.compile_state_start 없음` (배지에 셈).
   compile 상태의 `경고` 카드에 `compile_state_changed` 행 (기존 경고 카드 그대로).
10. **진단 탭** — 카테고리 값 `am · wm · view · dalvik`. `slice 이름별` 표 위에 새 카드 `컴파일 상태 slice` (span 12 · `dexstates`): 머리 행 = `location` 원문 · 칸 셋 `oat 파일 상태`/`status` · `컴파일 필터`/`filter` · `컴파일 이유`/`reason`. `slice 수` 카드 끝 행 `JIT 컴파일 slice`/`target_process_jit_slices` `52`. diag-noapp: 둘 다 `값 없음` + `process_not_in_trace`, 수 칸 · 표도 `값 없음`. 표 마지막 행 `L*;` (클래스 디스크립터 접은 행 — 다른 행과 같은 모양).

## 폭

1440 · 390 둘 다 맞게 — 390 은 레일이 위 가로 줄 · 카드 1열 · 타일 2열 · **페이지 가로 넘침 0** (slice 표만 상자 안 가로 스크롤 · dexstates 표는 줄바꿈으로 들어감).

## 남길 것

`Report Readability.dc.html` 하나 (재료는 이 폴더) + 끝나면 핸드오프 폴더 둘 `design_handoff_report-readability/` · `design_handoff_baseline-profile/` (README.md · 사진 · baseline-profile 은 `cli-blocks.txt` 포함) — 사진 · CLI 블록은 레포 쪽에서 올린다.
