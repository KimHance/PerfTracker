# PerfTracker

안드로이드 앱의 성능을 **앱을 고치지 않고** 측정하는 CLI 입니다.

측정 대상 앱에 SDK 를 넣지 않고, 기기를 루팅하지 않고, 기기에 무언가를 설치하지도 않습니다.
adb 로 붙어서 Perfetto 트레이스를 기기에 남기고, 그것을 호스트에서 파싱해
세션마다 `result.json` 하나를 남깁니다.

측정 대상은 **릴리즈 빌드로 설치된 아무 앱**입니다. 내가 만든 앱이든 아니든 상관없습니다.

```bash
npx perftracker doctor        # 설치 없이 바로 — 이 기기에서 뭘 잴 수 있는지
```

> 이 문서는 **도구를 쓰는 법**입니다. 아래 「개발」 절만 저장소에서 직접 작업하는 사람
> 대상이고, 나머지는 npm 으로 받아 쓰는 데 필요한 것입니다. 저장소는 [https://github.com/KimHance/PerfTracker](https://github.com/KimHance/PerfTracker) 입니다.

---

## 무엇을 재는가 — 지표 8개

`result.json` 의 `metrics` 아래에 이 여덟 개가 들어갑니다. 키가 곧 수집기 id 입니다.

| 지표 | 귀속 범위 | 무엇인가 | 어디서 나오는가 |
| --- | --- | --- | --- |
| [`startup`](#metricsstartup) | 앱 | 콜드 스타트 시간 (`--launch` 세션만) | `am start -W` — **유일하게 트레이스를 안 읽는 지표** |
| [`cpu`](#metricscpu) | **앱 + 기기 전역** | 앱 프로세스의 CPU 시간, 기기 전체 사용률·코어별·주파수 | perfetto `linux.sys_stats` + `linux.process_stats` |
| [`memory`](#metricsmemory) | **앱 + 기기 전역** | 앱 프로세스의 RSS 통계, 기기 전체 meminfo | perfetto `linux.process_stats` + `linux.sys_stats` |
| [`log`](#metricslog) | **앱 + 기기 전역** | 우선순위별 로그 개수, 크래시·ANR 목록 | perfetto `android.log` |
| [`thermal`](#metricsthermal) | 기기 전역 | 센서별 온도의 세션 전/후 차이 | `dumpsys thermalservice` 전/후 스냅샷 |
| [`network`](#metricsnetwork) | **uid** | 세션 동안 오간 바이트·패킷 | `dumpsys netstats` 전/후 스냅샷 |
| [`hwui`](#metricshwui) | 앱 | 프레임워크가 직접 센 렌더링 집계와 **원인별 개수** | `dumpsys gfxinfo` 전/후 스냅샷 |
| [`frame`](#metricsframe) | 앱 + **표시 프레임은 기기 합성** | 화면에 나간 프레임의 **시간축** (개수·백분위는 없음) | perfetto `android.surfaceflinger.frametimeline` — **sdk 31 이상** |

범위 열을 그냥 넘기지 마세요. 이 도구가 가장 자주 오해받은 자리입니다:

- **`cpu` · `memory` · `log` 는 앱 단위와 기기 전역을 함께 싣고, 필드 이름이 그 범위를
  말합니다.** `app` 아래는 대상 앱의 것이고 `device_` 로 시작하는 것은 기기 전체의 것입니다.
  같은 세션에서 두 값이 **45배** 차이 난 적이 있습니다 (로그: 앱 37줄 vs 기기 전역 1,507줄).
- **`thermal` 은 기기 전역뿐입니다.** 앱별 온도는 물리적으로 존재하지 않습니다.
- **`network` 은 패키지가 아니라 uid 단위입니다.** 실기기에서 uid 하나를 86개 패키지가
  공유하는 것을 봤습니다. 귀속 범위의 정본은 `shared_uid_packages` 배열입니다.
- **`hwui` 와 `frame` 은 같은 렌더링을 서로 다른 축으로 잽니다.** `hwui` 는 개수·백분위·
  원인을, `frame` 은 시간축(`samples`)만 냅니다 — 겹치는 숫자가 없습니다. `frame.frames_seen`
  을 `hwui.total_frames` 와 비교하지 마세요. 세는 대상이 다릅니다 (자세한 것은
  [`metrics.frame`](#metricsframe) 절 참고).
- **`frame.samples` 의 세 번째 값은 대상 앱만의 비용이 아닙니다.** SurfaceFlinger 가 그
  vsync 에 합성한 **표시 프레임(display frame)** 의 길이이고, 그때 함께 합성된 **모든
  레이어가 공유하는 시간**입니다 — 다른 앱·시스템 UI 가 같은 화면에 얹혀 있으면 대상 앱이
  아무것도 안 해도 이 값이 늡니다. 앱에 청구할 수 있는 것은 두 번째 값(앱이 그린 시간)뿐입니다.

---

## 어느 안드로이드에서 되는가

**Android 11(sdk 30)부터 동작합니다.** 두 지표에만 더 높은 하한이 있습니다:

| 지표 | 최소 | 왜 |
| --- | --- | --- |
| `network` | **Android 14** (sdk 34) | `dumpsys netstats` 의 `mAppUidStatsMap` 절이 그때부터입니다 |
| `frame` | **Android 12** (sdk 31) | `android.surfaceflinger.frametimeline` 데이터소스가 그때부터입니다 |
| 나머지 6개 | Android 11 | thermal 만 sdk 29 하한이 따로 있습니다 |

**렌더링 집계(`hwui`)는 어느 기기에서나 볼 수 있습니다.** `dumpsys gfxinfo` 에서 와서 버전
하한이 없습니다 — 실측 SM-A405S(sdk 30)에서도 전체 799장·분포 70칸이 나왔습니다.
**렌더링의 시간축(`frame`)은 다릅니다** — sdk 31 미만에서는 `metrics.frame` 이
`sdk_too_low` 로 나옵니다 (`hwui` 는 그 기기에서도 그대로 나옵니다).

**기기를 꽂고 `perftracker doctor` 를 돌리면 그 기기에서 무엇을 잴 수 있는지 알려줍니다:**

```
✗ metric: network   이 기기에서는 측정할 수 없습니다 — sdk_int=30 로는 수집할 수 없습니다 (최소 34, Android 14)
✓ metric: hwui      측정 가능
✓ metric: startup   측정 가능
✓ metric: cpu       측정 가능
...
✗ metric: network   이 기기에서는 측정할 수 없습니다 — sdk_int=30 로는 수집할 수 없습니다 (최소 34, Android 14)
```

못 재는 지표가 있어도 **`doctor` 는 실패하지 않습니다**(종료 코드 0). 그건 고칠 수 없는
기기의 성질이지 환경 오류가 아니기 때문입니다 — `adb` 를 못 찾는 것과는 다릅니다.
`start` 도 세션을 열면서 같은 목록을 한 번 더 보여줍니다.

버전별 상세 표와 그것을 어떻게 확인했는지는 저장소의 [`docs/STATUS.md`](https://github.com/KimHance/PerfTracker/blob/main/docs/STATUS.md) 의
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

진단 세션(`--diagnose`)에서 `--launch` 를 주면 그 같은 호출의 맨 앞에 **atrace 켜짐 대기**가
붙습니다 — `getprop` 으로 `debug.atrace.tags.enableflags` 와 `debug.atrace.app_number` 를 **읽기만**
하며 둘 다 켜질 때까지 최대 5초 기다린 뒤 앱을 띄웁니다. 트레이스는 atrace 가 켜지기 전에
시작하므로, 기다리지 않으면 그 사이에 뜬 앱의 `bindApplication` slice 가 빠집니다 (실기기에서
기다리지 않은 회 0개 · 기다린 회 1개). adb 호출은 그대로 한 번이고, 평소 세션에는 붙지 않습니다.

`--compile` 은 반대로 **기기를 일부러 바꿉니다** — 앱의 컴파일 상태를 맞춰 재려고 사람이 켜는 옵션이고, 그 변경은
세션이 끝나도 남습니다. 그래서 측정 창 **밖**, 트레이스 · 시작 스냅샷보다 앞에서 끝내고, 바꾼 사실을
`result.json` 의 [`session.compile`](#sessioncompile--바꾼-기록) 에 남깁니다. `--compile` 을 주지 않은 세션은
컴파일 상태를 바꾸는 명령을 하나도 보내지 않습니다.

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

값을 안 찍는 것과 **다음에 무엇을 열면 되는지 안 알려주는 것은 다릅니다.** `stop` 은 경로
아래에 보고서를 만드는 명령 한 줄을 같이 냅니다 — 그 줄은 그대로 쳐서 도는 명령입니다.

---

## 설치

**Node 20.19 이상**과 **adb**(Android Platform Tools)가 필요합니다. 그 둘뿐입니다 —
기기에 설치할 것도, 앱에 넣을 것도 없습니다.

```bash
npx perftracker doctor        # 설치 없이 바로. 이 기기에서 뭘 잴 수 있는지 알려줍니다
```

자주 쓰면 전역으로 두는 편이 낫습니다.

```bash
npm i -g perftracker
perftracker doctor
```

### 저장소에서 직접 쓸 때

npm workspaces 를 쓰는 모노레포라 **저장소 루트에서 한 번** `npm install` 하면
`packages/*` 가 함께 설치되고 서로 링크됩니다. 패키지 디렉토리 안에서 따로 설치하지 마세요.

```bash
git clone https://github.com/KimHance/PerfTracker.git && cd PerfTracker
npm install
npm run build        # tsc --build + 화면 빌드. dist/ 와 dist-web/ 이 있어야 돕니다
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
  얻을 수 있습니다.
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
npx perftracker stop --report      # 보고서(HTML)까지 만들고 브라우저로 연다
```

`stop` 은 `result.json` 의 경로와 **보고서를 만드는 명령**을 냅니다:

```
→ /…/runs/2026-07-26T02-31-40_홈-스크롤_a3f9c1/result.json
  perftracker report a3f9c1 로 보고서를 엽니다
```

`--report` 는 그 한 줄을 대신 쳐 주는 것입니다. 기본값이 아닌 이유는 보고서가 화면 자산을
필요로 하기 때문입니다 — npm 으로 받았으면 이미 들어 있고, 저장소에서 직접 쓸 때만
`npm run build` 가 한 번 돌아 있어야 합니다.

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

**`offset_ms` 는 시계열의 `t_s` 와 0초가 다릅니다.** 마킹은 **세션 시작**(호스트 시계)이 0이고
시계열은 **트레이스 시작**(기기 시계)이 0인데, `start` 가 adb 왕복을 하는 동안 트레이서는 아직
돌지 않습니다 — 실측 0.82초 차이입니다. 시계열 위에 얹으려면 그만큼 당기세요:

```
t_s = (offset_ms − session.trace_start_offset_ms) / 1000
```

`trace_start_offset_ms` 가 `null` 이면 두 축의 관계를 모르는 것이므로 **옮기지 마세요.**
0으로 가정하면 어긋난 자리에 찍히면서 맞는 것처럼 보입니다.

진행 중인 세션이 하나뿐이면 아무것도 지정하지 않아도 되고, 둘 이상인데 지정하지 않으면
**아무 데도 붙이지 않고 어느 세션인지 묻습니다.**

### 화면으로 하고 싶다면

같은 흐름을 브라우저에서 할 수 있습니다.

```bash
npx perftracker open           # 서버가 뜨고 브라우저가 열립니다
npx perftracker open -p 7333   # 포트를 고정하고 싶으면
```

**이 명령은 끝나지 않습니다** — Ctrl-C 까지 서버를 붙잡습니다.

> 저장소에서 직접 쓸 때는 `npm run open` 이 빌드까지 함께 합니다.

> 예전 이름 `gui` 도 그대로 받습니다. 별칭으로 남겨 뒀습니다.

세션을 **동시에 여러 개** 돌릴 수 있게 브라우저 탭처럼 상단 탭바로 나뉘고, 기기를 고르면 그
기기에서 못 재는 지표를 **시작 전에** 알려 줍니다. 측정 중 화면에는 경과 시간과 정지 버튼,
그리고 마킹 입력만 있습니다 — 화면에서 남긴 마킹과 터미널에서 `perftracker mark` 로 남긴
마킹은 **같은 자리에 쌓입니다.**

| 옵션 | |
| --- | --- |
| `-p, --port <포트>` | 고정 포트 (생략하면 빈 포트를 고릅니다) |
| `-o, --out <dir>` | 결과를 저장할 디렉토리 (기본 `runs`) |
| `--no-browser` | 브라우저를 자동으로 열지 않습니다 |

서버는 **127.0.0.1 에만 붙습니다.** 이 서버는 연결된 기기에 adb 를 보내고 run 디렉토리를 지울
수 있어서, 같은 네트워크의 다른 사람에게 열어 줄 이유가 없습니다.

브라우저를 새로고침해도 측정 중인 세션은 그대로 돌아옵니다 — 경과 시간도 0부터 다시 세지 않고
이어집니다. 터미널에서 `perftracker start` 로 연 세션도 화면에 나타납니다.

**기록을 클릭하면 세션 보고서가 새 창으로 열립니다.** `result.json` 에 있는 것이 전부
그려집니다 — 프레임 분포, 시계열 다섯, 기기·앱 정보, 경고, 측정 비용. 주소에 run id 가 있어
(`?report=<id>`) 그대로 공유할 수 있습니다.

시계열 하나에 마우스를 올리면 **나머지 시계열이 같은 초를 가리킵니다.** 마킹을 남겼다면
그 시각이 세로선으로 모든 그래프에 얹히고, 마커를 짚으면 그 순간의 값이 한꺼번에 읽힙니다.

보고서는 **판정하지 않습니다.** 점수도, 등급도, "좋다/느리다" 도 없습니다 (「이 도구가 지키는 두 가지」의
2번). 예외는 **둘뿐이고 둘 다 같은 조건**을 지킵니다 — 앱 시작 카드의 기준선 막대(첫 번째)와
프레임 타임라인의 16ms 참고선(두 번째)입니다. 경계를 우리가 정하지 않고(구글이 공개한 값을
출처와 함께 옮겨 적습니다), 점수도 이름도 붙이지 않으며, **그 선으로 값을 분류하지 않습니다** —
참고선을 넘었다고 막대 색이 달라지지 않습니다.
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
| `perftracker start` | 측정 시작 (`--diagnose` 면 진단 세션 · `--launch --compile <값>` 이면 컴파일 상태를 바꾼 뒤) | 필요 |
| `perftracker mark <라벨>` | 측정 중인 세션에 마킹 | **접촉 안 함** |
| `perftracker status` | 진행 중인 세션 | **접촉 안 함** |
| `perftracker stop` | 종료 · 트레이스 회수 · `result.json` 생성 (`--report` 면 HTML 까지) | 필요 |
| `perftracker extract <run-dir>` | 원본을 다시 파싱해 `result.json` 재생성 | 불필요 |
| `perftracker runs list` | 기록 목록 | 불필요 |
| `perftracker runs rename <id> <이름>` | 기록 이름 변경 (디렉토리 경로는 그대로) | 불필요 |
| `perftracker runs rm <id>` | 기록 삭제 (run 디렉토리째) | 불필요 |
| `perftracker report <id>` | 기록을 **파일 하나짜리 HTML** 로 (서버 불필요) | 불필요 |
| `perftracker open` | 화면을 띄웁니다 — 로컬 서버 (Ctrl-C 까지 붙잡습니다) | 필요 |

「접촉 안 함」은 기기가 연결돼 있어도 adb 를 **보내지 않는다**는 뜻입니다. 그래서 이 셋은
측정 중에 불러도 안전합니다 — 마킹이 측정 결과를 바꾸지 않는 이유가 이것입니다.

### 진단 세션 (`--diagnose`)

평소 세션은 수치만 냅니다. 그 시간에 앱이 **무엇을** 했는지(atrace slice 이름)를 보려면
진단 세션으로 엽니다.

```bash
npx perftracker doctor                       # diagnose: app slice 줄 — 이 기기에서 앱 slice 가 열리나
npx perftracker start --app "네이버 웹툰" --launch --diagnose
npx perftracker status                       # Diagnose 줄
npx perftracker stop                         # 평소와 같습니다 — 경로와 보고서 명령만
```

- **기록하는 것** — atrace 카테고리 `am` · `wm` · `view` · `dalvik` 와 대상 앱 하나의 앱 slice 입니다.
  `dalvik` 은 ART 가 남기는 slice(dex 를 열 때의 컴파일 상태 · JIT 컴파일 · 클래스 이름)이고, 그 가운데 컴파일
  상태와 JIT 수가 진단 블록의 [ART 칸 둘](#diagnose)로 실립니다. gfx · input · sched 는 켜지 않습니다.
- **최대 10분입니다** (평소 세션은 30분). `status` 의 최대 시간 넘음 안내도 진단 세션은 10분 기준입니다.
- **평소 세션과 수치를 나란히 놓을 수 없습니다.** slice 하나를 남기는 비용은 앱 프로세스
  자신에게 청구되고 `measurement_overhead` 에 잡히지 않습니다. 그래서 진단 세션은 눈에 띄게
  갈립니다 — `start` · `status` 에 `Diagnose` 줄, `runs` 행 끝에 `진단`.
  `status --json` · `runs --json` 도 **진단 세션에만** 진단 표시를 싣습니다
  (`status` 는 `session.options.diagnose` · `session.diagnose`, `runs` 는 `diagnose: true`).
  평소 세션의 JSON 은 키가 진단 모드 이전과 같습니다.
- **앱 slice 가 열리는 조건** — sdk 31 이상이면 앱과 무관하게 열립니다. sdk 30 이하는
  debuggable 앱만 열리고, 그 밖의 앱이면 세션은 열되 `start` 가 `앱 slice 열림 모름 — …`
  줄을 냅니다. **실측은 sdk 35(에뮬레이터) · 36(SM-S901N) 뿐입니다** — sdk 31–34 와
  sdk 30 이하는 안드로이드 문서(`profileable` 요소) 근거이고 실기기로 확인하지 않았습니다.
  프레임워크 slice(`am` · `wm` · `view` · `dalvik`)는 그대로 실립니다. `doctor` 의
  `diagnose: app slice` 줄이 기기 단위로 같은 판정을 미리 보여 줍니다 (✗ 여도 종료 코드 0).
- `stop` · `extract` 의 출력은 평소와 같습니다 — slice 요약을 찍지 않습니다. slice 는
  `result.json` 에 실리고(아래 「`result.json` 읽는 법」), 시간축으로 보려면 run 디렉토리의
  `trace.perfetto-trace` 를 [Perfetto UI](https://ui.perfetto.dev) 로 엽니다.

### 컴파일 상태를 맞춰 재기 (`--compile`)

같은 앱이라도 컴파일 상태(`speed-profile` · `verify` · `speed` …)에 따라 콜드 스타트 · 스크롤 수치가 달라집니다.
상태를 맞춰 다시 재려면 `--compile <reset|speed-profile|speed>` 를 줍니다. **`--compile` 은 `--launch` 와만 받습니다** —
`--launch` 없이 주거나 셋 밖의 값을 주면 기기에 명령을 하나도 보내지 않고 거부합니다. 이미 떠 있는 앱은 옛 컴파일
결과로 돌 수 있기 때문입니다. (`--help` 의 설명 줄은 80칸이라 이 조건을 싣지 않습니다.)

```bash
npx perftracker start --app com.google.android.youtube --launch --compile speed
npx perftracker status                       # Compile 줄
npx perftracker stop                         # 경로 · 보고서 명령 + 되돌림 줄
```

- **기기를 영구히 바꿉니다** — 세션이 끝나도 남습니다. 보낸 명령 · 바꾸기 전 상태 · 걸린 시간은
  [`session.compile`](#sessioncompile--바꾼-기록) 에 남습니다.
- `start` · `status` 에 `Compile   speed · base.apk speed-profile → speed · 67,500 ms` 줄이 붙습니다 — base.apk 줄의
  바꾸기 전 → 뒤 `status`(compiler filter)와 상태를 바꾸는 데 걸린 시간입니다. 읽지 못한 쪽은 `모름` 입니다.
  `status` 는 기기에 묻지 않고 run 디렉토리의 기록(`capture.json`)을 읽습니다.
- **도구는 되돌리지 않고, 되돌림 명령 줄을 냅니다.** `start` 와 `stop` 출력에 — 상태 바꾸기가 실패했거나 바꾼 뒤
  세션 시작이 실패해 오류로 끝날 때도 — 호스트에서 그대로 쳐서 도는 줄이 붙습니다:

  ```
  되돌림 · 실행 뒤 reason = cmdline · 기기가 다시 바꿀 수 있음
    adb -s R5CT0000001 shell cmd package compile -m speed-profile -f com.google.android.youtube
    adb -s R5CT0000001 shell cmd package compile -m verify -f --secondary-dex com.google.android.youtube
  ```

  바꾸기 전 base.apk 줄의 `status` 로 `-m` 을 채우고, 보조 dex 가 있고 그 `status` 가 모두 같으면 `--secondary-dex`
  줄이 하나 더 붙습니다. `-m` 이 받는 값은 sdk 36 기기 도움말 실측의 `speed` · `speed-profile` · `verify` 셋입니다.
  base.apk 와 보조 dex 는 **따로** 봅니다 — 어느 쪽이든 되돌릴 수 없으면(바꾸기 전 `status` 가 그 셋 밖 · 읽지 못함 ·
  보조 dex 끼리 서로 다름) 명령 대신 **그 사실 한 줄**이 나오고, 다른 쪽 명령은 그대로 나옵니다. 되돌릴 수 없는
  dex 가 있다는 사실을 줄로 남기는 것은, 줄이 없으면 다 되돌렸다고 믿게 되기 때문입니다. 대상 앱만 다루고, 명령
  줄은 자르지 않아 80칸을 넘습니다. serial 에 셸이 해석하는 글자가 있으면(IPv6 `[fe80::1]:5555` 등) 작은따옴표로
  감쌉니다. 되돌려도 처음과 똑같아지지 않는 이유는 [`session.compile` 의 한계](#sessioncompile--바꾼-기록)에 있습니다.
- `stop` 이 `result.json` 산출에 실패해 오류로 끝나거나 화면(`open`)에서 세션을 멈추면 되돌림 줄이 나오지
  않습니다 — 그때는 run 디렉토리 `session.json` 의 `compile.compile_state_before` 가 바꾸기 전 상태입니다.
- `status --json` 은 `compile`(`value` · `baseStatusBefore` · `baseStatusAfter` · `elapsedMs`)을, `runs --json` 은
  행마다 같은 꼴의 `compile` 을 **`--compile` 세션에만** 싣습니다 — 평소 세션의 JSON 은 키가 이 옵션 이전과
  같습니다. 모르는 칸은 `null` 이고, `runs` 의 `baseStatusAfter` 는 `result.json` 이 있는 기록에서만 읽습니다.
- `--compile` 없는 세션의 `start` · `stop` · `status` 출력은 이 옵션 이전과 같습니다.

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

### 보고서를 파일 하나로 (`report`)

`gui` 와 **같은 화면**인데 서버가 없습니다. 자산과 데이터를 전부 문서 안에 말아 넣어 더블클릭
하면 열리는 HTML 하나를 냅니다.

```bash
npx perftracker report bc7a6a                 # → runs/<…>/report.html (브라우저가 열립니다)
npx perftracker report bc7a6a --file /tmp/r.html
npx perftracker report bc7a6a --no-browser    # CI
npx perftracker stop --report                 # 측정을 끝내면서 바로 (--no-browser 도 같습니다)
```

**왜 파일 하나인가:** 측정한 사람과 읽는 사람이 다른 경우가 보통이고, 그때 "서버를 띄우고 이
포트를 열어라" 는 전달 방법이 못 됩니다. 첨부해서 보내면 끝나야 합니다.

글꼴 6개까지 data URI 로 넣어 **외부로 나가는 요청이 0** 입니다 (약 430KB). 인터넷 없는
자리에서도, 이 도구가 없는 컴퓨터에서도 그대로 뜹니다.

`-o` 는 다른 명령과 **같은 뜻**(기록이 있는 디렉토리)이고 쓸 자리는 `--file` 입니다 —
한 글자를 명령마다 다른 뜻으로 쓰면 그것이 가장 비싼 종류의 함정이 됩니다.

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

`schema_version` 이 그 계약의 버전입니다 (현재 `1.2.0`).

> **`1.2.0` 은 진단 세션의 자리와 컴파일 상태를 더한 minor 입니다.** 진단 세션(`start --diagnose`)에만
> `session.options.diagnose` 와 [`diagnose`](#diagnose) 블록이 실리고, **모든 세션**의 `target_app` 에
> [컴파일 상태](#target_app-의-컴파일-상태)(`compile_state_*`)가 실립니다. `start --compile` 세션에만
> [바꾼 기록](#sessioncompile--바꾼-기록)(`session.compile`)이 실립니다. 그래서 **평소 세션의
> `result.json` 도 `1.1.0` 과 키가 다릅니다** — `target_app` 이 닫힌 객체라 캐시해 둔 `1.1.0` 스키마는
> 평소 세션 산출물도 거부합니다. `1.1.0` 은 npm 0.1.0 ~ 0.2.1 로 나간 버전인데, 개발 중에도 출시 뒤에도 같은
> `1.1.0` 안에서 계약이 넓어졌습니다 — 0.2.0 이 `metrics.frame` 과 reason_code `no_frames` 를
> 더했습니다. 스키마를 캐시해 두고 쓰신다면 아래
> [스키마를 다시 꺼내야 하는 때](#스키마를-다시-꺼내야-하는-때)를 반드시 읽으세요.

### 최상위 구조

| 필드 | 무엇인가 |
| --- | --- |
| `schema_version` | 이 파일 형식의 버전 |
| `schema_help` | 이 파일을 해석하기 전에 읽을 곳 (값은 늘 같습니다 — 데이터가 아니라 안내) |
| `tool` | 도구 이름·버전과 **이것을 돌린 컴퓨터**(`host.os` / `arch` / `node`) |
| `session` | id, 이름, `state`, 시작/종료 시각, 길이, **시간축 기준 두 개**(아래 참고), `options`(`launch` · 진단 세션이면 `diagnose: true`), **`--compile` 세션이면 바꾼 기록** `compile`([아래](#sessioncompile--바꾼-기록)) |
| `device` | 기기 스펙(`static`)과 세션 전후 상태(`state_before` / `state_after`) |
| `target_app` | 패키지, 라벨, 버전, 렌더 프로세스와 pid, **빌드 속성**(`debuggable` / `large_heap` / `min_sdk` / `target_sdk` / `primary_cpu_abi`), **시작 · 끝 컴파일 상태**(`compile_state_start` / `compile_state_end` — [아래](#target_app-의-컴파일-상태)) |
| `metrics` | 메트릭들. 키가 곧 수집기 id (`hwui` / `startup` / `cpu` / `memory` / `log` / `thermal` / `network`) |
| `diagnose` | **진단 세션에만.** atrace slice 집계 — 켠 범위, 앱 slice 열림, slice 수, 이름별 표 ([아래](#diagnose)). 평소 세션에는 키가 없습니다 |
| `measurement_overhead` | 이 측정이 기기에 개입한 정도의 **하한** (아래 참고) |
| `references` | 구글 공개 기준치. **비교에 쓰이지 않고 기록만 된다** |
| `warnings` | 관측된 사건 (평가 아님 — [코드 목록](#warnings)) |
| `artifacts` | 원본 파일들의 상대 경로 |

> **아직 `stop` 하지 않은 세션에 `extract` 를 돌린 결과**(`session.state === "running"`)에는
> 아직 존재하지 않는 사실이 있습니다. 그 자리는 그럴듯한 숫자가 아니라 `null` 입니다:
> `session.ended_at` 과 `session.duration_ms`(세션이 안 끝났으니 길이가 없습니다 — 0 이 아닙니다),
> 그리고 `device.state_after`. `measurement_overhead` 의 두 필드도 `null` 일 수 있습니다
> (아래). `warnings` 에는 `session_still_running` 이 함께 실립니다.
> `stop` 한 뒤 같은 run 디렉토리로 `extract` 를 다시 돌리면 전부 채워집니다.

### 시계열을 그릴 때 쓰는 두 값

**이 도구에는 0초가 둘입니다.** 시계열의 `t_s` 는 **트레이스 시작**(기기 시계)이 0이고,
`session.marks[].offset_ms` 는 **세션 시작**(호스트 시계)이 0입니다. `start` 가 adb 왕복을
하는 동안 트레이서는 아직 돌지 않아서 두 시각이 다릅니다.

| 필드 | 무엇 | 어떻게 쓰나 |
| --- | --- | --- |
| `session.trace_span_ms` | 트레이스가 **실제로 덮은** 시간 | **시간축의 오른쪽 끝** |
| `session.trace_start_offset_ms` | 세션 시작 → 트레이스 시작 | 마킹을 시계열 축으로 옮길 때 뺀다 |

실측(SM-S901N): 세션 9,017ms · 트레이스 8,250ms · offset 817ms.

**축을 `duration_ms` 까지 그리지 마세요.** 잰 적 없는 구간이 "값이 빠진 구간" 으로 보입니다.
초 단위 집계는 온전히 덮인 초에서만 값이 나오므로 마지막 칸은 `floor(trace_span_ms / 1000) − 1`
입니다.

둘 다 `null` 일 수 있습니다 — 트레이스를 못 읽었거나(`trace_span_ms`), 트레이스에
clock_snapshot 이 없거나 기기 시계를 못 읽은 경우(`trace_start_offset_ms`)입니다.
**`trace_start_offset_ms` 가 `null` 이면 마킹을 옮기지 마세요.** 0으로 가정하면 어긋난 자리에
찍히면서 맞는 것처럼 보입니다.

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

### `target_app` 의 컴파일 상태

**모든 세션**에 실립니다 — 같은 기기 · 같은 앱이라도 ART 가 앱을 어떤 상태로 컴파일해 두었느냐에 따라
콜드 스타트 · 스크롤 수치가 크게 달라지기 때문입니다 (실측 SM-S901N · YouTube: TotalTime 중앙값
speed-profile 471 · verify 618 · speed 665 ms). 두 세션의 수치가 다를 때 상태가 같았는지를 먼저 볼 수
있게 **측정 조건의 사실**로 남깁니다. 이 도구는 상태를 비교하거나 좋고 나쁨을 말하지 않습니다.

- **시작 상태**(`compile_state_start`)는 대상 앱을 해석할 때 이미 돌리던 `dumpsys package <pkg>` 출력에서
  함께 읽습니다 — **기기 왕복이 늘지 않습니다.** `start --compile` 세션만은 다릅니다: 그 출력은 상태를 바꾸기
  **전**이라, 바꾸는 명령 바로 뒤에 `dumpsys package <pkg>` 를 한 번 더 읽은 출력이 시작 상태(= 바꾼 뒤 상태)입니다.
  바꾸기 전 상태는 [`session.compile`](#sessioncompile--바꾼-기록) 에 있습니다.
- **끝 상태**(`compile_state_end`)는 `stop` 이 측정 창을 닫고 트레이스를 회수한 **뒤** `dumpsys package <pkg>`
  한 번으로 읽습니다. 측정 창 안의 기기 접촉은 그대로 0 입니다.
- 값은 그 출력의 `Dexopt state` 절 **원문 그대로**입니다. dex 줄마다 하나씩, base.apk 줄과 보조 dex 줄을
  기기 순서대로 전부 싣습니다. 문서 표에 없는 값(`profile-utilization` · `vdex-dm` · `run-from-apk` ·
  `unknown`)이 실측됐으므로 enum 으로 좁히지 않습니다. 컴파일 상태가 아닌 줄(`class loader context: …` 와
  그 `=VaryingClassLoaderContexts=` 하위 줄 · `used by other apps: […]`)은 꼴을 알고 싣지 않습니다.

| 필드 | 무엇 |
| --- | --- |
| `compile_state_start` · `compile_state_end` | dex 줄의 배열. **`null` 은 읽지 못했다는 뜻**이고 `[]` 는 쓰지 않습니다 |
| `compile_state_start_reason_code` · `compile_state_end_reason_code` | 칸이 `null` 인 이유 (아래 넷 중 하나). 값이 있으면 `null` |
| `compile_state_start_reason` · `compile_state_end_reason` | 그 이유의 사람용 문장. 매칭에는 코드를 쓰세요 |
| `path` | dex 파일 경로 원문 — 비보조 dex 는 `path:` 줄의 값(`…/base.apk` · split), 보조 dex 는 그 줄에서 끝의 ` (public)` 표시를 뗀 나머지 |
| `secondary_dex` | `known secondary dex files:` 아래 줄이면 `true` |
| `public_dex` | 보조 dex 경로 줄 끝에 ` (public)` 표시가 있으면 `true`. 비보조 dex 에는 기기가 이 표시를 찍지 않아 늘 `false` |
| `abi` | 그 줄 머리의 ABI (`arm64` 등). 한 dex 에 ABI 줄이 여럿일 수 있습니다 |
| `status` | `[status=…]` — **compiler filter** 입니다 (`speed-profile` · `verify` · `speed` · `run-from-apk` …) |
| `reason` | `[reason=…]` — 그 컴파일을 일으킨 까닭 (`install-dm` · `bg-dexopt` · `cmdline` · `profile-utilization` …) |
| `primary_abi` | 그 줄에 `[primary-abi]` 가 있으면 `true` |
| `location` | `[location is …]` 의 `…` 원문 — odex · vdex 경로, `error`, 공백 든 문장까지 그대로. 그 줄이 없으면 `null` |

```json
{
  "path": "/data/app/~~j3NK…/com.google.android.youtube-_ZCw…/base.apk",
  "secondary_dex": false,
  "public_dex": false,
  "abi": "arm64",
  "status": "speed-profile",
  "reason": "profile-utilization",
  "primary_abi": true,
  "location": "/data/app/~~j3NK…/com.google.android.youtube-_ZCw…/oat/arm64/base.odex"
}
```

- **`status` 는 진단 블록의 컴파일 상태 slice 에 나오는 `status` 와 뜻이 다릅니다.** 여기의 `status` 는
  compiler filter 이고, 그 slice 의 `status` 는 oat 파일 상태(`up-to-date` 등)이며 그쪽의 compiler filter 는
  `filter` 칸입니다. 이름은 기기 원문이라 바꾸지 않았습니다.
- **못 읽으면 `null` 이고 이유가 붙습니다** — `dexopt_state_section_missing`(출력에 `Dexopt state` 절이
  없음) · `dexopt_state_package_missing`(절에 대상 패키지 줄이 없음) · `dexopt_state_unparsable`(절은 있는데
  줄 꼴을 모름 — **꼴을 추측해 채우지 않습니다**) · `dexopt_state_unavailable`(그 시점의 출력이 없음 —
  기기 끊김, 아직 `stop` 하지 않은 세션을 `extract` 한 경우, 또는 끝 상태를 읽기 전의 도구로 `stop` 한 run 을
  다시 `extract` 한 경우). 실측한 출력 꼴은 sdk 36 기기 하나뿐입니다 — 그 기기의 전 패키지(635개) 출력에서는
  dex 줄이 하나도 없는 패키지(오버레이 등 69개)만 `dexopt_state_unparsable` 이었고, 다른 기기 · 버전에서는
  모르는 꼴 때문에 더 나올 수 있습니다.
- **세션 중 바뀌었으면 경고가 하나 붙습니다.** 시작 · 끝 상태가 둘 다 있고 base.apk 줄(ABI 줄이 여럿이면
  `[primary-abi]` 줄)의 `status` 또는 `reason` 문자열이 다르면 `warnings` 에 `compile_state_changed` 가
  실립니다 — 백그라운드 dexopt · Play 업데이트 · 제조사 작업이 세션 중에 컴파일했다는 관측된 사건입니다.
  어느 쪽이든 `null` 이면 경고는 없습니다.
- 이 키들이 **아예 없는** `result.json` 은 이 기록이 생기기 전에 산출된 것입니다.

### `session.compile` — 바꾼 기록

`start --launch --compile <reset|speed-profile|speed>` 로 연 세션에만 있습니다 — 측정 창을 열기 전에 이 도구가
**기기의 컴파일 상태를 바꿨다**는 기록입니다. 키가 없으면 그 세션은 상태를 바꾸지 않았습니다(`cmd package compile`
0). 상태를 맞춰 다시 재려고 쓰는 옵션이고, 상태별 세션을 나란히 놓고 비교하는 것은 읽는 쪽의 몫입니다.

| 필드 | 무엇 |
| --- | --- |
| `value` | `--compile` 에 준 값 — `reset` · `speed-profile` · `speed` 중 하나 (기기 낱말 그대로) |
| `command` | 기기로 보낸 셸 명령 원문 — `reset` 은 `cmd package compile --reset '<pkg>'`, 그 밖은 `cmd package compile -m <값> -f '<pkg>'` |
| `elapsed_ms` | 그 명령이 걸린 시간 — 호스트가 잰 adb 호출 왕복 (실측 SM-S901N · YouTube: `reset` 200 · `speed-profile` 18,640 · `speed` 67,500) |
| `compile_state_before` | **바꾸기 전** 상태 — 대상 앱을 해석한 `dumpsys package` 출력의 dex 줄 전부. 꼴은 [`compile_state_start`](#target_app-의-컴파일-상태) 와 같습니다 |
| `compile_state_before_reason_code` · `compile_state_before_reason` | 바꾸기 전 상태가 `null` 인 이유와 그 문장 (`dexopt_state_*` — 위와 같은 넷) |

바꾼 **뒤** 상태는 여기 없습니다 — `target_app.compile_state_start` 가 그것입니다.

- **순서:** 상태를 바꾸는 명령은 설정 검증 뒤, run 디렉토리 · 시작 스냅샷 · Perfetto 세션 · `am force-stop`
  **앞**에 나갑니다. 컴파일의 발열이 시작 상태(`device.state_before` 의 배터리 온도 · thermal)에 섞이지 않고,
  측정 창 안의 기기 접촉은 그대로 0 입니다. `--launch` 없이는 받지 않습니다 — 이미 떠 있는 앱은 옛 컴파일
  결과로 돌 수 있어, 시작 상태와 실제로 돈 코드가 다를 수 있기 때문입니다.
- **실패하면 세션을 열지 않습니다.** 종료 코드가 0 이 아니거나 · 출력에 `Failure` 가 있거나 · 10분 한도를
  넘으면 run 디렉토리도 `result.json` 도 생기지 않습니다. 실패 뒤의 상태는 다시 읽지 않으므로 **기기가 어디까지
  바꿨는지는 모릅니다** — 한도에 걸려 호스트가 adb 를 끊어도 기기는 계속 컴파일하고 있을 수 있습니다.
- **상태는 바꿨는데 그 뒤에서 실패하면** (run 디렉토리 · 시작 스냅샷 · Perfetto 세션 시작 · 앱 실행 등) 세션은
  열리지 않지만 **기기 컴파일 상태는 이미 바뀌어 있습니다.** 그 오류는 원래 문장 그대로 나오고 그 아래에
  [되돌림 명령 줄](#컴파일-상태를-맞춰-재기---compile)이 붙습니다. 도구는 기기에 더 묻지 않습니다 (바뀐 뒤 상태를
  다시 읽지도 되돌리지도 않습니다).
- **한계 — 이 도구는 자동으로 되돌리지 않습니다.** 그리고 되돌려도 처음과 똑같아지지 않습니다:
  - 되돌려도 `reason` 은 `cmdline` 으로 남습니다 (실측 `profile-utilization` → `cmdline`).
  - `reset` 이 지운 로컬 프로파일은 되살리지 못합니다.
  - 이후 백그라운드 dexopt 가 상태를 다시 바꿀 수 있습니다.
  - 상태를 바꾸는 명령은 실측한 꼴 그대로이고 범위 옵션(`--primary-dex` 등)을 붙이지 않습니다 — 그래서 기기가
    대상 앱의 **의존 패키지 · split · 보조 dex 까지** 바꿀 수 있습니다 (실측: `reset` 뒤 보조 dex 셋 중 둘이
    `verify` → `run-from-apk`). 기록과 되돌림은 대상 앱만 다룹니다.

### `warnings`

관측된 사건만 담습니다 — 평가는 없습니다. 이 버전이 내는 `code` 는 아래가 전부입니다
(옛 run 을 `extract` 하면 그때의 코드가 그대로 옮겨질 수 있어 스키마는 닫힌 enum 이 아닙니다).

| `code` | 언제 |
| --- | --- |
| `charging_during_session` | 세션 시작 때 USB 충전 중이었음 |
| `power_save_mode_on` | 세션 시작 때 저전력 모드가 켜져 있었음 |
| `launcher_activity_ambiguous` | 런처 진입점이 여럿이라 이 도구가 하나를 골라 띄웠음 |
| `app_launch_time_unmeasured` | `am start -W` 가 TotalTime 을 보고하지 않아 시작 시간을 못 쟀음 |
| `trace_session_lost` | Perfetto 세션이 사라져 트레이스를 회수하지 못했음 (`session.state` 가 `aborted`) |
| `session_still_running` | 아직 `stop` 하지 않은 세션을 `extract` 했음 — 부분 상태 |
| `compile_state_changed` | 세션 중 base.apk 의 컴파일 상태(`status` · `reason`)가 바뀌었음 ([위](#target_app-의-컴파일-상태)) |

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
  CI 매칭은 반드시 이걸로 하세요. (예: `sdk_too_low`, `no_log_entries`,
  `trace_missing`, `data_source_not_registered`, `query_failed`)

  > `reason_code` 는 **닫힌 enum** 입니다. 이 버전의 reason_code 값은 **45개**입니다
  > (`1.0.0` 은 6개, `1.1.0` 의 마지막 판인 npm 0.2.1 은 36개였습니다). 그중 `process_name_stale_in_trace` 는 `1.0.0` 부터 있던
  > `metrics.hwui` 에도 실립니다. `1.2.0` 에 더한 아홉은 메트릭에는 실리지 않습니다 — 셋은 [`diagnose`](#diagnose)
  > 블록에만 옵니다(`app_slices_open_unknown` 은 `app_slices_open_reason_code` 에,
  > `ftrace_not_recorded` · `ftrace_setup_errors` 는 블록 `reason_code` 에). 넷(`dexopt_state_section_missing` ·
  > `dexopt_state_package_missing` · `dexopt_state_unparsable` · `dexopt_state_unavailable`)은
  > [`target_app` 의 컴파일 상태](#target_app-의-컴파일-상태) 칸의 `_reason_code` 에만 옵니다. 둘(`dalvik_not_recorded` ·
  > `compile_state_slice_unparsable`)은 진단 블록 ART 칸(`target_process_compile_state_slices` ·
  > `target_process_jit_slices`)의 `_reason_code` 에만 옵니다. 이 숫자는 테스트가
  > `METRIC_REASON_CODES` 와 대조해 고정하므로 코드보다 낡을 수 없습니다.
- `reason` — 사람이 읽는 한국어 문장. 다듬힐 수 있으니 매칭에 쓰지 마세요.
- `data` — 메트릭별 본문. 수집되지 않았으면 `null`

### 스키마를 다시 꺼내야 하는 때

**`1.2.0` 부터는 `schema_version` 이 신호입니다.** 출시된 계약을 넓히면 minor 를 올립니다
(`packages/core/src/schema/result.ts` 상단의 규칙표). 캐시해 둔 스키마를 꺼낸 때의 버전과
산출물의 `schema_version` 이 다르면 다시 꺼내세요.

- **`1.2.0` 산출물은 평소 세션의 것도 `1.1.0` 스키마가 거부합니다.** `target_app` 이
  `additionalProperties: false` 라 모든 세션에 실리는 컴파일 상태(`compile_state_start` 등)가 거기
  걸립니다. 진단 세션의 것은 하나 더 — 최상위 객체와 `session.options` 도 닫혀 있어
  `diagnose` 키와 `options.diagnose` 가 걸립니다. `start --compile` 세션의 것도 하나 더 — `session` 이 닫혀
  있어 `session.compile` 이 걸립니다.

**`1.1.0` 끼리는 그 신호가 없습니다.** `1.1.0` 은 개발 중에도, 출시 뒤에도 계약이 넓어질 때 버전을
올리지 않았습니다. npm 0.1.0(2026-08-20)의 스키마는 reason_code 35개에 `metrics.frame` 이 없었고,
0.2.0(2026-08-31)이 같은 `1.1.0` 으로 `metrics.frame` 과 `no_frames` 를 더했습니다 — reason_code 가
닫힌 enum 이라 0.1.0 때 받아 둔 스키마는 `no_frames` 가 실린 산출물을 거부합니다. 그래서 **깨지는
소비자는 `1.0.0` 을 고정한 쪽만이 아닙니다** — `1.1.0` 시절 중간에 `perftracker schema` 를 한 번 받아
두고 그대로 쓰는 쪽도 같은 `1.1.0` 산출물을 거부할 수 있습니다.
그런데 `schema_version` 은 그때도 그 뒤도 `1.1.0` 이라, **`1.1.0` 산출물끼리는 다시 꺼내라는 신호가 산출물 안에
존재하지 않습니다.**

`1.1.0` 시절 중간에 받은 스키마와 `z.toJSONSchema()` 출력이 실제로 갈라지는 곳은 셋이고, 서로 독립적입니다:

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

### `metrics.hwui`

**프레임워크(HWUI)가 자기 렌더링을 직접 센 값**입니다. `dumpsys gfxinfo <패키지>` 를 세션 전과
후에 한 번씩 찍어 **차이**를 냅니다 — 누적 카운터라 측정 중에는 기기에 아무것도 보내지 않습니다
(`network` 의 uid 델타와 같은 방식).

```json
{
  "total_frames": 212,
  "janky_frames": 3,
  "deadline_missed": 3,
  "missed_vsync": 0,
  "high_input_latency": 187,
  "slow_ui_thread": 0,
  "slow_bitmap_uploads": 0,
  "slow_draw_commands": 2
}
```

**개수·백분위·원인별 카운터를 재는 길은 이것 하나입니다.** 한동안 트레이스
(`android.surfaceflinger.frametimeline`)로도 같은 종류의 숫자(개수·백분위)를 재서
`metrics.frame` 을 함께 냈는데, **보고서가 `hwui` 만 그리게 되자 화면에 없는 데이터가
`result.json` 에만 남았습니다.** 사람은 보고서를 보고 LLM 은 파일을 보는데 둘이 다른 숫자를
들게 됐습니다 — 같은 세션에서 `janky_frames` 가 170 대 1,556, `p99` 가 53 대 39.56 으로
갈렸습니다. 그때는 그래서 트레이스 쪽 수집을 접었습니다.

[`metrics.frame`](#metricsframe) 은 이후 **범위를 바꿔 돌아왔습니다** — 개수도 백분위도
내지 않고 시간축(`samples`)만 냅니다. 같은 이름의 숫자가 두 벌이 되는 조건 자체가 없으므로
위 문제가 재발하지 않습니다.

| | `hwui` |
| --- | --- |
| 출처 | 프레임워크 (`dumpsys gfxinfo` 세션 전후 차이) |
| 모집단 | **View 계층만** — 안드로이드 Vitals 와 같은 범위 |
| 버전 하한 | **없음** |
| 분포 · 백분위 | 있음 (프레임워크 버킷) |
| 원인별 개수 | 있음 |
| 초 단위 추이 | 없음 |

- `janky_frames` 의 정의는 **프레임워크의 것**이고 이 도구가 정한 것이 아닙니다.
  어느 쪽이 나쁜지는 판정하지 않습니다.
- **`janky_frames` 와 `deadline_missed` 는 버전에 따라 같기도 하고 다르기도 합니다.**
  실측 sdk 36(SM-F936N)은 표본 여섯 개가 전부 일치하고(323/323 · 289/289 · 170/170 …),
  sdk 30(SM-A405S)은 46 대 13, 157 대 8 로 갈립니다. 우연이 아니라 정의가 바뀐 것입니다 —
  sdk 36 출력에는 `Janky frames (legacy)` 라는 **옛 정의 줄이 따로** 있고(498, 새 정의
  323 과 다름) sdk 30 출력에는 그 줄이 아예 없습니다. 즉 새 정의에서 "janky" 는 곧
  "마감을 넘김" 이고, sdk 30 의 `Janky frames` 는 그 옛 정의 쪽입니다.
  **버전이 다른 두 기기의 `janky_frames` 를 나란히 비교하지 마세요** — 같은 이름이지만
  다른 것을 셉니다. `deadline_missed` 는 두 버전에 다 있고 정의가 같습니다.
  (이 도구는 `(legacy)` 줄을 읽지 않습니다. 라벨을 줄 시작에 고정해 두 값이 섞이지 않게
  합니다 — 실측에서 그 둘은 94 와 138 로 달랐습니다.)
- 뒤의 다섯은 프레임 시간이 아니라 **원인**입니다 — UI 스레드가 느렸는지, 비트맵 업로드인지,
  그리기 명령인지, 입력 지연인지. 트레이스에는 없는 축입니다.
- **`histogram` 은 프레임워크가 만든 프레임 시간 분포**입니다 (세션 델타).
  **UI 스레드 + RenderThread 의 CPU 시간**이고, 그것이 Vitals 가 보는 값입니다.
  - **버전 하한이 없습니다.** sdk 30(SM-A405S) 실측에서도 70칸 · 799장이 나왔습니다.
  - 칸 경계는 프레임워크가 정합니다(1ms 씩 시작해 뒤로 갈수록 넓어짐) — 우리 버킷과 다릅니다.
    `to_ms` 는 다음 칸의 시작입니다.
  - **칸 이름은 그 칸의 끝입니다.** 프레임워크가 `6ms=155` 라고 하면 6ms 걸린 프레임 수이므로
    구간으로는 `[5, 6)` 입니다. 첫 칸 `5ms` 는 "5ms 이하 전부" 라 `[0, 5)` 가 됩니다 —
    이름을 그대로 `from_ms` 에 넣으면 한 칸씩 밀리고 0–5ms 구간이 사라진 것처럼 보입니다.
  - **첫 칸만 5ms 폭이고 더 쪼갤 수 없습니다.** 프레임워크가 5ms 이하를 아예 따로 세지
    않습니다(`HISTOGRAM: 5ms=480 6ms=155 …` 의 첫 항목이 그것입니다). 나머지가 1ms 폭이라
    첫 칸만 유독 높게 보이는데, 그것은 뭉갠 것이 아니라 원본의 해상도입니다.
  - **700ms 에서 자릅니다.** 프레임워크 칸은 4950ms 까지 가는데 실제 데이터는 앞쪽에 몰려
    있어 그대로 그리면 화면의 3분의 2가 빕니다. **자르되 버리지 않습니다** — 그 이상은 마지막 한 칸(`to_ms: null`)으로 접어서
    칸의 합이 `total_frames` 와 같습니다.
  - **그 아래는 0 인 칸도 전부 실립니다.** 분포는 어디가 비어 있는가가 곧 정보이고, 있는 칸만
    남기면 축이 세션마다 달라져 두 결과를 나란히 볼 수 없습니다.
- **`percentiles` 는 위 `histogram`(세션 델타)에서 계산합니다.** `dumpsys gfxinfo` 도 자기
  백분위를 찍지만 그것은 프로세스 시작 이후 누적이라 세션 값이 아닙니다 — 그대로 실으면
  분포와 백분위가 서로 다른 구간을 말하게 됩니다.
  - **해상도는 프레임워크의 칸 폭**입니다. 5~32ms 는 1ms 라 촘촘하고 뒤로 갈수록 넓어지므로
    꼬리 백분위는 그 칸의 시작값(하한)으로 떨어집니다 — 정확한 값이 아니라 하한이라는 뜻입니다.
  - 실기기 교차 확인(`--launch` 세션이라 누적=세션): 우리 계산 8/25/38/89 = 기기 보고 8/25/38/89.
- 값이 `null` 인 경우: 그 줄이 출력에 없었거나, 세션 중 앱 프로세스가 죽어 누적이 리셋됐습니다.
  **0 과 다른 말입니다.**
- 지표 전체가 없으면(`reason_code: hwui_stats_unavailable`) 이 앱이 HWUI 로 그리지 않는
  것입니다 — Unity · Vulkan · OpenGL 이 그렇고, **Vitals 와 같은 한계**입니다.

**개발자 옵션을 켤 필요는 없습니다.** 「HWUI 렌더링 프로파일」이 꺼진 상태에서도 이 집계는
나옵니다 (실측 sdk 36). 그 옵션이 켜는 `framestats`(프레임별 단계 분해)는 마지막 120장만
남아 세션을 담을 수 없어 쓰지 않습니다 — 담으려면 측정 중 폴링이고 규칙 1 위반입니다.

### `metrics.frame`

**프레임의 시간축입니다.** `hwui` 와 다른 것을 답합니다 — `hwui` 는 "몇 장이 얼마나
걸렸나", 이쪽은 "언제 그랬나" 입니다. perfetto `android.surfaceflinger.frametimeline`
(`actual_frame_timeline_slice` + `expected_frame_timeline_slice`)에서 옵니다.

**sdk 31(Android 12) 이상이 필요합니다.** 그 미만에서는 `status` 가 `unsupported`,
`reason_code` 가 `sdk_too_low` 입니다 — `hwui` 는 그 기기에서도 그대로 나옵니다
(위 [「어느 안드로이드에서 되는가」](#어느-안드로이드에서-되는가) 참고).

```json
{
  "samples": [
    [0, 3.12, 8.01, 8.33],
    [8, 6.30, 15.08, 8.33],
    [16, 2.87, null, 8.33]
  ],
  "sampling": "all",
  "bucket_ms": null,
  "frames_seen": 3
}
```

- `samples` — 프레임 한 장이 한 칸이고, 순서는
  `[경과 ms, 앱이 그린 ms, 화면에 나가기까지 ms, 그 프레임의 마감 ms]` 입니다. 앞의 둘은
  겹치지 않습니다(실측 SM-F936N: 앱 0.00~6.30ms, 표시 7.11~15.08ms) — 앱이 그리는 시간과
  화면에 나가는 시간이 이어 붙어 쌓입니다.
  - **세 번째 값은 대상 앱만의 비용이 아닙니다.** SurfaceFlinger 가 그 vsync 에 합성한
    **표시 프레임(display frame)** 의 길이이고, 그때 함께 합성된 **모든 레이어가 공유하는
    시간**입니다 — 다른 앱이나 시스템 UI 가 같은 화면에 얹혀 있으면 대상 앱이 아무것도
    안 해도 이 값이 늘어납니다. 앱에 청구할 수 있는 것은 두 번째 값뿐이고, 세 번째는
    "이 프레임이 화면에 나가기까지 기기가 쓴 시간" 입니다.
  - **뒤의 둘은 `null` 일 수 있습니다** — 짝을 못 찾았다는 뜻이고 `0` 이 아닙니다. 표시
    시간이 없는 경우는 보통 `--stop` 이 트레이스를 끊는 순간 그 프레임이 아직 화면에
    나가기 전이었다는 뜻입니다.
  - **마감(4번째 값)은 고정값이 아닙니다.** 기기가 프레임마다 배정하고 주사율을 따라
    세션 중에도 바뀝니다(실측 한 세션: 8.23ms 672장 · 8.33ms 668장 · 41.67ms 4장 —
    6초 만에 120Hz 에서 24Hz 로 떨어졌습니다). 60fps·120Hz 같은 고정 예산이 아니라
    **그 프레임에서 기기가 실제로 쓴 값**입니다.
  - 시간 원점은 다른 모든 시계열과 같습니다 — 트레이스 시작(`trace_bounds.start_ts`).
    `mark` 로 남긴 표시와 같은 축 위에서 나란히 읽을 수 있습니다.
- `sampling` / `bucket_ms` — 프레임이 5,000장을 넘으면 `sampling` 이 `max_per_bucket`
  으로 바뀌고 `bucket_ms` 폭의 버킷마다 **가장 오래 걸린 프레임 하나만** 남습니다. 이
  지표의 목적이 스파이크를 보는 것이라 매 N번째를 고르는 균등 추출은 쓰지 않습니다.
  `all` 이면 전부 실렸고 그때 `bucket_ms` 는 `null` 입니다.
- `frames_seen` — 추리기 전에 본 프레임 수입니다. **`hwui.total_frames` 와 비교하지
  마세요** — 세는 대상이 다릅니다. 이쪽은 화면에 나간 프레임이고 `hwui` 는 View 계층이
  그린 프레임입니다. 지표가 아니라 표본을 뽑았다는 사실을 말하는 각주용 숫자입니다.
- **개수도 백분위도 여기 없습니다. 의도한 것입니다.** 예전에 이 지표를 접은 이유가 같은
  이름의 숫자가 두 벌이었다는 것입니다 — 자세한 사정은 위 [`metrics.hwui`](#metricshwui)
  절에 있습니다. 두 지표가 같은 종류의 숫자를 갖지 않으면 "이 앱의 p99" 라는 질문에 둘이
  답할 일이 없습니다.
- `actual_frame_timeline_slice` 는 **레이어마다** 한 행을 냅니다 — SurfaceView 를 쓰는
  앱은 배경 레이어까지 붙어 화면 한 번 갱신에 여러 행이 달립니다(실측 33초 세션: 행
  6,932 · 실제 프레임 2,875, 2.4배). `frame` 은 프레임 토큰으로 접어 **가장 오래 걸린
  레이어**를 그 프레임의 앱 시간으로 씁니다 — 레이어 이름으로 거르지 않습니다.

### `metrics.startup`

**이 값은 트레이스에서 계산한 것이 아니라 `am start -W` 가 보고한 숫자입니다.**
트레이스를 읽지 않는 두 지표 중 하나입니다(다른 하나는 `hwui`) — `start` 가 앱을 띄우면서 받아
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
  아닙니다.
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
  갈래를 말합니다 (`app_cpu_sdk_too_low` / `process_not_in_trace` / `no_app_cpu_samples` /
  `counter_went_backwards` / `query_failed`). 그때도 `device_*` 값은 그대로 나옵니다.
  - **`app_cpu_sdk_too_low` 는 다시 재도 같습니다.** `record_process_runtime` 이 perfetto v44
    필드라 sdk 35 미만에는 없고, 그 필드를 넣으면 기기가 config 를 통째로 거부합니다
    (실측 sdk 30: `No field named "record_process_runtime"`). 그래서 아예 보내지 않습니다.
  - **`no_app_cpu_samples` 는 다시 재면 나올 수 있습니다.** sdk 하한은 넘었는데 카운터가
    없는 경우 — 그 필드가 꺼진 채로 찍힌 옛 캡처를 `extract` 로 다시 산출하면 이렇습니다.
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

### `diagnose`

**진단 세션(`start --diagnose`)에만 있는 블록입니다.** 평소 세션에는 키가 없고, 그 "없음" 이 곧
"진단 세션이 아님" 입니다. `session.options.diagnose` 도 진단 세션에만 `true` 로 실립니다 —
`false` 로 실리는 일은 없습니다. 진단 세션은 atrace(카테고리 `am` · `wm` · `view` · `dalvik` + 대상 앱 하나의
앱 slice)를 켜고 최대 10분 돕니다. `dalvik` 은 2026-10-11(baseline-profile)에 더했습니다 — 그 전 진단 run 의
`atrace_categories` 에는 없고, 그런 run 을 `extract` 로 다시 내면 ART 칸 둘이 `null` + `dalvik_not_recorded` 입니다.

> **진단 세션의 수치는 평소 세션과 나란히 놓을 수 없습니다.** atrace slice 를 남기는 비용은 앱
> 프로세스 자신에게 청구되고 `measurement_overhead` 에 잡히지 않습니다 ([아래](#measurement_overhead)).

```json
{
  "atrace_categories": ["am", "wm", "view", "dalvik"],
  "atrace_apps": ["com.google.android.youtube"],
  "status": "collected",
  "reason_code": null,
  "reason": null,
  "app_slices_open": true,
  "app_slices_open_reason_code": null,
  "app_slices_open_reason": null,
  "trace_slices": 147462,
  "target_process_slices": 134423,
  "target_process_slices_unfinished": 2,
  "ftrace_overrun_events": 0,
  "trace_bytes": 12844952,
  "target_process_slice_names_unfolded": 15388,
  "target_process_slice_names": [
    { "name": "Choreographer#doFrame *",
      "main_thread": { "count": 1058, "sum_ms": 2390.124, "max_ms": 77.696 },
      "other_threads": { "count": 16, "sum_ms": 2.837, "max_ms": 0.777 },
      "async_tracks": null },
    { "name": "L*;",
      "main_thread": { "count": 1903, "sum_ms": 48.239, "max_ms": 2.1 },
      "other_threads": { "count": 3767, "sum_ms": 185.436, "max_ms": 5.504 },
      "async_tracks": null },
    { "name": "bindApplication",
      "main_thread": { "count": 1, "sum_ms": 56.169, "max_ms": 56.169 },
      "other_threads": null, "async_tracks": null }
  ],
  "target_process_compile_state_slices": [
    { "location": "/data/app/~~j3NK…/com.google.android.youtube-_ZCw…/oat/arm64/base.odex",
      "status": "up-to-date", "filter": "speed-profile", "reason": "profile-utilization" },
    { "location": "primary.vdex mapped directly in memory from /data/app/~~KFTc…/com.google.android.gms-tENA…/split_DynamiteLoader_installtime.dm",
      "status": "up-to-date", "filter": "verify", "reason": "vdex-dm" }
  ],
  "target_process_compile_state_slices_reason_code": null,
  "target_process_compile_state_slices_reason": null,
  "target_process_jit_slices": 54,
  "target_process_jit_slices_reason_code": null,
  "target_process_jit_slices_reason": null
}
```

(SM-S901N · Android 16 · YouTube 21.40.161 15초 원본 — `dalvik` 을 켠 회 — 을 이 블록의 쿼리로 다시 센 값입니다.
표는 1,521행 가운데 셋만, 컴파일 상태는 6줄 가운데 둘만 옮겼고 경로의 해시는 줄였습니다.)

| 필드 | 무엇 | `null` 이면 |
| --- | --- | --- |
| `atrace_categories` | 켠 atrace 카테고리 — 기기로 나간 config 에 실린 값 | `session.json` 에 그 기록이 없다 |
| `atrace_apps` | 앱 slice 대상 패키지 (대상 앱 하나) | 같음 |
| `status` · `reason_code` · `reason` | [메트릭과 같은 껍데기](#메트릭-하나의-모양) — **트레이스에서 읽은 칸**(수 · 표)의 상태 | — |
| `app_slices_open` | **앱 slice 열림** — 앱 자신의 slice 가 실릴 수 있던 조건이었나. 앱이 실제로 남겼나가 아닙니다. `true` 또는 `null` (`false` 는 없음) | 모름 — 이유는 다음 칸 |
| `app_slices_open_reason_code` · `app_slices_open_reason` | 열림이 `null` 인 이유 (`app_slices_open_unknown`) | 열림이 `true` |
| `trace_slices` | 트레이스 전체(모든 프로세스)의 slice 수 | ftrace 가 원본에 안 남음 · 트레이스를 못 읽음 |
| `target_process_slices` | 대상 앱 프로세스의 slice 수 = 표의 `count` 합 | 대상 앱 프로세스를 못 찾음 · ftrace 가 원본에 안 남음 · 트레이스를 못 읽음 |
| `target_process_slices_unfinished` | 그중 끝나지 않은 slice 수 | 같음 |
| `ftrace_overrun_events` | 커널 ftrace 링버퍼에서 잃은 이벤트 수 | 트레이스에 그 통계가 없음 (0 이 아님) |
| `trace_bytes` | 원본(`artifacts.trace`) 크기 (바이트) | 원본이 없음 |
| `target_process_slice_names_unfolded` | 접기 전 고유 이름 수 (표 행 수 이상) | `target_process_slices` 와 같음 |
| `target_process_slice_names` | 접은 이름별 표 (아래) | 같음 — `[]` 는 "프로세스는 찾았고 slice 가 0개" |
| `target_process_compile_state_slices` | **ART 칸 (1)** — 대상 앱 프로세스의 컴파일 상태 slice 목록 (아래) | `dalvik` 을 안 켠 원본 · 꼴을 모르는 `location=` slice · 표가 `null` 인 이유와 같음 — `[]` 는 "켰고 찾았는데 0줄" |
| `target_process_compile_state_slices_reason_code` · `target_process_compile_state_slices_reason` | 목록이 `null` 인 이유 | 목록이 있음 |
| `target_process_jit_slices` | **ART 칸 (2)** — 대상 앱 프로세스의 JIT 컴파일 slice 수 | `dalvik` 을 안 켠 원본 · 표가 `null` 인 이유와 같음 — `0` 은 "켰고 찾았는데 0개" |
| `target_process_jit_slices_reason_code` · `target_process_jit_slices_reason` | 수가 `null` 인 이유 | 수가 있음 |

표의 한 행:

| 필드 | 무엇 |
| --- | --- |
| `name` | 접은 이름 |
| `main_thread` | 메인 스레드(tid = pid) 갈래 |
| `other_threads` | 대상 앱 프로세스의 나머지 스레드 갈래 |
| `async_tracks` | 대상 앱 프로세스의 프로세스 트랙(비동기) 갈래 |
| `count` | 그 갈래에서 그 이름으로 남은 slice 수 — 끝나지 않은 것도 셉니다 |
| `sum_ms` | 끝난 slice 의 길이 합 (ms) |
| `max_ms` | 끝난 slice 가운데 가장 긴 것 (ms) |

- **atrace slice 만 셉니다** — 스레드 트랙 slice 와 프로세스 트랙(비동기) slice. frametimeline
  트랙(Actual · Expected Timeline — 이름이 프레임 토큰 숫자)의 slice 는 수 · 표 · 이름 수 어디에도 들지 않습니다.
- **대상 앱 프로세스는 `metrics` 와 같은 규칙으로 하나입니다.** 트레이스의 이름이 낡았으면 캡처 때 받아 둔
  pid 로 찾고 `partial` + `process_name_stale_in_trace` 입니다 — 값은 다 있습니다
  ([아래](#트레이스가-앱을-다른-이름으로-아는-경우-zygote64--pre-initialized)).
- **표는 프레임워크 slice(am · wm · view · dalvik)와 앱 slice 를 가르지 않습니다.** atrace 마커에 가를 태그가
  없습니다. 앱 slice 가 실릴 수 있었는지는 `app_slices_open` 이 따로 말합니다.
- **이름 접기** — 숫자가 하나라도 든 영문 · 숫자 토큰(연속한 `[A-Za-z0-9]`)을 `*` 하나로 바꿉니다.
  `Choreographer#doFrame 136993` → `Choreographer#doFrame *` · `tk-trace-id: 1001yo7d2xmcq` →
  `tk-trace-id: *` · `VRI[Shell$HomeActivity]@a1b2c3` → `VRI[Shell$HomeActivity]@*`. 숫자가 없는 토큰은
  단어와 가를 수 없어 그대로입니다 — `tk-trace-id: rlcyp` → `tk-trace-id: rlcyp`.
  **이름 전체가 클래스 디스크립터**(`L` 로 시작해 `;` 로 끝나고 공백 없음)면 한 행 `L*;` 로 접습니다 —
  `Lfvb;` → `L*;` · `Lcom/google/Foo$1;` → `L*;`. `dalvik` 이 남기는 이 이름은 숫자 없는 난독화 이름이
  대부분이라 위 규칙으로는 안 접힙니다. 공백이 든 이름은 디스크립터가 아닙니다 — `Lock contention on a monitor lock` →
  `Lock contention on a monitor lock`. 위 원본에서 15,388 → 1,521행이었습니다 (디스크립터 규칙 없이는 약 6,900행 ·
  컴파일을 초기화한 verify 상태의 원본은 약 2만 7천 행).
  원문 이름은 원본 트레이스에 그대로 있습니다.
- **행을 자르지 않고 이름도 자르지 않습니다.** 순서는 이름의 UTF-16 코드 단위 순 하나입니다 (호스트
  로캘과 무관 — `Z` 가 `a` 보다 앞). 순위 · 상위 N 은 없습니다 — 무엇이 길었는지 고르는 일은 읽는 쪽의 몫입니다.
- **빈 갈래는 `null` 입니다** — 그 갈래에 그 이름의 slice 가 없었다는 뜻입니다. 0 으로 채우지 않는 것은
  slice 가 없으면 최대가 0 이 아니라 없기 때문입니다.
- **끝나지 않은 slice**(트레이스가 끝날 때 아직 열려 있던 것)는 `count` 에만 들고 `sum_ms` · `max_ms` 에서
  빠집니다. 한 갈래의 slice 가 전부 끝나지 않았으면 그 칸의 `sum_ms` · `max_ms` 가 `null` 입니다.
- **`sum_ms` 를 행끼리 더하지 마세요.** 안쪽 slice 도 각자 세므로 바깥 slice 의 시간과 겹칩니다
  (같은 기기 · 앱 15초 원본 둘에서 대상 앱 스레드 slice 의 80.1% · 85.5% 가 안쪽이었습니다).
- **`ftrace_overrun_events`** 는 stats 의 `ftrace_cpu_overrun_delta`(덮어써서) ·
  `ftrace_cpu_commit_overrun_delta`(쓰는 중에 겹쳐서) · `ftrace_cpu_dropped_events_delta`(덮어쓰기를 끈 버퍼가
  꽉 차서)를 CPU 마다 더한 값입니다. `measurement_overhead.trace_buffer_overrun` 은 perfetto 버퍼만 보므로 이 손실을
  못 잡습니다 — 0 이 아니면 slice 가 그만큼 빠졌습니다.

**ART 칸 둘** — `dalvik` 이 남긴 slice 가운데 둘을 표 밖에 따로 싣습니다. 둘 다 표와 **같은 원문 이름**(대상 앱
프로세스 · atrace slice 만 · frametimeline 제외)에서 뽑으므로 같은 원본을 trace_processor 로 다시 세면 같은 값이
나옵니다.

- **`target_process_compile_state_slices`** — ART 가 dex 를 열 때 남기는
  `location=<…> status=<…> filter=<…> reason=<…>` 이름의 slice 를 네 칸으로 가른 목록입니다. 같은 네 값은 한 줄로
  (갈래 · 횟수와 무관하게) 싣고, 순서는 원문 이름의 UTF-16 코드 단위 순입니다. `location` 에는 공백이 들 수
  있어(`primary.vdex mapped directly in memory from …`) 마지막 ` status=` · ` filter=` · ` reason=` 자리로 가릅니다.
  대상 앱이 연 다른 패키지의 dex(WebView · GMS 모듈)도 그 프로세스 안의 일이라 함께 실립니다.
- **`target_process_jit_slices`** — 이름이 `JIT compiling` 으로 시작하는 slice 의 수입니다. 표의 그 이름들 `count`
  합과 같고, 끝나지 않은 slice 도 셉니다. 실측(SM-S901N · YouTube 15초)에서 speed-profile 39 · 52 · 54, verify 297,
  speed 0 이었습니다. 이 도구는 이 수에 많고 적음을 매기지 않습니다.
- **`status` 가 둘입니다.** 이 목록의 `status` 는 **oat 파일 상태**(`up-to-date` · `no-dex-code` …)이고
  compiler filter 는 `filter` 칸입니다. [`target_app` 의 컴파일 상태](#target_app-의-컴파일-상태) 의 `status` 는
  compiler filter 입니다 — 같은 낱말 다른 뜻이고, 이름은 기기 원문이라 바꾸지 않았습니다.
- **못 재면 `null` 이고 이유가 붙습니다** — 블록 `status` 와 따로 갑니다.
  `dalvik_not_recorded` 는 세션 기록(`atrace_categories`)에 `dalvik` 이 없거나 그 기록이 없는 원본입니다 (이 칸이
  생기기 전 진단 run 을 `extract` 로 다시 낸 경우) — 표 · 수는 잰 그대로이고 블록은 `collected` 일 수 있습니다.
  `compile_state_slice_unparsable` 은 `location=` 으로 시작하는데 네 칸으로 갈리지 않는 이름이 있는 경우로, 목록만
  `null` 입니다 (**꼴을 추측해 채우지 않습니다**). 표를 못 만든 경우(대상 앱 프로세스를 못 찾음 · ftrace 가 원본에
  안 남음 · 원본 없음 · 쿼리 실패 · 미등록)는 두 칸이 `null` 이고 이유 코드는 블록 `reason_code` 와 같습니다.
- `dalvik` slice 가 앱 프로세스에 실리는지는 sdk 36 한 기기에서만 확인했습니다.

컴파일 상태 slice 한 줄:

| 필드 | 무엇 |
| --- | --- |
| `location` | `location=` 뒤 원문 — odex · vdex 경로, `none`, 공백 든 문장까지 그대로 |
| `status` | `status=` — **oat 파일 상태** (`up-to-date` · `no-dex-code` …). compiler filter 가 아닙니다 |
| `filter` | `filter=` — compiler filter (`speed-profile` · `verify` · `speed` · `unknown` …) |
| `reason` | `reason=` — 그 컴파일을 일으킨 까닭 (`profile-utilization` · `install-dm` · `vdex-dm` · `unknown` …) |

| `status` | `reason_code` | `null` 이 되는 칸 |
| --- | --- | --- |
| `collected` | `null` | 없음 |
| `partial` | `process_not_in_trace` | `target_process_slices` · `target_process_slices_unfinished` · `target_process_slice_names_unfolded` · `target_process_slice_names` · `target_process_compile_state_slices` · `target_process_jit_slices` |
| `partial` | `process_name_stale_in_trace` | 없음 |
| `partial` | `ftrace_not_recorded` | `trace_slices` · `target_process_slices` · `target_process_slices_unfinished` · `ftrace_overrun_events` · `target_process_slice_names_unfolded` · `target_process_slice_names` · `target_process_compile_state_slices` · `target_process_jit_slices` |
| `partial` | `ftrace_setup_errors` | 없음 |
| `unsupported` | `data_source_not_registered` · `data_source: linux.ftrace` | `trace_slices` · `target_process_slices` · `target_process_slices_unfinished` · `ftrace_overrun_events` · `target_process_slice_names_unfolded` · `target_process_slice_names` · `target_process_compile_state_slices` · `target_process_jit_slices` |
| `failed` | `trace_missing` | `trace_slices` · `target_process_slices` · `target_process_slices_unfinished` · `ftrace_overrun_events` · `trace_bytes` · `target_process_slice_names_unfolded` · `target_process_slice_names` · `target_process_compile_state_slices` · `target_process_jit_slices` |
| `failed` | `query_failed` | `trace_slices` · `target_process_slices` · `target_process_slices_unfinished` · `ftrace_overrun_events` · `target_process_slice_names_unfolded` · `target_process_slice_names` · `target_process_compile_state_slices` · `target_process_jit_slices` |

ftrace 기록을 다 믿을 수 없는 경우는 코드 둘로 갈립니다 — 값이 있고 없음이 정반대라 `reason_code` 로 가르세요.

- **`ftrace_not_recorded`** — 원본에 CPU 별 ftrace 통계(`ftrace_cpu_*`)가 한 행도 없습니다. ftrace 가
  안 돌았으므로 slice 0개가 "없었다" 인지 "못 쟀다" 인지 모릅니다 — slice 칸과 잃은 이벤트 수가 `null` 입니다.
- **`ftrace_setup_errors`** — ftrace 는 돌았는데 traced_probes 가 켜다 오류를 냈습니다. 오류가 atrace 의 것인지
  다른 이벤트의 것인지 원본이 말하지 않아 일부가 빠졌을 수 있지만, **잰 수 · 표는 그대로 싣습니다** —
  gfx · input 카테고리를 켠 실측 원본은 오류 28 에 slice 33만–38만이 실렸습니다.
  대상 앱 프로세스를 못 찾았으면 그쪽(`process_not_in_trace`)이, 이름이 낡았을 뿐이면 이쪽이 블록의 코드입니다.

**앱 slice 열림은 `status` 와 따로 갑니다.** 트레이스가 아니라 sdk 와 `target_app.debuggable` 로
정해지는 조건이라 원본이 없어도(`failed`) 값이 있고, `null` 이어도 `status` 는 `collected` 일 수 있습니다.
판정은 `doctor` 의 `diagnose: app slice` 줄과 같은 함수 하나입니다.

| 기기 · 앱 | `app_slices_open` |
| --- | --- |
| sdk ≥31 | `true` |
| sdk ≤30 · `debuggable: true` | `true` |
| sdk ≤30 · `debuggable` 이 `false` 또는 `null` | `null` + `app_slices_open_unknown` (profileable 을 읽을 출처가 없습니다) |

**다시 내기.** 원본은 평소처럼 run 디렉토리의 `trace.perfetto-trace` 하나(`artifacts.trace`)이고 진단
세션이라고 다른 파일을 만들지 않습니다. `perftracker extract <run>` 이 기기 없이 같은 블록을 다시
냅니다 — 같은 원본이면 바이트까지 같습니다. 시간축 그림은 이 블록에 없습니다. 원본을 Perfetto UI 로 여세요.

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

  > **진단 세션(`session.options.diagnose: true`)은 atrace slice 비용이 앱 프로세스에 청구되어
  > 여기 안 잡힙니다 — 평소 세션과 수치를 나란히 놓을 수 없습니다.** slice 하나를 남기는 비용(~5µs)은
  > slice 를 남기는 앱 프로세스 자신의 몫이고, 이 세 필드는 트레이싱 프로세스만 셉니다. 두 종류를
  > 섞어 비교하려면 `session.options.diagnose` 로 먼저 가르세요.

### `references`

```json
[
  { "metric": "hwui", "name": "60fps frame budget", "value": 16.67, "unit": "ms",
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

**여기서부터는 저장소에서 직접 작업하는 사람용입니다.** npm 으로 받아 쓰는 데는
필요 없습니다 — 소스는 [https://github.com/KimHance/PerfTracker](https://github.com/KimHance/PerfTracker) 에 있습니다.

```bash
git clone https://github.com/KimHance/PerfTracker.git && cd PerfTracker
npm install
npm run build     # 먼저 한 번 — 아래 테스트가 core 의 dist/ 를 씁니다
npm test          # 유닛 테스트 (기기 불필요). 1초 남짓
npm run typecheck # src + test 전체 타입체크
npm run test:device   # 온-디바이스 스펙 (기기가 꽂혀 있어야 함) — 현재 20개
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

**기기가 둘이면 지정하지 않은 채로는 스펙이 하나도 돌지 못합니다** (`AmbiguousDeviceError`).
기기를 시험 안에서 잡는 11개는 실패로, 기기를 `beforeAll` 에서 잡는 진단 스펙(`diagnose.test.ts`) 9개는
건너뜀으로 셉니다 — vitest 는 `beforeAll` 이 던지면 그 안의 시험을 건너뜀으로 세고 그 파일은 실패로 냅니다.
실측(2026-10-08, 실기기 + 에뮬레이터를 같이 연결): `Test Files 5 failed (5)` · `Tests 11 failed | 9 skipped (20)` ·
종료 코드 1. 한 대만 꽂혀 있으면 `PERFTRACKER_TEST_DEVICE` 는 필요 없습니다.

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
  않습니다 — 에뮬레이터가 함께 켜져 있으면 `AmbiguousDeviceError` 로 하나도 돌지 못합니다 (위).
- **화면이 꺼지면 세션이 의미를 잃습니다.** 필요하면 `adb shell svc power stayon usb`,
  **끝나면 반드시 `false` 로 원복하세요.**
- 스펙 파일들은 **직렬로** 돕니다 (`vitest.device.config.ts` 의 `fileParallelism: false`).
  같은 기기의 활성 세션 포인터를 공유하므로 병렬로 돌리면 서로의 세션을 밟아 가짜 실패가
  납니다. 이것을 켜지 마세요.
- 온-디바이스 스펙은 `npm test` 에서 제외되어 있습니다 (`vitest.config.ts`).
  기기 없이도 `npm test` 는 그대로 통과해야 합니다.

## 검증 환경

| 항목 | M0+M1 | M2 | M3 | 진단 세션 |
|---|---|---|---|---|
| 실기기 (SM-S901N, Android 16 / sdk 36) | ✅ | ✅ | ✅ | ✅ |
| 에뮬레이터 (sdk_gphone64_arm64, API 35, 4코어) | — | ✅ | ✅ | — |

실기기 검증(2026-07-27)은 두 단계로 나뉩니다. **숫자가 다른 이유를 함께 적습니다** —
중간에 스펙이 하나 늘고 대상 앱이 바뀌었기 때문입니다.

| 언제 | 스펙 수 | 결과 | 대상 앱 |
| --- | --- | --- | --- |
| 실기기 검증 웨이브 | 10 | **5회 연속 10/10** | `com.android.settings` |
| CPU·Log 앱 단위화 이후 | 11 | **1회 11/11** | `com.nhn.android.webtoon` |
| 진단 세션 스펙 추가 (현재, 2026-10-08) | 20 | **1회 20/20** | `com.google.android.youtube` |

즉 **현재 스펙 구성으로 5회 연속을 돌린 적은 없습니다.** 5회 연속의 근거는 그 앞 구성의
것이고, 10 → 11 로 늘어난 스펙 하나는 "세션 스펙의 대상 앱이 이 기기에 설치되어 있다"(`m0`)입니다.
대상 앱을 바꾼 이유는 아래 "온-디바이스 테스트를 다른 기기에서 돌리기" 에 있습니다.
11 → 20 은 진단 세션 스펙(`diagnose.test.ts`, 9개)이고, 그 회차의 대상 앱은 YouTube 입니다 —
**20개를 웹툰으로 돌린 적은 없습니다** ([아래](#진단-세션--diagnose을-실기기가-검증한-것-2026-10-08-sm-s901n--sdk-36)).

유닛 테스트는 그 시점에 `npm test` **723/723**, `npm run typecheck` · `npm run build`
클린이었습니다 (M3 당시의 수치입니다 — 지금은 더 늘었습니다).

### 진단 세션(`--diagnose`)을 실기기가 검증한 것 (2026-10-08, SM-S901N / sdk 36)

대상은 YouTube 21.29.366 이고 흐름은 사람이 하는 것과 같습니다 —
`start --app com.google.android.youtube --launch --diagnose` → **다른 셸에서** `adb shell input swipe` 4회
(홈 피드 스크롤) → `stop`. 스와이프는 perftracker 를 거치지 않는 시나리오 입력이라 측정 창 안 기기 접촉 0
과 부딪히지 않습니다 — `adb_commands_during_session` 은 도구가 창 안에서 낸 명령 수입니다.

수동 1회의 `result.json` (18.6초 세션):

| 칸 | 값 |
| --- | --- |
| `session.options.diagnose` · `adb_commands_during_session` · `trace_buffer_overrun` | `true` · 0 · `false` |
| `diagnose.status` · `app_slices_open` | `collected` · `true` |
| `trace_slices` · `target_process_slices` · `target_process_slices_unfinished` | 123,772 · 116,165 · 1 |
| `ftrace_overrun_events` · `trace_bytes` | 0 · 11,293,657 |
| `target_process_slice_names_unfolded` → 표 행 | 8,314 → 1,088 |
| `bindApplication` 행 | 메인 스레드 1회 · 115.2 ms |
| `Choreographer#doFrame *` 행 | 메인 스레드 1,070회 |
| `RV Scroll` 행 | 메인 스레드 795회 |

- **frametimeline 은 실제로 빠졌습니다.** 같은 원본을 `trace_processor` 로 따로 세면 대상 앱 프로세스의
  트랙에 slice 가 118,050개 있고 그중 1,885개가 Actual · Expected Timeline 입니다 — 블록의 116,165 는 그 차이와
  같습니다. 고유 이름 9,219 → 8,314, 비동기 갈래 2,079 → 194 도 같은 방식으로 맞습니다.
- **보고서** — `perftracker report` 로 낸 파일 하나의 진단 탭 slice 표가 1,088행(블록 표와 같음) ·
  외부 요청 0 · 1440 폭 가로 넘침 0 이었습니다.
- **끝난 뒤 기기** — `debug.atrace.tags.enableflags` 0 · `debug.atrace.app_number` 빈 값 · perfetto 세션 0 ·
  그 세션의 원격 파일 0. `debug.atrace.app_0` 에는 `com.google.android.youtube` 가 남습니다 — perfetto 가 마지막
  패키지를 남기는 것이고, 이 도구는 atrace 속성을 고치지 않습니다.
- **같은 조건의 평소 세션** — `result.json` · `session.json` 에 진단 관련 키 0 · 최대 30분. 원본에 실린
  TraceConfig(`trace_config_pbtxt`)를 꺼내 보면 진단 세션 것에서 `atrace_*` 네 줄이 빠지고 `duration_ms` 만
  600000 → 1800000 으로 다를 뿐 나머지는 글자까지 같습니다. 평소 원본의 스레드 slice 는 0개입니다.

온-디바이스 스펙 `packages/cli/test/on-device/diagnose.test.ts`(9개)가 같은 것을 봅니다. 수의 크기는 단언하지
않고 관계를 단언합니다 — `trace_processor` 로 따로 센 수 = 블록의 수, 보고서 행 모델의 행 수 = 블록 표 행 수,
`extract` 를 다시 돌린 블록 = `stop` 이 쓴 블록(바이트까지). 스펙 회차 가운데 한 번은 앱이 트레이스에
낡은 이름으로 남아 블록이 `partial` + `process_name_stale_in_trace` 였고 값은 다 있었습니다
([아래](#트레이스가-앱을-다른-이름으로-아는-경우-zygote64--pre-initialized)). 스펙은 값을 싣는 `partial` 둘
(`process_name_stale_in_trace` · `ftrace_setup_errors`)을 받고 그 값이 `null` 이 아닌지 보며, 켜기 오류가 있던
회에는 행(`bindApplication` 등)을 보지 않습니다 — 어느 카테고리가 빠졌는지 원본이 말하지 않기 때문입니다.

**검증하지 못한 것:**

- **sdk 31–34 · sdk 30 이하 기기.** 앱 slice 열림 조건 표의 그 칸은 안드로이드 문서 근거와 합성 시험뿐입니다.
- **YouTube 말고 다른 앱.** 진단 스펙을 다른 앱으로 돌린 적이 없습니다. `RV Scroll` 행(androidx RecyclerView 가
  남기는 앱 slice)은 대상 앱이 YouTube 일 때만 단언하고, 아니면 그 시험을 건너뜀으로 셉니다(요약 줄의
  `skipped` · `--reporter=verbose` 면 이유까지) — 스와이프를 빼면 그 행이 사라지는 것은 봤습니다.
- **켜기 오류(`ftrace_setup_errors`)가 있는 회차.** 이 기기에서 돈 진단 회차는 켜기 오류가 전부 0 이었습니다.
  스펙이 그 갈래를 받는 것은 core 가 늘 켜기 오류로 내게 고친 빌드로만 돌려 봤습니다.
- **`bindApplication` 행이 atrace 켜짐 대기 덕인지.** 대기를 뺀 빌드로 돌린 1회에서도 행이 잡혔습니다
  (대기를 넣기 전 실측은 0/1). 경합이라 한 번으로는 못 가립니다 — 대기 자체는 유닛 시험(`D14 …`)이 지킵니다.
- **ftrace 손실이 0 이 아닌 회차** · **10분짜리 진단 원본으로 낸 블록**(쿼리 시간 · `result.json` 크기) — 본 적이 없습니다.

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
  **실기기에서도 같은 일이 일어납니다** — SM-A405S(Android 11)는 `android.log` 만 켠 트레이스가
  0줄이고 같은 config 가 SM-F936N(Android 16)에서는 1,021줄입니다. 데이터소스는 양쪽 다
  등록돼 있습니다. perfetto 문서는 이 데이터소스를 *"supported only on Android userdebug
  builds"* 라고 적지만 두 기기 다 `ro.build.type=user` 이고, 소스에는 빌드 타입 검사가 없이
  `/dev/socket/logdr` 에 붙어 실패하면 조용히 빕니다 — 버전이 아니라 **소켓 권한**입니다.
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

- `memory` / `cpu` / `log` 의 `process` 는 **패키지명**입니다 — 확인되지 않은
  이름이 결과에 실리는 일은 없습니다. **셋이 같은 규칙(`resolveAppProcess`)을 쓰므로
  같은 프로세스를 가리킵니다.**
- 세 메트릭의 `status` 는 `partial`, `reason_code` 는 `process_name_stale_in_trace` 입니다.
  값은 정상이고, "이름이 아니라 pid 로 확인했다" 는 사실을 그 코드가 말합니다.
- pid 조차 없으면(= `--launch` 없이 시작했고 이름도 안 맞음) 추측하지 않습니다 —
  `process_not_in_trace` 로 값을 내지 않습니다.

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

`memory` · `cpu` · `log` 세 지표에 **1초 단위 추이**가 함께 실립니다.
집계값(평균·최대·백분위)만으로는 구분되지 않는 것을 보려는 값입니다:

```
 초 │ 프레임  p50  │ RSS MB │ CPU ms │ 로그(E)
  0 │     ·      · │    198 │      · │      ·     ← 앱 시작
  2 │    80   7.64 │    461 │   3400 │   8(3)
  9 │   159  10.38 │    555 │   1590 │ 16(16)     ← 에러가 몰린 구간
 12 │   187  10.99 │    570 │   1440 │ 122(11)
```

**세 지표가 같은 `t_s` 를 씁니다.** 기준점은 트레이스 전체의 시작(`trace_bounds.start_ts`)
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
