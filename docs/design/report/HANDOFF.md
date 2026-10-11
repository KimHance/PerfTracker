# Handoff: PerfTracker 세션 데이터 화면 (보고서)

## Overview

`PerfTracker` CLI 가 세션마다 내는 `result.json` **하나**를 그대로 읽어 보여주는 화면입니다. 기록 목록에서 항목을 누르면 **새 창**으로 열립니다.

**판정하지 않는 화면입니다.** 값을 읽고 판단하는 것은 사람이 합니다. 점수·등급·좋고나쁨 색이 없습니다.
예외 하나는 프레임 타임라인의 16ms 참고선입니다 — 앱 시작 게이지와 같은 조건으로(출처가 구글,
점수·이름 없음, 막대를 분류하지 않음) 실제 구현에서 규칙 2 의 예외로 들어갔습니다(`packages/gui/AGENTS.md` 참고).

핵심 설계는 **팩토리**입니다 — 지표마다 컴포넌트를 만들지 않습니다. 데이터 모양은 7가지뿐이고(`distribution` `series` `bars` `delta` `pairs` `stat` `frametimeline`), 각 지표가 매니페스트에서 자기 모양과 데이터 위치를 선언하고 렌더러는 모양만 압니다. 지표가 늘면 **매니페스트에 한 줄**, 새 모양이 나올 때만 `kind` 를 하나 늘립니다.

## Screenshots

`screenshots/` — 프로토타입 실제 렌더.

| 파일 | 상태 |
| --- | --- |
| `01-summary-full.png` | 요약 탭 · `full.json` (7지표 정상) |
| `02-render-distribution.png` | 프레임 분포 · 백분위 점선 |
| `03-cpu-memory-series.png` | 시계열 (축·눈금·표본 없는 구간) |
| `04-context-delta.png` | 온도/기기 상태 전→후, 네트워크, 앱 시작, 측정 비용 |
| `05-device-tab.png` | 기기 탭 |
| `06-lowend-missing.png` | `low-end.json` — 미수집 블록이 사라지지 않고 남는 모습 |

## About the Design Files

`Session Report.dc.html` 은 **디자인 레퍼런스**입니다 — 의도한 모양과 동작을 보여주는 프로토타입이며 프로덕션 코드가 아닙니다. React 19 + Vite 로 다시 구현하되, **매니페스트 구조와 규칙은 그대로 옮기십시오**. 차트는 라이브러리 없이 SVG 를 직접 그립니다. 외부 요청 0회(글꼴·아이콘 자체 호스팅) — 프로토타입은 Google Fonts 링크를 쓰지만 구현에서는 Barlow / Barlow Condensed 를 vendoring 하십시오.

## Fidelity

**High-fidelity** — 색·타이포·간격·상태·카피 확정. 토큰은 `PerfTracker GUI` 와 **동일**합니다(같은 제품의 두 화면). 다크 하나만 존재합니다.

---

## 1. 데이터 계약 (깨면 화면이 거짓말한다)

입력은 `result.json` **그대로**입니다. GUI 전용 뷰 타입을 새로 만들지 마십시오 — 이미 `schema_version` 이 붙은 공개 계약이고, 옆에 두 번째 계약을 두면 둘이 조용히 어긋납니다.

### ① `null` 은 `0` 이 아니다 — 세 상태를 구분한다

읽기 함수가 **필드 부재 / `null` / 값** 을 구분해야 합니다. 프로토타입은 `MISSING` 심볼을 씁니다:

```js
const MISSING = Symbol('missing')
function readPath(root, path) {          // 'metrics.cpu.data.app.timeline'
  if (root == null) return MISSING
  let cur = root
  for (const seg of path.split('.')) {
    if (cur == null || typeof cur !== 'object' || !(seg in cur)) return MISSING
    cur = cur[seg]
  }
  return cur
}
```

| 결과 | 화면 표기 |
| --- | --- |
| `MISSING` (필드 자체가 없음) | `수집 안 함 — <경로> 없음` |
| `null` (측정을 시도했지만 값이 없음) | `값 없음` |
| 값 | 값 |

`low-end.json` 의 `metrics.cpu.data.app === null` 이 정확히 이 구분을 요구합니다 — 기기 쪽 값은 멀쩡한데 앱 쪽만 없습니다. **"앱 CPU 0%" 로 그리면 그 화면은 거짓말입니다.**

### ② 선을 잇지 않는다

`null` 인 초에서 선을 끊고, 끊긴 구간을 회색 띠(`--color-neutral-500` opacity .13)로 남깁니다. 이으면 재지 않은 구간에 직선이 그어지고 그 직선은 데이터처럼 보입니다.

- 누적 카운터(`cpu.data.app.timeline`, `cpu.data.device_timeline`)는 **첫 초가 배열에 없는 것이 정상**입니다 — 앞에 뺄 표본이 없어서입니다. 0 으로 채우면 "그 초에 안 썼다" 는 없던 사실이 됩니다. 매니페스트의 `sampling: 'cumulative'` 가 이것을 선언하고, 축은 1초부터 시작합니다.
- 순간값(`memory.data.system_timeline`)은 `sampling: 'gauge'` — 0초도 있습니다.
- 표본이 1개뿐인 구간은 선이 될 수 없어 점으로 그립니다.

### ③ 판정하지 않는다

- 색은 **계열 구분**에만 씁니다. 빨강/초록으로 좋고 나쁨을 칠하지 않습니다.
- 임계선·점수·등급·↑↓ 화살표 없음.
- `references` 배열(구글 공개 기준치)은 **이 화면에서 쓰지 않습니다.** 비교에도, 표시에도 쓰지 않습니다.
- 예외 하나: `target_app.debuggable === true` 는 헤더 플래그로 강조합니다. 판정이 아니라 "이 세션은 릴리스 빌드를 잰 것이 아니다" 라는 **측정 조건의 사실**입니다. `null` 은 `debuggable 모름` 으로 따로 표기합니다 — `false`(릴리스 확인)와 다릅니다.

