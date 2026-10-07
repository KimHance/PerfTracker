# collectors

지표 8개: `hwui` · `frame` · `startup` · `cpu` · `memory` · `log` · `thermal` · `network`.
`registry.ts` 의 `COLLECTORS` 배열이 실제로 소비된다 — `start` 가 TraceConfig 블록을 모으고
`extract` 가 순회해 `metrics` 를 채운다.
**진단 세션은 예외 하나를 더한다** — atrace 는 collector 가 읽는 것이 아니라 세션 종류의 것이라,
`collectTraceConfigBlocks(env, atrace)` 가 모은 블록의 `linux.ftrace`(`FTRACE_POWER_BLOCK`)를 같은 자리에서
진단 블록(`blocks.ts` 의 `diagnoseFtraceBlock`)으로 바꾼다. 평소 세션(`atrace` 없음)의 블록은 그대로다.

## 지표 하나의 네 계층

수집 경로는 SDK 마다 다르고 도메인 모델은 하나여야 한다. 그래서 이렇게 나눈다:

| 파일 | 아는 것 | **모르는 것** |
| --- | --- | --- |
| `model.ts` | 데이터 모델(중간형). import 0개 | — |
| `sources/*.ts` | SQL · dumpsys · 프로세스 특정 | 버킷 · 백분위 · 단위 변환 |
| `toDomain.ts` | 계산과 스키마 매핑 | 기기 · SDK · 명령 |
| `index.ts` | 소스 선택 + 사유 판단 | — |

**새 SDK 경로는 `sources/` 에 파일 하나 + `index` 의 분기 하나로 끝난다.** 계산은 한 벌만
유지된다. 규율은 grep 으로 검사된다 — `sources/` 에 `bucketFrames|percentile|bytesToKb` 가
없고 `toDomain` 에 `select |queryJson|adb\.` 가 없어야 한다.

예외 하나: `thermal/model.ts` 만 import 가 1개다. 파서가 `device/state.ts` 에 있고 그것이
`device.state_*.thermal_zones` 도 채우므로, 내리면 device → collector 뒤집힌 의존이 생긴다.

## 공유 자산

| 파일 | 무엇 |
| --- | --- |
| `blocks.ts` | 데이터소스 블록의 **유일한 소유자**. 같은 소스를 다른 텍스트로 두 번 요청하면 merge 가 던진다. 진단 세션의 `linux.ftrace`(atrace 포함)도 여기서 만든다 |
| `timeline.ts` | 모든 시계열의 공통 0초(`trace_bounds.start_ts`) |
| `appProcess.ts` | "트레이스 안에서 대상 앱" 을 정하는 **단 하나의 규칙** |
| `snapshots.ts` | 캡처 전/후 dumpsys 명세 |
| `types.ts` | collector 인터페이스. `traceConfigBlocks(env)` 가 `env` 를 받는 이유가 여기 적혀 있다 |

## 제약

- **`supports()` 와 config 는 층이 다르다.** 전자는 "이 지표를 낼 수 있는가"(못 내면 그 지표만
  `skipped`), 후자는 "이 config 가 열리는가"(못 열면 **전부** 실패).
- **어떤 기준선과도 비교하지 않는다.** 분포와 백분위만 낸다.
  **대신 기기가 내린 판정은 사실로 싣는다** — `hwui.deadline_missed` 가 그것이다.
  마감은 프레임마다 다르고 세션 중에도 바뀌는데, 그 비교는 기기가 프레임 단위로 이미 끝냈다.
  기준선을 **고르는** 것과 기기가 내린 결과를 **전달하는** 것은 다른 일이다.
- **화면에 없는 데이터를 파일에만 남기지 않는다.** 렌더를 트레이스(`frame`)와 `hwui` 두
  경로로 재면서 **둘이 같은 종류의 숫자(개수·백분위)를 각자** 내던 시절이 있었다. 보고서가
  `hwui` 만 그리게 되자 트레이스 쪽이 `result.json` 에만 남았고, **사람은 보고서를 LLM 은
  파일을 보는데 둘이 다른 숫자를 들게 됐다** (같은 세션에서 `janky_frames` 170 대 1,556).
  `frame` 이 한 번 접힌 것이 이 이유다(`e38075b`) — 지표를 하나 더 두기 전에 **화면이
  그것을 그릴 것인가**를 먼저 물을 것. 안 그릴 것이면 안 재는 편이 낫다.
  **`frame` 은 2026-08-31 에 범위를 바꿔 되살아났다** — 개수도 백분위도 내지 않고 시간축
  (`samples`)만 낸다. `hwui` 와 겹치는 이름의 숫자가 없으므로 위 재발 조건 자체가 없다.
  규칙은 그대로 유효하다: 새 지표가 기존 지표와 **같은 종류의 숫자**를 내려 한다면 화면이
  둘 다 그릴 것인지 먼저 물을 것.
- `thermal` · `network` 에는 시계열이 없다 (전/후 두 점뿐 — 중간은 규칙 1 위반 없이 못 얻는다).
- **기기 전역 시계열은 이미 받은 표본을 다시 접는 것이다.** `cpu.device_timeline` 과
  `memory.system_timeline` 은 집계와 **같은 카운터**를 초 단위로 나눈 값이라 데이터소스도
  폴링 주기도 늘지 않는다. 새 시계열을 넣을 때 이 조건(트레이스에 이미 있는가)을 먼저 볼 것.
- **누적 카운터와 순간값은 첫 초 처리가 다르다.** `cpu.times.*` · `runtime.*` 은 누적이라
  첫 초가 배열에 없고(앞에 뺄 대상이 없다), meminfo 는 순간값이라 첫 초도 있다.
