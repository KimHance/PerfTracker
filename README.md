# PerfTracker

안드로이드 앱의 성능을 **앱을 고치지 않고** 측정하는 CLI 입니다.

측정 대상 앱에 SDK 를 넣지 않고, 기기를 루팅하지 않고, 기기에 무언가를 설치하지도 않습니다.
adb 로 붙어서 Perfetto 트레이스를 기기에 남기고, 그것을 호스트에서 파싱해
세션마다 `result.json` 하나를 남깁니다.

측정 대상은 **릴리즈 빌드로 설치된 아무 앱**입니다. 내가 만든 앱이든 아니든 상관없습니다.

---

## 이 도구가 지키는 두 가지

### 1. 측정이 측정 대상을 바꾸지 않는다

`start` 가 끝난 순간부터 `stop` 을 부를 때까지 **기기에 단 한 개의 adb 명령도 나가지 않습니다.**

한 가지는 나란히 알아야 합니다. **트레이스는 `start` 가 끝나기 전에 이미 시작합니다** —
그래야 콜드 스타트가 트레이스 안에 들어갑니다. `--launch` 를 주면 트레이스가 켜진 뒤,
래치가 걸리기 전에 perftracker 자신이 `am start -W`(앱 실행 + 시작 시간)와 `pidof`(앱 pid)를
한 번의 adb 호출로 보냅니다. 앱을 콜드로 띄우는 것이 그 세션의 목적이므로 의도된 동작이지만,
"트레이스 구간 안의 adb 호출이 0" 이라는 뜻은 아닙니다. 그 뒤로는 0 입니다.

이건 "그러려고 노력한다" 가 아니라 구조입니다. 세션이 살아 있는 동안 모든 adb 접근 경로에
래치(`MeasurementWindow`)가 걸리고, 기기를 만지려는 명령은 예외로 막힙니다.
세션 중에 `perftracker apps` 를 실행하면 이렇게 됩니다:

```
측정 창이 열려 있는 동안 adb 명령을 시도했습니다: adb -s R5CT0000001 shell pm list packages -3
측정 중 기기 접촉은 관찰자 효과를 만들므로 금지됩니다.
```

