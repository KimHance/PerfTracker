# PerfTracker

안드로이드 앱 성능을 **앱을 고치지 않고** 재는 CLI. adb 로 붙어 Perfetto 트레이스를 남기고
호스트에서 파싱해 세션마다 `result.json` 하나를 낸다. 비루팅 · 릴리스 빌드 · 임의의 앱이 전제다.
그 CLI 를 감싸는 로컬호스트 웹 GUI 가 `packages/gui` 에 있다.

## 깨면 안 되는 것

1. **측정 창 안에서 기기 접촉 0회.** `start` 가 끝난 뒤 `stop` 까지 adb 명령이 나가지 않는다.
   `MeasurementWindow` 래치를 우회하는 경로를 만들지 말 것 — 재는 행위가 재는 대상을 바꾼다.
2. **판정하지 않는다.** "느리다/좋다" 를 내지 않는다. 구글 기준치는 `references` 에 출처와 함께
   기록만 되고 **비교에 쓰이지 않는다.** 기준선을 고르는 일은 데이터를 읽는 쪽의 몫이다.
3. **확인하지 않은 것을 사실로 쓰지 않는다.** 모르면 `null`, 왜 모르는지는 `reason_code`.
   `0`/`false`/`[]` 는 "재 봤더니 없었다" 일 때만 쓴다.
4. **의존은 한 방향이다.** `core` 는 `cli` 도 `gui` 도 모르고, `gui` 는 `cli` 를 모른다
   (`cli → gui → core`). 화면이 core 타입을 그대로 쓰지 않는 것도 같은 이유다 —
   경계는 `packages/gui/src/contract/api.ts` 하나뿐이다.

## 문서를 코드와 함께 고친다

**소스 파일을 고쳤으면 그 모듈의 `AGENTS.md` 갱신이 필요한지 반드시 확인한다.**
아래에 해당하면 같은 커밋에서 문서도 고친다 — 나중으로 미루면 문서가 조용히 낡는다.

- 진입점 · 디렉토리 구조가 바뀜 → 해당 모듈 `AGENTS.md` 의 맵
- 계층 규율 · 제약이 바뀜 → 해당 모듈 `AGENTS.md` 의 제약 절
- 새 모듈/서브디렉토리 추가 → 이 파일의 모듈 맵 + 새 `AGENTS.md`
- 지표 · 스키마 · 수집 경로 변경 → `README.md`(정본) + `docs/STATUS.md`
- **명령 · 옵션 추가/이름 변경 → `README.md` 의 「명령 전체」 + `packages/cli/AGENTS.md`**
- GUI 화면 · 카피 · 토큰 변경 → `docs/design/gui/HANDOFF.md` 와 어긋나지 않는지 확인

문서가 코드에 대해 **숫자로** 말하거나 **목록으로** 말하면 그것을 코드와 대조하는 테스트를
같이 넣는다 — `packages/core/test/schema/readme.test.ts`(버킷·지표 개수)와
`packages/cli/test/readme.test.ts`(등록된 명령이 전부 README 에 있는가)가 그 일을 한다.
**그 테스트는 반드시 깨 본다.** 통과하는 테스트는 문서가 맞다는 증거가 아니다 —
틀린 문서와 틀린 테스트는 사이좋게 통과한다.

## 모듈 맵

| 경로 | 무엇 |
| --- | --- |
| [packages/core](packages/core/AGENTS.md) | 수집·파싱·스키마. 기기 접촉은 전부 여기를 지난다 |
| [packages/core/src/collectors](packages/core/src/collectors/AGENTS.md) | 지표 7개. data/domain 4계층 |
| [packages/cli](packages/cli/AGENTS.md) | commander 진입점. core 를 부르고 사람이 읽는 문장으로 바꾼다 |
| [packages/gui](packages/gui/AGENTS.md) | 로컬호스트 웹 GUI. `perftracker gui` 가 띄우는 HTTP 서버 + 화면 |

## 작업 규약

- 사용자 대면 메시지는 **한국어**, 코드 식별자는 **영어**, 스키마 필드는 **snake_case**.
  커밋 메시지는 **prefix 영어 + 본문 한국어**.
- **변이 검증**: 테스트를 쓰면 그것이 지키는 코드를 일부러 망가뜨려 RED 를 확인하고 원복한다.
  통과하는 테스트는 증거가 아니다 — 실패할 수 있다는 것이 증거다.
- **합성 픽스처만 커밋한다.** 단 기기 원문(dumpsys/perfetto 출력)은 예외이고
  `packages/core/test/fixtures/` 에 있다.
- `npm test` 전에 `npm run build` 가 필요하다 (cli 테스트가 core 를 `dist/` 로 해석한다).
  gui 테스트는 소스를 직접 읽으므로 빌드가 필요 없다.
- **`gh` CLI 를 쓰지 않는다.** git CLI 나 GitHub REST API 를 쓴다.

판단 이력과 그 근거는 `.superpowers/sdd/STANDING-ORDERS.md`, 진행 상태는 `docs/STATUS.md`.
