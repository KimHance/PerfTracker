# Handoff: PerfTracker GUI (로컬호스트 웹 GUI)

> Claude Code 에 그대로 붙여넣을 프롬프트는 `CLAUDE_CODE_PROMPT.md` 에 있습니다.

## Overview

`PerfTracker` 는 안드로이드 앱 성능을 앱 수정·루팅 없이 측정하는 CLI 입니다. 이 핸드오프는 그 CLI 를 감싸는 **로컬호스트 웹 GUI** 의 디자인입니다.

핵심 요구:

- 여러 세션을 **동시에** 돌릴 수 있어야 하므로 웹 브라우저 탭처럼 상단 탭바로 세션을 분리한다 (추가/삭제, 최소 1개 보장).
- 각 탭은 독립적으로 `기기 선택 → 앱 선택 → 세션 이름/옵션 → 측정 시작 → 측정 중(타이머) → 정지` 를 진행한다.
- 기기의 `sdk_int` 에 따라 못 재는 지표가 있으므로, 기기 선택 직후 8개 지표의 측정 가능 여부를 표시한다.
- 측정 중에는 경과 시간과 정지 버튼만 두고, 사람이 수기로 **마킹(이벤트 라벨)** 을 남길 수 있다.
- 정지하면 데이터를 회수해 기록(history)에 추가한다. 여러 탭이 동시에 끝날 수 있으므로 기록 드로어는 항상 최신 상태를 유지한다.
- CLI 를 실제로 호출하므로 대기 구간은 **재사용 가능한 전체 화면 로딩 오버레이** 로 덮는다.
- 기록을 클릭하면 대시보드를 띄운다 — **대시보드는 아직 미정(이 핸드오프 범위 밖)**.

## About the Design Files

이 번들의 HTML 은 **디자인 레퍼런스**입니다 — 의도한 모양과 동작을 보여주는 프로토타입이며, 그대로 가져다 쓰는 프로덕션 코드가 아닙니다. 할 일은 이 HTML 디자인을 **대상 코드베이스의 기존 환경에서 다시 만드는 것**입니다(React / Vue / Svelte 등, 그 프로젝트의 확립된 패턴과 라이브러리를 사용). GUI 환경이 아직 없다면 이 프로젝트에 가장 적합한 프레임워크를 선택해 구현하십시오.

프로토타입 안의 기기 목록, 앱 목록, 기록 5건, 지표 수치는 **모두 하드코딩된 목업 데이터**입니다. 실제 구현은 아래 "CLI 연동" 절의 명령 결과로 대체해야 합니다.

권장 실행 형태: 로컬 HTTP 서버(예: CLI 에 `perftracker gui` 서브커맨드 추가)가 정적 프론트엔드를 서빙하고, 프론트엔드는 그 서버의 JSON API 를 호출하며, 서버가 `adb` / 기존 core 함수를 실행한다. 브라우저에서 직접 adb 를 부를 수 없으므로 서버 계층은 필수입니다.

## Screenshots

`screenshots/` 에 프로토타입 실제 렌더 화면이 들어 있습니다 (924×540, 즉 좁은 창 기준 — 반응형 동작까지 확인 가능).

| 파일 | 상태 |
| --- | --- |
| `01-setup-device-app-selected.png` | 세션 설정 — 기기 선택됨(`선택됨` 배지), 미지원 지표 배지, 기록 드로어 열림, 하단 명령 미리보기 |
| `02-running-with-marks.png` | 측정 중 — 타이머, 마킹 입력(`마킹 @ 00:02`), 빠른 칩, 마킹 목록 2건, CLI 로그에 `mark "스크롤 시작" @ 00:01` |
| `03-history-after-stop.png` | 정지 직후 — 기록 최상단에 `NEW` 배지 + `마킹 2`, 탭은 설정 화면으로 복귀(기기 선택 유지) |
| `04-confirm-delete-dialog.png` | 기록 삭제 확인 다이얼로그 |
| `05-loading-overlay.png` | 전체 화면 로딩 오버레이 (`환경과 기기를 점검하고 있습니다` + 실행 명령) |
| `06-app-search-no-result.png` | 앱 검색 결과 없음 빈 상태 (드로어 닫아 2단 그리드가 된 모습) |
| `07-no-devices-empty-state.png` | 기기 0대 빈 상태 |

## Fidelity

**High-fidelity (hifi)** — 색상, 타이포그래피, 간격, 상태, 카피가 확정된 상태입니다. 픽셀 단위로 재현하되, 코드베이스에 이미 디자인 시스템이 있으면 아래 토큰을 그 시스템의 등가 토큰에 매핑하십시오. 디자인은 "Industry" 디자인 시스템(스틸블루 액센트 + Barlow Condensed / Barlow)의 **다크 반전 테마**를 사용합니다. 테마는 다크 하나만 존재합니다(라이트 모드 없음).

