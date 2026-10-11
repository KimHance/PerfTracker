# 진단 모드 시안 — Claude Design 입력 (v1)

PerfTracker 에 **진단 세션**(atrace slice 를 평소 측정과 따로 기록)이 생긴다. 지금 화면 두 개(측정 화면 · 보고서)에
진단 표시를 덧붙인 **정적 시안 HTML 두 장**을 만든다. 새 화면을 디자인하는 일이 아니다 — 지금 화면에 한 칸씩 더하는 일이다.

## 기준 — 반드시

- 기준은 `diagnostic-mode/ref/` — `app.css`(지금 코드 CSS) · `measure-current.html` · `report-current.html`(지금 코드 실렌더 DOM). **지금 코드의 실렌더**(측정 화면 `?mock` · 보고서 `perftracker report`)에서 떠 왔다.
  `app.css` 를 시안 파일의 `<style>` 에 **그대로 복사**(파일 하나로 서게 — `<link>` 로 걸지 않는다)하고 클래스 이름 · 마크업 구조를 그대로 쓴다. 이 프로젝트의 옛 프로토타입
  (`PerfTracker GUI.dc.html` · `Session Report.dc.html` · `design_handoff_*`)은 지금 코드보다 19곳 뒤처져 있다 — **보지 말 것.**
- 새 CSS 는 시안 파일 끝 `<style id="diag">` 한 블록에만, 색은 기존 토큰(`--color-*`)만. 새 hex 금지.
- 판정 금지: 순위 · Top N · 강조색 · 위험색(빨강 · 주황 · 초록) · 아이콘 · 굵기로 **데이터 행을 구별하지 않는다.** 진단 표시는 조용한 중립 표시다.
- 글은 아래 「문구」 표의 문자열을 **한 글자도 바꾸지 않고** 쓴다. 표에 없는 새 문구를 지어내지 않는다 (기존 화면 글은 스냅숏 그대로).
- 외부 요청은 Google Fonts 하나만 (스냅숏에 이미 있음). 프레임워크 없이 HTML + 바닐라 JS.

## 만들 파일

| 파일 | 무엇 |
|---|---|
| `diagnostic-mode/Measure.html` | 측정 화면 6상태 — `?state=<id>` 로 고른다 |
| `diagnostic-mode/Report.html` | 보고서 6상태 — `?state=<id>` 로 고른다 · slice 표 정렬이 실제로 동작 |

두 파일 공통: 화면 오른쪽 아래 작은 상태 고르개(버튼 6개)를 띄우되 **URL 에 `shot` 이 있으면 숨긴다** (`?state=running&shot`). 상태 고르개는 시안 도구라 기존 토큰으로 작게.
측정 화면 04 섹션에 `id="sec-04"`, 보고서 slice 표 카드에 `id="slice-card"` 를 단다 (사진을 찍을 때 스크롤 위치).

## 측정 화면 — `Measure.html`

공통 표본: 기기 `SM-S901N` (R5CT0000001 · Android 16 (SDK 36)), 앱 `YouTube · com.google.android.youtube` v21.29.366, 세션 이름 `유튜브 진단`.
목업 배너(`목업 모드 — …`)는 **빼고** 그린다 (실제 화면 기준). 헤더 · 탭 스트립 · 푸터 CLI 로그 스트립은 스냅숏 그대로.
기록 드로어는 `drawer` 상태에서만 연다 (나머지는 닫힘 — 헤더의 `기록 N` 버튼만).

