# perftracker (CLI)

commander 진입점. **판단은 core 가 하고 여기는 옵션을 넘기고 결과를 사람이 읽는 문장으로
바꾼다.** 런타임 의존성은 `commander` 와 `@perftracker/core` 둘뿐이다.

## 진입점

| 경로 | 무엇 |
| --- | --- |
| `src/program.ts` | 명령 11개 등록 (`runs` 는 하위 셋). **실행하지 않는다** |
| `src/index.ts` | bin 진입점 — `parseAsync` 와 최상위 오류 처리뿐 |

**`dist/index.js` 는 매 빌드마다 실행 권한을 잃는다.** `npm install` 이 붙여 준 권한을
`tsc --build` 가 파일을 다시 쓰면서 떨어뜨리고, 그러면 `npx perftracker` 가 `Permission denied`
로 죽는다. 루트 `build` 스크립트가 빌드 뒤에 다시 `chmod` 한다 — 잊고 지우면 조용히 재발한다.
| `src/context.ts` | `--adb` / `--device` 를 core 의 컨텍스트로 |
| `src/commands/` | 명령 하나당 파일 하나 (`browser.ts` 만 예외 — 브라우저 여는 헬퍼를 `open`·`report` 가 나눠 쓴다) |
| `src/copy/diagnose.ts` | 진단 모드가 새로 내는 cli 문구 모음 — 정본은 `docs/design/diagnostic-mode.md` `## 문구` 표 |
| `test/readme.test.ts` | 등록된 명령이 전부 README 에 있는지 · `start` 옵션이 전부 README 에 있는지 대조 |
| `test/copy/diagnose.test.ts` | cli 진단 문구 ↔ 디자인 문서 `## 문구` 표 양방향 대조 · 단어형 규칙 (DM-15) |
| `test/preview-flag.test.ts` | GUI 가 적는 `start` 줄(시작 바 예고 · 서버 실행 줄)의 플래그가 commander 에 등록된 `start` 옵션과 같은지 대조 (DM-2) |
| `test/on-device/` | **실기기가 있어야 도는 스펙.** `npm run test:device` 로만 실행 |

**gui 소스를 상대 경로(`…/gui/src/…`)로 import 하는 cli 시험은 지금 둘뿐인 예외다** — `test/preview-flag.test.ts`(예고 함수) · `test/on-device/diagnose.test.ts`(보고서 slice 표 행 모델). gui exports 는 서버 진입점(`.`) 하나라 둘 다 패키지로 못 읽고, 방향이 cli → gui 라 규칙 4 안이다 (gui 는 cli 를 모르므로 이 대조는 cli 쪽에만 둘 수 있다). `src/` 는 이 길을 쓰지 않는다.

**등록과 실행을 가른 이유는 테스트다.** 진입점이 곧 실행이면 import 하는 순간 `process.argv`
를 파싱해 버려서, 명령 목록을 확인하려면 소스를 정규식으로 긁는 수밖에 없다. `program.ts` 를
따로 두면 테스트가 **commander 가 실제로 등록한 트리**를 읽는다.

명령: `doctor` `devices` `apps` `schema` · `start` `mark` `status` `stop` `extract` ·
`runs`(`list`/`rename`/`rm`) · `report` · `open`(옛 이름 `gui` 는 별칭).
실제 측정은 `start` / `stop` 둘뿐이고 나머지는 점검·조회·마킹·기록 관리·보고서다.

**기기에 접촉하지 않는 명령**은 `createContext` 를 부르지 않는다 — `mark` 와 `runs` 가 그렇다.
그것이 규칙 1 을 지키는 방식이다: 조심해서 안 부르는 것이 아니라 **부를 수단이 없는 것**.

**명령을 늘리면 README 의 「명령 전체」도 같은 커밋에서 고친다.** `runs` 셋이 한동안 문서에
없었다 — 틀린 것이 아니라 빠진 것이라 읽는 사람은 알 길이 없었다. `test/readme.test.ts` 가
이제 그것을 막는다. **`start` 의 옵션도 같다** — 등록된 옵션(`--app` `--name` `--device`
`--launch` `--out` `--force` `--diagnose`)이 README 어딘가에, `--diagnose` 는 「명령 전체」 절 안에
있어야 한다.

## 제약

