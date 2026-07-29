# PerfTracker

안드로이드 앱의 성능을 **앱을 고치지 않고** 측정하는 CLI 입니다.

측정 대상 앱에 SDK 를 넣지 않고, 기기를 루팅하지 않고, 기기에 무언가를 설치하지도 않습니다.
adb 로 붙어서 Perfetto 트레이스를 기기에 남기고, 그것을 호스트에서 파싱해
세션마다 `result.json` 하나를 남깁니다.

측정 대상은 **릴리즈 빌드로 설치된 아무 앱**입니다. 내가 만든 앱이든 아니든 상관없습니다.

> **이 저장소에서 작업을 이어받는다면** [`docs/STATUS.md`](docs/STATUS.md) 를 먼저 보세요 —
> 어디까지 왔고, 무엇을 확인하지 못했고, 다음에 무엇을 할 차례인지가 거기 있습니다.
> 이 README 는 **도구를 쓰는 법**을 말하고, 그쪽은 **프로젝트의 상태**를 말합니다.

---

## 무엇을 재는가 — 지표 7개

`result.json` 의 `metrics` 아래에 이 일곱 개가 들어갑니다. 키가 곧 수집기 id 입니다.

| 지표 | 귀속 범위 | 무엇인가 | 어디서 나오는가 |
| --- | --- | --- | --- |
| [`frame`](#metricsframe) | 앱 | 프레임별 실제 소요 시간의 분포·백분위 | perfetto `android.surfaceflinger.frametimeline` |
| [`startup`](#metricsstartup) | 앱 | 콜드 스타트 시간 (`--launch` 세션만) | `am start -W` — **유일하게 트레이스를 안 읽는 지표** |
| [`cpu`](#metricscpu) | **앱 + 기기 전역** | 앱 프로세스의 CPU 시간, 기기 전체 사용률·코어별·주파수 | perfetto `linux.sys_stats` + `linux.process_stats` |
| [`memory`](#metricsmemory) | **앱 + 기기 전역** | 앱 프로세스의 RSS 통계, 기기 전체 meminfo | perfetto `linux.process_stats` + `linux.sys_stats` |
| [`log`](#metricslog) | **앱 + 기기 전역** | 우선순위별 로그 개수, 크래시·ANR 목록 | perfetto `android.log` |
| [`thermal`](#metricsthermal) | 기기 전역 | 센서별 온도의 세션 전/후 차이 | `dumpsys thermalservice` 전/후 스냅샷 |
| [`network`](#metricsnetwork) | **uid** | 세션 동안 오간 바이트·패킷 | `dumpsys netstats` 전/후 스냅샷 |

범위 열을 그냥 넘기지 마세요. 이 도구가 가장 자주 오해받은 자리입니다:

- **`cpu` · `memory` · `log` 는 앱 단위와 기기 전역을 함께 싣고, 필드 이름이 그 범위를
  말합니다.** `app` 아래는 대상 앱의 것이고 `device_` 로 시작하는 것은 기기 전체의 것입니다.
  같은 세션에서 두 값이 **45배** 차이 난 적이 있습니다 (로그: 앱 37줄 vs 기기 전역 1,507줄).
- **`thermal` 은 기기 전역뿐입니다.** 앱별 온도는 물리적으로 존재하지 않습니다.
- **`network` 은 패키지가 아니라 uid 단위입니다.** 실기기에서 uid 하나를 86개 패키지가
  공유하는 것을 봤습니다. 귀속 범위의 정본은 `shared_uid_packages` 배열입니다.

---

## 어느 안드로이드에서 되는가

**Android 11(sdk 30)부터 동작합니다.** 다만 두 지표에는 더 높은 하한이 있습니다:

| 지표 | 최소 | 왜 |
| --- | --- | --- |
| `frame` | **Android 12** (sdk 31) | `android.surfaceflinger.frametimeline` 데이터소스가 그때 생겼습니다 |
| `network` | **Android 14** (sdk 34) | `dumpsys netstats` 의 `mAppUidStatsMap` 절이 그때부터입니다 |
| 나머지 5개 | Android 11 | thermal 만 sdk 29 하한이 따로 있습니다 |

**기기를 꽂고 `perftracker doctor` 를 돌리면 그 기기에서 무엇을 잴 수 있는지 알려줍니다:**

```
✗ metric: frame     이 기기에서는 측정할 수 없습니다 — sdk_int=30 로는 수집할 수 없습니다 (최소 31, Android 12)
✓ metric: startup   측정 가능
✓ metric: cpu       측정 가능
...
✗ metric: network   이 기기에서는 측정할 수 없습니다 — sdk_int=30 로는 수집할 수 없습니다 (최소 34, Android 14)
```

못 재는 지표가 있어도 **`doctor` 는 실패하지 않습니다**(종료 코드 0). 그건 고칠 수 없는
기기의 성질이지 환경 오류가 아니기 때문입니다 — `adb` 를 못 찾는 것과는 다릅니다.
`start` 도 세션을 열면서 같은 목록을 한 번 더 보여줍니다.

버전별 상세 표와 그것을 어떻게 확인했는지는 [`docs/STATUS.md`](docs/STATUS.md) 의
"어느 안드로이드 버전에서 무엇이 되는가" 에 있습니다.

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

**터미널에도 요약을 찍지 않습니다.** `stop` 과 `extract` 는 `result.json` 의 경로만 알려주고
끝납니다. 어느 지표를 앞에 둘지, 무엇을 굵게 쓸지 자체가 이미 판단이고, 요약을 만들려면
"무엇이 중요한가" 를 도구가 정해야 하기 때문입니다. 산출물은 `result.json` 하나입니다.

---

## 설치

**Node 20.19 이상**이 필요합니다 (`package.json` 의 `engines`). npm workspaces 를 쓰는
모노레포라 **저장소 루트에서 한 번** `npm install` 하면 `packages/core` 와 `packages/cli` 가
함께 설치되고 서로 링크됩니다. 패키지 디렉토리 안에서 따로 설치하지 마세요.

```bash
git clone https://github.com/KimHance/PerfTracker.git && cd PerfTracker
npm install
npm run build        # tsc --build. dist/ 가 있어야 CLI 가 돕니다
npx perftracker doctor
```

런타임 의존성은 `zod` 와 `commander` 둘뿐입니다. 안드로이드 SDK 도, Gradle 도,
JDK 도 필요 없습니다 — 이 도구는 앱을 빌드하지 않습니다.

### `adb`

다음 순서로 찾습니다. 하나만 되면 됩니다.

1. `--adb <경로>` 옵션
2. `PERFTRACKER_ADB` 환경변수
3. `PATH`
4. `ANDROID_HOME` / `ANDROID_SDK_ROOT` 의 `platform-tools/`
5. OS 기본 SDK 경로 (macOS 는 `~/Library/Android/sdk`)

**`adb` 가 `PATH` 에 없는 것이 드문 일이 아닙니다.** Android Studio 만 깔면 보통 그렇습니다.
이 저장소의 개발 맥에서도 그랬고, 실제 경로는
`~/Library/Android/sdk/platform-tools/adb` 였습니다. 4·5번 규칙이 그 경우를 덮으므로
대개는 아무것도 안 해도 되지만, SDK 를 기본 위치가 아닌 곳에 두었다면:

```bash
export PERFTRACKER_ADB="$HOME/Library/Android/sdk/platform-tools/adb"
# 또는
export ANDROID_HOME="$HOME/Library/Android/sdk"
```

`perftracker doctor` 가 무엇을 찾았는지 그대로 보여줍니다. 막히면 거기서부터 보세요.

### 기기

준비물은 **USB 디버깅 켜기**가 전부입니다. 기기에 아무것도 설치하지 않고 루팅도 필요 없습니다.

- **Android 12(API 31) 이상**이어야 프레임 타이밍(`android.surfaceflinger.frametimeline`)을
  얻을 수 있습니다. 그 아래에서는 `metrics.frame` 이 `unsupported` / `sdk_too_low` 입니다.
- **`metrics.network` 은 Android 14(sdk 34) 이상**에서만 나옵니다 (아래 해당 절 참고).
- **기기를 하나만 연결해 두세요.** 에뮬레이터를 함께 켜 두면 기기가 둘이 되어
  `AmbiguousDeviceError` 가 납니다. 굳이 둘을 두려면 `-d, --device <serial>` 로 지목하세요
  (단 온-디바이스 테스트는 serial 을 넘기지 않습니다 — 아래 "개발" 참고).

### 트레이스 파서 (`trace_processor_shell`)

**따로 설치하지 않습니다.** 첫 `stop`(또는 `extract`) 때 자동으로 내려받아
`~/.perftracker/bin/` 에 캐시합니다. 받은 바이트는 **크기와 SHA256 을 둘 다 검증**한 뒤에만
저장하므로, 프록시가 중간에서 응답을 바꾸면 조용히 넘어가지 않고 실패합니다.
(고정 버전은 `perfetto/traceProcessor/locate.ts` 의 `TRACE_PROCESSOR_VERSION` 하나가
소유합니다. 현재 `v57.2`, 약 12~14MB.)

- 네트워크를 쓰고 싶지 않으면 `--offline` 을 주세요. 캐시가 없으면 **받을 URL 과 둘 자리를
  오류 메시지에 찍고** 멈춥니다 — 그 파일을 손으로 받아 그 경로에 두면 됩니다.
- 이미 가진 바이너리를 쓰려면 `PERFTRACKER_TRACE_PROCESSOR` 에 절대 경로를 주세요.
- 캐시 위치를 옮기려면 `PERFTRACKER_HOME` 을 바꾸세요 (기본 `~/.perftracker`).
  이 디렉토리에는 활성 세션 포인터(`active/<serial>.json`)도 함께 삽니다.
- 회사 방화벽 등으로 `commondatastorage.googleapis.com` 이 막혀 있으면 다른 머신에서 받아
  옮긴 뒤 `PERFTRACKER_TRACE_PROCESSOR` 로 지정하는 것이 가장 빠릅니다.

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

### 측정 중에 무슨 일이 있었는지 적어 두기 (`mark`)

시계열(`timeline`)은 "3초에 CPU 가 뛰었다" 는 말해 주지만 **그 3초가 무엇이었는지**는 말해
주지 못합니다. 그것을 아는 것은 기기 앞에 있던 사람뿐이고, 그 순간에 적어 두지 않으면 다시는
복원되지 않습니다.

```bash
# 측정이 도는 동안, 다른 터미널에서
npx perftracker mark "홈 진입"
npx perftracker mark "스크롤 시작" --session a3f9c1   # 세션이 여럿이면 고유값으로 지정
npx perftracker mark "광고 재생" -d R5CT0000001       # 기기로 지정해도 됩니다
```

**이 명령은 기기에 아무것도 보내지 않습니다.** 호스트의 세션 파일만 고치므로 측정 창(§"이
도구가 지키는 두 가지")을 깨지 않습니다. 정지하면 `result.json` 의 `session.marks[]` 에
세션 시작으로부터의 경과와 함께 들어갑니다:

```json
"session": {
  "marks": [
    { "offset_ms": 11353, "label": "홈 진입" },
    { "offset_ms": 13373, "label": "스크롤 시작" }
  ]
}
```

`offset_ms / 1000` 은 각 지표 `timeline[].second` 와 **같은 축**입니다 — 그래서 시계열 위에
그대로 세로선으로 얹을 수 있습니다. 진행 중인 세션이 하나뿐이면 아무것도 지정하지 않아도 되고,
둘 이상인데 지정하지 않으면 **아무 데도 붙이지 않고 어느 세션인지 묻습니다.**

### 화면으로 하고 싶다면 (GUI)

같은 흐름을 브라우저에서 할 수 있습니다.

```bash
npm run gui   # 빌드 · 서버 · 브라우저까지 이 한 줄이 다 합니다
```

옵션을 주려면 `npx perftracker gui -p 7333` 처럼 CLI 를 직접 부릅니다 (`npm run build` 가
한 번은 돌아 있어야 합니다).

세션을 **동시에 여러 개** 돌릴 수 있게 브라우저 탭처럼 상단 탭바로 나뉘고, 기기를 고르면 그
기기에서 못 재는 지표를 **시작 전에** 알려 줍니다. 측정 중 화면에는 경과 시간과 정지 버튼,
그리고 마킹 입력만 있습니다 — GUI 에서 남긴 마킹과 터미널에서 `perftracker mark` 로 남긴
마킹은 **같은 자리에 쌓입니다.**

| 옵션 | |
| --- | --- |
| `-p, --port <포트>` | 고정 포트 (생략하면 빈 포트를 고릅니다) |
| `-o, --out <dir>` | 결과를 저장할 디렉토리 (기본 `runs`) |
| `--no-open` | 브라우저를 자동으로 열지 않습니다 |

서버는 **127.0.0.1 에만 붙습니다.** 이 서버는 연결된 기기에 adb 를 보내고 run 디렉토리를 지울
수 있어서, 같은 네트워크의 다른 사람에게 열어 줄 이유가 없습니다.

브라우저를 새로고침해도 측정 중인 세션은 그대로 돌아옵니다 — 경과 시간도 0부터 다시 세지 않고
이어집니다. 터미널에서 `perftracker start` 로 연 세션도 화면에 나타납니다.

**기록을 클릭하면 세션 보고서가 새 창으로 열립니다.** `result.json` 에 있는 것이 전부
그려집니다 — 프레임 분포, 시계열 다섯, 기기·앱 정보, 경고, 측정 비용. 주소에 run id 가 있어
(`?report=<id>`) 그대로 공유할 수 있습니다.

시계열 하나에 마우스를 올리면 **나머지 시계열이 같은 초를 가리킵니다.** 마킹을 남겼다면
그 시각이 세로선으로 모든 그래프에 얹히고, 마커를 짚으면 그 순간의 값이 한꺼번에 읽힙니다.

보고서는 **판정하지 않습니다.** 임계선도, 점수도, "좋다/느리다" 도 없습니다 (「이 도구가 지키는 두 가지」의 2번).
못 잰 값은 `수집 안 함`(이 도구가 그 값을 낼 줄 모르던 시절의 세션)과 `값 없음`(재려다
못 잼)으로 **다르게** 적히고, 어느 쪽이든 카드가 사라지지는 않습니다.

디자인 정본은 측정 화면이 `docs/design/gui/HANDOFF.md`, 보고서가
`docs/design/report/HANDOFF.md`, 구현 규율은 `packages/gui/AGENTS.md` 입니다.

---

## 명령 전체

위 흐름에 나오지 않는 것까지 포함한 목록입니다. **실제로 측정하는 것은 `start` 와 `stop`
둘뿐이고** 나머지는 점검·조회·마킹·기록 관리입니다.

| 명령 | 무엇 | 기기 |
| --- | --- | --- |
| `perftracker doctor` | 환경과 기기 지원 여부를 점검 | 필요 |
| `perftracker devices` | 연결된 기기와 스펙 요약 | 필요 |
| `perftracker apps` | **열 수 있는** 앱을 런처 이름으로 (런처에 아이콘이 뜨는 것) | 필요 |
| `perftracker schema` | `result.json` 의 JSON Schema 를 출력 | 불필요 |
| `perftracker start` | 측정 시작 | 필요 |
| `perftracker mark <라벨>` | 측정 중인 세션에 마킹 | **접촉 안 함** |
| `perftracker status` | 진행 중인 세션 | **접촉 안 함** |
| `perftracker stop` | 종료 · 트레이스 회수 · `result.json` 생성 | 필요 |
| `perftracker extract <run-dir>` | 원본을 다시 파싱해 `result.json` 재생성 | 불필요 |
| `perftracker runs list` | 기록 목록 | 불필요 |
| `perftracker runs rename <id> <이름>` | 기록 이름 변경 (디렉토리 경로는 그대로) | 불필요 |
| `perftracker runs rm <id>` | 기록 삭제 (run 디렉토리째) | 불필요 |
| `perftracker gui` | 로컬 웹 GUI (Ctrl-C 까지 붙잡습니다) | 필요 |

「접촉 안 함」은 기기가 연결돼 있어도 adb 를 **보내지 않는다**는 뜻입니다. 그래서 이 셋은
측정 중에 불러도 안전합니다 — 마킹이 측정 결과를 바꾸지 않는 이유가 이것입니다.

### 기록 관리 (`runs`)

측정이 끝난 뒤의 파일 정리입니다. **GUI 의 기록 목록과 같은 일을 합니다** — 한쪽에만 있는
기능을 만들지 않는 것이 이 도구의 규칙이고, 판정과 파일 조작은 양쪽 다 core 의 같은 코드를
부릅니다.

```bash
npx perftracker runs                          # 목록 (list 가 기본)
npx perftracker runs rename a3f9c1 "홈 스크롤 2차"
npx perftracker runs rm a3f9c1                # 되돌릴 수 없습니다
npx perftracker runs rm --all --yes           # 전부 (--yes 없으면 거부합니다)
```

`rm` 은 **기록이 아닌 폴더도 지웁니다.** `start` 가 죽어 `session.json` 조차 없는 폴더는
목록에 안 뜨는데, 그런 것까지 지워야 "전부 지웠다" 가 사실이 됩니다. 다만 **측정 중인 세션의
폴더는 남깁니다** — 그 자리는 `stop` 이 트레이스를 회수해 쓸 곳입니다.

`--all` 이 `--yes` 를 요구하는 것은 되묻지 않기 위해서입니다. CI 에서 입력을 기다리면 빌드가
타임아웃까지 매달립니다. id 를 직접 적은 삭제는 그 자체가 의사 표시라 묻지 않습니다.

### 조회 결과를 JSON 으로 (`--json`)

`doctor` · `devices` · `apps` · `status` · `runs` 는 `--json` 을 받습니다.

```bash
npx perftracker doctor --json     # 이 기기가 무엇을 잴 수 있는지 기계가 읽는 형태로
npx perftracker devices --json
```

**사람이 읽는 문장이 기본이고 이것은 추가 모드입니다** — 사람과 기계(CI · LLM)가 둘 다
소비자입니다. `start` / `stop` / `mark` 에는 없습니다: 그 셋의 출력은 이미 한 줄(경로 하나)이고,
시작 전에 알아야 할 것은 `doctor --json` 이 전부 줍니다.

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
| `tool` | 도구 이름·버전과 **이것을 돌린 컴퓨터**(`host.os` / `arch` / `node`) |
| `session` | id, 이름, `state`, 시작/종료 시각, 길이 (아래 참고) |
| `device` | 기기 스펙(`static`)과 세션 전후 상태(`state_before` / `state_after`) |
| `target_app` | 패키지, 라벨, 버전, 렌더 프로세스와 pid, **빌드 속성**(`debuggable` / `large_heap` / `min_sdk` / `target_sdk` / `primary_cpu_abi`) |
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

### `target_app` 의 빌드 속성

`dumpsys package` 한 번의 출력에서 함께 읽습니다 — **기기 왕복이 늘지 않습니다.**

```json
{
  "package": "com.example.streaming",
  "version_name": "8.28.3",
  "debuggable": false,
  "large_heap": true,
  "min_sdk": 26,
  "target_sdk": 36,
  "primary_cpu_abi": "arm64-v8a"
}
```

- **`debuggable: true` 면 그 세션은 릴리스 빌드를 잰 것이 아닙니다.** 디버그 빌드는 JIT ·
  검증 · 로깅이 달라 수치를 릴리스와 나란히 놓을 수 없습니다. 이 도구는 그 사실을 **판정하지
  않고 적기만** 합니다 — 비교해도 되는지는 데이터를 읽는 쪽이 정합니다.
- **`false` 와 `null` 은 다릅니다.** `false` 는 "릴리스임을 확인했다" 이고 `null` 은
  "확인하지 못했다" 입니다. 다섯 필드 모두 그렇습니다.
- `large_heap` 은 `metrics.memory` 의 RSS 를 읽을 때 상한이 다르다는 사실입니다.
- `primary_cpu_abi` 는 이 앱이 **실제로 실행되는** ABI 로, `device.static.abis` 의 부분집합입니다.
  64비트 기기에서 32비트로 도는 앱이 여기서 갈립니다. 네이티브 코드가 없으면 `null` 입니다.

### `tool.host`

이 도구를 **돌린 컴퓨터**입니다 (`os` / `arch` / `node`). 같은 앱·같은 기기인데 수치가 다른 두
세션을 비교할 때, 호스트가 달랐다는 사실이 후보에서 빠지면 원인을 기기에서만 찾게 됩니다.

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
  "buckets": [ { "from_ms": 0, "to_ms": 5, "count": 812 }, "...61개" ],
  "percentiles": { "p50": 9.2, "p90": 21.4, "p95": 28.1, "p99": 96.3 },
  "mean_ms": 12.8,
  "max_ms": 312.4,
  "timeline": [ { "t_s": 0, "count": 119, "p50_ms": 6.81, "max_ms": 24.03 }, "..." ]
}
```

- `buckets` 는 **항상 61개**로 고정입니다. 경계는 `[from, to)` 반개구간이고,
  마지막 버킷은 `to_ms: null` (= 700ms 이상, 상한 없음)입니다.
  **폭은 구간마다 다릅니다** — 5~16ms 는 1ms, 16~50ms 는 2ms, 50~130ms 는 4ms 로 조밀하고,
  130ms 부터는 30 → 50 → 100ms 로 넓어집니다. 130ms 를 넘은 프레임에서 분포가 답하는 질문은
  "165냐 185냐" 가 아니라 "이런 것이 몇 개 있었나" 이고, 정확한 값은 `percentiles` 와
  `max_ms` 가 소수점까지 말합니다.
  흔히 쓰이는 예산 부근을 1ms 로 조밀하게 보고 꼬리로 갈수록 폭을 넓힙니다.
- 종료 이벤트를 못 받은 미완결 프레임(`dur = -1`)은 집계에서 **제외**됩니다.
- `timeline` 은 **1초 단위 추이**입니다. `buckets` 와 같은 원본에서 나오고 같은 규칙으로
  미완결 프레임을 거릅니다. 집계만으로는 구분되지 않는 것 — 내내 고르게 느렸는지, 특정
  구간에서만 튀었는지 — 을 보려는 값입니다. **값이 없는 초는 배열에 없습니다**(0 으로 채우지
  않습니다: 앱이 화면을 안 바꾸면 프레임이 아예 안 나오는 것이 정상이라, 0 으로 메우면
  "한 장도 못 그렸다" 와 "그 초의 표본이 없다" 가 같은 모양이 됩니다).

> **여기에 "몇 % 가 기준 안에 들었다" 는 값이 없습니다. 일부러 없습니다.**
>
> 프레임 예산은 기기의 주사율에 따라 달라집니다 — 60Hz 는 16.67ms 지만 120Hz 는 **8.33ms**,
> 90Hz 는 11.1ms 입니다. 어느 선을 쓸지는 기기·안드로이드 버전·그 앱이 목표하는 바에 따라
> 달라지고, 그것을 고르는 일은 이 데이터를 읽는 쪽의 몫입니다.
>
> 판단에 필요한 것은 결과에 다 있습니다:
>
> | 무엇 | 어디 |
> | --- | --- |
> | 프레임 분포 | `metrics.frame.buckets` (61개) |
> | 이 기기가 지금 몇 Hz 로 도는가 | `device.static.display.active_refresh_rate_hz` |
> | 이 기기가 지원하는 주사율 | `device.static.display.supported_refresh_rates_hz` |
> | 구글이 공개한 참고치 | [`references`](#references) (출처와 함께 기록만 되고 비교에 쓰이지 않음) |
>
> 한 가지 한계: 버킷 폭이 구간마다 달라서 **임계값이 버킷 경계와 어긋나면 그 비율은 버킷
> 폭만큼 근사**가 됩니다. 16.67ms 는 `16~18ms` 버킷 안에, 8.33ms 는 `8~9ms` 버킷 안에
> 있습니다. 정확한 경계가 필요하면 `trace.perfetto-trace` 원본이 그대로 남아 있습니다.

### `metrics.startup`

**이 값은 트레이스에서 계산한 것이 아니라 `am start -W` 가 보고한 숫자입니다.**
일곱 지표 중 유일하게 트레이스를 읽지 않습니다 — `start` 가 앱을 띄우면서 받아
`session.json` 에 적어 둔 것을 `extract` 가 그대로 옮깁니다. 그래서 이 지표는 TraceConfig 를
한 블록도 늘리지 않고, SDK 하한도 데이터소스 요구도 없습니다 (`am start -W` 는 어느
안드로이드에서나 돕니다).

```json
{
  "total_time_ms": 2743,
  "launch_state": "COLD",
  "status": "ok",
  "wait_time_ms": 2748
}
```

실기기(SM-F936N / Android 16 / sdk 36)에서 `com.example.streaming.debug` 를
`--launch` 로 콜드 스타트한 세션 `d62a76` 의 실측값입니다.

- `total_time_ms` — `am start -W` 의 `TotalTime`. 프로세스 시작부터 첫 프레임까지입니다.
  **ActivityManager 가 보고한 숫자를 그대로 옮긴 것**이지 이 도구가 트레이스에서 잰 값이
  아닙니다. 그래서 같은 세션의 `metrics.frame` 과는 출처가 다릅니다.
  **`null` 은 기기가 이 값을 내지 않았다는 뜻입니다** (아래 `status` 참조) — 0 이 아닙니다.
- `launch_state` — 기기가 준 `LaunchState` 원문 (`COLD` / `WARM` / `HOT`).
  **enum 으로 좁히지 않습니다** — 우리가 정하는 값이 아니라 기기가 뱉는 문자열이기
  때문입니다. 기기가 보고하지 않으면 `null` 입니다.
- `status` — `am start -W` 의 `Status:` 원문. 정상은 `ok`, 기다리다 포기하면 `timeout`.
- `wait_time_ms` — `WaitTime`, 즉 **호출자가 기다린 시간**입니다. 시작 시간이 아닙니다.
  `status` 가 `ok` 면 `TotalTime` 에 ActivityManager 자신의 오버헤드가 더해진 값이고
  (위 실측: 2,743 → 2,748ms, 5ms 차), **`timeout` 이면 ActivityManager 가 포기한 시점**입니다.

> **`timeout` 일 때 `wait_time_ms` 를 시작 시간으로 읽지 마세요.** 그때 이 값은 앱을 잰 것이
> 아니라 기기의 임계치입니다. 실측(SM-A405S / Android 11, 같은 앱 4회): **10182 · 10150 ·
> 10147 · 10163ms — 편차 0.3%.** 앱이 11초 걸리든 60초 걸리든 같은 값이 나옵니다.
> 읽을 수 있는 것은 하한 하나입니다: *"이 앱은 이 기기에서 `wait_time_ms` 안에 뜨지 못했다."*

한정 조건:

- **런처 액티비티까지만 잽니다.** `am start -W` 는 exported 진입점만 실행할 수 있습니다.
  앱 안쪽 화면으로 들어가는 시간은 이 지표가 재지 않습니다 (v1 범위 밖).
- **`--launch` 없이 시작한 세션에서는 `skipped` 입니다** (`launch_not_requested`).
  재려다 실패한 것이 아니라 잴 기회 자체가 없었다는 뜻이라 `partial` 이 아닙니다.
- **`am start -W` 가 `TotalTime` 을 아예 안 찍는 경우가 있습니다.** 기기가
  `Status: timeout` 을 내면 `TotalTime` 줄이 통째로 없습니다. **앱이 실행되지 않았다는 뜻이
  아닙니다** — 같은 세션에서 pid 는 확보되고 프레임·메모리도 정상 수집됩니다. 에뮬레이터에서
  **11세션 중 4회**, 실기기 SM-A405S(Android 11)에서는 **매번** 그랬습니다.
  그때도 `data` 는 `null` 이 아니라 **아는 것을 담습니다**:

  ```json
  { "total_time_ms": null, "launch_state": "UNKNOWN", "status": "timeout", "wait_time_ms": 10163 }
  ```

  자세한 원문과 근거는 아래 "`--launch` 인데 시작 시간이 안 나오는 경우" 를 보세요.
- **한 세션에 한 번뿐입니다.** 이 지표에는 분포도 표본 수도 없습니다. 값 하나가 그 세션의
  전부이므로, 편차를 보려면 세션을 여러 번 돌려 비교해야 합니다. 참고로 같은 실기기·같은 앱의
  콜드 스타트 4세션이 **509 / 747 / 822 / 3,199ms** 였습니다 — 한 번의 값으로 결론을 내지
  마세요.

값이 없을 때 `data` 는 `null` 이고 `reason_code` 가 갈래를 말합니다:

| `status` | `reason_code` | 뜻 |
| --- | --- | --- |
| `skipped` | `launch_not_requested` | `--launch` 없이 시작했다. 잴 기회가 없었다. |
| `partial` | `launch_wait_timed_out` | 기기가 `Status: timeout` 을 냈다. `detail.wait_time_ms` 에 기기가 보고한 `WaitTime` 이 있다. **앱이 안 떴다는 뜻이 아니다.** |
| `partial` | `launch_time_unreported` | `TotalTime` 이 없는데 기기가 이유도 말하지 않았다. `detail.am_start_status` 에 기기가 낸 `Status:` 원문이 있다 (그것조차 없으면 `null`). |

> **`launch_wait_timed_out` 을 실패로 집계하지 마세요.** 그것은 이 도구의 결함도 앱의 결함도
> 아니고, "이 세션에서는 시작 시간만 못 쟀다" 는 사실입니다. 앱이 실제로 떴는지는
> `target_app.pid` 와 다른 지표들이 말합니다. 세션 전체에는 경고
> `app_launch_time_unmeasured` 가 함께 실립니다.

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
  "device_timeline": [ { "t_s": 1, "busy_pct": 43.8 }, { "t_s": 2, "busy_pct": 43.54 }, "..." ],
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
- **`device_timeline` 은 기기 전체 사용률의 초당 추이입니다.** `app.timeline` 이 **시간(ms)**
  인 것과 달리 여기는 **백분율**이고, **전 코어를 합쳐 100%** 입니다 (8코어가 전부 바쁘면 100).
  같은 `cpu.times.*` 카운터를 다시 접은 것이라 **기기에 아무것도 더 묻지 않습니다.**
  `app.timeline` 과 같은 이유로 **첫 초는 배열에 없고**(누적값이라 앞에 뺄 대상이 없음),
  되감긴 초는 버립니다. 초당으로 나눌 수 없으면 `[]` 가 아니라 `null` 입니다.
  집계값 `device_total_busy_pct` 와 이 배열의 평균은 정확히 같지 않습니다 — 집계는 전체
  첫·마지막 표본의 차이 하나로 내고 배열은 초 경계마다 끊습니다 (실측 36.44 vs 35.9).

### `metrics.memory`

대상 앱 프로세스 **하나**의 RSS 를 세션 동안 1초 주기로 관측한 통계입니다.
기기 전체 메모리(`system`)는 그 옆에 두고 읽는 맥락입니다 — "앱이 큰 것" 과 "기기가 이미
쪼들리던 것" 은 다른 사실이고, 둘이 나란히 없으면 가를 수 없습니다.

```json
{
  "process": "com.nhn.android.webtoon",
  "pid": 26424,
  "samples": 72,
  "rss":      { "min_kb": 21396, "max_kb": 369576, "avg_kb": 280044 },
  "rss_anon": { "min_kb": 14744, "max_kb": 197668, "avg_kb": 108851 },
  "rss_file": { "min_kb": 6400,  "max_kb": 174260, "avg_kb": 169902 },
  "rss_watermark_peak_kb": 494432,
  "system": {
    "mem_total_kb": 7394224,
    "mem_available": { "min_kb": 2725828, "max_kb": 3215192, "avg_kb": 2879622 },
    "mem_free":      { "min_kb": 196048,  "max_kb": 452376,  "avg_kb": 396176 },
    "cached":        { "min_kb": 2591928, "max_kb": 2709448, "avg_kb": 2606573 },
    "swap_total_kb": 8388604,
    "swap_free":     { "min_kb": 5818808, "max_kb": 5888932, "avg_kb": 5824497 }
  },
  "system_timeline": [ { "t_s": 0, "mem_available_kb": 4720636, "mem_free_kb": 286832 }, "..." ]
}
```

실기기(SM-S901N / Android 16 / sdk 36)의 72.9초 세션 `da49c4` 실측값입니다.
72초에 표본 72개 — 폴링 주기가 1초라는 것이 그대로 보입니다.

- **단위는 전부 kB 입니다.** `trace_processor` 는 바이트로 주므로 이 도구가 변환합니다.
  필드 이름의 `_kb` 접미어가 그 계약입니다.
- **`system_timeline` 은 기기 전체 가용 메모리의 초당 추이입니다.** 앱 RSS(`timeline`)와
  나란히 놓고 읽는 값입니다 — 앱이 늘어도 기기 가용이 그만큼 줄지 않을 수 있습니다(캐시 회수).
  `system` 집계와 **같은 meminfo 카운터**를 다시 접은 것이라 기기에 더 묻지 않습니다.
  meminfo 는 누적이 아니라 그 순간의 값이라 **첫 초도 배열에 있습니다** (`cpu.device_timeline`
  이 첫 초를 빼는 것과 다릅니다). `MemAvailable` 과 `MemFree` 중 한쪽만 있는 초는 버립니다 —
  나머지를 0 으로 채우면 "재 봤더니 0" 이라는 거짓말이 됩니다. 남는 점이 없으면 `null` 입니다.
- `rss` / `rss_anon` / `rss_file` 은 **세션 구간의 관측 통계**(min/max/avg)입니다.
  `linux.process_stats` 가 `/proc/<pid>/status` 를 폴링해 만든 `mem.rss` 계열 카운터에서
  나옵니다. `rss_anon` / `rss_file` 은 해당 카운터가 트레이스에 없으면 `null` 입니다 —
  없는 것을 0 으로 채우지 않습니다.
- **`min_kb` 를 "이 앱의 최소 사용량" 으로 읽지 마세요.** `--launch` 세션의 첫 표본은 앱이
  갓 fork 된 직후라 아주 작고, 그 뒤 올라간 것이 같은 프로세스입니다.
  `--launch` 여부가 이 값을 완전히 갈라놓습니다 (실기기 5세션 실측, 단위 kB):

  | 세션 | `--launch` | `rss.min_kb` | `rss.max_kb` |
  | --- | --- | --- | --- |
  | `da49c4` | 있음 | **21,396** | 369,576 |
  | `5a6e26` | 있음 | **38,036** | 359,256 |
  | `9e8c75` | 있음 | **99,312** | 375,736 |
  | `f58e76` | 있음 | **142,772** | 309,472 |
  | `b8fb03` | **없음** | **362,508** | 365,268 |

  이미 떠 있던 앱을 잰 마지막 줄만 `min` 과 `max` 가 거의 같습니다. **콜드 스타트 세션의
  `min_kb` 는 앱의 특성이 아니라 "언제부터 쟀는가" 를 말합니다.**

**`rss_watermark_peak_kb` 는 이 세션의 값이 아닙니다.** 이 필드만 성격이 다릅니다:

- `/proc/<pid>/status` 의 **`VmHWM`** 이고, **프로세스가 시작된 뒤 지금까지의 최고점**을
  커널이 기억하고 있는 값입니다. 옆의 `rss.max_kb` 는 이 세션에서 1초 주기로 관측한
  최댓값이라 **구간이 다릅니다.**
- 그래서 **`--launch` 없이 이미 떠 있던 앱을 잰 세션에서는 몇 시간 전, 혹은 이전 세션의
  최고점이 그대로 실립니다.** 실측 예 — 같은 pid(12103)를 이어서 잰 두 세션:

  | 세션 | `--launch` | `rss.max_kb` | `rss_watermark_peak_kb` |
  | --- | --- | --- | --- |
  | `9e8c75` | 있음 | 375,736 | 382,320 |
  | `b8fb03` | **없음** | 365,268 | **382,320** (동일) |

  두 번째 세션은 관측된 최댓값이 오히려 **더 낮은데** 워터마크는 첫 세션에서 찍힌 값
  그대로입니다. 이것을 "폴링이 놓친 이번 세션의 진짜 피크" 로 읽으면 안 됩니다.
- **이번 세션 구간의 피크가 필요하면 `rss.max_kb` 를 쓰세요.**
- `null` 은 트레이스에 `mem.rss.watermark` 카운터가 없었다는 뜻입니다.

`system` 에 대해:

- `linux.sys_stats` 의 meminfo 에서 나오는 **기기 전체** 값입니다. 대상 앱과 무관하게
  같은 시간에 돈 모든 것이 섞입니다.
- **필요한 항목이 하나라도 빠지면 통째로 `null` 입니다.** 반쯤 채운 시스템 메모리는 읽는 쪽이
  구분할 수 없는 거짓말이 되므로, 그 자리를 0 으로 메우지 않고 포기합니다. 그때 앱 RSS 는
  그대로 나오고 `reason_code` 가 `no_meminfo_samples` 입니다 (`status` 는 `partial` 이지만
  **`data` 는 non-null** — 값이 없다는 뜻이 아닙니다).

**프로세스를 하나만 고르고 합산하지 않습니다.** CPU 와 결론은 같지만 이유는 다릅니다:

- CPU 를 안 합치는 이유는 "더할 대상 집합이 완전하지 않아서" 입니다 (위 cpu 절 참고).
- **메모리는 그것에 더해, 합산 자체가 틀립니다.** 여러 프로세스의 RSS 를 더하면 공유
  페이지(zygote 가 물려준 프레임워크 코드, 공유 라이브러리, 파일 매핑)를 **여러 번 셉니다.**
  그렇게 나온 숫자는 어느 프로세스의 것도 아니고 기기가 실제로 쓴 양도 아닙니다.
- 그래서 `metrics.memory` 에는 `other_processes` 같은 배열이 없습니다. 대표 프로세스 하나의
  값만 있고, 그것이 어느 프로세스인지 `process` / `pid` 가 말합니다.

값이 없을 때 / 한정이 붙을 때:

| `status` | `reason_code` | `data` | 뜻 |
| --- | --- | --- | --- |
| `unsupported` | `data_source_not_registered` | `null` | 이 기기에 `linux.process_stats` 가 없다. |
| `partial` | `process_not_in_trace` | `null` | 대상 앱 프로세스를 트레이스에서 특정하지 못했다. |
| `partial` | `no_rss_samples` | `null` | 프로세스는 찾았는데 `mem.rss` 표본이 없다. |
| `partial` | `process_name_stale_in_trace` | **non-null** | 값은 다 있다. 트레이스가 그 프로세스를 다른 이름으로 알고 있어 pid 로 확인했다는 뜻이다 (아래 참고). |
| `partial` | `no_meminfo_samples` | **non-null** | 앱 RSS 는 있고 `system` 만 `null` 이다. |
| `failed` | `trace_missing` / `query_failed` | `null` | 트레이스 원본이 없거나 쿼리가 예외로 터졌다. |

> **사유 자리는 하나뿐입니다.** `process_name_stale_in_trace` 와 `no_meminfo_samples` 가
> 겹치면 **정체성 쪽(`process_name_stale_in_trace`)이 먼저 실립니다** — meminfo 가 없다는
> 사실은 `system: null` 로 데이터에 이미 드러나지만, "이 프로세스가 그 앱이라는 근거가
> 이름이 아니라 pid 였다" 는 데이터 어디에도 안 남기 때문입니다.

`process_name_stale_in_trace` 는 예외 상황이 아닙니다 — 실기기의 최근 두 `--launch` 세션
(`5a6e26`, `da49c4`)이 둘 다 이 사유를 달았습니다. **값이 잘못됐다는 뜻이 아닙니다.**
자세한 것은 아래 "트레이스가 앱을 다른 이름으로 아는 경우" 를 보세요.

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
  "tracing_processes_cpu_time_ms": 5570,
  "tracing_processes_cpu_share_pct": 1,
  "tracing_processes_peak_rss_kb": 15436,
  "adb_commands_during_session": 0,
  "trace_buffer_overrun": false
}
```

(실기기 72.9초 세션 `da49c4` 의 실측값입니다. 같은 세션에서 대상 앱은
`share_of_device_cpu_pct` 가 1.72 였으므로, 트레이싱이 쓴 몫이 앱과 같은 자릿수라는 뜻입니다 —
아래 하한 단서와 함께 읽으세요.)

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
  쓴 CPU 시간과 RSS 입니다. `cpu_share_pct` 의 분모는 `metrics.cpu` 의
  `app.share_of_device_cpu_pct` 와 **같은 분모**(같은 구간 기기 전체의 CPU 시간)라
  두 백분율을 서로 비교할 수 있습니다. 셋 다 `null` 이면 트레이스 원본이 없거나 쿼리가
  실패한 것입니다.

  > **이건 트레이싱의 총비용이 아니라 체계적인 하한입니다.** 커널이 ftrace 이벤트를
  > 링버퍼에 기록하는 비용은 그 순간 인터럽트당한 프로세스(대상 앱일 수 있습니다)에
  > 청구되므로 이 숫자에 들어오지 않습니다. 켜는 ftrace 이벤트를 줄이면 그 몫도 줄지만
  > 0 이 되지는 않습니다.

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
npm run build     # 먼저 한 번 — 아래 테스트가 core 의 dist/ 를 씁니다
npm test          # 유닛 테스트 (기기 불필요) — 현재 723개, 1초 미만
npm run typecheck # src + test 전체 타입체크
npm run test:device   # 온-디바이스 스펙 (기기가 꽂혀 있어야 함) — 현재 11개
```

**갓 클론한 저장소에서는 `npm run build` 가 먼저입니다.** `packages/cli` 의 테스트가
`@perftracker/core` 를 `dist/` 로 해석하므로, 빌드 없이 `npm test` 를 돌리면 스위트 하나가
`Failed to resolve entry for package "@perftracker/core"` 로 실패합니다.

- `packages/core` — 기기·세션·수집·파싱. 도메인 로직 전부.
- `packages/cli` — 얇은 껍데기. 명령 조립과 출력 포맷만.

`core` 는 구체 프로세스 실행기를 공개하지 않습니다. 기기 접촉은 `AdbClient` 를 통해서만
가능하고, 그래야 측정 창 래치를 우회할 수 없습니다.

새 메트릭을 붙이려면 `Collector` 를 하나 만들어 `collectors/registry.ts` 의
`COLLECTORS` 에 넣으면 됩니다. `start` 가 TraceConfig 블록을 모으고 `extract` 가
`metrics[collector.id]` 를 채우는 것은 그 배열을 순회해서 일어납니다.

### 온-디바이스 테스트를 다른 기기에서 돌리기

**이것을 먼저 읽지 않으면 새 기기에서 `npm run test:device` 가 실패합니다.**

세션을 여는 온-디바이스 스펙은 대상 앱을 **고정**합니다. 기본값은
**`com.nhn.android.webtoon`**(네이버 웹툰)이고, 그 앱이 없는 기기에서는 실패합니다.

```bash
# 이 기기에 있는 서드파티 앱 하나를 골라 덮는다
PERFTRACKER_TEST_APP=<패키지명> npm run test:device

# 기기가 두 대 이상 꽂혀 있으면 어느 기기인지도 지정해야 한다
PERFTRACKER_TEST_DEVICE=<serial> PERFTRACKER_TEST_APP=<패키지명> npm run test:device
```

**기기가 둘이면 지정하지 않은 채로는 11개가 전부 실패합니다** (`AmbiguousDeviceError`).
한 대만 꽂혀 있으면 `PERFTRACKER_TEST_DEVICE` 는 필요 없습니다.

고를 앱의 조건은 둘입니다.

1. **런처 액티비티가 있어야 합니다.** `--launch` 가 그것으로 콜드 스타트합니다.
   런처처럼 진입점이 없는 앱을 고르면 `No activity found` 로 거부됩니다.
2. **강제 종료돼도 괜찮은 앱이어야 합니다.** `--launch` 는 `am force-stop` 후 재실행이라
   스펙을 돌릴 때마다 그 앱이 죽고 화면에 튀어나옵니다. 설치된 앱은
   `npx perftracker apps` 로 볼 수 있습니다.

앱이 없으면 스펙은 **조용히 건너뛰지 않고 실패합니다.** 무엇이 없어서 못 도는지와 어떻게
바꾸는지를 메시지에 적습니다 (`assertTargetAppInstalled`). 건너뛰기를 넣지 않은 이유는
단순합니다 — 건너뛴 스펙은 통과한 스펙과 같은 색으로 보이고, 그러면 이 스펙이 지키려는 것이
아무 데서도 지켜지지 않습니다.

**왜 고정하는가:** 예전에는 CLI 기본값(포그라운드 앱)을 그대로 썼습니다. 그래서 **사람이
화면에 무엇을 두었는가가 테스트의 커버리지와 결과를 정했습니다.** 5회 연속 실행이 그것을 두
모양으로 드러냈습니다 — 포그라운드가 우연히 설정 앱이라 시스템 앱 경로만 밟은 회차, 그리고
폰이 홈 화면이라 포그라운드가 런처였고 런처에는 런처 액티비티가 없어 `--launch` 자체가
거부된 회차. 코드가 아니라 폰이 어느 화면에 있었는가가 원인이었습니다.

그 밖에 새 기기에서 걸리는 것들:

- **기기를 하나만 연결하세요.** 온-디바이스 스펙은 `createContext({})` 라 serial 을 넘기지
  않습니다 — 에뮬레이터가 함께 켜져 있으면 `AmbiguousDeviceError` 로 전부 실패합니다.
- **화면이 꺼지면 세션이 의미를 잃습니다.** 필요하면 `adb shell svc power stayon usb`,
  **끝나면 반드시 `false` 로 원복하세요.**
- 스펙 파일들은 **직렬로** 돕니다 (`vitest.device.config.ts` 의 `fileParallelism: false`).
  같은 기기의 활성 세션 포인터를 공유하므로 병렬로 돌리면 서로의 세션을 밟아 가짜 실패가
  납니다. 이것을 켜지 마세요.
- 온-디바이스 스펙은 `npm test` 에서 제외되어 있습니다 (`vitest.config.ts`).
  기기 없이도 `npm test` 는 그대로 통과해야 합니다.

## 검증 환경

| 항목 | M0+M1 | M2 | M3 |
|---|---|---|---|
| 실기기 (SM-S901N, Android 16 / sdk 36) | ✅ | ✅ | ✅ |
| 에뮬레이터 (sdk_gphone64_arm64, API 35, 4코어) | — | ✅ | ✅ |

실기기 검증(2026-07-27)은 두 단계로 나뉩니다. **숫자가 다른 이유를 함께 적습니다** —
중간에 스펙이 하나 늘고 대상 앱이 바뀌었기 때문입니다.

| 언제 | 스펙 수 | 결과 | 대상 앱 |
| --- | --- | --- | --- |
| 실기기 검증 웨이브 | 10 | **5회 연속 10/10** | `com.android.settings` |
| CPU·Log 앱 단위화 이후 (현재) | 11 | **1회 11/11** | `com.nhn.android.webtoon` |

즉 **현재 스펙 구성으로 5회 연속을 돌린 적은 없습니다.** 5회 연속의 근거는 그 앞 구성의
것이고, 늘어난 스펙 하나는 "세션 스펙의 대상 앱이 이 기기에 설치되어 있다"(`m0`)입니다.
대상 앱을 바꾼 이유는 아래 "온-디바이스 테스트를 다른 기기에서 돌리기" 에 있습니다.

유닛 테스트는 `npm test` **723/723**, `npm run typecheck` · `npm run build` 클린입니다.

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

---

## 시계열 (`timeline`)

`frame` · `memory` · `cpu` · `log` 네 지표에 **1초 단위 추이**가 함께 실립니다.
집계값(평균·최대·백분위)만으로는 구분되지 않는 것을 보려는 값입니다:

```
 초 │ 프레임  p50  │ RSS MB │ CPU ms │ 로그(E)
  0 │     ·      · │    198 │      · │      ·     ← 앱 시작
  2 │    80   7.64 │    461 │   3400 │   8(3)
  9 │   159  10.38 │    555 │   1590 │ 16(16)     ← 에러가 몰린 구간
 12 │   187  10.99 │    570 │   1440 │ 122(11)
```

**네 지표가 같은 `t_s` 를 씁니다.** 기준점은 트레이스 전체의 시작(`trace_bounds.start_ts`)
하나이고, 지표마다 "자기 첫 표본" 을 0 초로 잡으면 겹쳐 그렸을 때 축이 어긋나기 때문입니다.

**기기에 더 묻지 않습니다.** 트레이스에 이미 있던 값을 집계로 접지 않고 그대로 내는 것뿐이라
측정 부하는 그대로입니다 (`result.json` 이 세션당 27KB → 36KB 정도로 커집니다).

몇 가지 한정이 있고, 전부 스키마의 `.describe()` 에도 적혀 있습니다:

- **`thermal` 과 `network` 에는 시계열이 없습니다.** 전/후 두 점뿐이고, 중간을 얻으려면 측정
  중에 `dumpsys` 를 반복해야 하는데 그것이 이 도구의 제1원칙을 깹니다.
- **`memory` 는 구간 평균이 아니라 그 순간의 표본**입니다. 표본 사이의 순간 최고점은 없습니다.
- **`cpu` 시계열의 합은 `app.total_ms` 이하**입니다. `total_ms` 는 전체 첫 표본부터 재고,
  시계열은 0 초 구간의 **마지막** 표본을 기준점으로 쓰기 때문입니다. 초당 표본이 하나뿐이면
  둘은 같아집니다 (실측: 콜드 스타트 세션에서 34,000ms vs 34,650ms).
- **`log` 시계열은 앱 프로세스의 것**입니다. 기기 전역이 아닙니다.
