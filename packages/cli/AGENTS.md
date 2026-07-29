# perftracker (CLI)

commander 진입점. **판단은 core 가 하고 여기는 옵션을 넘기고 결과를 사람이 읽는 문장으로
바꾼다.** 런타임 의존성은 `commander` 와 `@perftracker/core` 둘뿐이다.

## 진입점

| 경로 | 무엇 |
| --- | --- |
| `src/program.ts` | 명령 11개 등록 (`runs` 는 하위 셋). **실행하지 않는다** |
| `src/index.ts` | bin 진입점 — `parseAsync` 와 최상위 오류 처리뿐 |
| `src/context.ts` | `--adb` / `--device` 를 core 의 컨텍스트로 |
| `src/commands/` | 명령 하나당 파일 하나 |
| `test/readme.test.ts` | 등록된 명령이 전부 README 에 있는지 대조 |
| `test/on-device/` | **실기기가 있어야 도는 스펙.** `npm run test:device` 로만 실행 |

**등록과 실행을 가른 이유는 테스트다.** 진입점이 곧 실행이면 import 하는 순간 `process.argv`
를 파싱해 버려서, 명령 목록을 확인하려면 소스를 정규식으로 긁는 수밖에 없다. `program.ts` 를
따로 두면 테스트가 **commander 가 실제로 등록한 트리**를 읽는다.

명령: `doctor` `devices` `apps` `schema` · `start` `mark` `status` `stop` `extract` ·
`runs`(`list`/`rename`/`rm`) · `gui`.
실제 측정은 `start` / `stop` 둘뿐이고 나머지는 점검·조회·마킹·기록 관리다.

**기기에 접촉하지 않는 명령**은 `createContext` 를 부르지 않는다 — `mark` 와 `runs` 가 그렇다.
그것이 규칙 1 을 지키는 방식이다: 조심해서 안 부르는 것이 아니라 **부를 수단이 없는 것**.

**명령을 늘리면 README 의 「명령 전체」도 같은 커밋에서 고친다.** `runs` 셋이 한동안 문서에
없었다 — 틀린 것이 아니라 빠진 것이라 읽는 사람은 알 길이 없었다. `test/readme.test.ts` 가
이제 그것을 막는다.

## 제약

- **터미널에 요약을 찍지 않는다.** `stop` 과 `extract` 는 `→ <runDir>/result.json` 한 줄만 낸다.
  어느 지표를 앞에 둘지 자체가 이미 판단이고, 산출물은 `result.json` 하나다.
- **`doctor` 의 종료 코드는 `kind` 로 갈린다.** `requirement`(adb 없음 — 사람이 고쳐야 함)는
  exit 1, `capability`(이 기기가 뭘 잴 수 있나 — 고칠 수 없는 사실)는 exit 0.
  화면에는 둘 다 ✗ 로 보인다. 못 잰다는 사실 자체는 감추지 않는다.
- **`start` 는 못 재는 지표를 미리 알린다.** 세션은 열되 목록을 낸다 — 그 사실을 `stop` 뒤에
  알면 측정을 한 번 더 하게 된다.
- **`mark` 는 `createContext` 를 부르지 않는다.** 마킹은 활성 세션 포인터(호스트의 파일)만
  고치므로 측정 창 안에서 불려도 규칙 1 이 깨지지 않는다. `AdbContext` 를 받는 순간 그 보증이
  사라진다 — 다른 명령과 달리 `commands/mark.ts` 만 컨텍스트를 안 받는 이유다.
- **GUI 로 되는 일은 CLI 로도 된다.** 기록 목록·이름변경·삭제가 한동안 GUI 에만 있었고,
  그 상태를 두면 GUI 가 조금씩 자기만의 로직을 갖는다. 판정과 파일 조작은 core 의
  `session/runs.ts` 에 있고 CLI 와 GUI 는 나란히 그것을 부른다.
- **`--json` 은 추가 모드이지 대체가 아니다.** 사람이 읽는 문장이 기본이다 — 사람과
  기계(CI · LLM)가 둘 다 소비자다. `doctor` `devices` `apps` `status` `runs` 에만 있고
  `start`/`stop`/`mark` 에는 없다: 그 셋의 출력은 이미 한 줄이고, 시작 전에 알아야 할 것
  (이 기기가 뭘 잴 수 있나)은 `doctor --json` 이 전부 준다.
  **텍스트와 JSON 은 같은 규칙으로 답해야 한다** — `status` 가 세션 고르는 규칙을 `pick()`
  하나에 둔 이유다. 두 곳에 적으면 사람이 보는 답과 기계가 받는 답이 갈린다.
