# 세션 보고서 — 데이터 계약

이 문서는 **화면이 무엇을 그리는가** 가 아니라 **무엇이 들어오는가** 를 정한다.
디자인은 자유롭게 정하되, 아래 계약을 깨면 화면이 거짓말을 한다.

## 1. 입력은 `result.json` 하나다

보고서의 입력은 이 저장소가 세션마다 내는 `result.json` **그대로**다.
GUI 전용 뷰 타입을 새로 만들지 않는다 — 이 파일은 이미 버전(`schema_version`)이 붙은 공개
계약이고, 옆에 두 번째 계약을 두면 둘이 조용히 어긋난다.

- 스키마: `samples/schema.json` (`perftracker schema` 출력, JSON Schema)
- **표본 3개. 전부 실기기 실측이고, 셋 다 오류 없이 렌더되어야 한다.**

| 파일 | 기기 | 무엇을 시험하나 |
| --- | --- | --- |
| `full.json` | SM-F936N · sdk 36 | 7개 지표가 다 나온 정상 세션. 릴리스 빌드 |
| `legacy.json` | SM-F936N · sdk 36 | 필드가 늘기 **전**에 뜬 세션. `target_app.debuggable` · `display.orientation` 등 **새 필드가 통째로 없다** |
| `low-end.json` | SM-A405S · **sdk 30** | **기기가 원래 못 재는 것들.** 아래 참고 |

`low-end.json` 이 이 셋 중 가장 중요하다. 실제로 이런 상태다:

```
frame     unsupported  sdk_too_low            ← 지표 하나가 통째로 없다 (sdk 31 필요)
network   unsupported  sdk_too_low            ← 마찬가지 (sdk 34 필요)
startup   partial      launch_wait_timed_out
cpu       partial      no_app_cpu_samples     ← app 은 null 인데 device_timeline 은 49점 있다
memory    partial      process_name_stale_in_trace
log       partial      no_log_entries         ← 재 봤더니 0건 (모르는 것이 아니다)
thermal   collected

display.active_refresh_rate_hz = null         ← 이 기기에서 못 읽음
target_app.debuggable = true                  ← 디버그 빌드를 잰 세션
warnings = [charging_during_session, launcher_activity_ambiguous, app_launch_time_unmeasured]
```

**`cpu` 를 보라.** 기기 쪽 값은 멀쩡한데 앱 쪽만 `null` 이다 — 지표 하나 안에서 반쪽만
못 잰 상태다. "앱 CPU 0%" 로 그리면 그 화면은 거짓말이다.

## 2. 블록 여섯 종류로 전부 그린다

`result.json` 안의 데이터 모양은 실제로 여섯 가지뿐이다. 지표마다 컴포넌트를 만들지 말고,
**지표가 자기 모양과 데이터 위치를 선언**하고 렌더러는 모양만 안다.

| kind | 데이터 모양 | 쓰이는 곳 |
| --- | --- | --- |
| `distribution` | `[{from_ms, to_ms\|null, count}]` + 백분위 | 프레임 지속 시간 **(유일한 막대)** |
| `series` | `[{t_s, <값 필드>}]` | 앱/기기 CPU · 앱/기기 메모리 · 로그 **(전부 선)** |
| `bars` | `[{label, value}]` | 코어별 사용률 |
| `delta` | `[{label, before, after}]` | 온도 존, 세션 전/후 기기 상태 |
| `pairs` | `[{key, value}]` | 기기·앱 정보, min/avg/max 요약 |
| `stat` | 단일 값 + 부가 문장 | 상단 요약 타일 |

새 지표가 생기면 **매니페스트에 한 줄**이 늘 뿐, 새 컴포넌트를 쓰지 않는다.
그렇게 안 되는 모양이 나오면 그때 kind 를 하나 늘린다 — 지표마다가 아니라 **모양마다**.

## 3. 매니페스트

블록 하나의 선언:

```ts
{
  kind: 'series',
  title: '앱 CPU',
  unit: '%',
  section: 'cpu',
  path: 'metrics.cpu.data.app.timeline',   // 여기에 데이터가 있다
  field: 'app_cpu_ms',                     // 그 안의 어느 값인가
  transform: (v) => v / 10,                // ms/초 → % (1코어=100%)
}
```

**`path` 를 반드시 선언으로 둔다. 규칙으로 유추하지 말 것.** 같은 `timeline` 이라도 위치가 다르다:

```
metrics.frame.data.timeline        ← frame  은 data 바로 아래
metrics.memory.data.timeline       ← memory 도
metrics.cpu.data.app.timeline      ← cpu 는 app 아래   ★
metrics.log.data.app.timeline      ← log 도 app 아래   ★
metrics.cpu.data.device_timeline   ← 기기 쪽은 또 다르다
metrics.memory.data.system_timeline
```

