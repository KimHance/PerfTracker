# PerfTracker

![PerfTracker](https://raw.githubusercontent.com/KimHance/PerfTracker/main/docs/media/banner.png)

안드로이드 앱 성능을 앱 수정 없이 재는 CLI 입니다.
adb 로 기기에 붙어 Perfetto 트레이스와 측정 전후 기기 상태를 남기고, 계산은 내 컴퓨터에서 합니다.

- 앱에 SDK 를 넣지 않고, 루팅도 기기에 설치할 것도 없습니다
- 릴리스 빌드로 깔린 아무 앱이나 잴 수 있습니다
- 측정하는 동안에는 기기에 명령을 하나도 보내지 않습니다
- 결과는 판정 없는 숫자(`result.json`)와 보고서 HTML 한 장입니다

![adb 연결 하나로 기기 신호 세 갈래를 모아 호스트에서 지표 8개를 계산하고, 결과 파일과 보고서 한 장으로 내보내는 흐름](https://raw.githubusercontent.com/KimHance/PerfTracker/main/docs/media/diagram-dataflow.png)

## 빠른 시작

Node 20.19 이상과 adb 가 필요합니다. 폰은 USB 디버깅만 켜 두면 됩니다.

```bash
npx perftracker doctor                                  # 이 기기에서 뭘 잴 수 있는지
npx perftracker start --app YouTube --name "홈 스크롤" --launch
#   … 폰에서 앱을 조작 …
npx perftracker status                                  # 경과 확인 (기기에 안 닿음)
npx perftracker stop --report                           # result.json + 보고서
```

브라우저로 하고 싶으면 `npx perftracker open`. 측정 중에 있었던 일은 `npx perftracker mark "광고 재생"` 으로 적어 둡니다.

## 무엇을 재는가 — 지표 8개

| 지표 | 귀속 범위 | 무엇인가 | 어디서 나오는가 |
| --- | --- | --- | --- |
| [`startup`](https://github.com/KimHance/PerfTracker/blob/main/docs/result-json.md#metricsstartup) | 앱 | 콜드 스타트 시간 (`--launch` 세션만) | `am start -W` — **유일하게 트레이스를 안 읽는 지표** |
| [`cpu`](https://github.com/KimHance/PerfTracker/blob/main/docs/result-json.md#metricscpu) | **앱 + 기기 전역** | 앱 프로세스의 CPU 시간, 기기 전체 사용률·코어별·주파수 | perfetto `linux.sys_stats` + `linux.process_stats` |
| [`memory`](https://github.com/KimHance/PerfTracker/blob/main/docs/result-json.md#metricsmemory) | **앱 + 기기 전역** | 앱 프로세스의 RSS 통계, 기기 전체 meminfo | perfetto `linux.process_stats` + `linux.sys_stats` |
| [`log`](https://github.com/KimHance/PerfTracker/blob/main/docs/result-json.md#metricslog) | **앱 + 기기 전역** | 우선순위별 로그 개수, 크래시·ANR 목록 | perfetto `android.log` |
| [`thermal`](https://github.com/KimHance/PerfTracker/blob/main/docs/result-json.md#metricsthermal) | 기기 전역 | 센서별 온도의 세션 전/후 차이 | `dumpsys thermalservice` 전/후 스냅샷 |
| [`network`](https://github.com/KimHance/PerfTracker/blob/main/docs/result-json.md#metricsnetwork) | **uid** | 세션 동안 오간 바이트·패킷 | `dumpsys netstats` 전/후 스냅샷 |
| [`hwui`](https://github.com/KimHance/PerfTracker/blob/main/docs/result-json.md#metricshwui) | 앱 | 프레임워크가 직접 센 렌더링 집계와 **원인별 개수** | `dumpsys gfxinfo` 전/후 스냅샷 |
| [`frame`](https://github.com/KimHance/PerfTracker/blob/main/docs/result-json.md#metricsframe) | 앱 + **표시 프레임은 기기 합성** | 화면에 나간 프레임의 **시간축** (개수·백분위는 없음) | perfetto `android.surfaceflinger.frametimeline` — **sdk 31 이상** |

Android 11(sdk 30)부터 됩니다. `network` 은 Android 14, `frame` 은 Android 12 이상에서만 나옵니다.

## 두 가지 원칙

**측정이 측정 대상을 바꾸지 않습니다.** `start` 가 끝나고 `stop` 할 때까지 기기에 adb 명령을 하나도 보내지 않습니다.
명령 하나만 보내도 CPU · 로그 수치가 흔들리기 때문입니다. 트레이스는 기기가 혼자 기록하고 `stop` 때 한 번에 가져옵니다.

![측정 중엔 기기에 명령 0회 — 시작에서 상태를 찍고 기록을 켜고, 끝에서 기록을 회수하고 상태를 다시 찍는다. 계산은 나중에 기기 없이](https://raw.githubusercontent.com/KimHance/PerfTracker/main/docs/media/diagram-session.png)

**판정하지 않습니다.** 결과에 "좋다 / 느리다" 가 없습니다. 기준과 비교하는 건 CI 나 사람의 몫이고,
구글 기준치는 `references` 에 출처와 함께 적어 두기만 합니다. 못 잰 값은 0 이 아니라 `null` 과 이유 코드로 남깁니다.

## 명령

| 명령 | 무엇 |
| --- | --- |
| `perftracker doctor` | 환경과 기기 점검 |
| `perftracker devices` | 연결된 기기 |
| `perftracker apps` | 열 수 있는 앱 목록 |
| `perftracker start` | 측정 시작 |
| `perftracker mark <라벨>` | 측정 중 마킹 (기기에 안 닿음) |
| `perftracker status` | 진행 중인 세션 (기기에 안 닿음) |
| `perftracker stop` | 측정 끝 · `result.json` 생성 |
| `perftracker extract <run-dir>` | 원본으로 `result.json` 다시 계산 (기기 불필요) |
| `perftracker runs list` · `perftracker runs rename <id> <이름>` · `perftracker runs rm <id>` | 기록 목록 · 이름 변경 · 삭제 |
| `perftracker report <id>` | 기록을 HTML 파일 하나로 |
| `perftracker open` | 브라우저 화면 |
| `perftracker schema` | `result.json` 의 JSON Schema |

`start` 옵션: `--app` · `--name` · `--launch`(콜드 스타트) · `--device` · `--out` · `--force` ·
`--diagnose`(atrace slice 까지 기록하는 진단 세션) · `--compile reset|speed-profile|speed`(`--launch` 와만 · 측정 전에 앱 컴파일 상태를 맞춤).

## 더 보기

- [자세한 사용법](https://github.com/KimHance/PerfTracker/blob/main/docs/usage.md) — 설치 · 명령별 옵션 · 진단 세션 · `--compile` · 문제가 생겼을 때 · 개발
- [`result.json` 읽는 법](https://github.com/KimHance/PerfTracker/blob/main/docs/result-json.md) — 필드 하나하나 · 스키마 버전
- [CHANGELOG](https://github.com/KimHance/PerfTracker/blob/main/CHANGELOG.md) — 버전별 변경과 실기기 검증 기록