### ④ 못 잰 것을 숨기지 않는다

- 필드가 없으면 블록을 **사라지게 하지 말고** "수집 안 함" 으로 남깁니다. 없어진 블록은 "이 도구가 원래 안 재는 것" 처럼 보입니다.
- `status` 가 `unsupported` / `skipped` / `failed` 면 카드 제목 줄에 배지를 답니다. **`partial` 은 배지를 달지 않습니다** — full 표본에서 4개 지표가 전부 `process_name_stale_in_trace` 로 partial 이라 배지가 노이즈가 됩니다. 대신 헤더 플래그에서 세고, 이유는 배지/블록의 `title` 툴팁으로 닿을 수 있게 둡니다.
- `reason_code` 와 `reason` 은 미수집 블록에서 코드로 표시하고 문장은 툴팁에 둡니다. 카드마다 이유 문장을 본문에 박지 않습니다 — 같은 문장이 4번 반복되면 아무도 읽지 않습니다.

### ⑤ 단위는 필드 이름이 말한다

`_kb` `_ms` `_pct` `_hz` `_c` `_bytes`. 추측하지 말고 변환은 매니페스트에 명시합니다(`transform`). **주의**: `transform` 으로 이미 MB 로 바꾼 값에 MB 포맷터(`/1024`)를 또 걸면 이중 변환됩니다 — 변환한 계열은 순수 숫자 포맷(`n0` / `n1`)을 쓰고 단위는 `unit` 으로 적습니다.

### ⑥ 시간축은 하나다

모든 `t_s` 와 `session.marks[].offset_ms / 1000` 이 같은 0초를 씁니다. 축의 `maxT` 는 **화면 전체에서 한 번** 계산합니다:

```
maxT = max( 모든 series 의 max t_s, 모든 mark 의 초, ceil(duration_ms/1000) )
```

그래서 한 시계열에 마우스를 올리면 **모든 시계열이 같은 초를 가리킵니다.** "CPU 가 튄 그 순간 프레임은 어땠나" 를 눈을 안 옮기고 읽게 하는 것이 목적입니다. 지표마다 축을 다르게 잡으면 이 데이터의 설계 의도가 죽습니다.

### ⑦ 측정 중 세션

`session.state === 'running'` 이면 `ended_at` · `duration_ms` · `state_after` 가 `null` 입니다 — 0 이 아닙니다. 헤더의 길이는 `측정 중` 으로 표기하고, 세션 길이라고 부르지 않습니다.

### ⑧ 모르는 지표

`metrics` 는 catchall 입니다. 매니페스트에 없는 키는 무시하되 **몇 개를 무시했는지 푸터에 남깁니다**(무시한 것이 없으면 아무 문구도 띄우지 않습니다). `schema_version` 의 major 가 다르면 헤더 플래그로 먼저 말합니다.

---

## 2. 블록 8종

| kind | 데이터 모양 | 쓰이는 곳 |
| --- | --- | --- |
| `distribution` | `[{from_ms, to_ms\|null, count}]` + 백분위 | 프레임 지속 시간 **(이 화면의 유일한 막대)** |
| `series` | `[{t_s, <값 필드>}]` | 앱/기기 CPU · 앱 RSS · 기기 가용 메모리 · 로그 **(전부 선)** |
| `bars` | `[{label, value}]` | 코어별 사용률, 클러스터 최대 주파수 |
| `delta` | 배열 `[{label, before, after}]` 또는 두 객체 경로 + 키 목록 | 온도 존, 기기 상태 전/후 |
| `pairs` | `[{key, value}]` | 기기·앱 정보, min/avg/max 요약, 오버헤드, 진단 탭의 카드 셋 |
| `stat` | 단일 값 — 게이지 + 아래 줄 (큰 숫자 없음 · 값이 없으면 `값 없음` + 코드) | 앱 시작 카드 (숫자는 요약 타일 · RR-4 결정 10) |
| `frametimeline` | `[경과 ms, 앱 ms, 표시 ms, 마감 ms]` 의 배열 | 시간별 프레임 (렌더 섹션 타임라인 서브탭) |
| `slicetable` | `[{name, <갈래>: {count, sum_ms, max_ms} \| null, …}]` | 진단 탭의 slice 이름별 표 (**진단 세션에만**) |

### 블록 선언

```js
{
  kind: 'series',
  title: '앱 CPU',
  unit: '% · 1코어 = 100%',
  section: 'cpu',
  span: 6,                                  // 12칸 그리드
  metric: 'cpu',                            // status/reason 을 끌어올 지표
  path: 'metrics.cpu.data.app.timeline',    // 데이터 위치 — 점 표기 그대로
  field: 'app_cpu_ms',                      // 배열 원소에서 읽을 값
  transform: (ms) => ms / 10,               // ms/초 → % (1코어=100%)
  sampling: 'cumulative',                   // 0초가 없는 것이 정상
  fmt: 'n1',
  baseline: 'zero',                         // 세로축 0 기준
}
```

**`path` 를 반드시 선언으로 둡니다. 규칙으로 유추하지 마십시오.** 같은 `timeline` 이라도 위치가 다릅니다:

```
metrics.frame.data.timeline        ← data 바로 아래
metrics.memory.data.timeline       ← 여기도
metrics.cpu.data.app.timeline      ← cpu 는 app 아래   ★
metrics.log.data.app.timeline      ← log 도 app 아래   ★
metrics.cpu.data.device_timeline   ← 기기 쪽은 또 다르다
metrics.memory.data.system_timeline
```

"`data.timeline` 을 보면 된다" 는 규칙을 만들면 cpu 와 log 가 조용히 빕니다.

### kind별 추가 필드