## 화면 구조 (전역 레이아웃)

한 페이지 안에서 상태만 바뀌는 단일 화면입니다. 라우팅은 불필요합니다(대시보드가 정해지면 그때 라우트 추가).

```
┌──────────────────────────────────────────────────────────────┐
│ 헤더 (min-height 52px, wrap 허용)                             │
│  PERFTRACKER v0.1.0 │ ● adb <경로> │ ⟶ 환경 점검 │ 기록 ⑤    │
├──────────────────────────────────────────────────────────────┤
│ 탭 스트립 (height 38px, overflow-x auto)                      │
│  ● 홈 스크롤 00:14 × │ ● 새 세션 준비 × │ +   1개 탭·측정 중 1 │
├───────────────────────────────────┬──────────────────────────┤
│ main (flex:1, overflow auto)      │ 기록 드로어 (조건부)      │
│  · 세션 설정 폼  또는             │  width clamp(280,32vw,392)│
│  · 측정 중 화면                    │                          │
├───────────────────────────────────┴──────────────────────────┤
│ 푸터: CLI 로그 스트립 (클릭 시 최대 168px 펼침)                │
└──────────────────────────────────────────────────────────────┘
```

- 최상위 컨테이너: `display:flex; flex-direction:column; height:100vh; min-width:0; overflow:hidden`
- 중단: `display:flex; flex:1; min-height:0` — main 은 `flex:1; min-width:0; overflow:auto`
- 반응형: 고정 최소폭 없음. 헤더/시작바/푸터는 `flex-wrap:wrap`, 탭 스트립은 가로 스크롤, 패딩은 `clamp()`.
- 전역 로딩 오버레이와 확인 다이얼로그는 `position:fixed; inset:0` 로 이 구조 위에 뜬다.

---

## 1. 헤더

높이 `min-height:52px`, 패딩 `var(--space-2) clamp(12px,2vw,20px)`, 하단 `1px solid var(--color-divider)`, `flex-wrap:wrap`, gap `var(--space-2) var(--space-4)`.

| 요소 | 스펙 |
| --- | --- |
| 워드마크 `PERFTRACKER` | `--font-heading`, 700, 19px, `letter-spacing:.14em`, `text-transform:uppercase` |
| 버전 `v0.1.0` | monospace 10.5px, `--color-neutral-600` |
| adb 칩 | `display:flex; gap:var(--space-2); padding:3px var(--space-3); border:1px solid var(--color-divider); border-radius:99px; white-space:nowrap`. 내부: 6px 원형 `--color-accent` 도트 + `adb` + 경로(`--color-neutral-500`) |
| `환경 점검 (doctor)` | `.btn .btn-ghost`, height 32px, 12px, `white-space:nowrap` |
| `기록 N` | `.btn .btn-secondary`, height 32px. N 은 pill 배지: monospace 10px, `padding:1px 7px; border-radius:99px; background:var(--color-accent-200); color:var(--color-accent-800)`. 클릭 시 드로어 토글 |

`환경 점검` → 로딩 오버레이 1100ms, 명령 `npx perftracker doctor`.

결과 패널(다이얼로그 `환경 점검`)은 두 묶음 — `환경`(requirement · 막힌 것) · `이 기기가 잴 수 있는 것`(capability · 기기의 성질). 행 = `✓`/`✗` + 검사 이름(monospace 11.5px) + 상세(11.5px `--color-neutral-700`). capability 맨 끝에 진단 세션 줄 `diagnose: app slice` — sdk ≥31 `✓ sdk {sdk} · 열림` · sdk ≤30 `✗ sdk {sdk} · debuggable 앱만 열림`. 판정과 글자는 core 그대로(`doctor` 와 같은 줄)이고 화면은 그리기만 한다.

## 2. 탭 스트립

높이 38px, `background:var(--color-neutral-100)`, 하단 divider, `padding-left:var(--space-2)`, `overflow-x:auto; overflow-y:hidden`.

각 탭 (`flex:none; white-space:nowrap; display:flex; align-items:center; gap:6.8px; padding:0 10.2px; height:100%; border-radius:12px 12px 0 0; cursor:pointer`):

- **활성**: `background:var(--color-bg)`, `box-shadow: inset 0 -2px 0 var(--color-accent)`
- **비활성**: 배경 투명, `color:var(--color-neutral-700)`
- 상태 도트: 6px 원. 측정 중 = `--color-accent` + `pulse` 애니메이션(1.4s ease-in-out infinite, opacity 1→.35→1); 그 외 = `--color-neutral-400`
- 라벨: 12.5px, `max-width:150px`, ellipsis. 이름이 비면 `새 세션`
- 배지: monospace 10px `--color-neutral-600`. 측정 중 = 경과시간 `mm:ss` (500ms 틱) — **진단 세션이면 `진단 mm:ss`**, 설정 중 = `준비` (진단 토글과 무관). 좁으면 라벨만 ellipsis 로 줄고 배지는 그대로
- 닫기 `×`: 14px, `--color-neutral-600`. 탭이 1개면 `opacity:.25; pointer-events:none` (최소 1개 보장). 클릭은 `stopPropagation` 필수
- `+` 버튼: `.btn .btn-ghost`, 26×26, 15px, 새 탭 추가 후 즉시 활성화
- 우측 요약: monospace 10px, `N개 탭 · 측정 중 M`

