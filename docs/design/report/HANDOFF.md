# Handoff: PerfTracker 세션 데이터 화면 (보고서)

## Overview

`PerfTracker` CLI 가 세션마다 내는 `result.json` **하나**를 그대로 읽어 보여주는 화면입니다. 기록 목록에서 항목을 누르면 **새 창**으로 열립니다.

**판정하지 않는 화면입니다.** 값을 읽고 판단하는 것은 사람이 합니다. 임계선·점수·등급·좋고나쁨 색이 없습니다.

핵심 설계는 **팩토리**입니다 — 지표마다 컴포넌트를 만들지 않습니다. 데이터 모양은 6가지뿐이고(`distribution` `series` `bars` `delta` `pairs` `stat`), 각 지표가 매니페스트에서 자기 모양과 데이터 위치를 선언하고 렌더러는 모양만 압니다. 지표가 늘면 **매니페스트에 한 줄**, 새 모양이 나올 때만 `kind` 를 하나 늘립니다.

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

## 2. 블록 6종

| kind | 데이터 모양 | 쓰이는 곳 |
| --- | --- | --- |
| `distribution` | `[{from_ms, to_ms\|null, count}]` + 백분위 | 프레임 지속 시간 **(이 화면의 유일한 막대)** |
| `series` | `[{t_s, <값 필드>}]` | 앱/기기 CPU · 앱 RSS · 기기 가용 메모리 · 로그 **(전부 선)** |
| `bars` | `[{label, value}]` | 코어별 사용률, 클러스터 최대 주파수 |
| `delta` | 배열 `[{label, before, after}]` 또는 두 객체 경로 + 키 목록 | 온도 존, 기기 상태 전/후 |
| `pairs` | `[{key, value}]` | 기기·앱 정보, min/avg/max 요약, 오버헤드 |
| `stat` | 단일 값 + 부가 문장 | 상단 요약 타일 |

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
- **distribution** — `percentilesPath`, `share`(백분위 옆에 세울 비율 하나: `{label, countPath, totalPath}`), `breakAfterEmptyBuckets`(현재 `Infinity` — **버킷은 전부 보여준다**)
- **bars** — `labelField`(배열이면 `CPU 0–3` 처럼 범위로), `labelPrefix`, `valueField`, `fmt`, `scaleMax`(`null` 이면 데이터 최댓값)
- **delta** — 배열형: `labelField` `beforeField` `afterField` `fmt` / 객체형: `beforePath` `afterPath` `keys[]`
- **pairs** — `keys: [{p, l, f}]` (`p` 는 블록 `path` 기준 상대 경로, 점 표기 가능) 또는 `arrayAs: 'freq'` 같은 특수 변환
- **stat** — `fmt`, `unit`, `sub: [{l, p, f}]`

### 포맷터

`int` `ms0` `ms2` `pct0` `pct1` `pct2` `c1` `hz` `mb0` `mb1` `gb1` `ghz2` `bytes` `bool` `list` `mbTriple`(`{min_kb,avg_kb,max_kb}` → `52 / 315 / 352 MB`) `wrap`(줄바꿈 허용) `raw` `n0` `n1`(순수 숫자 — 변환된 계열용).

---

## 3. 화면 구조

```
┌──────────┬────────────────────────────────────────────────┐
│ 좌측 레일 │ 헤더: 세션 id · 이름 · 상태                     │
│  212px   │   앱 / 기기 / 시작 / 길이 / 옵션                │
│          │ 플래그 줄                                      │
│ PERF...  │ 표식 줄 (session.marks)                        │
│ 세션데이터│ ─────────────────────────────────────────────  │
│          │ 섹션들 (12칸 그리드)                           │
│ [요약]   │                                                │
│  기기    │                                                │
│          │ 푸터: 도구 · 호스트 · schema_version            │
└──────────┴────────────────────────────────────────────────┘
```

- 셸: `display:grid; grid-template-columns:212px minmax(0,1fr); min-height:100vh`
- 레일: `position:sticky; top:0; height:100vh; border-right:1px solid var(--color-divider); padding:var(--space-6) 0`

### 탭 2개

레일에 **요약 / 기기** 두 개만 둡니다. 섹션 목차나 스크롤 스파이는 없습니다.

