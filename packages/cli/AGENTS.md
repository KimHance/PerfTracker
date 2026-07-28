# perftracker (CLI)

commander 진입점. **판단은 core 가 하고 여기는 옵션을 넘기고 결과를 사람이 읽는 문장으로
바꾼다.** 런타임 의존성은 `commander` 와 `@perftracker/core` 둘뿐이다.

## 진입점

| 경로 | 무엇 |
| --- | --- |
| `src/index.ts` | 명령 10개 등록 · 최상위 오류 처리 |
| `src/context.ts` | `--adb` / `--device` 를 core 의 컨텍스트로 |
| `src/commands/` | 명령 하나당 파일 하나 |
| `test/on-device/` | **실기기가 있어야 도는 스펙.** `npm run test:device` 로만 실행 |

명령: `doctor` `devices` `apps` `schema` · `start` `mark` `status` `stop` `extract` · `gui`.
실제 측정은 `start` / `stop` 둘뿐이고 나머지는 점검·조회·마킹이다.

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