| state | 무엇 |
|---|---|
| `toggle-off` | 설정 화면. 01 에서 SM-S901N 선택됨 · 02 칩 8개 ✓ · 03 YouTube 선택됨 · 04 세션 이름 `유튜브 진단` · 옵션 행 **넷** — 기존 셋(`--launch` ON · `--force` ON · `--offline` OFF) 뒤에 새 행 `--diagnose` OFF. 시작 바 예고 `$ perftracker start --app "com.google.android.youtube" --name "유튜브 진단" -d R5CT0000001 --launch --force -o runs` |
| `toggle-on` | 같은 화면 · `--diagnose` 행 ON (기존 ON 행과 같은 모양) · 예고 `… --launch --force --diagnose -o runs` (`-o` 바로 앞) |
| `doctor-sdk30` | 01 에서 `SM-A405S` (R38M20ABCDE · Android 11 (SDK 30)) 선택 · 환경 점검 패널(`measure-current.html` ③ 다이얼로그 그대로) 열림. 그룹 「환경」: ✓ adb `/Users/me/Library/Android/sdk/platform-tools/adb (ANDROID_HOME)` · ✓ adb version `Android Debug Bridge version 1.0.41` · ✓ device `R38M20ABCDE SM-A405S` · ✓ perfetto `/system/bin/perfetto 사용 가능` · ✓ trace_processor `캐시됨: ~/.perftracker/bin/trace_processor`. 그룹 「이 기기가 잴 수 있는 것」: ✓ `data source: linux.process_stats` `등록됨` · ✓ `data source: linux.sys_stats` `등록됨` · ✓ `metric: hwui` `측정 가능` · ✗ `metric: frame` `이 기기에서는 측정할 수 없습니다 — 이 기기의 sdk_int=30 로는 수집할 수 없습니다 (최소 sdk_int=31, Android 12).` · ✓ `metric: startup` · `metric: cpu` · `metric: memory` · `metric: log` · `metric: thermal` 각 `측정 가능` · ✗ `metric: network` `이 기기에서는 측정할 수 없습니다 — 이 기기의 sdk_int=30 로는 수집할 수 없습니다 (최소 sdk_int=34, Android 14).` · **새 줄** ✗ `diagnose: app slice` `sdk 30 · debuggable 앱만 열림` (마지막 줄). 상단 문장은 `측정을 막는 항목은 없습니다.` |
| `running` | 측정 중 화면. 탭 셋: ① `유튜브 진단` 활성 · 배지 `진단 01:23` · 도트 측정 중 ② `홈 스크롤` · 배지 `03:10` · 도트 측정 중 ③ `새 세션` · 배지 `준비`. 우측 요약 `3개 탭 · 측정 중 2`. 킥커 `측정 중 · 진단` (기존 킥커 글 뒤에 ` · 진단`). 타이머 `01:23`. 정보 `유튜브 진단` / `YouTube · com.google.android.youtube v21.29.366` / `SM-S901N (R5CT0000001) · 시작 00:29:11`. 정지 버튼 · 마킹 블록 그대로. 각주: 기존 문장 `<p class="running-note">` 그대로 두고 **그 아래 새 `<p class="running-note">`** 한 줄 `진단 · slice 비용 앱 프로세스 몫 · 평소 세션과 비교 불가 · 최대 10분`. 푸터 CLI 로그 `$ perftracker start --app "com.google.android.youtube" --name "유튜브 진단" -d R5CT0000001 --launch --force --diagnose -o runs` |
| `running-unknown` | `running` 과 같되 기기 `SM-A405S (R38M20ABCDE)` · 앱 버전 `v19.45.38` · 탭 ① 하나만(`유튜브 진단` · `진단 00:41`) · 우측 요약 `1개 탭 · 측정 중 1`. 정보 블록 아래 줄 둘 (`.running-unsupported` 모양 · 순서대로): 기존 `✗ 이 기기에서 못 재는 지표 2개 — frame · network (나머지는 정상 수집)` · **새** `앱 slice 열림 모름 — sdk 30 · debuggable 아님` (기호 없이) |
| `drawer` | `toggle-off` 설정 화면 + 기록 드로어 열림. 헤더 `기록` `4건 · 항상 최신`. 행 넷 (최신순): ① `유튜브 진단` NEW · `SM-S901N · R5CT0000001` · `YouTube v21.29.366` · `10/08 00:29 · 01:42 · launch · 경고 0 · 진단` ② `유튜브 평소` · `SM-S901N · R5CT0000001` · `YouTube v21.29.366` · `10/08 00:25 · 01:38 · launch · 경고 0` ③ `동시-A11` · `SM-A405S · R38M20ABCDE` · `YouTube v19.45.38` · `10/07 17:46 · 01:01 · launch · 경고 3 · 미지원 2 · 마킹 4 · 진단` ④ `홈 스크롤` · `SM-S901N · R5CT0000001` · `Instagram v2026.7.1` · `10/07 16:12 · 02:02 · attach · 경고 1`. 진단 태그는 메타 줄 끝 ` · 진단` 글자뿐 — 배지 · 색 없음 |

옵션 행 새 줄: 플래그 `--diagnose` · 설명 `atrace slice 기록 (am · wm · view + 대상 앱) · 최대 10분` (기존 행처럼 `플래그 — 설명`).

## 보고서 — `Report.html`

`report-current.html` 의 셸 · 레일 · 머리 · 카드 · 표 CSS 를 그대로 쓴다. 레일 탭이 **셋**이 된다: `요약` · `기기` · `진단` (진단 세션 보고서에만 세 번째 탭).
머리: id `a1b2c3` · 이름 `유튜브 진단` · 상태 pill `completed` 바로 **오른쪽에 같은 크기 pill `진단`** (테두리만 · `--color-divider` 테두리 · 투명 배경 · `--color-neutral-700` 글자 — 상태 pill 보다 조용하게). 메타 줄 `앱 YouTube · com.google.android.youtube · 21.29.366` / `기기 SM-S901N · R5CT0000001 · Android 16 (sdk 36)` / `시작 2026-10-08 00:29:11` / `duration 102,418 ms` / `옵션 --launch`.
푸터 `perftracker 0.3.0 · darwin/arm64 · node 25.2.1` · `schema_version 1.2.0`.

