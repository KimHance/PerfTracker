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

`schema_version` 이 그 계약의 버전입니다 (현재 `1.0.0`).

### 최상위 구조

| 필드 | 무엇인가 |
| --- | --- |
| `schema_version` | 이 파일 형식의 버전 |
| `session` | id, 이름, `state`, 시작/종료 시각, 길이 |
| `device` | 기기 스펙(`static`)과 세션 전후 상태(`state_before` / `state_after`) |
| `target_app` | 패키지, 라벨, 버전, 렌더 프로세스와 pid |
| `metrics` | 메트릭들. 키가 곧 수집기 id (M1 은 `frame` 하나) |
| `measurement_overhead` | 이 측정이 기기에 얼마나 개입했는지 |
| `references` | 구글 공개 기준치. **비교에 쓰이지 않고 기록만 된다** |
| `warnings` | 관측된 사건 (평가 아님) |
| `artifacts` | 원본 파일들의 상대 경로 |

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

- `status` — `collected`(정상) / `partial`(일부만) / `unsupported`(이 기기가 못 함) /
  `failed`(수집 실패) / `skipped`(요청되지 않음)
- `source` — 이 숫자를 **어떤 방법으로 쟀는지**의 기록
- `reason_code` — 기계가 읽는 안정적인 키. 문구가 바뀌어도 이건 안 바뀝니다.
  CI 매칭은 반드시 이걸로 하세요. (예: `sdk_too_low`, `render_process_not_found`,
  `no_frames`, `trace_missing`, `data_source_not_registered`, `query_failed`)
- `reason` — 사람이 읽는 한국어 문장. 다듬힐 수 있으니 매칭에 쓰지 마세요.
- `data` — 메트릭별 본문. 수집되지 않았으면 `null`

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

- `adb_commands_during_session` — 측정 창이 열린 동안 **perftracker 를 통해** 시도되어
  차단된 adb 호출 수. 0 이 아니면 그 데이터는 의심하세요.
  **반대 방향은 성립하지 않습니다:** 0 은 "perftracker 가 아무것도 보내지 않았다"는 뜻이지
  "아무도 기기를 건드리지 않았다"는 뜻이 아닙니다. 다른 터미널에서 직접 실행한 `adb`
  (예: `adb shell input swipe`)는 이 도구를 거치지 않으므로 여기 잡히지 않습니다.
  도구는 자기가 보내지 않은 트래픽을 관측할 수 없습니다 — 관측하려면 세션 중에 기기에
  물어봐야 하고, 그게 곧 이 도구가 금지하는 행위이기 때문입니다.
- `trace_buffer_overrun` — 트레이스 버퍼가 넘쳐 데이터가 잘렸는지. 잘린 데이터를
  정상인 척 내보내지 않기 위해 사실로 기록합니다.
- `tracing_processes_*` 는 M2 에서 채워집니다.

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