**측정 중인 탭을 닫으면** 즉시 닫지 않고 확인 다이얼로그(아래 6절)로 넘어간다.

## 3. 세션 설정 화면 (탭 state = `setup`)

`display:grid; grid-template-columns:repeat(auto-fit,minmax(360px,1fr)); gap:clamp(20px,3vw,34px); padding:clamp(14px,2.4vw,24px) clamp(14px,3vw,30px); align-items:start` — 좁아지면 자동 1단.

섹션 헤더 공통: `display:flex; align-items:baseline; gap:var(--space-3); border-bottom:1px solid var(--color-text); padding-bottom:var(--space-2)`
번호(`01`~`04`) monospace 10.5px `--color-accent-700` → 제목 `--font-heading` 600 20px `letter-spacing:.03em; white-space:nowrap` → 우측 보조(실행 명령명 등) monospace 10.5px `--color-neutral-600`, ellipsis.

### 01 기기 선택 (좌단)

`perftracker devices` 결과. 우측에 `새로고침` 버튼(ghost, 24px) → 로딩 900ms.

기기 행 (`padding:10.2px 13.6px; border-radius:var(--radius-lg); border:1px solid; min-width:0`):

- 1행 (`flex-wrap:wrap; gap:var(--space-2)`): serial(monospace 11px `--color-neutral-600`) → 모델명(`--font-heading` 600 16px) → 상태 배지
- 2행: 스펙 11.5px `--color-neutral-700` — `Android {release} (SDK {sdk}) · {soc ?? 'SoC 미상'} · {cores}코어 · {ramGb}GB · {res}@{hz}Hz`, 미지원 지표가 있으면 뒤에 ` — frame·network 미지원` 을 붙인다
- 상태별:
  - **선택됨**: border `--color-accent`, background `--color-accent-100`, 배지 `선택됨`(background `--color-accent`, `color:#fff`)
  - **다른 탭에서 측정 중**: `opacity:.45; cursor:not-allowed; background:var(--color-neutral-200)`, 배지 `다른 탭에서 측정 중`(background `--color-neutral-300`), **클릭 무시** — 한 기기를 두 세션이 점유할 수 없다
  - **미지원 지표 있음**: 배지 `지표 N개 미지원`(background `--color-accent-200`, `color:var(--color-accent-800)`)
  - 기본: border `--color-divider`, 배경 투명
- 배지 공통: monospace 10px, `padding:1px 7px; border-radius:99px; white-space:nowrap; flex:none`

**빈 상태 (기기 0대)** — 점선 카드 `padding:var(--space-6); border:1px dashed var(--color-divider); border-radius:var(--radius-lg); text-align:center`:

- 제목 `연결된 기기가 없습니다` (`--font-heading` 600 19px)
- 본문 12px `--color-neutral-700`, `line-height:1.7`: `USB 로 연결하고 기기 화면의 **USB 디버깅 허용**을 눌러 주세요. 이미 연결했다면 `unauthorized / offline` 상태일 수 있습니다.`
- 버튼 2개(중앙, wrap): `다시 조회`(primary 32px), `환경 점검`(secondary 32px)

### 02 이 기기에서 측정 가능한 지표

`doctor` 와 동일한 판정. 지표 8개와 최소 `sdk_int`:

| 지표 | 최소 SDK | 표시 문구 |
| --- | --- | --- |
| `hwui` | 0 (제한 없음) | — |
| `frame` | 31 | Android 12 |
| `startup` | 0 (제한 없음) | — |
| `cpu` | 30 | Android 11 |
| `memory` | 30 | Android 11 |
| `log` | 30 | Android 11 |
| `thermal` | 29 | Android 10 |
| `network` | 34 | Android 14 |

칩 (`display:inline-flex; align-items:center; gap:5px; padding:4px 11px; font-size:12px; border-radius:99px; white-space:nowrap; border:1px solid`):

- 가능: `✓` + 지표명, border `--color-accent-400`, background `--color-accent-100`, color `--color-accent-800`
- 불가: `✗` + 지표명, border `--color-neutral-400`, 배경 투명, color `--color-neutral-600`, `text-decoration:line-through`
- `title` 툴팁: 가능 = `측정 가능`, 불가 = `sdk_int={sdk} 로는 수집할 수 없습니다 (최소 {min}, {label})`

