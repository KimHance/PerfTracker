# @perftracker/core

수집·파싱·스키마. **기기 접촉은 전부 이 패키지를 지난다.** 런타임 의존성은 `zod` 하나다.

## 진입점

| 경로 | 무엇 |
| --- | --- |
| `src/index.ts` | 공개 배럴. **구체 프로세스 실행기는 일부러 내보내지 않는다** |
| `src/adb/` | `AdbClient` 와 측정 창 래치. 기기로 가는 모든 길목 |
| `src/collectors/` | 지표 8개 ([AGENTS.md](src/collectors/AGENTS.md)) |
| `src/session/` | `start` / `stop` / 활성 세션 포인터 / 마킹 / **기록 목록**(`runs.ts`) / **진단 세션**(`diagnose.ts` — 앱 slice 열림 판정 · atrace 대기) |
| `src/extract/` | 트레이스 재파싱 → `result.json` 조립 · **진단 블록**(`diagnose.ts` — 진단 세션에만) |
| `src/schema/` | `result.json` 의 zod 스키마 · `reason_code` · `references` |
| `src/device/` | 기기 목록 · 정적 스펙 · 전/후 상태 스냅샷 · `probeDevice` |
| `src/app/` | 앱 목록 · 라벨 해석(`resources.arsc` 직접 파싱) · 대상 특정 · 빌드 속성 · **컴파일 상태**(`dexopt.ts` — `Dexopt state` 절 파서 · 끝 상태 읽기 · 바뀜 경고) |
| `src/perfetto/` | TraceConfig 조립 · `--detach` 세션 · `trace_processor` |
| `src/device/clock.ts` | 기기 시계 − 호스트 시계. 마킹과 시계열의 0초를 잇는다 |
| `src/host/` | **기기가 아닌 이 컴퓨터.** 이 패키지에서 `AdbClient` 를 안 받는 유일한 수집 지점 |
| `src/copy/` | 기능이 **새로** 내는 사용자 문구 모음. 정본은 디자인 문서 `## 문구` 표 (`docs/design/<기능>.md`). 단어형 규칙(`wordform.ts`)은 cli · gui 시험도 여기서 가져간다 |

## 제약

- **배럴이 `ProcessRunner` 구현을 공개하지 않는다.** 공개하면 소비자가 `AdbClient` 를 건너뛰어
  측정 창 래치를 우회할 수 있다. 밖으로 나가는 것은 타입뿐이다.
- **`cli` 를 import 하지 않는다.** 의존은 한 방향이다.
- **스키마의 한정은 `.describe()` 에 넣는다.** `z.toJSONSchema()` 는 런타임이라 소스 주석을
  못 본다 — 스키마만 읽는 소비자(CI · LLM)에게 주석은 존재하지 않는다.
  값의 의미가 범위에 달렸으면 **필드 이름에도** 범위를 넣는다 (`device_` 접두어).
- **`perfetto/config.ts` 의 `assertLowOverheadConfig` 를 통과한 config 만 기기로 나간다.**
  ftrace 이벤트는 화이트리스트(`ALLOWED_FTRACE_EVENTS`)이고, 새 이벤트는 **그것을 읽는
  collector 와 같은 커밋에** 넣는다. 읽지 않는 이벤트는 트레이스만 키우는 것이 아니라 커널이
  링버퍼에 쓰는 비용을 그 순간 인터럽트당한 프로세스(대상 앱일 수 있다)에 청구한다.
- **atrace 는 진단 세션(`startSession` 의 `diagnose`)에만 있다.** 평소 세션 config 에 `atrace_` 로
  시작하는 키가 하나라도 있으면 `assertLowOverheadConfig` 가 거부하고, 진단 세션도 두 키
  (`atrace_categories` · `atrace_apps`) · 카테고리 허용 목록(`DIAGNOSE_ATRACE_CATEGORIES`) · 대상 앱
  하나 밖이면 거부한다. atrace slice 의 비용은 커널 ftrace 와 달리 **slice 를 남기는 앱 프로세스
  자신**에게 청구되고 `measurement_overhead` 에 안 잡힌다 — 평소 세션의 수치와 섞이면 안 되는 이유다.
  평소 세션의 config · 기기 명령 목록은 진단 모드 이전과 글자 하나 다르지 않다 (`start.test.ts` 가 원문을 고정).
