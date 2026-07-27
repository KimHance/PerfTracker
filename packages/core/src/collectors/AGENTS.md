# collectors

지표 7개: `frame` · `startup` · `cpu` · `memory` · `log` · `thermal` · `network`.
`registry.ts` 의 `COLLECTORS` 배열이 실제로 소비된다 — `start` 가 TraceConfig 블록을 모으고
`extract` 가 순회해 `metrics` 를 채운다.

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
| `blocks.ts` | 데이터소스 블록의 **유일한 소유자**. 같은 소스를 다른 텍스트로 두 번 요청하면 merge 가 던진다 |
| `timeline.ts` | 모든 시계열의 공통 0초(`trace_bounds.start_ts`) |
| `appProcess.ts` | "트레이스 안에서 대상 앱" 을 정하는 **단 하나의 규칙** |
| `snapshots.ts` | 캡처 전/후 dumpsys 명세 |
| `types.ts` | collector 인터페이스. `traceConfigBlocks(env)` 가 `env` 를 받는 이유가 여기 적혀 있다 |

## 제약

- **`supports()` 와 config 는 층이 다르다.** 전자는 "이 지표를 낼 수 있는가"(못 내면 그 지표만
  `skipped`), 후자는 "이 config 가 열리는가"(못 열면 **전부** 실패).
- **어떤 기준선과도 비교하지 않는다.** 분포와 백분위만 낸다.
- `thermal` · `network` 에는 시계열이 없다 (전/후 두 점뿐 — 중간은 규칙 1 위반 없이 못 얻는다).