섹션 헤더 우측: 기기 미선택 = `기기를 먼저 선택하세요`, 선택 = `{ok}/8 측정 가능 · SDK {sdk}`.

칩 아래 주석 11.5px `--color-neutral-700`, `max-width:52ch`, `text-wrap:pretty`:

- 미선택: `기기를 선택하면 doctor 와 같은 판정으로 8개 지표의 측정 가능 여부를 표시합니다.`
- 전부 가능: `이 기기는 8개 지표를 모두 측정할 수 있습니다.`
- 일부 불가: `칩에 마우스를 올리면 이유가 보입니다. 못 재는 지표가 있어도 세션은 막히지 않고 나머지는 정상 수집됩니다 — 고칠 수 없는 기기의 성질입니다.`

### 03 앱 선택 (우단)

`perftracker apps` 결과 = 선택한 기기의 설치 앱.

- 검색 입력 `.input`, `width:100%`, 아래 `var(--space-2)` 간격. placeholder: 기기 선택 전 `기기를 먼저 선택하세요`(+ `disabled`), 후 `라벨 또는 패키지명으로 검색`
- 목록 컨테이너: `border:1px solid var(--color-divider); border-radius:var(--radius-md); max-height:clamp(180px,32vh,300px); overflow:auto`
- 앱 행 (`display:flex; align-items:baseline; gap:10.2px; padding:6.8px 10.2px; border-bottom:1px solid var(--color-divider); cursor:pointer`): 라벨 13px(`flex:1; min-width:0`, ellipsis) → 패키지명 monospace 10.5px `--color-neutral-600`(`flex:none`) → 버전 monospace 10.5px `--color-neutral-500`(`min-width:52px; text-align:right`)
- 선택된 행: `background:var(--color-accent); color:#fff`
- 필터: 라벨 또는 패키지명 부분일치(대소문자 무시)

**빈 상태 2종** (둘 다 점선 카드, `padding:var(--space-6); border-radius:var(--radius-lg); text-align:center`):

1. 기기 미선택 — 12px `--color-neutral-700`: `설치된 앱 목록은 선택한 기기에서 읽어옵니다. 위에서 기기를 먼저 고르면 pm list packages 결과가 여기에 채워집니다.` (목록 컨테이너는 `display:none`)
2. 검색 결과 없음 — `검색 결과가 없습니다` (12.5px) + 입력한 검색어를 monospace 11px `--color-neutral-600`, `word-break:break-all` 로 재표시 + `검색어 지우기` ghost 버튼 28px

### 04 세션

- 세션 이름: `.field` + `label`(`세션 이름`) + `.input` placeholder `예: 홈 스크롤`. 비워두면 시작 시 `세션-N` 으로 자동 부여
- 옵션 4개, 각각 클릭 가능한 행 (`display:flex; align-items:flex-start; gap:10.2px; padding:6.8px 10.2px; border-radius:var(--radius-md); border:1px solid`):
  - 체크박스: 16×16, `border-radius:5px`. ON = `border:1px solid var(--color-accent-700); background:var(--color-accent); color:#fff` + `✓`(11px). OFF = `border:1px solid var(--color-neutral-500)`
  - ON 행: border `--color-accent-400`, background `--color-accent-100`
  - 플래그명 monospace 11.5px + 설명 11.5px `--color-neutral-700`

| 플래그 | 설명 | 기본값 |
| --- | --- | --- |
| `--launch` | 앱을 콜드로 띄우고 시작 시간을 측정 (기본 켬) | ON |
| `--force` | 이 기기에 남은 기존 세션을 버리고 시작 (기본 켬) | ON |
| `--offline` | trace_processor 를 내려받지 않음 (캐시만 사용) | OFF |
| `--diagnose` | atrace slice 기록 (am · wm · view + 대상 앱) · 최대 10분 | OFF — 정지하면 다시 꺼진다 (`--launch`/`--force` 와 달리 남기지 않음) |

`--diagnose` 는 진단 세션(atrace slice 기록 — 평소 세션과 수치를 나란히 놓을 수 없다)이라 평소 옵션 셋 뒤 끝 행이다. 설명 문구의 정본은 `docs/design/diagnostic-mode.md` `## 문구`.

출력 디렉토리는 서버가 준 `EnvView.outDir` (섹션 머리 우측 `-o {outDir}`) — 화면이 정하지 않는다.

### 하단 시작 바 (`position:sticky; bottom:0`)

`display:flex; flex-wrap:wrap; align-items:center; gap:var(--space-3); padding:var(--space-3) clamp(14px,3vw,30px); border-top:1px solid var(--color-divider); background:var(--color-neutral-100)`