| state | 무엇 |
|---|---|
| `summary` | 요약 탭 선택. 섹션 「앱 시작」 은 스냅숏 그대로, 렌더 · CPU · 메모리 · 로그 네 섹션은 **섹션 머리만** 그리고 아래에 `--color-neutral-100` 빈 자리 상자(높이 120px · 글 없음)로 줄인다. 섹션 「맥락」 은 스냅숏 그대로이되 **측정 비용 카드 머리에 단위 `앱 프로세스 몫 미포함`** (경고 카드의 `측정 조건 관측 · 평가 아님` 과 같은 `.rp-card-unit`) |
| `diag` | 진단 탭 선택. 섹션 머리 `atrace slice`. 그리드: 카드 `기록 범위` span 4 · `slice 수` span 4 · `원본` span 4 · 그 아래 `slice 이름별` span 12. 값은 아래 「진단 블록 값」 collected 열. slice 표는 이름 코드 단위 순(아래 표본 순서 그대로) · 머리 `이름` 에 `▲` · aria-sort=ascending |
| `sorted` | `diag` 와 같되 `메인 스레드 › 합 ms` 머리를 누른 뒤 — 그 열 `▼` · aria-sort=descending · 그 머리 버튼에 **포커스 링**(`:focus-visible` 과 같은 `outline: 2px solid var(--color-accent)`) · 행은 표본의 `rows_by_main_sum_desc` 순서 · `이름` 머리의 `▲` 는 사라짐 |
| `open-null` | 기기 `SM-A405S · R38M20ABCDE · Android 11 (sdk 30)` · 앱 버전 `19.45.38`. 「진단 블록 값」 open-null 열. slice 표는 **있다**(표본 그대로) |
| `no-process` | 「진단 블록 값」 no-process 열 — slice 표 카드 본문이 표 대신 `.rp-none` (`값 없음` + `<code class="rp-none-code">process_not_in_trace</code>`) · 카드 단위 칸 비움 |
| `failed` | 「진단 블록 값」 failed 열 — 세 카드의 null 값은 `값 없음`, slice 표 카드는 `.rp-none` (`값 없음` + `trace_missing`). 네 카드 머리에 기존 상태 배지 `.rp-badge` `실패` |

### 진단 블록 값 (pairs 카드 — 라벨은 필드 경로 그대로, 값 칸 `.num`)

카드 `기록 범위` · 단위 `diagnose` / 카드 `slice 수` · 단위 `diagnose` / 카드 `원본` · 단위 비움.

| 카드 | 라벨 | collected (`diag` · `sorted`) | open-null | no-process | failed |
|---|---|---|---|---|---|
| 기록 범위 | `atrace_categories` | `am · wm · view` | 같음 | 같음 | 같음 |
| 기록 범위 | `atrace_apps` | `com.google.android.youtube` | 같음 | 같음 | 같음 |
| 기록 범위 | `app_slices_open` | `예` | `값 없음` | `예` | `값 없음` |
| 기록 범위 | `app_slices_open_reason_code` | `값 없음` | `app_slices_open_unknown` (mono) | `값 없음` | `값 없음` |
| 기록 범위 | `status` | `collected` | `collected` | `partial` | `failed` |
| 기록 범위 | `reason_code` | `값 없음` | `값 없음` | `process_not_in_trace` (mono) | `trace_missing` (mono) |
| slice 수 | `slices_total` | `74,906` | `31,207` | `52,118` | `값 없음` |
| slice 수 | `slices_app` | `62,682` | `24,530` | `값 없음` | `값 없음` |
| slice 수 | `slices_unfinished` | `41` | `12` | `값 없음` | `값 없음` |
| slice 수 | `names_before_fold` | `5,369` | `2,204` | `값 없음` | `값 없음` |
| slice 수 | `ftrace_lost` | `0` | `0` | `0` | `값 없음` |
| 원본 | `artifacts.trace` | `runs/2026-10-08T00-29-11_유튜브-진단_a1b2c3/trace.perfetto-trace` (줄바꿈 허용 · mono) | 같음 | 같음 | `값 없음` |
| 원본 | `trace_bytes` | `6.5 MB` | `3.1 MB` | `5.0 MB` | `값 없음` |

slice 표 카드: 제목 `slice 이름별` · 단위 `대상 앱 프로세스 · 1,055행` (open-null 은 `대상 앱 프로세스 · 618행`).