- **`status` 는 위반 0 을 보고하지 않는다.** 정상을 매번 찍으면 진짜 신호가 묻힌다.
  위반이 **있을 때만** 경고를 낸다.
- **`runs rm` 은 기록이 아닌 폴더도 지운다.** `start` 가 죽어 `session.json` 조차 없는 폴더는
  목록에 없으니 예전에는 삭제 대상도 못 됐고 사람이 `rm -rf` 를 쳐야 했다. 판별은 이름이 아니라
  **내용물**로 한다 (`session.json`·`capture.json`·`result.json`·`trace.perfetto-trace`·`raw/`
  중 하나) — 이름은 사람이 바꿀 수 있지만 저 파일은 이 도구만 만든다.
- **측정 중인 세션의 폴더는 지우지 않는다.** 그 자리는 `stop` 이 트레이스를 회수해 쓸 곳이다.
  거절할 때 "찾지 못했습니다" 가 아니라 **"측정 중입니다"** 라고 말한다 — 멀쩡한 id 를 든
  사람이 엉뚱한 곳을 뒤지지 않게.
- **`runs rm --all` 은 `--yes` 없이 거부한다.** 되묻지 않는 이유는 CI 다 — 입력을 기다리면
  빌드가 타임아웃까지 매달린다. id 를 직접 적은 삭제는 그 자체가 의사 표시라 묻지 않는다.
- **`gui` 는 끝나지 않는 명령이다.** 문자열을 돌려주지 않고 Ctrl-C 까지 서버를 붙잡는다.
  서버 구현은 `@perftracker/gui` 에 있고 CLI 는 그것을 부르기만 한다.
- **core 의 판정을 다시 구현하지 않는다.** `doctor` 의 지표 지원 여부도 collector 의
  `supports()` 를 그대로 부른다. 출처가 둘이면 "된다" 고 한 것이 실제로는 안 되는 상태가 생긴다.

## 온-디바이스 스펙

`npm test`(유닛)에 들어가지 않으므로 **유닛이 전부 그린인 채로 깨져 있을 수 있다.**
CLI 출력을 고쳤으면 `test/on-device/` 를 함께 grep 할 것.

```bash
PERFTRACKER_TEST_DEVICE=<serial> PERFTRACKER_TEST_APP=<패키지> npm run test:device
```

기기가 둘 이상이면 `PERFTRACKER_TEST_DEVICE` 가 없으면 11개가 전부 실패한다.
대상 앱이 없으면 **조용히 건너뛰지 않고 실패한다** — 건너뛴 스펙은 통과한 스펙과 같은 색이다.

### 못 재는 기기에서 실패시키지 않는다

스펙은 **"이 기기가 다 잰다"** 가 아니라 **"이 도구가 이 기기에 대해 참말을 한다"** 를 본다.
`doctor` 의 `requirement`(사람이 고쳐야 함) / `capability`(기기가 원래 그럼) 와 같은 선이다.

판정은 `target.ts` 의 `deviceCapabilities()` 가 core 의 `collector.supports(env)` 를 그대로
불러서 만든다 — **여기에 sdk 표를 다시 쓰지 말 것.** 표가 core 와 어긋나는 날 스펙이 틀린
것을 통과시킨다.

기기에 따라 갈리는 자리 (전부 core 의 상수로 가른다):

| 자리 | 하한 | 없으면 |
| --- | --- | --- |
| `frame` | sdk 31 (`frametimeline`) | `unsupported` + 사유를 단언 |
| `network` · `netstats`/`packages` 스냅샷 | sdk 34 | 스냅샷 파일 자체가 없는 것이 정상 |
| **`cpu.app` · `measurement_overhead` 의 CPU 두 필드** | **sdk 35** (`PROCESS_RUNTIME_MIN_SDK`) | `null` 이어야 한다. 0 이면 없던 사실을 만든 것 |

마지막 줄이 함정이다: `cpu` 는 **지원되는 지표인데도** 앱 자리가 비는 기기가 있다.
`record_process_runtime` 이 perfetto v44 필드라 sdk 35 미만에는 없기 때문이고,
`collectors/blocks.ts` 가 그 사실을 이미 적어 두고 있다.