- **series** — `field`, `subField`/`subLabel`(같은 축의 점선 보조선, 부분집합일 때만 · 쌓지 않음), `transform`, `sampling: 'cumulative'|'gauge'|'count'`, `baseline: 'zero'|'data'`, `fmt`
- **distribution** — `percentilesPath`, `share`(백분위 옆에 세울 비율 하나: `{label, countPath, totalPath}`), `framesPath`(각주의 프레임 수), `breakAfterEmptyBuckets`(현재 `Infinity` — **버킷은 전부 보여준다**)
- **bars** — `labelField`(배열이면 `CPU 0–3` 처럼 범위로), `labelPrefix`, `valueField`, `fmt`, `scaleMax`(`null` 이면 데이터 최댓값)
- **delta** — 배열형: `labelField` `beforeField` `afterField` `fmt` / 객체형: `beforePath` `afterPath` `keys[]`
- **pairs** — `keys: [{p, l, w?, f}]` (`p` 는 블록 `path` 기준 상대 경로, 점 표기 가능 · `w` 는 경로 라벨의 단어 줄 — RR-6) 또는 `arrayAs: 'freq'` 같은 특수 변환
- **stat** — `fmt`, `unit`, `sub: [{l, p, f}]`
- **frametimeline** — `path` 하나 (`metrics.frame.data`)
- **slicetable** — `nameField` `nameLabel`, `groups: [{field, label}]`(갈래 셋), `stats: [{field, label, fmt}]`(횟수 · 합 ms · 최대 ms), `rowsUnit`(`{n}` 자리에 행 수)

블록 공통으로 둘이 더 있습니다.

- `statePath` — 지표가 아닌 블록의 껍데기(`status` · `reason_code` · `reason`) 위치. `metric` 과 같은 일(배지 · 제목 툴팁 · 값 없는 자리의 코드)을 합니다. 진단 탭의 카드 넷이 `diagnose` 를 씁니다 — 진단 블록은 `metrics` 밖에 있지만 메트릭과 같은 껍데기입니다.
- `diagnoseUnit` — **진단 세션에만** 쓰는 카드 단위. 지금은 측정 비용 카드 하나(`앱 프로세스 몫 미포함`)입니다.

`pairs` 의 키에 `why: {code, reason}` 를 달면 **그 값이 `null` 일 때만** `값 없음` 옆에 코드를, 문장은 행 `title` 로 냅니다 (진단 탭의 `app_slices_open` 행). 블록 `path` 가 빈 문자열이면 문서 루트 기준입니다 (`원본` 카드의 `artifacts.trace` · `diagnose.trace_bytes`).

### 포맷터

`int` `ms0` `ms2` `pct0` `pct1` `pct2` `c1` `hz` `mb0` `mb1` `gb1` `ghz2` `bytes` `bool` `list` `dots`(목록을 ` · ` 로 — `am · wm · view`) `mbTriple`(`{min_kb,avg_kb,max_kb}` → `52 / 315 / 352 MB`) `wrap`(줄바꿈 허용) `path`(기계값 경로 — `wrap` + 등폭, 값이 있을 때만 등폭) `raw` `n0` `n1`(순수 숫자 — 변환된 계열용).

---

## 3. 화면 구조

```
┌──────────┬────────────────────────────────────────────────┐
│ 좌측 레일 │ 헤더: 세션 id · 이름 · 상태                     │
│  212px   │   앱 / 기기 / 시작 / 길이 / 옵션                │
│          │ 플래그 줄                                      │
│ PERF...  │ 표식 줄 (session.marks)                        │
│ 세션데이터│ ─────────────────────────────────────────────  │
│          │ 지표 — 타일 8 (요약 탭만 · 4열 / ≤760 2열)     │
│          │ 섹션들 (12칸 그리드)                           │
│ [요약]   │                                                │
│  기기    │                                                │
│ (진단)   │  ← 진단 세션에만                               │
│          │ 푸터: 도구 · 호스트 · schema_version            │
└──────────┴────────────────────────────────────────────────┘
```

- 셸: `display:grid; grid-template-columns:212px minmax(0,1fr); min-height:100vh`
- 레일: `position:sticky; top:0; height:100vh; border-right:1px solid var(--color-divider); padding:var(--space-6) 0`

### 탭 — 평소 2개 · 진단 세션 3개

레일에 **요약 / 기기** 두 개를 둡니다. **진단 세션**(`session.options.diagnose === true`)이면 세 번째 **진단** 탭이 붙습니다 — 기준은 그 칸 하나이고 진단 블록의 유무로 가르지 않습니다. 평소 보고서는 탭 둘 그대로입니다. 섹션 목차나 스크롤 스파이는 없습니다.

- 탭 버튼: `padding:8px var(--space-4)`, 14px, `border-radius:0 99px 99px 0`, 선택 시 `border-left:2px solid var(--color-accent)` + `background:var(--color-accent-100)` + `color:var(--color-accent-800)`
- 미수집 블록이 있는 탭에는 개수 배지(monospace 12px, `--color-neutral-800` 글자 · `--color-neutral-200` 바탕). 세는 것은 값 자리에 `수집 안 함` · `값 없음` 을 그린 블록뿐입니다 — 재 봤더니 없음(`[]`)으로 `크래시 없음` · `ANR 없음` · `경고 없음` · 차트의 `표본 없음` · `프레임 없음` · `항목 없음` 을 그린 블록과 요약 타일은 세지 않습니다(RR-8 · 결정 12 · B22). 셈은 카드가 그린 글자를 그대로 읽습니다(`blocks.ts` 의 `tabBadgeCount`)
- **요약** 탭 = `지표`(타일 8 — 블록 아님) `startup` `render` `cpu` `memory` `log` `context` 섹션
- **기기** 탭 = `device` 섹션
- **진단** 탭 = `diagnose` 섹션(머리 `atrace slice`) — 카드 넷: `기록 범위`(`atrace_categories` · `atrace_apps` · `app_slices_open`) · `slice 수`(`trace_slices` · `target_process_slices` · `target_process_slices_unfinished` · `target_process_slice_names_unfolded` · `ftrace_overrun_events` · `target_process_compile_state_slices` · `target_process_jit_slices` — ART 칸 둘은 `why` 짝으로 `null` 이면 코드) · `원본`(`artifacts.trace` · `diagnose.trace_bytes`) 각 span 4 + `slice 이름별` 표 span 12. 라벨은 **우리말 단어 줄 + 필드 경로 줄**입니다(RR-6 — 경로 줄은 글자 그대로 · ART 칸 둘은 경로 한 줄). 카드 단위 칸은 비웁니다(`diagnose` 는 뜻 없는 글자였습니다). 표가 `null` 이면 탭 개수 배지에 1 이 섭니다.
- 탭 전환 시 `window.scrollTo(0, 0)`