- **터미널에 요약을 찍지 않는다.** `stop` 과 `extract` 는 `→ <runDir>/result.json` 을 낸다.
  어느 지표를 앞에 둘지 자체가 이미 판단이고, 산출물은 `result.json` 하나다.
  **값을 안 찍는 것과 다음에 열 것을 안 알려주는 것은 다르다** — `stop` 은 그 아래에
  `perftracker report <id>` 한 줄을 더 낸다(`--report` 로 만들었으면 만든 경로를 대신).
  그 줄은 **그대로 쳐서 도는 명령**이어야 한다: 기록이 `-o` 로 다른 디렉토리에 있으면
  `-o` 까지 붙인다. 안내한 명령이 "기록을 찾지 못했습니다" 로 죽으면 사람은 도구가 아니라
  자기 기록을 의심한다. `stop.ts` 의 `formatStopResult` 가 그 규칙의 전부이고 테스트도 그것을 본다.
- **`stop --report` 는 켜는 사람만 켠다.** 보고서는 빌드된 화면(`dist-web`)이 있어야 나오므로
  기본값으로 두면 **측정은 끝났는데 마지막에 실패하는** 모양이 생긴다. 실패해도 마찬가지다 —
  그 예외는 `result.json` 경로를 문장에 담아 던진다. 보고서가 방금 잰 것을 가리면 안 된다.
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
- **`report` 는 서버를 띄우지 않는다.** `gui` 와 같은 화면을 쓰지만 자산과 데이터를 문서
  안에 말아 파일 하나를 낸다 (`@perftracker/gui` 의 `buildStandaloneReport`). 측정한 사람과
  읽는 사람이 다를 때 "포트를 열어라" 는 전달 방법이 못 되기 때문이다.
  **파일을 쓰는 자리는 `report.ts` 의 `writeStandaloneReport` 하나다** — `report` 와
  `stop --report` 가 그것을 나눠 쓴다. 두 곳에 적으면 "같은 기록인데 어느 명령으로 냈느냐에
  따라 다른 보고서" 가 된다.
  **`-o` 의 뜻을 명령마다 바꾸지 않는다** — 여기서도 `-o` 는 *기록이 있는 디렉토리*이고,
  쓸 자리는 `--file` 이다. 한 글자가 명령마다 다른 뜻이면 가장 비싼 종류의 함정이 된다.
- **`open` 은 끝나지 않는 명령이다.** 문자열을 돌려주지 않고 Ctrl-C 까지 서버를 붙잡는다.
  서버 구현은 `@perftracker/gui` 에 있고 CLI 는 그것을 부르기만 한다.
- **이름을 바꿔도 옛 이름을 끊지 않는다.** `gui` 는 `.alias('gui')` 로 계속 받는다.
  도움말에는 commander 가 `open|gui` 로 함께 내지만 **README 의 「명령 전체」에는 `open`
  하나만 싣는다** — 표에 둘을 나란히 두면 정본이 둘로 보인다. 별칭은 눈에 잘 안 띄어서
  **누가 지워도 아무도 모르므로** `test/readme.test.ts` 가 그것을 고정한다.
- **플래그 이름은 명령 이름과 싸우지 않는다.** 브라우저를 안 여는 옵션이 `--no-open` 이던
  시절이 있었는데, 명령이 `open` 이 되면서 `open --no-open`("열어라, 근데 열지 마라")이
  됐다. 지금은 `--no-browser` 하나이고 `open`·`report`·`stop --report` 가 같은 이름을 쓴다.
- **core 의 판정을 다시 구현하지 않는다.** `doctor` 의 지표 지원 여부도 collector 의
  `supports()` 를 그대로 부른다. 출처가 둘이면 "된다" 고 한 것이 실제로는 안 되는 상태가 생긴다.
- **진단 세션(`start --diagnose`)은 진단 세션에만 표시한다.** `start` · `status` 의 `Diagnose`
  줄, `runs` 행 끝의 `진단`, `status --json` · `runs --json` 의 진단 키 — 평소 세션에는 하나도
  없고 JSON 에 `false` 도 싣지 않는다 (평소 세션의 출력이 진단 모드 이전과 같다).
  `--diagnose` 에 기본값을 주지 않는 것도 같은 이유다 — 안 주면 core 로 가는 옵션 객체에
  `diagnose` 키가 없다(`startSessionOptions`). 기본값을 주면 도움말에 `(default: false)` 도 붙는다.
  `stop` · `extract` 는 진단 세션이어도 그대로다 — slice 요약을 찍지 않는다.
  앱 slice 열림 판정과 그 문구(doctor 줄 · start 고지 줄)의 주인은 core 다(`appSliceOpen` ·
  `DIAGNOSE_COPY`) — cli 는 core 가 세션에 실은 `diagnose.notice` 를 그대로 찍는다.