- 탭 버튼: `padding:8px var(--space-4)`, 13.5px, `border-radius:0 99px 99px 0`, 선택 시 `border-left:2px solid var(--color-accent)` + `background:var(--color-accent-100)` + `color:var(--color-accent-800)`
- 미수집 블록이 있는 탭에는 개수 배지(monospace 9.5px, `--color-neutral-200`)
- **요약** 탭 = `summary` `render` `cpu` `memory` `log` `context` 섹션
- **기기** 탭 = `device` 섹션
- 탭 전환 시 `window.scrollTo(0, 0)`

### 헤더

- 세션 id: monospace 11px, `letter-spacing:.14em`, uppercase, `--color-accent-700`
- 이름: `--font-heading` 600, `clamp(26px,3.4vw,34px)`
- 상태 pill: monospace 10px uppercase, `padding:3px 10px; border-radius:99px`. `running` 이면 `background:var(--color-accent); color:var(--color-bg)`, 그 외 `--color-neutral-200`
- 메타 줄(12.5px, `--color-neutral-700`, wrap): 앱 `{label} · {package} · {version_name}` / 기기 `{model} · {serial} · Android {release} (sdk {sdk_int})` / 시작 `YYYY-MM-DD HH:MM:SS` / 길이 `{duration_ms} ms` 또는 `측정 중` / 옵션 `--launch` 또는 `attach`

### 플래그 줄

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
`표식` 라벨(monospace 10px uppercase) + 칩들. 칩은 `border:1px dashed`, `border-radius:99px`, `padding:3px 10px`, 내용 `{m:ss} {label}`.

**칩에 마우스를 올리면 그 초가 모든 시계열로 전파됩니다**(공유 `hoverT`). 시계열마다 그 초에 점선 세로선이 얹히고, 짚은 표식의 선만 진해집니다.

### 섹션

`display:grid; grid-template-columns:repeat(12,minmax(0,1fr)); gap:var(--space-3)`.
섹션 제목: monospace 10.5px uppercase `letter-spacing:.16em` `--color-neutral-600` + 오른쪽으로 뻗는 1px hairline. 섹션 설명 문장은 두지 않습니다.

### 카드

`.card`, `border-radius:var(--radius-lg)`, `padding:var(--space-4)`, `grid-column:span {span}`. **코너 십자 마크(`.blueprint`)는 쓰지 않습니다.**

카드 머리: 제목(`--font-heading` 600 15px) + 단위(11px `--color-neutral-500`) + 상태 배지.
그 아래 한 줄: **min/avg/max 요약** (11.5px `--color-neutral-600`) — 호버 중에는 그 초의 값으로 바뀝니다(`--color-accent-700` 600). 표본이 없는 초면 `{m:ss} · 표본 없음`.

---

## 4. 차트

### 시계열 (`series`)

viewBox `300 × 138`, 여백 `{l:40, r:10, t:12, b:30}`, `width:100%`.

- 가로 격자 3줄(min / 중간 / max) `--color-divider` 0.6px
- 좌·하 축선 `--color-neutral-400` 0.8px + x 눈금 마크
- **눈금 라벨에 단위를 붙입니다** — x `0s 10s 20s…`(간격은 `maxT` 에 따라 3/10/20/30초), y 숫자만. 별도 축 이름 라벨은 두지 않습니다.
- 선 `--color-accent` 1.6px `round`. `subField` 는 같은 축에 `--color-neutral-500` 1.1px 점선.
- 표본 없는 초: 회색 띠. 문구로 세지 않습니다.
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
- 세로축: 0 부터 최대 count 까지 `niceMax(max/4)` 간격 눈금 + 격자
- 백분위: `percentiles` 의 p50/p90/p95/p99 를 큰 숫자로 위에 표기하고, 차트에는 **점선만** 얹습니다(라벨은 겹쳐서 뺐습니다). x 위치는 그 값을 포함하는 버킷의 슬롯입니다.
- 그 줄 오른쪽 끝에 `share` 타일 하나(`JANK 10.1%`)를 세로선(`.rp-pct-sep`)으로 갈라 세웁니다. **백분위와 같은 지표에서 옵니다** — 출처가 갈리면 옆에 선 숫자끼리 모집단이 달라집니다. 분자·분모를 못 읽으면 타일이 아예 서지 않습니다.
- **호버는 슬롯 전체 높이의 투명 히트 영역**입니다 — 막대가 아닙니다. 얇은 막대·빈 구간도 잡히고 슬롯이 맞닿아 있어 틈이 없습니다(마우스를 움직여도 깜빡이지 않음). 같은 슬롯 안에서는 6px 이상 움직이지 않으면 상태를 갱신하지 않습니다.
- 짚은 슬롯은 `--color-accent` opacity .14 배경으로 표시.
- 툴팁: `position:fixed`, 마우스 +14px, `border:1px solid var(--color-text)`, `--shadow-md`, `border-radius:var(--radius-md)`. 내용 = **구간 / 프레임 수 / 전체의 N%**.
  **누적 비율을 보여주지 않습니다** — 버킷은 시간축이 아니라 지속 시간 구간이라 "0에서 끝으로 누적된다" 는 인상을 주면 안 됩니다.