### 헤더

- 세션 id: monospace 12px, `letter-spacing:.14em`, uppercase, `--color-accent-700`
- 이름: `--font-heading` 600, `clamp(26px,3.4vw,34px)`
- 상태 pill: monospace 12px uppercase, `padding:3px 10px; border-radius:99px`. `running` 이면 `background:var(--color-accent); color:var(--color-bg)`, 그 외 `--color-neutral-200`
- **진단 pill** (진단 세션에만): 상태 pill 바로 옆 `진단`. 같은 글꼴 · 크기 · 모양에 **바탕 없이** `--color-neutral-700` 글자 + `--color-divider` 1px 안쪽 테두리 — 상태 pill 과 모양으로만 갈리고 색에 뜻을 싣지 않습니다. `옵션` 메타 칸은 그대로(`--launch` · `attach`)입니다
- 메타 줄(값 13px `--color-neutral-700` · 라벨 12px `--color-neutral-600`, wrap): 앱 `{label} · {package} · {version_name}` / 기기 `{model} · {serial} · Android {release} (sdk {sdk_int})` / 시작 `YYYY-MM-DD HH:MM:SS` / 길이 `{duration_ms} ms` 또는 `측정 중` / 옵션 `--launch` 또는 `attach`

### 플래그 줄

> 지금 코드에는 이 줄이 없습니다 — 각 사실이 화면 안의 제자리로 갔습니다 (`header.ts` 머리 주석의 표). 진단 세션 표시도 플래그가 아니라 위 진단 pill 과 레일 탭입니다.

pill (`font-size:11.5px; padding:3px 10px; border-radius:99px; border:1px solid`). 강조(`hot`)는 `--color-accent` 테두리 + `--color-accent-100` 배경 + `--color-accent-800` 글자, 보통은 `--color-divider` + `--color-neutral-100`.

| 조건 | 라벨 | 강조 |
| --- | --- | --- |
| `schema_version` major ≠ 1 | `schema {버전}` | ● |
| `target_app.debuggable === true` | `debuggable` | ● |
| `debuggable` 가 `null`/부재 | `debuggable 모름` | |
| `status` 가 unsupported/skipped/failed 인 지표 | `미수집 frame network` | |
| `warnings[]` 있음 | `경고 {N}` | |
| 매니페스트에 없는 지표 | `미지원 매니페스트 {키들}` | ● |
| `display.active_refresh_rate_hz === null` | `주사율 못 읽음` | |

각 pill 의 `title` 에 이유를 넣습니다.

### 표식 (marks)

`session.marks` 가 있을 때만. 위아래 hairline 로 감싼 줄:
`표식` 라벨(monospace 12px uppercase `--color-neutral-600`) + 칩들(12px · 시각 monospace 12px `--color-neutral-600`). 칩은 `border:1px dashed`, `border-radius:99px`, `padding:3px 10px`, 내용 `{m:ss} {label}`.

**칩에 마우스를 올리면 그 초가 모든 시계열로 전파됩니다**(공유 `hoverT`). 시계열마다 그 초에 점선 세로선이 얹히고, 짚은 표식의 선만 진해집니다.

### 섹션

`display:grid; grid-template-columns:repeat(12,minmax(0,1fr)); gap:var(--space-3)`.
섹션 제목: `--font-heading` 600 18px uppercase `letter-spacing:.02em` `--color-neutral-800` + 오른쪽으로 뻗는 1px hairline — 카드 제목(15px)보다 크다 (RR-3). 섹션 설명 문장은 두지 않습니다.

### 요약 타일 (`지표` · RR-4)

요약 탭 맨 위 첫 섹션. **지표마다 하나 · 보고서 섹션 순 · 값이 바뀌어도 순서와 수가 그대로**입니다 (결정 9):
`startup` `앱 시작` · `hwui` `프레임 수` · `frame` `시간별 프레임` · `cpu` `앱 CPU 시간` · `memory` `앱 RSS 최대` · `log` `앱 로그 줄` · `thermal` `스로틀 단계 · 종료` · `network` `수신`. 선언은 `manifest.ts` 의 `TILES`, 뷰모델은 `blocks.ts` 의 `buildTiles`.

- 그리드 `repeat(4, minmax(0,1fr))` (1440 4열 × 2줄) · ≤760 `repeat(2, …)` (2열 × 4줄 — 카드 1열 규칙의 예외). 타일 = 카드와 같은 바탕 · 테두리 · 둥글기.
- 한 장: 단어 줄(13px `--color-neutral-700`) + 배지 / 값(`--font-heading` 600 `clamp(26px,2.2vw,32px)` `--color-text` · 숫자 `nowrap` · 영문 단위 · `장` · `줄` 은 13px `--color-neutral-600`) / 경로 줄(등폭 12px `--color-neutral-600` · 구분자 뒤 `<wbr>`).
- 값은 **아래 카드의 같은 값과 같은 문자열**입니다 (startup ↔ `측정값` TotalTime · memory ↔ `앱 RSS 구성` 의 `rss.max_kb` 행 · 나머지는 같은 카드 행). `frame` 만 개수가 아니라 **수집 상태**(`metrics.frame.status` 원문)입니다.
- 값이 없으면 18px heading `--color-neutral-700` 로 `수집 안 함`(필드 없음) · `값 없음` + 코드 줄(null) · unsupported/skipped/failed 면 카드와 같은 배지 + 그 `reason_code`. partial 은 배지 없이 타일 `title`. 타일은 사라지지 않습니다.
- **값으로 색 · 굵기 · 아이콘 · 순서를 바꾸지 않습니다** · `references` 를 쓰지 않습니다 · 앱 시작 게이지 색을 타일에 올리지 않습니다 (결정 10). 타일은 블록이 아니라 레일 배지에 세지 않습니다 (결정 12).