### slice 표 (새 모양)

- 열 10개: `이름` | 갈래 셋(`메인 스레드` · `그 밖 스레드` · `비동기 트랙`) × (`횟수` · `합 ms` · `최대 ms`). 머리 두 줄 — 윗줄 갈래 이름(3칸 묶음) · 아랫줄 열 이름. `이름` 은 두 줄을 차지.
- 정렬 가능한 머리 = 아랫줄 9칸 + `이름` 의 **`<button>`** (`<th aria-sort>` 안). 누르면 그 열로 정렬 — 숫자 열은 처음 누르면 내림 · 다시 누르면 오름, `이름` 은 처음 오름. 정렬된 열만 머리 글 뒤에 `▲`/`▼`. Enter · Space 로도 동작(버튼이라 저절로). 빈 칸은 방향과 무관하게 끝 · 같은 값은 이름 코드 단위 순.
- 이름 칸: mono 11px · 왼쪽 정렬 · **자르지 않는다** — `overflow-wrap:anywhere` 로 줄바꿈 (ellipsis · `title` 툴팁 대체 금지). 1440 에서 이름 열 너비 약 38%, 390 에서 140px.
- 숫자 칸: `.num` (tabular-nums) 오른쪽 정렬. 횟수 `1,500` · 합/최대 소수 한 자리 `7,574.2`. 그 갈래에 slice 가 없으면 `—` (`--color-neutral-500`).
- 행 구별 없음: 줄무늬 · 색 · 굵기 · 아이콘 없음. 행 사이 hairline `--color-divider` 만.
- 표는 카드 안 스크롤 상자 `max-height: min(70vh, 640px); overflow: auto` — 머리 두 줄 `position: sticky; top: 0` (배경 `--color-surface` 또는 카드 배경), `이름` 열 `position: sticky; left: 0` (390 에서 가로 스크롤해도 이름이 남음). 페이지 가로 넘침 0 (390 에서 표만 상자 안에서 가로 스크롤).
- 표본 32행이 1,055행 중 일부라는 표시를 따로 하지 않는다 (시안 표본일 뿐 — 실제 화면은 전 행).

표본: `diagnostic-mode/ref/slice-sample.json` (32행 · `rows_by_name` = 이름 코드 단위 순 · `rows_by_main_sum_desc` = `sorted` 상태 순서). Report.html 안에 그대로 심는다 (fetch 없이).

## 문구 — 이것만 새로 쓴다

| 자리 | 문구 |
|---|---|
| 04 옵션 행 설명 | `atrace slice 기록 (am · wm · view + 대상 앱) · 최대 10분` |
| 탭 배지 (진단 세션 측정 중) | `진단 01:23` (`진단 ` + 경과) |
| running 킥커 덧붙임 | `진단` (→ `측정 중 · 진단`) |
| running 각주 둘째 줄 | `진단 · slice 비용 앱 프로세스 몫 · 평소 세션과 비교 불가 · 최대 10분` |
| running 고지 | `앱 slice 열림 모름 — sdk 30 · debuggable 아님` |
| 환경 점검 새 줄 | 이름 `diagnose: app slice` · 상세 `sdk 30 · debuggable 앱만 열림` |
| 드로어 메타 꼬리 | `진단` |
| 보고서 레일 탭 · 머리 pill | `진단` |
| 보고서 섹션 머리 | `atrace slice` |
| 카드 제목 | `기록 범위` · `slice 수` · `원본` · `slice 이름별` |
| slice 표 카드 단위 | `대상 앱 프로세스 · 1,055행` |
| 표 머리 | `이름` · `메인 스레드` · `그 밖 스레드` · `비동기 트랙` · `횟수` · `합 ms` · `최대 ms` |
| 빈 칸 · 정렬 표시 | `—` · `▲` · `▼` |
| 측정 비용 카드 단위 | `앱 프로세스 몫 미포함` |

## 고침 1 (2026-10-08 · 검토 왕복 1 — Report.html 직접 고침)

- 기록 범위 카드에서 `status` · `reason_code` · `app_slices_open_reason_code` 행을 뺐다. 블록 상태 = 카드 배지(failed) · 카드 제목 · 배지 `title`(reason 문장). 열림이 null 이면 값 자리 `값 없음` + 코드, 열림 행 `title` = 열림 reason 문장.
- 원본 카드 라벨은 루트 경로 하나로: `artifacts.trace` · `diagnose.trace_bytes`.
- 정렬하면 표 상자를 맨 위로 (`scrollTop = 0`) · 가로 위치는 그대로.
- failed 의 열림 값은 `예` 로 그림 (sdk · debuggable 로 정해짐 — 값은 diag-extract 가 정함, plan D18).