- **config 는 기기에 아무 일도 시키기 전에 만든다.** `startSession` 은 probe 바로 뒤에 config 를 조립해
  검증한다 — 거부될 config 로 시작 스냅샷 · force-stop · perfetto 가 먼저 나가면 앱만 죽은 채로 남는다.
- **앱 slice 가 열리나는 `session/diagnose.ts` 의 `appSliceOpen` 하나가 정한다.** doctor 의 기기 줄 ·
  start 고지 · 화면 · extract 가 전부 그것을 부른다. sdk 경계를 다른 파일에 다시 쓰지 않는다.
- **출시된 계약을 넓히면 `schema_version` 의 minor 를 올린다.** 1.1.0 은 npm 0.1.0 ~ 0.2.1 로 나갔고
  진단 블록이 1.2.0 이다. 규칙표는 `src/schema/result.ts` 상단에 있다. **진단 세션의 키(`diagnose` ·
  `session.options.diagnose`)는 진단 세션에만 싣는다.** 컴파일 상태(`target_app.compile_state_*`)는 모든 세션에
  싣는다 — 그래서 평소 세션 산출물도 1.1.0 스키마가 거부한다 (`target_app` 이 닫힌 객체 · baseline-profile 결정 7).

## 자주 틀리는 자리

- **거짓 청정 신호** — 조회조차 못 한 것에 `0`/`false`/`[]` 를 쓰지 않는다. 판정 기준은
  "이 필드를 보고 소비자가 내릴 결론이 사실인가". `target_app.debuggable` 이 이 규칙의 가장
  비싼 자리다: `false` 는 "릴리스임을 확인했다" 이고 `null` 은 "모른다" 인데, 둘을 바꿔 쓰면
  디버그 빌드를 재고 릴리스라고 읽는 세션이 생긴다.
- **"서드파티 앱"은 "사람이 열 수 있는 앱"이 아니다.** 앱 목록의 필터는 `pm list packages -3`
  이 아니라 런처 질의(`app/list.ts` 의 `LAUNCHER_QUERY`)다. 실기기 실측으로 두 집합은 84 대
  82인데 **겹치는 것이 58개**뿐이었다 — 유튜브·크롬·카메라는 선탑재라 `-3` 에서 빠지고,
  `*.test`(androidTest APK)는 `-3` 에 있는데 열리지 않는다. 재고 싶은 앱이 목록에 없었다.
- **필드를 늘릴 때 명령을 늘리지 않는다.** `app/detail.ts` 의 일곱 필드와 시작 컴파일 상태는 전부 한 번의
  `dumpsys package` 출력에서 나오고, 화면 방향·크기 구간은 이미 읽은 해상도에서 **파생**한다.
  `start` 전 왕복 하나가 곧 콜드 스타트가 그만큼 늦게 시작된다는 뜻이다.
- **화면이 하나라는 보장이 없다.** `dumpsys display` 는 폴더블·외부 모니터·DeX·미러링이면
  화면마다 `mActiveSfDisplayMode` 를 하나씩 낸다. **순서로 고르지 않는다** — 실측 SM-F936N
  (접힘)에서 먼저 나오는 것이 꺼져 있는 내부 화면이라, `.exec()` 로 첫 번째를 집던 시절
  해상도는 커버 화면(904x2316)인데 주사율만 내부 화면(60Hz)인 값이 나갔다. 같은 파일의
  기기는 실제로 120Hz 로 돌고 있었는데도. 지금은 `mViewports` 의
  `isActive=true` 로 패널 크기를 정하고 그 크기의 모드만 본다. **못 고르면 `null`** —
  화면이 여럿인데 어느 것인지 모르면서 하나를 찍는 것이 정확히 그 버그였다.
  `appProcess.ts` 가 이름으로 안 거르는 것과 같은 규율이다: 순서도 이름도 근거가 아니다.
- **프로세스 특정** — 트레이스의 이름은 낡을 수 있다(`zygote64` / `<pre-initialized>`).
  이름 목록으로 막는 방어는 성립하지 않는다. 규칙은 `collectors/appProcess.ts` 하나뿐이다.
- **config 는 부분 수용이 없다** — 기기가 모르는 필드 하나가 세션 전체를 거부시킨다.
  버전에 따라 달라지는 필드는 `collectors/blocks.ts` 에서 sdk 로 가른다.