### 카드

`.card`, `border-radius:var(--radius-lg)`, `padding:var(--space-4)`, `grid-column:span {span}`. **코너 십자 마크(`.blueprint`)는 쓰지 않습니다.**

카드 머리: 제목(`--font-heading` 600 15px) + 단위(12px `--color-neutral-600`) + 상태 배지(monospace 12px). span 이 6칸보다 넓은 카드(`.rp-span-wide`)는 ≤1180 6칸 그리드에서 한 줄을 다 씁니다.
그 아래 한 줄: **min/avg/max 요약** (12px `--color-neutral-700`) — 호버 중에는 그 초의 값으로 바뀝니다(`--color-accent-700` 600). 표본이 없는 초면 `{m:ss} · 표본 없음`.

---

## 4. 차트

### 시계열 (`series`)

viewBox `300 × 118`, 여백 `{l:46, r:8, t:10, b:26}`(`blocks.ts` 의 `SPAD`), `width:100%`. 눈금은 viewBox 12 단위 — 카드 폭만큼 커져 렌더 1440 ≈ 14.8px · 390 ≈ 13.1px. 카드가 viewBox 보다 좁은 ≈ 362px 미만 창에서는 12px 아래입니다(360 ≈ 11.9 — RR-1 측정 폭 1440 · 390 밖). 왼쪽 여백 46 이 `3,000` 을 담고, 그보다 긴 눈금(`12,000`)은 잘리지 않게 SVG 밖 카드 여백으로 흘러 나갑니다(`overflow:visible`).

- 가로 격자 3줄(min / 중간 / max) `--color-divider` 0.6px
- 좌·하 축선 `--color-neutral-400` 0.8px + x 눈금 마크
- **눈금 라벨에 단위를 붙입니다** — x `0s 10s 20s…`(간격은 `maxT` 에 따라 3/10/20/30초), y 숫자만. 별도 축 이름 라벨은 두지 않습니다.
- 선 `--color-accent` 1.6px `round`. `subField` 는 같은 축에 `--color-neutral-500` 1.1px 점선.
- 표본 없는 초: 회색 띠. 문구로 세지 않습니다.
- 계열이 `[]`(재 봤더니 0건)면 카드 본문이 `표본 없음` — `값 없음`(null) · `수집 안 함`(필드 없음)과 다른 말이고 레일 배지에 세지 않습니다 (B22).
- 호버: 전체를 덮는 투명 `rect` 의 `onMouseMove` 에서 x → 초를 역산해 공유 `hoverT` 를 갱신. 세로 커서선 + 그 초의 점.
- `baseline:'data'` 인 계열(기기 가용 메모리)만 0 기준선을 벗어납니다 — 양끝 값을 눈금에 표기합니다.

> ⚠ **SVG `<text>` 안에 템플릿 홀을 쓰면 안 됩니다.** 런타임이 홀을 `<span>` 으로 감싸서 SVG 안에서 렌더되지 않습니다(bbox 0). 프로토타입은 눈금 라벨만 `React.createElement('text', …)` 로 만들어 넘깁니다. 다른 프레임워크로 옮길 때는 해당되지 않는 제약입니다.

### 분포 (`distribution`)

viewBox `측정된 컨테이너 폭 × 190`, 여백 `{l:44, r:10, t:18, b:30}`. **가로 스크롤 없이 한눈에 들어옵니다.**

- `ResizeObserver` 로 컨테이너 폭을 재고, 폭에 맞춰 **막대 두께와 눈금 라벨 개수를 조절**합니다:
  - `slotW = (W - 54) / 버킷수`, `GAP` = slotW 9↑ 2 / 5↑ 1 / 3↑ 0.6 / 그 외 0.3, `BW = max(1, slotW - GAP)`, `rx = min(2, BW/3)`
  - 라벨 간격 `labelEvery = ceil(버킷수 / max(4, floor((W-54)/62)))` — 넓으면 촘촘히, 좁으면 드물게
  - **눈금은 칸의 시작이 아니라 끝입니다**(`5ms 15ms 25ms…`). 시작값을 쓰면 첫 칸 아래에 `0ms` 가 서는데 프레임 대부분이 그 칸에 있어 "0ms 에 끝난 프레임이 480장" 으로 읽힙니다. 데이터 쪽도 같은 규칙입니다 — 프레임워크의 `6ms=155` 는 `[5, 6)` 이고 첫 칸 `5ms` 는 `[0, 5)` 입니다. 상한 없는 칸만 `700ms+`.
