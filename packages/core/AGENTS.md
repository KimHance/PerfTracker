# @perftracker/core

수집·파싱·스키마. **기기 접촉은 전부 이 패키지를 지난다.** 런타임 의존성은 `zod` 하나다.

## 진입점

| 경로 | 무엇 |
| --- | --- |
| `src/index.ts` | 공개 배럴. **구체 프로세스 실행기는 일부러 내보내지 않는다** |
| `src/adb/` | `AdbClient` 와 측정 창 래치. 기기로 가는 모든 길목 |
| `src/collectors/` | 지표 7개 ([AGENTS.md](src/collectors/AGENTS.md)) |
| `src/session/` | `start` / `stop` / 활성 세션 포인터 / 마킹 / **기록 목록**(`runs.ts`) |
| `src/extract/` | 트레이스 재파싱 → `result.json` 조립 |
| `src/schema/` | `result.json` 의 zod 스키마 · `reason_code` · `references` |
| `src/device/` | 기기 목록 · 정적 스펙 · 전/후 상태 스냅샷 · `probeDevice` |
| `src/app/` | 앱 목록 · 라벨 해석(`resources.arsc` 직접 파싱) · 대상 특정 |
| `src/perfetto/` | TraceConfig 조립 · `--detach` 세션 · `trace_processor` |

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
- **`schema_version` 은 미출시 동안 올리지 않는다.** 규칙표는 `src/schema/result.ts` 상단에 있다.

## 자주 틀리는 자리

- **거짓 청정 신호** — 조회조차 못 한 것에 `0`/`false`/`[]` 를 쓰지 않는다. 판정 기준은
  "이 필드를 보고 소비자가 내릴 결론이 사실인가".
- **프로세스 특정** — 트레이스의 이름은 낡을 수 있다(`zygote64` / `<pre-initialized>`).
  이름 목록으로 막는 방어는 성립하지 않는다. 규칙은 `collectors/appProcess.ts` 하나뿐이다.
- **config 는 부분 수용이 없다** — 기기가 모르는 필드 하나가 세션 전체를 거부시킨다.
  버전에 따라 달라지는 필드는 `collectors/blocks.ts` 에서 sdk 로 가른다.
