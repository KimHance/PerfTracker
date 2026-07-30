# collectors

지표 8개: `frame` · `hwui` · `startup` · `cpu` · `memory` · `log` · `thermal` · `network`.
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
  **대신 기기가 고른 기준선은 사실로 싣는다** — `frame.deadlines` 가 그것이다. 마감은
  프레임마다 다르고 세션 중에도 바뀐다(실측 한 세션에 8.33ms·16.67ms 공존). 그것을 안 실으면
  읽는 쪽이 지속 시간을 무엇에 대해 읽어야 하는지 모른다. 기준선을 **고르는** 것과 기기가
  고른 것을 **전달하는** 것은 다른 일이다.
  `frame.jank` 도 같다 — 기기가 `jank_type` 에 붙여 둔 꼬리표를 **세기만** 하고 어느 것이
  심각한지 정하지 않는다. 꼬리표는 집합이라 `by_type` 의 합이 `janky_frames` 를 넘는 것이
  정상이고, 하나만 고르면 세지 않은 것을 0 으로 만드는 셈이 된다.
- **같은 것을 다른 눈으로 보는 지표는 나눈다.** `frame`(트레이스)과 `hwui`(`dumpsys gfxinfo`
  전후 델타)가 그렇다 — 전자는 초 단위 추이와 분포, 후자는 View 계층만 센 Vitals 모집단과
  원인별 개수다. 숫자가 다르면 그것이 정보다. **한쪽으로 맞추려고 다른 쪽을 접지 말 것.**
  안에 넣을지 밖으로 낼지는 **실패 조건이 같은가**로 가른다: `hwui` 는 트레이스가 없어도
  나오므로(sdk 30 에서 `frame` 은 미지원인데 `hwui` 는 나온다) 별도 지표다.
- **레이어마다 한 행인 테이블은 접어야 프레임이 된다.** `actual_frame_timeline_slice` 를
  그대로 세면 실측 2.4배가 나온다 (SurfaceView + Background 짝). `display_frame_token` 으로
  접고 최댓값을 쓴다 — **이름으로 거르지 않는다** (`appProcess.ts` 와 같은 이유).
- `thermal` · `network` 에는 시계열이 없다 (전/후 두 점뿐 — 중간은 규칙 1 위반 없이 못 얻는다).
- **기기 전역 시계열은 이미 받은 표본을 다시 접는 것이다.** `cpu.device_timeline` 과
  `memory.system_timeline` 은 집계와 **같은 카운터**를 초 단위로 나눈 값이라 데이터소스도
  폴링 주기도 늘지 않는다. 새 시계열을 넣을 때 이 조건(트레이스에 이미 있는가)을 먼저 볼 것.
- **누적 카운터와 순간값은 첫 초 처리가 다르다.** `cpu.times.*` · `runtime.*` 은 누적이라
  첫 초가 배열에 없고(앞에 뺄 대상이 없다), meminfo 는 순간값이라 첫 초도 있다.