- **버킷은 접지 않고 전부 보여줍니다**(101칸). 접기 로직은 남아 있지만 `breakAfterEmptyBuckets: Infinity` 로 꺼져 있습니다.
- 눈금 12px (1배). viewBox 폭은 최소 360 이라 그보다 좁은 카드(창 ≈ 422px 미만)에서는 줄어 그려지므로 그 폭에서만 14 단위 — 390 에서 렌더 ≈ 12.7px · 375 ≈ 12.1px (360 ≈ 11.5 — 측정 폭 밖).
- 세로축: 0 부터 최대 count 까지 `niceMax(max/4)` 간격 눈금 + 격자
- 백분위: `percentiles` 의 p50/p90/p95/p99 를 큰 숫자로 위에 표기하고, 차트에는 **점선만** 얹습니다(라벨은 겹쳐서 뺐습니다). x 위치는 그 값을 포함하는 버킷의 슬롯입니다.
- 그 줄 오른쪽 끝에 `share` 타일 하나(`JANK 10.1%`)를 세로선(`.rp-pct-sep`)으로 갈라 세웁니다. **백분위와 같은 지표에서 옵니다** — 출처가 갈리면 옆에 선 숫자끼리 모집단이 달라집니다. 분자·분모를 못 읽으면 타일이 아예 서지 않습니다.
- **호버는 슬롯 전체 높이의 투명 히트 영역**입니다 — 막대가 아닙니다. 얇은 막대·빈 구간도 잡히고 슬롯이 맞닿아 있어 틈이 없습니다(마우스를 움직여도 깜빡이지 않음). 같은 슬롯 안에서는 6px 이상 움직이지 않으면 상태를 갱신하지 않습니다.
- 짚은 슬롯은 `--color-accent` opacity .14 배경으로 표시.
- 툴팁: `position:fixed`, 마우스 +14px, `border:1px solid var(--color-text)`, `--shadow-md`, `border-radius:var(--radius-md)`. 내용 = **구간 / 프레임 수 / 전체의 N%**.
  **누적 비율을 보여주지 않습니다** — 버킷은 시간축이 아니라 지속 시간 구간이라 "0에서 끝으로 누적된다" 는 인상을 주면 안 됩니다.
- 각주: 단어 한 줄 `{total_frames} 프레임 · 버킷 {칸 수}칸` (프레임 수를 못 읽으면 `버킷 {칸 수}칸` 만) — 실제로 접혔으면 뒤에 `· 빈 버킷 N칸 접음`. 카드 위 읽는 법 문장(`막대가 왼쪽에 몰릴수록 …`)은 지웠습니다 (RR-5 · 결정 3 — 평가 낱말). 지표의 성질은 `README.md` 가 정본입니다.
- 히스토그램이 `[]` 면 `프레임 없음` (B22 · 배지에 안 셈).

### 시간별 프레임 (`frametimeline`)

- 각주: 단어 한 줄 `막대 = 프레임 · 아래 칸 앱 · 위 칸 표시 · 가로 = 트레이스 시작 뒤 시각` (읽는 법 두 문장 자리 · RR-5) + 표본을 뽑았으면 그 고지 한 줄.
- 표본이 `[]` 면 `프레임 없음` (B22 · 배지에 안 셈) · 표본 칸이 배열이 아니면 `값 없음`.

### bars

글자 13px · 비율 12px `--color-neutral-600`. 배열이 `[]` 면 `항목 없음` (B22 · 배지에 안 셈). `grid-template-columns:64px minmax(0,1fr) 66px`. 트랙 8px `--color-neutral-200` `border-radius:99px`, 채움 `--color-accent` opacity .7. 값은 우측 정렬 `tabular-nums`.

### delta

5열 표(13px): 라벨 / before(`--color-neutral-700`) / `→`(`--color-neutral-600`) / after / **차이**(`--color-neutral-600`). 행마다 hairline.

- 차이의 단위는 before·after 와 **같은 포맷터**가 붙입니다 — 퍼센트면 `%`, 온도면 `°C`, kB 필드면 MB. 오른 값에만 `+` 를 붙입니다(음수 부호는 포맷터가 이미 붙임).
- 적을 차이가 없으면 `-` 입니다 — 안 변했거나(0), 뺄 수 없거나(`wifi` · `예`), 한쪽을 못 읽었거나(측정 중인 세션의 `state_after`). 셋을 한 글자로 합쳐도 **왼쪽 두 칸이 이미 셋을 가릅니다**(`37.1°C → 37.1°C` 대 `100% → 값 없음`). 칸을 비워 두지는 않습니다.
- **증감에 색을 쓰지 않습니다.** 온도가 내려간 것이 "좋다" 가 되면 규칙 2 를 깬 것입니다.
- 배열형(온도 존)이 `[]` 면 `항목 없음` — 재 봤더니 0개라 레일 배지에 세지 않습니다 (plan B37). `null` 은 `값 없음`, 필드가 없으면 `수집 안 함`.

### pairs

`arrayAs:'freq'`(클러스터 주파수)가 `[]` 면 `항목 없음` (B37 · 배지에 안 셈).

3열 표(라벨 / 값 / 비율). 기계 이름 포맷(`wrap` · `path` · `list` · `dots`)의 값과 라벨은 구분자(`/ : $ . ; , _`) **뒤에** `<wbr>` 를 두고 `overflow-wrap:break-word` 로 줄바꿈합니다 — 토막이 칸보다 넓을 때만 토막 안에서 끊습니다. `anywhere` · `break-all` · ellipsis 는 쓰지 않습니다 (RR-7). 숫자 칸에는 `<wbr>` 가 없습니다(`1,234` 가 쉼표에서 끊기지 않게). 비율은 `pct` 가 선언된 키에만 붙고, **값과 따로 낸 칸**입니다 — 한 문자열로 붙이면 개수와 비율이 눈에서 섞입니다.

**라벨은 옮겨 적지 않습니다.** `dumpsys gfxinfo` 의 `Slow issue draw commands` 를 "그리기 명령" 으로 쓰면 원문에서 grep 되지 않습니다 — 기기가 영어로 준 이름은 **그 이름 그대로 한 줄**입니다. 우리 필드는 **우리말 단어 한 줄 + 경로 원문 한 줄**입니다 (RR-6 · 결정 2): `.rp-lbl` 13px `--color-neutral-700` 위, `.rp-lbl-path` 등폭 12px `--color-neutral-600` 아래. 경로 줄은 지금 라벨 글자 그대로라(`versionCode` · `app.total`) ⌘F · grep 이 `result.json` 에 닿습니다. 단어의 정본은 `docs/design/report-readability.md` `## 문구` 의 라벨 단어 표입니다.

### pairs — 진단 탭