- 좌: 실행될 명령 미리보기 monospace 11.5px `--color-neutral-700`, `flex:1; min-width:180px`, 한 줄 끝 ellipsis. 형식:
  `$ perftracker start [--diagnose] --app "<pkg|<미선택>>" [--name "<이름>"] -d <serial|<미선택>> [--launch] [--force] -o <outDir>`
  (이름이 비면 `--name` 생략). **`--diagnose` 는 `start` 바로 뒤** — 924 폭에서 끝이 잘려도 진단 세션이라는 사실이 남는다 (서버가 적는 실행 줄도 같은 자리)
- 우: `측정 시작` — `.btn .btn-primary .blueprint`, height 40px, `min-width:150px`, 14px. **기기 또는 앱 미선택이면 disabled**(디자인 시스템의 45% opacity)

`측정 시작` → 로딩 오버레이 1400ms(`세션을 시작하고 트레이스를 켜고 있습니다`) → 탭 state `running`, `startedAt = now`.

## 4. 측정 중 화면 (탭 state = `running`)

래퍼: `min-height:100%; display:flex; flex-direction:column; align-items:center; gap:clamp(12px,2.4vh,26px); padding:clamp(16px,4vh,40px) clamp(16px,3vw,32px); margin-block:auto`
(`height:100%` + `justify-content:center` 를 쓰면 내용이 넘칠 때 상하가 잘린다 — `margin-block:auto` 로 짧을 때만 중앙 정렬되게 한다.)

위에서 아래로:

1. 킥커: 7px 원형 `--color-accent` 도트(pulse) + `측정 중` — monospace 11px, `letter-spacing:.16em`, uppercase, `--color-accent-700`. 진단 세션이면 `측정 중 · 진단`
2. 타이머: `--font-heading` 600, `font-size:min(108px,max(52px,14vw,12vh))`, `line-height:.9`, `font-variant-numeric:tabular-nums`, 형식 `mm:ss`(1시간 넘으면 `h:mm:ss`), 500ms 틱
3. 세션 정보(중앙 정렬, `line-height:1.7`): 이름(`--font-heading` 19px) / `{앱 라벨} · {패키지}`(13px `--color-neutral-700`) / `{모델} ({serial}) · 시작 HH:MM:SS`(monospace 11.5px). 그 아래 사실 줄(11.5px `--color-neutral-600`, `margin-top:var(--space-2)`, `word-break:keep-all`) — 있을 때만:
   - 못 재는 지표: `✗ 이 기기에서 못 재는 지표 N개 — {id · id} (나머지는 정상 수집)`
   - 진단 세션 고지(앱 slice 열림이 "모름" 칸일 때만): core 의 문장 그대로 — `앱 slice 열림 모름 — sdk {sdk} · debuggable 아님|모름`. 기호 없음 · 설정 화면에는 없다 (앱의 debuggable 을 모름)
4. 정지 버튼: `.btn .btn-primary .blueprint`, height 52px, `min-width:190px`, 15px — `정지 · 기록 생성`. **마킹 블록 위**다 (아래 알려진 이슈를 이렇게 풀었다)
5. **마킹 블록** — `width:min(520px,92%)`, `display:flex; flex-direction:column; gap:var(--space-2)`:
   - 헤더: `마킹`(monospace 10.5px, uppercase, `letter-spacing:.14em`, `--color-neutral-600`) + `이벤트가 일어난 순간에 이름을 남기면 경과 시간과 함께 기록됩니다`(11.5px `--color-neutral-600`)
   - 입력 행: `.input`(`flex:1; min-width:0`, placeholder `예: 홈 진입, 스크롤 시작, 광고 재생`) + 버튼 `.btn .btn-secondary`(height 40px, `min-width:96px`, 12.5px) 라벨 `마킹 @ mm:ss` — **경과 시간이 실시간으로 갱신됨**. 입력이 비면 disabled. **Enter 로도 등록**
   - 빠른 마킹 칩(wrap): ghost 28px 11.5px — `+ 앱 진입`, `+ 스크롤 시작`, `+ 영상 재생`, `+ 화면 전환`. 클릭 즉시 그 라벨로 마킹
   - 마킹 목록(1개 이상일 때만): `border:1px solid var(--color-divider); border-radius:var(--radius-lg); max-height:118px; overflow:auto`. 행 = `padding:6px 12px; border-bottom:1px solid var(--color-divider)`; 경과시간(monospace 11.5px `--color-accent-700`, `min-width:46px`) + 라벨(12.5px, ellipsis) + `×` 삭제(14px `--color-neutral-600`). **최신순(내림차순)**
   - 목록 아래 우측 정렬: `{N}개 · result.json 의 marks[] 로 저장됩니다`(monospace 10.5px `--color-neutral-600`)
6. 각주(`max-width:46ch`, 중앙, 11.5px `--color-neutral-600`): `측정 중에는 기기에 어떤 adb 명령도 보내지 않습니다. 다른 탭의 세션은 이 탭과 독립적으로 흘러갑니다.` — 진단 세션이면 같은 문단 안 둘째 줄(블록, `margin-top:var(--space-2)`): `진단 · slice 비용 앱 프로세스 몫 · 평소 세션과 비교 불가 · 최대 10분`