래치는 프로세스 경계를 넘습니다 — `start` 와 `stop` 은 서로 다른 프로세스지만,
새 프로세스는 활성 세션 포인터를 읽고 창을 복원합니다. 그리고 막힌 호출의 **횟수**를 세어
`result.json` 의 `measurement_overhead.adb_commands_during_session` 에 적습니다.
그 값이 0 이 아니면 그 세션 데이터는 오염된 것으로 봐야 합니다.
(이 카운터가 세는 것은 **이 도구를 통과한** 호출뿐입니다. 자세한 한계는
[아래](#measurement_overhead)에 적어 두었습니다.)

횟수는 창이 열려 있는 동안 활성 세션 포인터에 쌓이고 `stop` 이 그것을 거둡니다.
그래서 아직 `stop` 하지 않은 세션에 `extract` 를 돌리면 이 값은 **최종값이 아닙니다** —
그때까지의 누적이거나, 포인터마저 없으면 `null`(= 셀 수 없었다)입니다.
`null` 을 0 으로 접어 읽지 마세요.

이 제약이 설계 전체를 결정합니다:

- 트레이스는 Perfetto `--detach` 세션으로 남깁니다. 도구가 아무것도 붙잡고 있지 않아도
  기기가 알아서 기록하므로, 측정 중 왕복이 필요 없습니다.
- 트레이스는 세션 중에 회수하지 않습니다. `stop` 때 한 번에 flush 하고 pull 합니다.
- 고빈도 ftrace 이벤트(`sched/sched_switch` 등)는 **설정 단계에서 거부됩니다.**
  그것들은 켜는 것만으로 기기에 부하를 줍니다. 폴링 주기는 1000ms 이상만 허용됩니다.
- 모든 파싱은 호스트에서 합니다. `extract` 단계는 기기에 접촉하지 않습니다.
- `doctor` 와 `devices` 조차 측정 중인 기기는 건드리지 않습니다.

### 2. 판정하지 않는다

`result.json` 에는 "좋다 / 나쁘다 / 느리다" 가 없습니다. 측정값과 관측된 사실만 있습니다.

구글이 공개한 기준치(60fps 예산 16.67ms, frozen frame 700ms)는 값 옆이 아니라
**별도의 `references` 배열에 사실로 기록**되고, 도구는 그것과 비교하지 않습니다.
비교는 이 데이터를 소비하는 쪽(CI, 리포트, 사람)이 합니다.

`warnings` 에도 평가는 없습니다. "USB 충전 중이었음", "저전력 모드가 켜져 있었음" 처럼
관측된 사건만 들어갑니다.

---

## 설치

Node 20.19 이상이 필요합니다.

```bash
git clone <repo> && cd PerfTracker
npm install
npm run build
```

`adb` 는 다음 순서로 찾습니다. 하나만 되면 됩니다.

1. `--adb <경로>` 옵션
2. `PERFTRACKER_ADB` 환경변수
3. `PATH`
4. `ANDROID_HOME` / `ANDROID_SDK_ROOT` 의 `platform-tools/`
5. OS 기본 SDK 경로 (macOS 는 `~/Library/Android/sdk`)

기기 쪽 준비물은 **USB 디버깅 켜기**가 전부입니다. Android 12(API 31) 이상이어야
프레임 타이밍(`android.surfaceflinger.frametimeline`)을 얻을 수 있습니다.

트레이스 파서(`trace_processor_shell`)는 첫 `stop` 때 자동으로 내려받아
`~/.perftracker/bin/` 에 SHA256 검증과 함께 캐시합니다. 네트워크를 쓰고 싶지 않으면
`--offline` 을 주고, 바이너리를 직접 지정하려면 `PERFTRACKER_TRACE_PROCESSOR` 를 쓰세요.

---

## 네 개의 명령으로 끝나는 흐름

```bash
# 0) 환경과 기기가 준비됐는지 본다
npx perftracker doctor

# 1) 측정 시작 (앱을 콜드로 띄우고 싶으면 --launch)
npx perftracker start --app "네이버 웹툰" --name "홈 스크롤" --launch

# --- 여기서 손으로 앱을 조작한다. 이 동안 도구는 기기를 건드리지 않는다 ---

# 2) 얼마나 지났는지 확인 (기기에 접촉하지 않는다)
npx perftracker status

# 3) 종료 — 트레이스를 회수하고 result.json 을 만든다
npx perftracker stop
```

`start` 는 앱을 **라벨로도 패키지명으로도** 찾습니다(`--app` 생략 시 지금 포그라운드에 있는 앱).
설치된 앱 목록은 `perftracker apps` 로 볼 수 있습니다.

세션 하나가 디렉토리 하나입니다:

```
runs/2026-07-26T02-31-40_홈-스크롤_a3f9c1/
  result.json              ← 최종 산출물
  trace.perfetto-trace     ← Perfetto 원본 (Perfetto UI 로 열 수 있다)
  capture.json             ← 캡처 단계의 기록 (기기 스펙, 스냅샷, 경고)
  session.json             ← 세션 메타
  raw/                     ← dumpsys 원문 (before / after)
```

원본이 남아 있으므로 **기기 없이 언제든 다시 산출**할 수 있습니다:

```bash
npx perftracker extract runs/2026-07-26T02-31-40_홈-스크롤_a3f9c1
```

파싱 규칙이 바뀌었을 때, 다른 사람이 뜬 트레이스를 받았을 때 유용합니다.

### 뭔가 잘못됐을 때

- **`stop` 이 트레이스 회수에 실패했다** — 세션은 그대로 남습니다. 기기의 트레이스도
  지우지 않습니다. `perftracker stop` 을 그냥 다시 실행하면 그 지점부터 재개합니다.
- **`stop` 은 됐는데 `result.json` 산출이 실패했다** — 원본은 이미 안전합니다.
  오류 메시지에 있는 run 디렉토리로 `perftracker extract` 를 돌리세요.
- **이미 세션이 있다고 한다** — `perftracker stop` 으로 끝내거나 `--force` 로 시작하세요.
  `--force` 는 기기 쪽에 남은 Perfetto 세션까지 정리합니다.

---

## `result.json` 읽는 법

전체 스키마는 언제든 꺼낼 수 있습니다. CI 검증이나 LLM 에게 계약을 알려줄 때 그대로 쓰세요.

```bash
npx perftracker schema > result.schema.json
```

`schema_version` 이 그 계약의 버전입니다 (현재 `1.1.0`).

> **다만 이 버전 하나로 "내 스키마가 최신인지" 를 판단할 수는 없습니다.** `1.1.0` 은 아직
> 출시된 적이 없어서, 그 안에서 계약이 넓어질 때 이 도구는 버전을 올리지 않았습니다.
> 스키마를 캐시해 두고 쓰신다면 아래 [스키마를 다시 꺼내야 하는 때](#스키마를-다시-꺼내야-하는-때)
> 를 반드시 읽으세요.

### 최상위 구조

| 필드 | 무엇인가 |
| --- | --- |
| `schema_version` | 이 파일 형식의 버전 |
| `session` | id, 이름, `state`, 시작/종료 시각, 길이 (아래 참고) |
| `device` | 기기 스펙(`static`)과 세션 전후 상태(`state_before` / `state_after`) |
| `target_app` | 패키지, 라벨, 버전, 렌더 프로세스와 pid |
| `metrics` | 메트릭들. 키가 곧 수집기 id (`frame` / `startup` / `cpu` / `memory` / `log` / `thermal` / `network`) |
| `measurement_overhead` | 이 측정이 기기에 개입한 정도의 **하한** (아래 참고) |
| `references` | 구글 공개 기준치. **비교에 쓰이지 않고 기록만 된다** |
| `warnings` | 관측된 사건 (평가 아님) |
| `artifacts` | 원본 파일들의 상대 경로 |

> **아직 `stop` 하지 않은 세션에 `extract` 를 돌린 결과**(`session.state === "running"`)에는
> 아직 존재하지 않는 사실이 있습니다. 그 자리는 그럴듯한 숫자가 아니라 `null` 입니다:
> `session.ended_at` 과 `session.duration_ms`(세션이 안 끝났으니 길이가 없습니다 — 0 이 아닙니다),
> 그리고 `device.state_after`. `measurement_overhead` 의 두 필드도 `null` 일 수 있습니다
> (아래). `warnings` 에는 `session_still_running` 이 함께 실립니다.
> `stop` 한 뒤 같은 run 디렉토리로 `extract` 를 다시 돌리면 전부 채워집니다.

### 메트릭 하나의 모양

모든 메트릭은 같은 껍데기를 씁니다. **값이 없는 이유를 null 로 뭉뚱그리지 않습니다.**

```json
{
  "status": "collected",
  "source": "perfetto: actual_frame_timeline_slice.dur",
  "reason_code": null,
  "reason": null,
  "data": { "...": "..." }
}
```

- `status` — 다섯 값입니다.
  - `collected` — 값이 전부 나왔습니다. `data` 는 non-null.
  - `partial` — **두 가지를 겸합니다.** 값은 나왔는데 일부가 빠졌거나(예: CPU 사용률은
    있고 주파수가 없음 → `data` non-null), **값이 아예 안 나왔거나**(→ `data` **null**).
    어느 쪽인지는 `reason_code` 가 말합니다.
  - `unsupported` — 이 기기가 못 냅니다 (sdk 하한 미달, 데이터소스 미등록). `data` null.
  - `failed` — **예외 상황 전용**입니다. 트레이스 원본이 없거나(`trace_missing`)
    쿼리가 예외로 터진 경우(`query_failed`)뿐입니다. `data` null.
  - `skipped` — 시도조차 하지 않음 (`--launch` 없이 시작한 세션의 startup). `data` null.

  > **`status === 'failed'` 만 걸러서는 수집 실패를 못 잡습니다.** 값이 없는 대부분의
  > 경로는 `partial` + `data: null` 입니다. 값이 있어야 하는 CI 는
  > `status === 'collected'` 또는 `data !== null` 로 판정하세요.
- `source` — 이 숫자를 **어떤 방법으로 쟀는지**의 기록
- `reason_code` — 기계가 읽는 안정적인 키. 문구가 바뀌어도 이건 안 바뀝니다.
  CI 매칭은 반드시 이걸로 하세요. (예: `sdk_too_low`, `render_process_not_found`,
  `no_frames`, `trace_missing`, `data_source_not_registered`, `query_failed`)

  > `reason_code` 는 **닫힌 enum** 입니다. 이 버전의 reason_code 값은 **34개**입니다
  > (`1.0.0` 은 6개였습니다). 그중 `process_name_stale_in_trace` 는 `1.0.0` 부터 있던
  > `metrics.frame` 에도 실립니다. 이 숫자는 테스트가 `METRIC_REASON_CODES` 와 대조해
  > 고정하므로 코드보다 낡을 수 없습니다.
- `reason` — 사람이 읽는 한국어 문장. 다듬힐 수 있으니 매칭에 쓰지 마세요.
- `data` — 메트릭별 본문. 수집되지 않았으면 `null`

### 스키마를 다시 꺼내야 하는 때

**`schema_version` 만 보고 판단하면 안 됩니다.** `1.1.0` 은 아직 출시된 적이 없어서, 그 안에서
계약이 넓어질 때 이 도구는 버전을 올리지 않았습니다. 그래서 **깨지는 소비자는 `1.0.0` 을
고정한 쪽만이 아닙니다** — 지금 이 저장소가 만드는 산출물을 거부하는 가장 흔한 경우는
`1.1.0` 시절 중간에 `perftracker schema` 를 한 번 받아 두고 그대로 쓰는 쪽입니다.
그런데 `schema_version` 은 그때도 지금도 `1.1.0` 이라, **다시 꺼내라는 신호가 산출물 안에
존재하지 않습니다.**

`z.toJSONSchema()` 출력에서 실제로 갈라지는 곳은 둘이고, 서로 독립적입니다:

1. **`device.state_*.thermal_zones` 의 항목 노드가 `additionalProperties: false` 입니다.**
   예전 그 스키마는 `{ name, celsius }` 뿐이었고 지금 산출물은 `type` / `status` / `source`
   를 함께 싣습니다 → 거부됩니다.
2. **`reason_code` 가 닫힌 enum 입니다.** 예전 스키마는 21개였고 지금 산출물은
   `snapshot_unavailable` 같은 값을 냅니다 → 거부됩니다.
3. **`metrics.cpu` 와 `metrics.log` 의 필드 이름이 바뀌었습니다.** 기기 전역 값에
   `device_` 접두어가 붙었고(`total_busy_pct` → `device_total_busy_pct`,
   `log.total` → `log.device_total` 등) 앱 단위 값이 `app` 아래에 새로 생겼습니다.
   **이름을 바꾼 것은 의도입니다** — `log.total` 을 앱 단위로 바꾸면서 이름을 그대로 두면
   같은 이름이 다른 것을 뜻하게 되고, 그것을 소비자가 알아챌 방법이 없습니다.
   옛 이름을 읽던 코드는 `undefined` 를 받으므로 조용히 틀리지 않고 즉시 드러납니다.

`1.0.0` 스키마를 고정한 CI 도 같은 이유로 거부합니다. 어느 쪽이든 답은 하나입니다 —

```bash
npx perftracker schema > result.schema.json   # 다시 꺼내 갱신하세요
```

**내가 가진 스키마가 낡았는지 확인하는 법:** 캐시해 둔 파일에서 `reason_code` enum 의 값
개수를 세어 보세요. 위에 적힌 개수보다 적으면 낡은 것입니다. `thermal_zones` 항목에
`source` 가 없어도 마찬가지입니다.

### `metrics.frame`

프레임 하나하나의 실제 소요 시간(`actual_frame_timeline_slice.dur`)에서 나옵니다.

```json
{
  "process": "com.nhn.android.webtoon",
  "pid": 24193,
  "total_frames": 1412,
  "buckets": [ { "from_ms": 0, "to_ms": 5, "count": 812 }, "...101개" ],
  "within_16_67ms_ratio": 0.874,
  "percentiles": { "p50": 9.2, "p90": 21.4, "p95": 28.1, "p99": 96.3 },
  "mean_ms": 12.8,
  "max_ms": 312.4
}
```

- `buckets` 는 **항상 101개**로 고정입니다. 경계는 `[from, to)` 반개구간이고,
  마지막 버킷은 `to_ms: null` (= 700ms 이상, 상한 없음)입니다.
  60fps 예산 부근을 1ms 로 조밀하게 보고 꼬리로 갈수록 폭을 넓힙니다.
- `within_16_67ms_ratio` 는 16.67ms 이하 프레임의 비율입니다. 판정이 아니라 비율입니다.
- 종료 이벤트를 못 받은 미완결 프레임(`dur = -1`)은 집계에서 **제외**됩니다.

### `metrics.cpu`

**앱 단위 값과 기기 전역 값이 함께 들어 있고, 필드 이름이 그 범위를 말합니다.**
`app` 아래는 대상 앱 프로세스의 것이고 `device_` 로 시작하는 것은 기기 전체의 것입니다.

```json
{
  "device_sampled_ms": 59218,
  "device_samples": 61,
  "device_total_busy_pct": 14.18,
  "device_per_core": [ { "cpu": 0, "busy_pct": 20.61 }, "...7개 더" ],
  "device_frequency": [ { "cpu": 0, "samples": 2215, "min_khz": 614400, "max_khz": 1785600, "avg_khz": 1029397.4 }, "..." ],
  "app": {
    "process": "com.nhn.android.webtoon",
    "pid": 24193,
    "samples": 61,
    "sampled_ms": 59206,
    "user_ms": 5710,
    "kernel_ms": 2920,
    "total_ms": 8630,
    "share_of_device_cpu_pct": 1.85,
    "other_processes": [ { "process": "com.nhn.android.webtoon", "pid": 24328, "user_ms": 0, "kernel_ms": 10, "total_ms": 10 } ]
  }
}
```

- `app.total_ms` 는 **CPU 시간**이지 벽시계 시간이 아닙니다. `linux.process_stats` 의
  `runtime.user_ns` / `runtime.kernel_ns` 가 세션 구간에서 늘어난 양이고, 이것은
  `/proc/<pid>/stat` 의 utime/stime 입니다. **데이터소스를 새로 켜지 않았습니다** —
  이 카운터는 `measurement_overhead` 가 자기 자신(`traced`)에게 이미 쓰던 것입니다.
- **`share_of_device_cpu_pct` 의 분모는 같은 구간 기기 전체의 CPU 시간(모든 코어 합, idle 포함)
  입니다.** 벽시계가 아닙니다. 8코어 기기에서 코어 하나를 내내 100% 쓰면 이 값은 약 12.5% 입니다.
  같은 분모를 `measurement_overhead.tracing_processes_cpu_share_pct` 가 쓰므로 두 백분율을
  서로 비교할 수 있습니다. "기기가 실제로 한 일 중 이 앱의 몫" 이 필요하면
  `device_total_busy_pct` 로 나누세요 (위 예: 1.85 / 14.18 = 약 13%).
- **해상도는 10ms 입니다** (USER_HZ=100). 짧은 세션의 `0` 은 "안 썼다" 가 아니라 "10ms 미만" 입니다.
  그리고 첫 폴링 표본 **이전**의 CPU 시간은 들어 있지 않으므로 이 값은 하한입니다.
- **`other_processes` 는 합산되어 있지 않습니다.** 합치려면 이 앱의 프로세스 집합이 완전해야
  하는데 트레이스의 프로세스 이름은 완전하지 않습니다 — 아래 "트레이스가 앱을 다른 이름으로
  아는 경우" 를 보세요. 실측에서 **이름이 패키지명과 정확히 같은 프로세스는 8.63초를 쓴 본체가
  아니라 10ms 를 쓴 자식**이었습니다.
- **`app` 이 `null` 이면 그것은 `0` 이 아니라 "내지 못했다" 입니다.** `reason_code` 가
  갈래를 말합니다 (`process_not_in_trace` / `no_app_cpu_samples` / `counter_went_backwards` /
  `query_failed`). 그때도 `device_*` 값은 그대로 나옵니다.

### `metrics.log`

**개수는 앱 단위와 기기 전역이 나뉘고, 크래시·ANR 목록은 일부러 기기 전역입니다.**

```json
{
  "min_prio": "PRIO_WARN",
  "app": { "process": "com.nhn.android.webtoon", "pid": 24193, "total": 37, "by_priority": { "warn": 24, "error": 13, "fatal": 0 } },
  "device_total": 1507,
  "device_by_priority": { "warn": 1095, "error": 412, "fatal": 0 },
  "device_crashes": [],
  "device_anrs": []
}
```

- `app` 은 `android_logs` 를 utid → thread → **upid** 로 걸러 센 것입니다. pid 가 아니라
  upid 인 이유는 pid 가 재사용될 수 있기 때문입니다.
- **차이가 큽니다.** 같은 세션에서 기기 전역은 W 1,095 / E 412 인데 대상 앱만은
  W 24 / E 13 이었습니다 — **45배 / 32배**. 예전에는 기기 전역 값만 있었고 이름이
  `total` / `by_priority` 라서 "이 앱이 에러 412개를 냈다" 로 읽혔습니다.
- **`device_crashes` / `device_anrs` 는 앱으로 거르지 않습니다. 그것이 의도입니다.**
  실측(SM-S901N / Android 16): 이 트레이스의 `ActivityManager` 태그 16줄은 **전부
  `system_server`(pid 2414)가 찍었습니다.** ANR 은 앱이 아니라 system_server 가 기록하므로
  앱 pid 로 걸렀다면 **ANR 이 하나도 남지 않았을 것입니다.**
  대신 각 항목이 **찍은 프로세스의 `pid` / `process`** 를 함께 싣습니다 — 대상 앱 것만 보려면
  `data.app.pid` 와 비교해 직접 거르세요. 어느 앱의 ANR 인지는 `message` 의
  `"ANR in <패키지>"` 로 읽습니다 (항목의 pid 는 기록자이지 멈춘 앱이 아닙니다).
- `app.total` 이 **`0`** 인 것과 `app` 이 **`null`** 인 것은 다릅니다. `0` 은 관측입니다 —
  그 값이 나오는 시점에 기기 전역 개수가 이미 0 이 아니었으므로(0 이면 메트릭 전체가
  `no_log_entries` 로 값을 내지 않습니다) 로그 경로가 살아 있었다는 것이 확인된 상태입니다.
  `null` 은 앱 프로세스를 **특정하지 못했다**는 뜻입니다.

### `metrics.thermal`

세션 **시작 직전**과 **종료 직후**에 찍은 `dumpsys thermalservice` 두 스냅샷의 차이입니다.
**추가 adb 호출이 없습니다** — 이 원문은 도구가 처음부터 매 세션 찍어 왔고, M3 은 이미
디스크에 있던 것을 메트릭으로 승격시켰을 뿐입니다.

```json
{
  "status": "collected",
  "source": "dumpsys thermalservice: 세션 시작 직전 / 종료 직후 스냅샷의 센서별 온도 차이",
  "data": {
    "zones": [
      { "name": "AP", "type": 0, "before_c": 31.1, "after_c": 36.2, "delta_c": 5.1,
        "status_before": 0, "status_after": 0, "source": "hal" }
    ],
    "device_status_before": 0, "device_status_after": 0,
    "status_override_before": false, "status_override_after": false,
    "hal_ready_before": true, "hal_ready_after": true,
    "headroom_thresholds": [null, 0.8666667, 0.93333334, 1.0, 1.1333333, 1.4333333, 2.4333334]
  }
}
```

읽을 때 반드시 알아야 할 것:

- **기기 전역이지 대상 앱의 온도가 아닙니다.** 같은 시간에 돈 다른 앱, 화면 밝기, USB 충전이
  전부 섞입니다. 이 도구는 adb 로 붙으므로 거의 항상 충전 중입니다 (`warnings` 의
  `charging_during_session` 이 그 사실을 말합니다).
- **`delta_c` 는 부호 있는 값이고 음수가 정상입니다.** 실기기 4세션 중 **2세션에서 내려갔습니다**
  (32.1→30.8, 32.1→31.9). "발열량" 으로 읽지 마세요.
- **전/후 두 점이므로 구간 중 최고 온도는 알 수 없습니다.** 원리적으로 그렇습니다 — 알려면
  세션 중에 기기를 폴링해야 하고, 그것이 이 도구가 하지 않는 일입니다.
- **`name` 은 벤더 임의 문자열입니다** (`AP` / `SKIN` / `PATHM` / `test temperature sensor`).
  CPU 온도인지 피부 온도인지는 `type` 으로 판별하세요 (0=CPU, 1=GPU, 2=BATTERY, 3=SKIN,
  4=USB_PORT, 5=POWER_AMPLIFIER, ...). 이름은 유일하지도 않습니다 — 한 기기에 `PATHM` 과
  `PA1THM` 이 **둘 다** 있습니다. 존의 동일성 키는 `(type, name)` 입니다.
- **`source` 를 함께 읽으세요.** `hal` 은 덤프 시점에 HAL 에 직접 물은 값이고, `cached` 는
  프레임워크가 콜백으로 들고 있던 값입니다. **`cached` 존의 `delta_c` 는 온도 변화가
  아닐 수 있습니다** — 콜백이 안 오면 같은 숫자가 그대로 남습니다. 실측: 어느 실기기의
  cached 전용 존 `PA1THM` 은 약 3시간에 걸친 8개 덤프에서 계속 27.0°C 였고, 같은 기간
  HAL 이 주는 `AP` 는 30.8~41.6°C 로 움직였습니다. **이 도구는 "안 변했다" 와
  "갱신되지 않았다" 를 구분하지 못합니다.**
- **값이 정확히 `0.0` 인 센서가 실기기에 있습니다** (`SUBBAT` / `SUBBATRAW`). 그것이 실제
  0°C 인지 이 기기에 그 센서가 없다는 뜻인지 **이 도구는 판별하지 않습니다.**
- `headroom_thresholds` 는 기기가 스스로 보고한 배열입니다. **이 도구는 headroom 을
  산출하지 않으므로** 위의 섭씨 온도와 직접 비교할 수 없습니다 (headroom 은 앱 프로세스 안에서
  `PowerManager.getThermalHeadroom()` 으로만 얻습니다). 원문의 `NaN` 은 `null` 로 실립니다.
- 에뮬레이터에서는 값이 **합성**입니다. Android 에뮬레이터의 thermal HAL 은 예제 구현이라
  상수를 돌려줍니다 (존 1개, `test temperature sensor`, 30.8°C 고정).

### `metrics.network`

세션 전/후 `dumpsys netstats` 의 `mAppUidStatsMap` 표에서 대상 앱 uid 행의 차이입니다.
**Android 14(sdk 34) 이상에서만 나옵니다** — 그 아래에서는 같은 내용이 다른 명령에 있고
이 도구는 그 분기를 하지 않습니다 (`unsupported` / `sdk_too_low`).

```json
{
  "status": "collected",
  "source": "dumpsys netstats mAppUidStatsMap: 세션 전/후 스냅샷의 uid 행 델타",
  "data": {
    "uid": 10388,
    "rx_bytes": 1258291, "tx_bytes": 441344,
    "rx_packets": 1119, "tx_packets": 871,
    "shared_uid_packages": ["com.nhn.android.webtoon"]
  }
}
```

이 숫자가 **무엇이 아닌지**:

- **패키지 단위가 아니라 uid 단위입니다.** 같은 uid 를 쓰는 다른 패키지의 트래픽이 섞이고
  분리할 수 없습니다 (맵의 키가 uid 뿐입니다). **귀속 범위의 정본은 `shared_uid_packages`
  배열입니다.**
  - **1개** → 위 숫자는 그 패키지만의 값입니다. 이때만 `status` 가 `collected` 입니다.
  - **2개 이상** → 그 패키지들의 **합계**입니다. `status` 는 `partial` 이고
    `reason_code` 는 `uid_shared_by_multiple_packages` 입니다. 실기기(SM-S901N / sdk 36)에서
    **uid 1000 을 86개 패키지가 공유합니다** — 시스템 앱을 측정하면 늘 이쪽입니다.
    값은 하나도 빠짐없이 실립니다. `partial` 은 "값이 없다" 가 아니라 "한정이 있다" 입니다.
  - **`null`** → **열거하지 못했다**는 뜻이고 `[]` 와 다릅니다. 스냅샷이 없거나, 이 uid 가
    속한 안드로이드 user 를 목록이 한 줄도 열거하지 못한 경우입니다 (아래 시큐어 폴더 참조).
  - **`[]`** → 열거했는데 이 uid 를 쓰는 패키지가 목록에 없었습니다 (대상 패키지 자신도).
  - `null` 과 `[]` 는 둘 다 `partial` 이고, `reason_code` 가 어느 갈래인지 말합니다
    (`uid_packages_not_enumerable` / `uid_not_in_package_list`).

  > **`reason_code` 로 공유 여부를 판단하지 마세요.** 사유 자리는 하나뿐이라
  > `netstats_uid_duplicated` 가 겹치면 그쪽이 먼저 실립니다. 귀속 범위를 볼 때는
  > **배열을 보세요.**

- **셸이 못 보는 안드로이드 user 가 있습니다.** 삼성 시큐어 폴더는 별도 user(실기기 실측
  **150**)이고, `pm list packages -U` 는 그 user 를 열거하지 못합니다 — 기기가
  `SecurityException: Shell does not have permission to access user 150` 을 **stderr 로만**
  내고 **종료 코드는 0** 입니다. 그런데 `dumpsys netstats` 에는 그 user 의 uid 행이
  실재합니다 (실기기에서 18개: `15010241`, `15010240`, …). uid 규칙은
  `userId * 100000 + appId` 입니다.
  **이 도구는 그런 uid 를 쓰는 패키지의 이름을 알 수 없고, 그것을 `[]` 가 아니라 `null` 로
  말합니다.** 시큐어 폴더 안의 앱은 `--app` 으로 지정할 수도 없습니다 — 목록에 없기 때문입니다.
- **IP 계층의 바이트입니다.** 이더넷 헤더는 빠지고 IP+TCP/UDP 헤더는 들어갑니다.
- **loopback 을 포함한 모든 인터페이스의 합계이고 wifi / mobile 로 나뉘지 않습니다.**
  loopback 통신은 송신·수신 양쪽에서 두 번 세어집니다.
- 1500바이트를 넘는 큰 패킷은 커널이 휴리스틱으로 되계산하므로 고throughput 구간의 값은
  정확한 wire 바이트가 아니라 **근사치**입니다.
- 방화벽/데이터세이버가 버린 **송신** 패킷은 안 세고, 버려진 **수신** 패킷은 셉니다.
- VPN(TUN)이 켜져 있으면 같은 트래픽이 앱 uid 와 VPN 앱 uid 양쪽에서 세어집니다.
- **델타 구간은 세션 구간보다 조금 넓습니다.** 시작 스냅샷은 앱을 띄우기 전에, 종료 스냅샷은
  트레이스를 회수한 뒤에 찍힙니다.
- **`device.state_*.captured_at` 은 그 구간의 근사일 뿐 스냅샷을 찍은 시각이 아닙니다.**
  두 값은 각각 `start` / `stop` 이 시작할 때 찍은 시계입니다. 특히 `state_after.captured_at` 은
  **트레이스 회수 전**의 시각이라 종료 스냅샷보다 앞섭니다 (실측: 트레이스 0.3~2.1MB 인
  4세션에서 0.5~0.7초). 그래서 **이 바이트를 그 두 시각의 차로 나눠 처리량을 구하면 안 됩니다** —
  분자는 회수 구간을 포함하는데 분모는 제외합니다. 스냅샷 시각이 필요하면
  `raw/netstats_{before,after}.txt` 의 파일 mtime 이 그것에 더 가깝습니다.
- **`0` 은 "관측된 바이트가 없었다" 이지 "조회하지 못했다" 가 아닙니다.** 조회하지 못한
  세션은 `data` 가 통째로 `null` 이고 `reason_code` 가 이유를 말합니다.
- 누적 원값은 싣지 않습니다. 감사가 필요하면 `raw/netstats_{before,after}.txt` 원문이
  `artifacts.raw` 에 등재되어 있습니다.

### `measurement_overhead`

```json
{
  "tracing_processes_cpu_time_ms": null,
  "tracing_processes_cpu_share_pct": null,
  "tracing_processes_peak_rss_kb": null,
  "adb_commands_during_session": 0,
  "trace_buffer_overrun": false
}
```

- `adb_commands_during_session` — **측정 창이 열린 동안** perftracker 를 통해 시도되어
  차단된 adb 호출 수. 0 이 아니면 그 데이터는 의심하세요.
  이름과 달리 세는 구간은 "세션 전체" 가 아니라 **창이 열린 구간**입니다. 두 가지를 세지
  않으니 함께 읽으세요.
  - **perftracker 자신의 실행 명령.** `--launch` 세션에서는 트레이스가 시작된 뒤,
    래치가 걸리기 전에 `am start -W` 와 `pidof` 가 한 번의 adb 호출로 나갑니다. 창 밖이라
    이 카운터에 잡히지 않습니다. 앱을 콜드로 띄우는 것이 그 세션의 목적이므로 의도된
    동작이고, 그 뒤로 창이 닫힐 때까지 perftracker 는 기기에 아무것도 보내지 않습니다.
  - **다른 프로세스의 adb.** 0 은 "perftracker 가 아무것도 보내지 않았다"는 뜻이지
    "아무도 기기를 건드리지 않았다"는 뜻이 아닙니다. 다른 터미널에서 직접 실행한 `adb`
    (예: `adb shell input swipe`)는 이 도구를 거치지 않으므로 여기 잡히지 않습니다.
    도구는 자기가 보내지 않은 트래픽을 관측할 수 없습니다 — 관측하려면 세션 중에 기기에
    물어봐야 하고, 그게 곧 이 도구가 금지하는 행위이기 때문입니다.
  - **아직 `stop` 하지 않은 세션.** 이 카운터의 정본은 `stop` 이 남깁니다. 그 전에
    `extract` 를 돌리면 활성 세션 포인터에 그때까지 쌓인 누적치가 실리는데, **읽은 시점까지의
    사실이지 최종값이 아닙니다** — 세션이 도는 동안 더 늘 수 있습니다. 포인터마저 없으면
    (`--force` 로 버려진 세션 등) 셀 방법이 없어 **`null`** 입니다.
    `null` 은 0 이 아닙니다: 0 은 "세어 봤더니 없었다", `null` 은 "셀 수 없었다" 입니다.
- `trace_buffer_overrun` — 트레이스 버퍼가 넘쳐 데이터가 잘렸는지. 잘린 데이터를
  정상인 척 내보내지 않기 위해 사실로 기록합니다.
  **`null` 은 확인하지 못했다는 뜻입니다**(`false` 가 아닙니다) — 이 run 에 트레이스 원본이
  없거나(아직 `stop` 전, 또는 트레이스를 잃은 `aborted` 세션) 통계 쿼리 자체가 실패한 경우입니다.
- `tracing_processes_*` — 트레이싱 **프로세스들**(`traced` / `traced_probes` / `perfetto`)이
  쓴 CPU 시간과 RSS 입니다. M2 에서 채워집니다.

  > **이건 트레이싱의 총비용이 아니라 체계적인 하한입니다.** 커널이 ftrace 이벤트를
  > 링버퍼에 기록하는 비용은 그 순간 인터럽트당한 프로세스(대상 앱일 수 있습니다)에
  > 청구되므로 이 숫자에 들어오지 않습니다. 켜는 ftrace 이벤트를 줄이면 그 몫도 줄지만
  > 0 이 되지는 않습니다. `stop` 요약의 `Overhead tracing procs ...% CPU` 도 같은 하한입니다.

### `references`

```json
[
  { "metric": "frame", "name": "60fps frame budget", "value": 16.67, "unit": "ms",
    "source": "Android Vitals — slow rendering",
    "url": "https://developer.android.com/topic/performance/vitals/render" }
]
```

**이 값들은 아무것과도 비교되지 않습니다.** "구글이 이렇게 말했다" 는 사실을 옆에 놓아둘 뿐입니다.
판정이 필요하면 이 값을 읽어서 소비하는 쪽에서 하세요.

`network` 의 50MB/day 는 **모바일 네트워크**의 **백그라운드** **하루** 합계 기준입니다.
이 도구가 재는 것은 수십 초짜리 **포그라운드** 세션의 **전 인터페이스(loopback 포함) 합계**라
**차원이 세 축 모두 다릅니다.** 그래서 `unit` 이 `MB` 가 아니라 `MB/day` 이고 `name` 에
`background` 와 `mobile` 이 남아 있습니다. 이 도구는 어떤 비교도 하지 않습니다.

`thermal` 에는 기준선이 **없습니다.** 온도에 대한 구글의 공개 수치 기준을 찾지 못했고
(CDD 에도 해당 요구사항 ID 가 없습니다), **출처 URL 이 없는 값은 이 배열에 넣지 않습니다.**
ADPF 의 headroom 휴리스틱(0.85 / 0.95 / 1.0)은 출처가 있지만 **이 도구가 산출하지 않는 값**의
기준선이라 실으면 소비자를 오도합니다.

---

## 개발

```bash
npm test          # 유닛 테스트 (기기 불필요)
npm run typecheck # src + test 전체 타입체크
npm run build
npm run test:device   # 실기기가 꽂혀 있어야 함
```

- `packages/core` — 기기·세션·수집·파싱. 도메인 로직 전부.
- `packages/cli` — 얇은 껍데기. 명령 조립과 출력 포맷만.

`core` 는 구체 프로세스 실행기를 공개하지 않습니다. 기기 접촉은 `AdbClient` 를 통해서만
가능하고, 그래야 측정 창 래치를 우회할 수 없습니다.

새 메트릭을 붙이려면 `Collector` 를 하나 만들어 `collectors/registry.ts` 의
`COLLECTORS` 에 넣으면 됩니다. `start` 가 TraceConfig 블록을 모으고 `extract` 가
`metrics[collector.id]` 를 채우는 것은 그 배열을 순회해서 일어납니다.

## 검증 환경

| 항목 | M0+M1 | M2 | M3 |
|---|---|---|---|
| 실기기 (SM-S901N, Android 16 / sdk 36) | ✅ | ✅ | ✅ |
| 에뮬레이터 (sdk_gphone64_arm64, API 35, 4코어) | — | ✅ | ✅ |

실기기 검증은 `npm run test:device` **5회 연속 10/10** 입니다 (2026-07-27).

### M3 에서 에뮬레이터가 **실제로 검증한** 것

`npm run test:device` 를 에뮬레이터에서 **5회 연속** 돌려 확인했습니다.

- **측정 창 안의 adb 호출이 0** 입니다. M3 이 기기로 보내는 명령을 둘(`dumpsys netstats`,
  `pm list packages -U`) 늘렸는데도 그렇습니다 — 두 명령 모두 `start` 에서는 트레이스를 켜기
  전에, `stop` 에서는 트레이서를 멈춘 뒤에 나갑니다.
- **스냅샷 원본이 전/후 짝으로** `raw/` 에 남고 `artifacts.raw` 에 등재됩니다
  (`thermalservice` / `netstats` / `packages` × `before` / `after`).
- **존 중복 제거가 실제로 동작합니다.** 이 에뮬레이터는 `Cached temperatures` 와
  `Current temperatures from HAL` 에 같은 센서를 하나씩 갖고 있어서, M3 이전 파서는 존을
  **2개**로 만들었습니다. 존이 1개뿐인 기기가 오히려 이 결함을 정확히 드러냅니다.
- **`mAppUidStatsMap` 절과 그 머리글**이 기대와 정확히 같고(`uid rxBytes rxPackets txBytes
  txPackets`), 대상 앱 uid 의 행이 실제로 있으며, `shared_uid_packages` 가 채워집니다.

### M3 에서 **실기기가** 검증한 것 (2026-07-27, SM-S901N / sdk 36)

에뮬레이터가 못 하던 것들 중 실기기에서 **실제로 확인된** 항목입니다. 근거를 함께 적습니다.

- **`dumpsys netstats` 의 실기기 원문.** 예전에는 "아직 한 줄도 본 적이 없다" 였습니다.
  이제 봤습니다:
  - `mAppUidStatsMap` 절이 있고 머리글이 기대와 **정확히** 같습니다
    (`uid rxBytes rxPackets txBytes txPackets`).
  - 미끼 회피가 실기기에서도 성립합니다 — `BPF map status:` 절의 `mAppUidStatsMap: OK` 가
    앞에 있고(162행), 내용 절은 208행입니다. 콜론 뒤가 빈 줄만 앵커로 삼는 규칙이 필요합니다.
  - 표는 **93행**이고 바로 뒤 절(`mStatsMapA:`)에서 끊깁니다.
  - **uid 열에 음수가 찍힙니다.** 82번째 행이 `-253 151772 1156 2367519 1871` 입니다
    (3회 연속 관측, 같은 자리). 그 값이 무엇인지 이 도구는 모릅니다 — 해석하지 않고
    원문 그대로 싣습니다. 다만 uid 열을 부호 없이 읽으면 그 줄에서 표 읽기가 멈춰
    **뒤의 12행을 통째로 잃습니다** (그중 하나는 1.6GB 를 받은 uid 10070). 그 12행 안에
    대상 앱이 있으면 이 도구가 "트래픽이 없었을 수 있습니다" 라고 말하게 됩니다.
- **온도가 실제로 움직입니다.** 아무 조작 없이 앱만 띄워 둔 세션에서:
  - 14.3초 세션 — AP 31.1→32.3 (**+1.2**), PATHM +0.4, SKIN +0.2, 나머지 0
  - 122.3초 세션 — AP 31.2→33.5 (**+2.3**), PATHM +0.1, SKIN +0.1, USB +0.1
    (같은 세션의 `cpu.device_total_busy_pct` 는 8.74 — 유휴에 가깝습니다)
  - 즉 **세션이 길수록 AP 가 더 오릅니다.** 다만 이것은 부하 곡선이 아니라 유휴 드리프트
    입니다 — 아래 "확인하지 못한 것" 을 보세요.
  - 에뮬레이터의 thermal HAL 은 AOSP 예제 구현이라 상수를 돌려줍니다 (존 1개,
    `test temperature sensor`, 30.8°C 고정). `delta_c` 는 **항상 0** 이므로 온-디바이스
    스펙은 여전히 `delta_c !== 0` 을 단언하지 않습니다 — 그 스펙은 에뮬에서도 돌아야 합니다.
- **`PA1THM` 은 `Cached temperatures` 에만 있고 값이 얼어붙어 있습니다.** 실측 27.0°C 가
  세션 전·후 모두 같습니다. 존 병합 규칙(HAL 절을 먼저 싣고 cached 전용을 뒤에 붙인다)이
  실기기에서 실제로 필요한 이유가 이 센서입니다. `source: 'cached'` 로 실립니다.
- **`SUBBAT` / `SUBBATRAW` 가 0.0°C 를 보고합니다.** 이 도구는 그것을 그대로 싣습니다 —
  "센서가 없다" 로 바꾸지 않습니다. 기기가 0 이라고 말한 것이 사실이고, 그 해석은 소비자 몫입니다.
- **시큐어 폴더(별도 안드로이드 user)의 존재.** `pm list packages -U` 는 user 150 을 열거하지
  못하고(stderr, 종료 코드 0), `dumpsys netstats` 에는 그 user 의 uid 18개가 있습니다.
  `tryShell` 이 stderr 를 stdout 과 섞지 않는다는 것도 실기기로 재확인했습니다 —
  stdout 632줄에 `SecurityException` 은 **0건**, stderr 2줄.
- **공유 uid 가 예외가 아니라 기본값입니다.** uid 1000 을 **86개** 패키지가 씁니다.
- **측정 창 안의 adb 호출이 0** 입니다 (실기기 5회 연속, 세션마다 확인).

### M3 에서 에뮬레이터가 **검증하지 못한** 것

여기 있는 것들은 테스트가 단언하지 않습니다. 단언하면 통과하지만 아무것도 확인하지 못합니다.

- **온도가 부하에 반응하는가** — 에뮬레이터에서는 불가능하고(위 참조), **실기기에서도
  아직 부하 곡선은 못 봤습니다.** 위 두 세션은 사람이 화면을 만지지 않은 유휴 세션이고,
  이 저장소는 기기에 인위적 부하를 거는 도구를 설치하지 않습니다. 부하 아래의 거동은
  사람이 앱을 조작하면서 측정해야 확인됩니다. 옛 실기기 4세션의 원본에는 AP 가
  31.1→36.2 / 33.8→41.6 으로 오른 세션이 둘, 32.1→30.8 / 32.1→31.9 로 **내려간 세션이
  둘** 있습니다.
- **여러 존을 가진 기기의 섹션 병합** — 에뮬은 존이 1개라 `Cached` 에만 있는 센서
  (실기기의 `PA1THM`)를 밟지 못합니다. 유닛 테스트와 실기기 원본으로만 덮입니다.
  덧붙여 **"값이 다를 때 HAL 을 택한다" 는 tie-break 는 합성 픽스처로만 검증됐습니다** —
  실기기 8개 덤프를 대조한 결과 `Cached` 와 HAL 의 공유 존 값은 **전부 완전히 일치**했습니다.
  즉 그 기기의 실데이터에서 HAL 우선 규칙이 바꾼 값은 하나도 없고, 실효는 중복 제거와
  `PA1THM` 보존뿐입니다. (규칙 자체의 근거는 유효합니다: HAL 절은 덤프 시점의 라이브 조회이고
  `Cached` 는 프레임워크 보관값이며, 4세션 8덤프 내내 27.0°C 로 얼어붙은 `PA1THM` 이 그 증거입니다.)
- **throttling 전이** — **못 봤습니다.** 에뮬의 mock HAL 은 전이를 만들지 않고,
  실기기에서도 관측한 모든 세션이 `Thermal Status: 0 → 0` 이었습니다 (14초 / 122초 세션과
  기기 조회 전부). 전이를 만들려면 기기를 실제로 달궈야 하고 이 저장소는 그러지 않습니다.
  그리고 전/후 두 점 스냅샷으로는 **전이 자체를 볼 수 없습니다** — 중간에 올라갔다 내려온
  것과 내내 그대로였던 것이 같은 모양입니다 (M3 범위 밖).
- **네트워크 바이트의 크기·정확도** — 에뮬레이터는 호스트 NAT 를 타고, 세션 중 앱이 통신하지
  않을 수 있습니다. `rx_bytes > 0` 은 flaky 한 단언이라 파이프라인과 uid 귀속만 검증하고
  값의 크기는 검증하지 않습니다. 실기기에서도 마찬가지입니다 (Settings 를 띄운 유휴 세션의
  실측은 rx 376B / tx 120B 였습니다 — 크기를 단언할 수 있는 값이 아닙니다).
- **VPN / CLAT / 이중 계수 / GSO 추정** — 그런 구성 자체가 없습니다. 문서로만 서술합니다.
- **sdk 34 미만의 Network 미지원 경로 / 카운터 되감김 / BPF 맵 중복 행** — 재현할 방법이
  없어 유닛 테스트로만 덮입니다.
- **Power** — M3 범위 밖입니다. 배터리 에너지는 adb⇒USB⇒충전 때문에 구조적으로 측정할 수
  없고(실기기 4세션 중 3세션에서 충전 카운터가 만충으로 고정), 앱별 전력의 "측정값" 은
  안드로이드에 존재하지 않습니다.

### M2 에서 에뮬레이터가 검증하지 못했고 **실기기가 검증한** 것

아래 셋은 에뮬레이터에서 원리적으로 못 보던 것들이고, 2026-07-27 실기기에서 확인됐습니다
(122초 세션, 대상 `com.android.settings`).

- **CPU 주파수 값** — 에뮬레이터의 `cpuinfo_max_freq` 는 `2` 라 kHz 가 아니었습니다.
  실기기에서는 실제 kHz 가 나옵니다: 614400~1785600 (little), 633600~2496000 (big),
  806400~2995200 (prime).
- **big.LITTLE 코어별 거동** — 에뮬레이터는 4코어가 모두 같은 클러스터입니다. 실기기는
  **3 클러스터** (`[0-3] / [4-6] / [7]`) 이고 코어별 사용률이 실제로 갈립니다
  (실측: cpu0 15.74% … cpu7 1.92%).
- **로그 수집** — 에뮬레이터 이미지는 SELinux 가 `traced_probes` 의 `logdr` 접근을 막아
  `android.log` 가 **항상 비어 있었습니다**(6세션 전부 `partial` / `no_log_entries`).
  실기기에서는 `collected` 이고 122초 세션에 **1,422건**이 잡혔습니다
  (warn 413 / error 1,009 / fatal 0). 크래시·ANR **분류** 자체는 실제 크래시를 만들어야
  검증되므로 여전히 유닛 테스트로만 덮입니다.

### M2 에서 아직 검증하지 못한 것

- **Thermal** — 에뮬레이터에는 물리 센서가 없습니다. 실기기 값은 M3 절을 보세요.
  **GPU** 는 M3 에서도 범위 밖입니다.

에뮬레이터에서 **검증된** 항목 (`npm run test:device` 로 돌린 `--launch` 세션 11회 실측):

- **프레임 타임라인** — 11회 **전부** 대상 앱의 프레임을 수집했다 (4~9 프레임,
  `process = com.example.streaming.debug`).
  (예전 이 문서는 "에뮬레이터에서는 `actual_frame_timeline_slice` 가 채워지지 않는다" 고
  적었는데, 그것은 런처만 조작한 세션의 관측이었고 지금은 사실이 아니다. 다만 프레임 **수**가
  적으므로 분포·백분위의 통계적 의미는 실기기에서 봐야 한다.)
- **CPU 사용률과 주파수 이벤트의 존재** — 11회 모두 `collected`, 4코어 전부에서 `cpufreq`
  카운터가 나왔다 (값의 크기는 위 참조).

### `--launch` 인데 시작 시간이 안 나오는 경우

`metrics.startup` 이 `partial` + `launch_wait_timed_out` 으로 나오고 값이 없을 수 있습니다.
**이 에뮬레이터에서는 11회 중 4회가 그랬습니다 (약 3분의 1).**

원인은 도구가 아니라 `am start -W` 자체입니다. 이 앱의 콜드 스타트가 이 에뮬레이터에서
12~15초 걸리는데, 그럴 때 ActivityManager 가 실행 완료 보고를 기다리다 포기하고 이렇게
답합니다:

```
Status: timeout
LaunchState: UNKNOWN (-1)
Activity: <패키지>/<런처 액티비티>
WaitTime: 11062
Complete
```

`TotalTime` 이 아예 찍히지 않습니다. **앱이 실행되지 않았다는 뜻이 아닙니다** — 같은
세션에서 앱의 pid 는 확보되고 프레임·메모리도 정상 수집됩니다. 그 사실을 `target_app.pid`
로 확인할 수 있고, 경고 `app_launch_time_unmeasured` 가 "이 세션에서 시작 시간을 못 쟀다"
는 것만 말합니다. 느린 콜드 스타트를 가진 앱은 실기기에서도 같은 일이 일어날 수 있습니다.

> 실기기(SM-S901N / sdk 36)에서 `com.android.settings` 를 콜드 스타트한 세션 **2회**는
> 둘 다 `collected` 였고 `TotalTime` 은 352ms / 375ms 였습니다 (값을 직접 확인한 세션이
> 그 둘입니다 — 온-디바이스 스펙은 두 갈래를 다 허용하므로 통과 자체는 근거가 안 됩니다).
> 즉 이 사유는 앱·기기의 콜드 스타트 속도에 달린 것이지 도구의 결함이 아닙니다.

### 트레이스가 앱을 다른 이름으로 아는 경우 (`zygote64` / `<pre-initialized>`)

`--launch` 로 앱을 트레이스 도중에 콜드 스타트시키면, 새로 fork 된 프로세스의 이름이
트레이스에 **`zygote64` 로 고정되는 경우가 있습니다.** `linux.process_stats` 는 프로세스를
처음 관측할 때 이름을 한 번 확정하고 갱신하지 않는데, zygote 가 fork 한 앱은
`Process.setArgV0()` 이 실제 패키지명을 붙이기 전까지 잠시 그 이름을 갖기 때문입니다
(`trace_processor` 로 직접 확인: 문제의 pid 가 트레이스 안에서 실제로 `name = "zygote64"`,
`uid = 0` 이었습니다). `--launch` 는 force-stop 후 재실행이라 앱 프로세스가 **항상** 갓
fork 된 상태이므로 이것은 예외 상황이 아닙니다.

perftracker 는 `am start -W` 직후(측정 창이 열리기 **전**) `pidof` 로 앱의 pid 를 받아 두고,
트레이스 이름이 맞지 않으면 그 pid 로 대상 앱을 특정합니다. 그때:

- `frame` / `memory` / `cpu` / `log` 의 `process` 는 **패키지명**입니다 — 확인되지 않은
  이름이 결과에 실리는 일은 없습니다. **네 메트릭이 같은 규칙(`resolveAppProcess`)을 쓰므로
  같은 프로세스를 가리킵니다.**
- 네 메트릭의 `status` 는 `partial`, `reason_code` 는 `process_name_stale_in_trace` 입니다.
  값은 정상이고, "이름이 아니라 pid 로 확인했다" 는 사실을 그 코드가 말합니다.
- pid 조차 없으면(= `--launch` 없이 시작했고 이름도 안 맞음) 추측하지 않습니다 —
  `render_process_not_found` / `process_not_in_trace` 로 값을 내지 않습니다.

**실기기에서 두 가지 이름을 모두 봤습니다** — 같은 기기(SM-S901N / Android 16)의 같은 앱이
한 세션에서는 `<pre-initialized>`, 다른 세션에서는 `zygote64` 로 기록됐습니다. 이름을 목록으로
막는 방어가 왜 성립하지 않는지가 여기 있습니다.

**이것이 CPU 를 합산하지 않는 이유이기도 합니다.** 두 세션 모두에서 트레이스 이름이 패키지명과
**정확히 같은** 프로세스가 따로 있었는데, 그것은 앱 본체가 아니라 본체가 fork 한 거의 놀고 있는
자식이었습니다 (한 세션은 8,630ms 대 10ms, 다른 세션은 9,560ms 대 0ms). 이름으로 모은 후보를
전부 더해 "이 앱의 CPU" 라고 부르면, 그 집합이 완전하다는 확인되지 않은 주장을 사실로 만드는
것이 됩니다. 그래서 대표 하나만 `app` 에 싣고 나머지는 `app.other_processes` 에 각자 pid 를
달고 남깁니다.