- 진단 블록의 `status` 는 네 카드 모두에 같은 규칙으로 닿습니다 — `unsupported` · `skipped` · `failed` 면 카드 배지, `reason` 문장은 카드 제목(과 배지)의 `title`. `partial` 은 배지 없이 제목 `title` 만, `collected` 는 아무것도 없습니다 (④ 관례를 진단 블록까지 넓힘).
- `app_slices_open` 은 블록 `status` 와 따로 갑니다. `null` 이면 그 행만 `값 없음` + `app_slices_open_reason_code`(`.rp-none-code`), 문장은 행 `title`. 값이 있으면 코드도 `title` 도 없습니다.
- 그 밖의 `null` 칸은 `값 없음` 만 냅니다. 코드는 열림 행과 표 자리에만 붙습니다.
- `측정 비용` 카드(요약 탭 · 맥락)는 진단 세션에만 단위 칸에 `앱 프로세스 몫 미포함` 을 둡니다.

### slice 표 (`slicetable`)

진단 블록의 `target_process_slice_names` — 행 = 접은 이름 하나, 열 = 갈래 셋(`메인 스레드` · `그 밖 스레드` · `비동기 트랙`) × (`횟수` · `합 ms` · `최대 ms`). **판정하지 않는 표**입니다.

- **행을 자르지 않고 다 그립니다** (1만 행도 — 창 안 행만 그리지 않습니다. 브라우저 찾기가 상자 밖 이름도 찾습니다). 이름은 자르지 않고 구분자 뒤 `<wbr>` + `overflow-wrap:break-word` 로 줄바꿈합니다 (RR-7 · ellipsis · 툴팁 대체 없음 · 복사하면 원문). 이름 열은 등폭 13px `--color-neutral-800`.
- **처음 순서는 이름의 UTF-16 코드 단위 순**입니다(`a < b` — `Z` 가 `a` 보다 앞). 순위 · 상위 N · 강조 · 줄무늬 · 행별 색 · 굵기 · 아이콘이 없습니다.
- 카드 단위는 `대상 앱 프로세스 · {n}행` — 프레임워크와 앱 slice 를 가르지 않습니다. 표가 `null` 이면 카드 본문이 `값 없음` + 블록 `reason_code`, `[]` 이면 머리만 있는 `0행` 표입니다.
- 빈 칸은 `—`(`--color-neutral-600`) — 그 갈래에 그 이름의 slice 가 없거나 끝난 slice 가 없어 합 · 최대가 없습니다. `0` 으로 채우지 않습니다. 숫자는 `tabular-nums` 오른쪽 정렬, 횟수 정수 · 합/최대 소수 한 자리.
- **상자**: `max-height:min(70vh,640px); overflow:auto`. 머리 두 줄이 위에(`position:sticky`, 둘째 줄 `top:27px` — 첫 줄 높이를 `line-height:18px` 로 고정), 이름 열이 왼쪽에 붙습니다(`left:0`, 넓을 때 38% · ≤760 에서 140px 고정 + 표 `width:max-content`). 붙은 칸마다 `--color-surface` 바탕. 갈래 사이 · 이름 열 오른쪽에 `--color-divider` 세로선. **페이지는 옆으로 밀리지 않습니다** — 390 에서 열 열 개가 넘치는 것은 상자 안 가로 스크롤입니다.
- **정렬**: 머리는 `<th aria-sort><button>` 10개(이름 + 9). 누름 · Enter · Space 로 그 열 정렬 — 숫자 열 첫 누름 내림 · 다시 오름 · `이름` 첫 누름 오름. 빈 칸은 방향과 무관하게 끝, 같은 값은 이름 코드 단위 오름. 정렬된 열에만 `▲`/`▼` 와 `aria-sort` 방향, 나머지 `none`. 정렬하면 상자 `scrollTop = 0`(새 순서의 첫 행부터) — 가로 위치 · 페이지 스크롤 · 포커스는 그대로. 포커스 링은 `:focus-visible` 액센트 2px 를 **안쪽**(`outline-offset:-2px`)에 — 상자 위 끝에 붙은 머리라 바깥 링은 잘립니다. 정렬 상태는 저장하지 않습니다.
- 카드에 읽는 법(합 ms 를 행끼리 더하지 말 것 등)을 쓰지 않습니다 — 스키마 설명과 README 몫입니다.

### stat

앱 시작 카드 하나. 제목 / 게이지 / 아래 줄 — **큰 숫자가 없습니다** (결정 10 — 숫자는 요약 타일과 `측정값` 카드의 TotalTime 행). 값이 없으면 `값 없음` · `수집 안 함` 을 본문 크기(`.rp-none` 13px)로 내고 **왜인지를 같이 냅니다** — 카드에는 코드만(`.rp-none-code`, 등폭), 문장은 `title` 툴팁으로. 이 글자를 레일 배지가 셉니다. **값이 있을 때는 코드를 붙이지 않습니다**: `partial` 지표의 사유가 멀쩡한 값 밑에 서면 그 값까지 의심하게 됩니다.

---

## 5. Design Tokens

`PerfTracker GUI.dc.html` 과 **동일한 값**을 씁니다. 두 화면이 같은 제품이라 토큰이 갈라지면 바로 눈에 띕니다.