"`data.timeline` 을 보면 된다" 는 규칙을 만들면 cpu 와 log 가 조용히 빈다.

## 4. 깨면 안 되는 규칙

### ① `null` 은 `0` 이 아니다

이 저장소 전체를 관통하는 규칙이고 화면에서 가장 어기기 쉽다.

- **선을 잇지 말 것.** 값이 없는 초에서 선이 이어지면 재지 않은 구간에 직선이 그어지고,
  그 직선은 데이터처럼 보인다. **끊고, 끊긴 자리를 남긴다.**
- 누적 카운터(`cpu.data.app.timeline`, `cpu.data.device_timeline`)는 **첫 초가 배열에 없다.**
  앞에 뺄 표본이 없기 때문이다. 0 으로 채우면 "그 초에 안 썼다" 는 없던 사실이 된다.
- 순간값(`memory.data.system_timeline`)은 첫 초도 있다. 둘의 차이를 화면이 뭉개면 안 된다.
- `target_app.debuggable` 이 `false` 면 "릴리스임을 확인했다", `null` 이면 "모른다" 이다.
  둘을 같은 회색으로 그리면 안 된다.

### ② 판정하지 않는다

**"느리다 / 좋다 / 위험" 을 내지 않는다.** 이 도구의 존재 이유다.

- 빨강·초록으로 좋고 나쁨을 칠하지 말 것. 색은 **계열 구분**에만 쓴다.
- 임계선·점수·등급·화살표(↑개선/↓악화) 없음.
- `references` 배열에 구글 공개 기준치가 들어 있다. **비교에 쓰지 않는다.**
  출처와 함께 "이런 기준치가 있다" 고 **기록만** 하는 자리다 (별도 블록으로 두거나 생략).
- 예외 하나: `target_app.debuggable === true` 는 강조해도 된다. 판정이 아니라
  "이 세션은 릴리스 빌드를 잰 것이 아니다" 라는 **측정 조건의 사실**이다.

### ③ 못 잰 것을 숨기지 않는다

- 지표마다 `status` 가 `collected` / `partial` / `skipped` / `failed` 중 하나다.
  `partial` 과 `skipped` 는 **화면에 보여야 한다.** 값만 예쁘게 그리고 상태를 숨기면
  소비자는 반쪽 데이터를 온전한 것으로 읽는다.
- `reason_code` 와 `reason`(사람이 읽는 문장)이 왜인지 말한다. 접어 두더라도 닿을 수 있게.
- 필드가 아예 없으면 블록을 **사라지게 하지 말고** "수집 안 함" 으로 남긴다.
  없어진 블록은 "이 도구가 원래 안 재는 것" 처럼 보인다.
- `warnings[]` 는 측정 조건에 대한 관측이다 (예: `charging_during_session`). 평가가 아니다.

### ④ 단위는 필드 이름이 말한다

`_kb` · `_ms` · `_pct` · `_hz` · `_c`(섭씨) · `_bytes`. **추측하지 말 것.**
`mem_available_kb` 를 MB 로 보여주는 것은 좋지만, 그 변환은 매니페스트에 명시한다.

### ⑤ 시간축은 하나다

모든 `t_s` 는 **같은 0초**(트레이스 시작)를 쓴다. `session.marks[].offset_ms / 1000` 도 같은 축이다.
그래서 여러 그래프를 겹치거나 나란히 놓고 같은 순간을 짚을 수 있다 — 이것이 이 데이터의
설계 의도이므로 화면이 축을 지표마다 다르게 잡으면 안 된다.

## 5. 확장

- `metrics` 는 **catchall** 이다. 알려진 7개(`frame` `startup` `cpu` `memory` `log` `thermal`
  `network`) 외의 키가 올 수 있다. 매니페스트에 없는 지표는 무시하되, **몇 개를 무시했는지는
  화면 어딘가에 남긴다** — 조용히 버리면 새 지표가 추가돼도 아무도 모른다.
- `schema_version` 은 semver 다. major 가 다르면 화면이 그 사실을 먼저 말해야 한다.
- 아직 없지만 논의된 것: 로그 원문 목록, 프로세스별 로그 분해, 네트워크 초당 추이.
  매니페스트에 줄 하나로 들어올 수 있어야 한다.

## 6. 진입점

기록 목록(`GET /api/runs`)에서 항목을 누르면 그 세션의 보고서가 열린다.

- 딥링크가 되어야 한다 (URL 에 run id).
- 목록으로 돌아갈 수 있어야 한다.
- 측정 중(`session.state === 'running'`)인 기록도 열릴 수 있다.
  그때 `ended_at` · `duration_ms` · `state_after` 는 `null` 이다 — 0 이 아니다.