- 각주: **없습니다.** `빈 버킷 N칸 접음` 만 실제로 접혔을 때 나옵니다(지금은 안 접으므로 늘 빈 문자열). 카드에 읽는 법을 설명하지 않습니다 — 카드마다 한 줄씩 붙으면 화면이 글이 됩니다. 지표의 성질은 `README.md` 가 정본입니다.

### bars

`grid-template-columns:64px minmax(0,1fr) 66px`. 트랙 8px `--color-neutral-200` `border-radius:99px`, 채움 `--color-accent` opacity .7. 값은 우측 정렬 `tabular-nums`.

### delta

5열 표: 라벨 / before(`--color-neutral-700`) / `→` / after / **차이**. 행마다 hairline.

- 차이의 단위는 before·after 와 **같은 포맷터**가 붙입니다 — 퍼센트면 `%`, 온도면 `°C`, kB 필드면 MB. 오른 값에만 `+` 를 붙입니다(음수 부호는 포맷터가 이미 붙임).
- 적을 차이가 없으면 `-` 입니다 — 안 변했거나(0), 뺄 수 없거나(`wifi` · `예`), 한쪽을 못 읽었거나(측정 중인 세션의 `state_after`). 셋을 한 글자로 합쳐도 **왼쪽 두 칸이 이미 셋을 가릅니다**(`37.1°C → 37.1°C` 대 `100% → 값 없음`). 칸을 비워 두지는 않습니다.
- **증감에 색을 쓰지 않습니다.** 온도가 내려간 것이 "좋다" 가 되면 규칙 2 를 깬 것입니다.

### pairs

3열 표(라벨 / 값 / 비율). `f:'wrap'` 인 값만 `word-break:break-all`. 비율은 `pct` 가 선언된 키에만 붙고, **값과 따로 낸 칸**입니다 — 한 문자열로 붙이면 개수와 비율이 눈에서 섞입니다.

**라벨은 옮겨 적지 않습니다.** `dumpsys gfxinfo` 의 `Slow issue draw commands` 를 "그리기 명령" 으로 쓰면 원문에서 grep 되지 않고, 우리 스키마 필드를 "앱 warn" 으로 쓰면 `result.json` 에서 찾을 수 없습니다. 기기가 영어로 준 이름은 **그 이름 그대로**, 우리 필드는 **경로 그대로**(`logcat 줄 수` 카드) 싣습니다. 우리말은 카드 제목에만 씁니다.

### stat

값 / (값이 없으면) `reason_code` / 부가 문장. 큼직한 `값 없음` 만 있으면 도구가 고장 난 것으로 읽히므로 **왜인지를 같이 냅니다** — 카드에는 코드만(`.rp-stat-why`, 등폭), 문장은 `title` 툴팁으로. **값이 있을 때는 붙이지 않습니다**: `partial` 지표의 사유가 멀쩡한 숫자 밑에 서면 그 숫자까지 의심하게 됩니다.

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

## 6. 진입점

- 기록 목록에서 항목 클릭 → **새 창**. 화면 안에 "목록으로" 링크는 없습니다.
- **딥링크가 되어야 합니다** — URL 에 run id.
- 측정 중(`session.state === 'running'`) 기록도 열릴 수 있습니다.

## 7. 상태

```
{ data, error, tab: 'summary'|'device', hoverT, tip, hoverBucket, distW }
```

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