> **알려진 이슈 (해결)**: 마킹이 3개 이상 쌓이고 뷰포트 높이가 낮으면(≈540px) 정지 버튼이 스크롤 아래로 밀렸다. 구현은 정지 버튼을 마킹 블록 위로 올리고 목록에 `max-height` 를 걸었다 (위 4).

마킹 데이터: `{ id, label, offsetMs }` — `offsetMs = now - startedAt`. 탭별로 독립 저장, 정지 후 새 세션에서는 초기화.

정지 → 로딩 오버레이 1800ms(`트레이스를 회수하고 result.json 을 만들고 있습니다`, 명령 `npx perftracker stop -d {serial}`) → 기록 레코드 생성 후 드로어를 열고, 그 탭은 설정 화면으로 되돌린다(기기·`--launch`·`--force` 는 유지, 앱/이름/마킹·`--diagnose` 는 초기화).

## 5. 기록 드로어 (우측, 조건부)

`width:clamp(280px,32vw,392px); flex:none; border-left:1px solid var(--color-divider); background:var(--color-neutral-100); display:flex; flex-direction:column`

헤더 (`padding:var(--space-4)`, 하단 divider): `기록`(`--font-heading` 600 18px, `letter-spacing:.06em`, uppercase) + `{N}건 · 항상 최신`(monospace 10.5px `--color-neutral-600`) + `전체 지우기`(ghost 26px) + `×` 닫기.

목록: `flex:1; overflow:auto; padding:var(--space-3); display:flex; flex-direction:column; gap:var(--space-2)`. **항상 최신순**, 여러 탭이 동시에 끝나도 즉시 반영.

기록 행 (`padding:10.2px 13.6px; border-radius:var(--radius-lg); border:1px solid var(--color-divider); background:var(--color-bg)`):

- 1행: 이름(`--font-heading` 600 17px, 클릭 시 대시보드) + `NEW` 배지(갓 생성된 기록만; monospace 9.5px, `padding:1px 6px; border-radius:99px; background:var(--color-accent); color:#fff`; 한 번 열면 사라짐)
- 이름 변경 중에는 이름 자리를 `.input`(height 28px, 13px)으로 교체 — Enter/blur 로 확정, Esc 로 취소, 공백이면 원래 이름 유지
- 2행 좌(11.5px `--color-neutral-700`, `line-height:1.55`, `flex:1; min-width:0`, 클릭 시 대시보드):
  - `{모델} · {serial}`
  - `{앱 라벨} v{버전}`
  - monospace 10.5px `--color-neutral-600`: `MM/DD HH:MM · mm:ss · {launch|attach} · 경고 N[ · 미지원 N][ · 마킹 N][ · 진단]` — `진단` 은 진단 세션 기록에만, 맨 끝. 드로어가 좁으면(924 에서 295px) 잘리지 않고 줄바꿈
- 2행 우(`flex:none`): `이름 변경`, `삭제` — ghost 24px 10.5px, `white-space:nowrap`

**빈 상태**: `기록이 없습니다. 세션을 정지하면 여기에 쌓입니다.` — 점선 카드, `padding:var(--space-8) var(--space-4)`, 12px `--color-neutral-600`.

## 6. 확인 다이얼로그 (재사용 1종)

`.dialog-backdrop`(`position:fixed; inset:0; display:flex; align-items:center; justify-content:center; z-index:40`) + `.dialog .blueprint`(`width:min(400px,92vw); padding:var(--space-6)`).
제목 `--font-heading` 600 22px / 본문 13px `--color-neutral-700` `line-height:1.6` / 액션 우측 정렬 `취소`(secondary 34px) + 확인(primary 34px).

| 종류 | 제목 | 본문 | 확인 라벨 |
| --- | --- | --- | --- |
| 기록 삭제 | `기록을 삭제할까요?` | `“{이름}” 의 run 디렉토리와 result.json 이 함께 삭제됩니다. 되돌릴 수 없습니다.` | `삭제` |
| 전체 지우기 | `기록을 전체 지울까요?` | `기록 {N}건의 run 디렉토리가 모두 삭제됩니다. 되돌릴 수 없습니다.` | `삭제` |
| 측정 중 탭 닫기 | `측정 중인 탭을 닫을까요?` | `진행 중인 세션이 버려지고 기록이 남지 않습니다. 기기의 Perfetto 세션도 정리합니다.` | `세션 버리고 닫기` |

## 7. 로딩 오버레이 (재사용 컴포넌트 — 전체 화면)

`position:fixed; inset:0; z-index:60; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:var(--space-4); background:color-mix(in srgb, var(--color-bg) 88%, transparent); backdrop-filter:blur(2px)`