```css
--color-bg:#1d1f20;  --color-surface:#26282a;  --color-text:#eef0f2;
--color-accent:#749dc4;
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

- 타이포: `--font-heading` = Barlow Condensed (600), `--font-body` = Barlow (400/500/600), monospace = `ui-monospace, Menlo, monospace` — serial·패키지·경로·시간·눈금 등 기계값 전용.
- **`tabular-nums` 필수** (`.num { font-variant-numeric: tabular-nums; font-feature-settings:"tnum" }`).
- 카드 16px, 입력 10px, 칩·배지·버튼 pill, 막대 트랙 pill, 분포 막대 상단 `rx≤2`.
- 간격은 `--space-*` (1/2/3/4/6/8 — **`--space-5` 는 없습니다**, 쓰면 `padding` 선언이 통째로 죽습니다).
- 포커스: `:focus-visible { outline:2px solid var(--color-accent); outline-offset:2px }`
- 애니메이션은 스피너 회전 하나뿐입니다.

### 글자 바닥 (report-readability RR-1 · RR-2 · RR-3)

토큰 값은 측정 화면과 같고 고치지 않습니다 — 보고서 CSS 가 **글자에 쓰는 토큰만** 고릅니다. 모든 글자 12px 이상 ·
표 · 카드 본문 13px 이상 · 층은 섹션 제목 18 > 카드 제목 15 > 본문 13. 글자 색은 `--color-neutral-600` 이상
(bg 6.13 · surface 5.48 · neutral-200 4.84) — `--color-neutral-500` 이하는 그림(띠 · 보조선 · 참고선)에만, 계열색
(`--color-alt-*`)은 막대에만. 키/값 표의 라벨 열은 45% 를 잡고 라벨 · 값 모두 구분자 뒤 `<wbr>` + `overflow-wrap:break-word` 로 줄바꿈합니다 (RR-7). 요약 타일 값은 섹션 제목보다 큽니다 (26–32 > 18).
아래 표는 `packages/gui/test/report-css.test.ts` 가 `report.css` 와 대조합니다 (`—` = 그 규칙이 정하지 않음).

| 층 | 선택자 | 크기 | 글자 색 |
| --- | --- | --- | --- |
| 섹션 제목 | `.rp-section-head` | 18px | `--color-neutral-800` |
| 카드 제목 | `.rp-card-title` | 15px | — |
| 본문 · 표 | `.rp-table` | 13px | — |
| 표 라벨 | `.rp-table th` | — | `--color-neutral-700` |
| 표 값 | `.rp-table td` | — | `--color-neutral-800` |
| slice 이름 | `.rp-slice .rp-slice-name` | 13px | `--color-neutral-800` |
| 값 없음 | `.rp-none` | 13px | `--color-neutral-700` |
| 머리 메타 값 | `.rp-meta` | 13px | `--color-neutral-700` |
| 머리 메타 라벨 | `.rp-meta-item i` | 12px | `--color-neutral-600` |
| 카드 단위 | `.rp-card-unit` | 12px | `--color-neutral-600` |
| 상태 배지 | `.rp-badge` | 12px | `--color-neutral-800` |
| 탭 배지 | `.rp-tab-count` | 12px | `--color-neutral-800` |
| 코드 | `.rp-none-code` | 12px | `--color-neutral-600` |
| 각주 | `.rp-footnote` | 12px | `--color-neutral-600` |
| 푸터 | `.rp-footer` | 12px | `--color-neutral-600` |
| 눈금 | `.rp-tick` | 12px | — |
| 시계열 눈금 (viewBox 단위) | `.rp-series .rp-tick` | 12px | — |
| 타일 값 | `.rp-tile-value` | clamp(26px, 2.2vw, 32px) | `--color-text` |
| 타일 값 없음 | `.rp-tile-none` | 18px | `--color-neutral-700` |
| 타일 단어 줄 | `.rp-tile-word` | 13px | `--color-neutral-700` |
| 타일 경로 줄 | `.rp-tile-path` | 12px | `--color-neutral-600` |
| 라벨 단어 줄 | `.rp-lbl` | 13px | `--color-neutral-700` |
| 라벨 경로 줄 | `.rp-lbl-path` | 12px | `--color-neutral-600` |

## 6. 진입점

- 기록 목록에서 항목 클릭 → **새 창**. 화면 안에 "목록으로" 링크는 없습니다.
- **딥링크가 되어야 합니다** — URL 에 run id.
- 측정 중(`session.state === 'running'`) 기록도 열릴 수 있습니다.

## 7. 상태

```
{ data, error, tab: 'summary'|'device'|'diagnose', hoverT, tip, hoverBucket, distW }
slice 표 안: { sort: { key: 'name' | '<갈래>.<수>', dir: 'asc'|'desc' } }   // 처음 { name, asc } · 저장 안 함
```

`tab` 의 `diagnose` 는 진단 세션 문서에서만 고를 수 있습니다. slice 표 뷰모델은 **문서가 바뀔 때만** 만듭니다 — 다른 블록은 호버마다 다시 만들지만 1만 행 표를 그 박자로 다시 포맷하면 요약 탭 호버가 끕니다.

`hoverT` 는 **화면 전체가 공유**합니다 — 시계열 호버와 표식 칩 호버가 같은 값을 씁니다.

## Files

- `Session Report.dc.html` — 화면 전체(단일 파일). 상단 `<style>` 토큰, 그 아래 마크업, 하단 `<script>` 에 매니페스트 + 렌더 로직
- `samples/full.json` `samples/low-end.json` `samples/legacy.json` — 실기기 실측 표본 3개. **셋 다 오류 없이 렌더되어야 합니다.** `low-end.json` 부터 맞추는 것이 빠릅니다
- `samples/schema.json` — `perftracker schema` 출력. 필드마다 뜻과 함정(특히 `null` 과 `0` 의 차이)
- `screenshots/` — 위 표의 렌더 화면
- `_ds/` — Industry 디자인 시스템 (`styles.css`, `_ds_bundle.js`, `readme.md`)

| 표본 | 무엇을 시험하나 |
| --- | --- |
| `full.json` | 7지표가 다 나온 세션. 릴리스 빌드. 4개 지표가 `partial`(`process_name_stale_in_trace`) |
| `low-end.json` | sdk 30. `frame`·`network` 가 통째로 `unsupported`, `cpu.data.app === null`, `log` 는 `no_log_entries`(재 봤더니 0건 — 모르는 것과 다름), 주사율 `null`, `debuggable: true` |
| `legacy.json` | 새 필드가 통째로 없는 옛 세션 (`target_app.debuggable`, `display.orientation` 등) |