- **진단 모드의 새 cli 문구는 `src/copy/diagnose.ts` 한 곳에 둔다.** 정본은 디자인 문서
  `## 문구` 표이고 `test/copy/diagnose.test.ts` 가 표의 cli 줄과 양방향으로 대조한다. 문구를 바꾸려면
  표를 먼저 고친다. 꼴은 단어형(끝 글자 `다`/`요` · 권유 · 평가 낱말 없음)이고 기존 문구는 대상이
  아니다 (plan D10). 새 줄은 80칸 안 — 시험이 표시 폭(한글 2칸)으로 잰다.

## 온-디바이스 스펙

`npm test`(유닛)에 들어가지 않으므로 **유닛이 전부 그린인 채로 깨져 있을 수 있다.**
CLI 출력을 고쳤으면 `test/on-device/` 를 함께 grep 할 것.

```bash
PERFTRACKER_TEST_DEVICE=<serial> PERFTRACKER_TEST_APP=<패키지> npm run test:device
```

기기가 둘 이상인데 `PERFTRACKER_TEST_DEVICE` 가 없으면 스펙이 하나도 돌지 못한다 (`AmbiguousDeviceError`).
시험 안에서 기기를 잡는 11개는 실패, 기기를 `beforeAll` 에서 잡는 `diagnose.test.ts` 9개는 건너뜀으로 센다 —
vitest 는 `beforeAll` 이 던지면 그 안의 시험을 skip 으로 세고 파일은 실패로 낸다
(실측 2026-10-08 실기기 + 에뮬레이터: `Tests 11 failed | 9 skipped (20)` · 종료 코드 1).
대상 앱이 없으면 **조용히 건너뛰지 않고 실패한다** — 건너뛴 스펙은 통과한 스펙과 같은 색이다.

**`diagnose.test.ts`(진단 세션 · DM-16 · DM-5)는 측정 창 안에서 화면을 스와이프한다** — 4회, adb 를 직접
불러서. 기능 문서 diagnostic-mode 결정 2 가 허용한 시나리오 입력이고 perftracker(`AdbClient`)를 거치지
않는다 (거치면 래치가 막는다 — 막는 것이 옳다). 그 때문에 대상 앱 화면이 스크롤된다.
`RV Scroll` 행(앱 slice)은 따로 뗀 it 이 대상 앱이 YouTube 이고 앱 slice 가 열리고 켜기 오류가 없을 때만
단언하고, 아니면 `ctx.skip(<이유>)` 로 건너뛴다 — 요약 줄에 `skipped` 로 세고 `--reporter=verbose` 면 이유가
찍힌다 (기본 리포터는 이름을 안 찍는다). 다른 앱으로는 돌려 보지 않았다.
블록 `partial` 은 값을 싣는 둘(`process_name_stale_in_trace` · `ftrace_setup_errors`)을 받고 값이 null 아님을
본다. 켜기 오류 회에는 행을 보지 않는다 — 어느 카테고리가 빠졌는지 원본이 말하지 않으므로 행이 없어도 결함인지
못 가린다.

### 못 재는 기기에서 실패시키지 않는다

스펙은 **"이 기기가 다 잰다"** 가 아니라 **"이 도구가 이 기기에 대해 참말을 한다"** 를 본다.
`doctor` 의 `requirement`(사람이 고쳐야 함) / `capability`(기기가 원래 그럼) 와 같은 선이다.

판정은 `target.ts` 의 `deviceCapabilities()` 가 core 의 `collector.supports(env)` 를 그대로
불러서 만든다 — **여기에 sdk 표를 다시 쓰지 말 것.** 표가 core 와 어긋나는 날 스펙이 틀린
것을 통과시킨다.

기기에 따라 갈리는 자리 (전부 core 의 상수로 가른다):

| 자리 | 하한 | 없으면 |
| --- | --- | --- |
| `network` · `netstats`/`packages` 스냅샷 | sdk 34 | 스냅샷 파일 자체가 없는 것이 정상 |
| `hwui` | **없음** (`dumpsys gfxinfo`) | 하한이 없다 — 어느 기기에서든 나온다 |
| **`cpu.app` · `measurement_overhead` 의 CPU 두 필드** | **sdk 35** (`PROCESS_RUNTIME_MIN_SDK`) | `null` + `app_cpu_sdk_too_low`. 0 이면 없던 사실을 만든 것 |
| `log` | **없음** (기기의 logdr 접근에 달림) | `no_log_entries`. sdk 30 실기기에서 0줄, sdk 36 에서 1,021줄 |

마지막 줄이 함정이다: `cpu` 는 **지원되는 지표인데도** 앱 자리가 비는 기기가 있다.
`record_process_runtime` 이 perfetto v44 필드라 sdk 35 미만에는 없기 때문이고,
`collectors/blocks.ts` 가 그 사실을 이미 적어 두고 있다.