- 스피너: 34×34, `border-radius:50%`, `border:2px solid var(--color-accent-300)`, `border-top-color:var(--color-accent-700)`, `animation:spin .8s linear infinite`
- 라벨: `--font-heading` 600 20px
- 명령: `$ {command}` monospace 11.5px `--color-neutral-700`, `max-width:88vw; text-align:center; word-break:break-all`

`{ label, command }` 하나만 받는 단일 컴포넌트로 만들고 모든 대기 구간에서 재사용한다.

| 트리거 | label | command | 프로토타입 지연 |
| --- | --- | --- | --- |
| 환경 점검 | `환경과 기기를 점검하고 있습니다` | `npx perftracker doctor` | 1100ms |
| 기기 새로고침 / 다시 조회 | `연결된 기기를 조회하고 있습니다` | `npx perftracker devices` | 900ms |
| 측정 시작 | `세션을 시작하고 트레이스를 켜고 있습니다` | 위 start 명령 전문 | 1400ms |
| 정지 | `트레이스를 회수하고 result.json 을 만들고 있습니다` | `npx perftracker stop -d {serial}` | 1800ms |

> 사용자 결정: 로딩은 **전체 화면**을 덮는다(탭 로컬이 아님).
> 실제 구현에서는 고정 지연이 아니라 API 응답까지 유지한다. 앱 목록 조회처럼 새로 추가되는 대기 구간에도 같은 컴포넌트를 쓴다.

## 8. CLI 로그 스트립 (푸터)

접힌 상태: `display:flex; align-items:center; gap:var(--space-3); padding:var(--space-2) clamp(12px,2vw,20px); cursor:pointer` — `CLI 로그`(monospace 10.5px, uppercase, `letter-spacing:.14em`) + 마지막 명령(`$ …`, monospace 11px, `flex:1`, ellipsis) + `펼치기 ▴ (N)` / `접기 ▾`.
펼친 상태: `max-height:168px; overflow:auto`, 행 = `{HH:MM:SS} $ {command}`(시각 `--color-neutral-500`, `$` `--color-accent-700`), monospace 11px `line-height:1.7`, **최신순**. 최대 40건 유지.

기록되는 이벤트: doctor / devices / start / stop, 마킹 추가(`mark "{라벨}" @ mm:ss`), 기록 열기, 기록 삭제(`rm -rf runs/*_{id}`), 전체 지우기(`rm -rf runs/*`).

## 9. 대시보드 (미정 — 이 핸드오프 범위 밖)

기록 이름/메타를 클릭하면 그 세션의 대시보드를 여는 자리입니다. 현재 프로토타입은 CLI 로그만 남기고 화면 전환은 하지 않습니다. 구현 시 `runs/{timestamp}_{name}_{id}/result.json` 을 읽어 별 페이지(또는 새 창)로 여는 지점만 마련해 두면 됩니다.

---

## Interactions & Behavior 요약

- 탭 전환은 상태 보존 — 각 탭이 `serial / pkg / name / 옵션 / marks / state / startedAt / appQuery` 를 독립 보유
- 측정 중 탭의 경과 시간은 500ms 인터벌로 갱신. 측정 중 탭이 하나도 없으면 인터벌은 상태를 갱신하지 않는다
- 한 기기는 동시에 한 세션만 — 다른 탭이 측정 중인 기기는 선택 불가로 표시
- 애니메이션 2종만: 스피너 회전(`.8s linear infinite`), 상태 도트 pulse(`1.4s ease-in-out infinite`, opacity 1→.35). 그 외 트랜지션은 디자인 시스템의 hover/press 기본값에 맡긴다
- 포커스: `:focus-visible { outline:2px solid var(--color-accent); outline-offset:2px }` (브라우저 기본 파란 링 금지)
- 반응형: 고정 최소폭 없음. 좁아지면 설정 폼 1단, 헤더/시작바 wrap, 탭 가로 스크롤. 낮은 높이에서는 타이머가 `12vh` 로 함께 줄어든다

## State Management

전역: `tabs[]`, `activeTabKey`, `history[]`, `drawerOpen`, `cliOpen`, `cliLog[]`, `loading | null`, `confirm | null`, `editingHistoryId`, `editDraft`, `now`.
탭: `{ key, name, serial, pkg, launch, force, offline, outDir, marks[], markDraft, state: 'setup'|'running', startedAt, appQuery }`.
기록: `{ id, name, serial, model, pkg, app, at, durationMs, launch, unsupported, marks, warnings, fresh }`.

상태 전이: `setup --(측정 시작)--> running --(정지)--> setup(초기화) + history 추가`.

## CLI 연동 (구현 시 실제 소스)

| GUI 동작 | CLI / core |
| --- | --- |
| 환경 점검 | `perftracker doctor` → core `runDoctor` (지표 지원 판정 포함) |
| 기기 목록 | `perftracker devices` → core `listDeviceSummaries` (serial, model, release, sdk, soc, cores, ram, res, hz) |
| 앱 목록 | `perftracker apps` → core `loadLabeledApps` (label, package, version) |
| 측정 시작 | `perftracker start --app <pkg> --name <name> -d <serial> [--launch] [--force] -o runs` |
| 경과 시간 / 활성 세션 | `perftracker status` → core `listActiveSessions`, `formatElapsed` |
| 정지 + 회수 | `perftracker stop -d <serial>` → core `stopSession` + `extractRun` |
| 기록 목록 | `runs/` 디렉토리의 `session.json` / `result.json` 스캔 |
| 이름 변경 / 삭제 | run 디렉토리의 `session.json` 갱신 / 디렉토리 삭제 |
| 마킹 | 세션 동안 GUI(서버)가 메모리에 보관 → 정지 시 `result.json` 의 `marks[]` 로 기록. **측정 중 기기에 adb 를 보내지 않는 원칙을 깨지 말 것** |

지표 지원 판정은 GUI 에 하드코딩하지 말고 `doctor` 결과를 그대로 쓰는 편이 안전합니다(위 표는 프로토타입이 쓴 값).

## Design Tokens

Industry 디자인 시스템의 다크 반전. 원본 토큰을 `:root` 에서 덮어써 디자인 시스템 클래스가 그대로 따라오게 했습니다.

```css
--color-bg:#1d1f20;  --color-surface:#26282a;  --color-text:#eef0f2;
--color-accent:#749dc4;  --color-accent-2:#7e9cb8;
--color-divider:color-mix(in srgb,#eef0f2 18%,transparent);

--color-neutral-100:#26282a; --color-neutral-200:#2f3133; --color-neutral-300:#3b3d40;
--color-neutral-400:#55585b; --color-neutral-500:#7e8285; --color-neutral-600:#9a9ea1;
--color-neutral-700:#b6babd; --color-neutral-800:#d3d6d8; --color-neutral-900:#eef0f2;

--color-accent-100:#1f2b36; --color-accent-200:#26374a; --color-accent-300:#3d5f80;
--color-accent-400:#6d97bf; --color-accent-500:#749dc4; --color-accent-600:#8fb2d3;
--color-accent-700:#a9c8e6; --color-accent-800:#cfe1f3; --color-accent-900:#e7f1fb;

--radius-sm:6px; --radius-md:10px; --radius-lg:16px;   /* pill: 99px */
--shadow-sm:0 1px 2px rgba(0,0,0,.5);
--shadow-md:0 3px 10px rgba(0,0,0,.55);
--shadow-lg:0 12px 32px rgba(0,0,0,.6);
```

- 원본 Industry 는 사각 모서리이지만, 이 GUI 는 사용자 요청으로 **둥근** 형태입니다: 카드·기기 행·기록 행 16px, 입력·목록 10px, 버튼·칩·배지 pill(99px), 체크박스 5px, 차트 바 상단 4px. `.blueprint` 코너 마크(`+`)는 primary 버튼과 카드에 유지합니다.
- 타이포: `--font-heading` = Barlow Condensed (500/600/700), `--font-body` = Barlow (400/500/600). monospace 는 `ui-monospace, Menlo, monospace` — serial·패키지명·명령·시간 등 기계값 전용.
- 간격은 `--space-*` 스케일(density 0.85×). `10.2px` / `13.6px` / `6.8px` 같은 값은 그 스케일에서 나온 값이므로 대상 코드베이스의 스케일로 매핑하십시오.
- 아이콘: Lucide, stroke-width 1.5. 프로토타입은 아이콘 대신 `×` `+` `✓` `✗` 문자를 썼습니다 — 실제 구현에서는 Lucide 로 교체 권장(`x`, `plus`, `check`, `refresh-cw`, `square` 등).

## Assets

이미지·아이콘 에셋 없음. 색·타입은 Industry 디자인 시스템에서, 기기/앱/기록 데이터는 목업입니다.

## Files

- `PerfTracker GUI.dc.html` — 이 GUI 전체(단일 파일). 상단 `<style>` 에 다크 토큰 오버라이드, 그 아래 마크업, 하단 `<script>` 에 상태 로직과 목업 데이터(`DEVICES` / `METRICS` / `APPS` / `SEED_HISTORY`)
- `screenshots/` — 위 표의 렌더 화면 7장
- `_ds/` — Industry 디자인 시스템 (`styles.css` 토큰·컴포넌트 클래스, `_ds_bundle.js`, `readme.md` 가이드)
- `support.js` — 프로토타입 런타임(디자인 도구 전용, 이식 대상 아님)

원본 CLI/core 소스는 이 번들에 없습니다 — 로컬 `PerfTracker` 리포지토리(`packages/cli`, `packages/core`, `runs/`)를 함께 참조하십시오.
