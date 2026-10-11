# 변경 기록

버전마다 무엇이 바뀌었고, 실기기 · 에뮬레이터에서 무엇을 어떻게 확인했는지를 적습니다.
사용법은 [README](README.md) · [docs/usage.md](docs/usage.md), 필드는 [docs/result-json.md](docs/result-json.md) 에 있습니다. `result.json` 의 스키마 버전(`schema_version`)은 도구 버전과
따로 갑니다 — 어느 도구 버전이 어느 스키마를 내는지는 각 버전 절에 적습니다.

## 0.3.0 — 출시 준비 (2026-10-11)

스키마 `1.2.0`. 옵셔널 필드만 늘었고 옛 `result.json` 은 새 스키마를 그대로 통과합니다. 다만 평소 세션 산출물에도
`target_app` 의 컴파일 상태 칸이 생겨 **캐시해 둔 `1.1.0` 스키마는 평소 산출물도 거부합니다** — docs/result-json.md
「스키마를 다시 꺼내야 하는 때」.

### 새로 생긴 것

- **진단 세션 `start --diagnose`** — atrace `am · wm · view · dalvik` 카테고리와 대상 앱 slice 를 함께 기록하고,
  `result.json` 최상위 `diagnose` 블록에 slice 수 · 이름별 표(갈래 셋 × 횟수 · 합 · 최대) · ftrace 손실 ·
  컴파일 상태 slice · JIT 컴파일 slice 수를 싣습니다. 진단 세션은 최대 10분이고, 평소 세션에는 진단 키가 하나도
  없습니다. CLI · 측정 화면 · 보고서(레일 세 번째 `진단` 탭)에 표시됩니다.
- **모든 세션에 컴파일 상태** — `target_app.compile_state_start` · `compile_state_end` 에 `dumpsys package` 의
  `Dexopt state` 를 dex 줄마다 원문 그대로 싣습니다. 시작 상태는 원래 읽던 출력에서(기기 명령 증가 0),
  끝 상태는 측정 창을 닫은 뒤 한 줄로 읽습니다. 못 읽으면 `null` + `reason_code`, 세션 중 base.apk 의
  `status` · `reason` 이 바뀌면 경고 `compile_state_changed`.
- **`start --launch --compile reset|speed-profile|speed`** — 측정 창이 열리기 전에 `cmd package compile` 로
  컴파일 상태를 맞추고, 바꾼 기록을 `session.compile` 에 싣습니다. `start` · `stop` 출력에 호스트에서 그대로
  쳐서 도는 되돌림 줄이 나옵니다(되돌려도 `reason` 은 `cmdline` 으로 남습니다). `--launch` 와만 받습니다.
- `status --json` · `runs --json` 에 `--compile` 세션의 `compile` 칸.

### 바뀐 것 — 보고서 가독성

- 모든 글자 12px 이상 · 표 · 카드 본문 13px 이상 · 글자 대비 4.5:1 이상 · 섹션 제목 18 > 카드 제목 15 > 본문 13.
- 요약 탭 맨 위 `지표` 섹션에 타일 8장 (지표마다 하나 · 순서 고정 · 아래 카드와 같은 값).
- 필드 경로 라벨을 우리말 단어 한 줄 + 원문 경로 한 줄로.
- 긴 기계 이름은 자르지 않고 구분자(`/ : $ . ; , _`) 뒤에서만 줄을 바꿉니다.
- 맥락 섹션 끝 `컴파일 상태 (전 → 후)` 카드 · 진단 탭 `컴파일 상태 slice` · 머리 `--compile <값>` 칸.
- 차트 · 전/후 표 · 주파수 카드가 비었을 때(재 봤더니 없음) `값 없음` 대신 `표본 없음` · `프레임 없음` · `항목 없음`.

### 고친 것

- 보고서 레일의 요약 배지가 크래시 · ANR · 경고 `[]`(재 봤더니 0건)를 미수집으로 세던 결함.

### 실기기 검증

**보고서 글자 측정** (2026-10-11 · SM-S901N · sdk 36 · YouTube 21.40.161) — 평소 · 진단 세션 하나씩의 `perftracker report` 를 요약 · 기기 · 진단 탭 × 1440 · 390 폭 10장으로 재 보니 12px 미만 글자 0% · 4.5:1 미만 글자 0% · 글자 층 타일 값 31.68(390 26) > 섹션 18 > 카드 제목 15 > 본문 13 px · 요약 타일 8 · 레일 배지 0 = `수집 안 함`/`값 없음` 카드 0 · 390 가로 넘침 0 이었습니다. 배지는 0 = 0 으로만 맞았고(두 세션에 못 잰 블록이 없음), 두 세션 다 `--compile` 이 아니라 보낸 명령 줄은 실기기 보고서로 못 봤습니다.

#### 진단 세션(`--diagnose`)을 실기기가 검증한 것 (2026-10-08, SM-S901N / sdk 36)

대상은 YouTube 21.29.366 이고 흐름은 사람이 하는 것과 같습니다 —
`start --app com.google.android.youtube --launch --diagnose` → **다른 셸에서** `adb shell input swipe` 4회
(홈 피드 스크롤) → `stop`. 스와이프는 perftracker 를 거치지 않는 시나리오 입력이라 측정 창 안 기기 접촉 0
과 부딪히지 않습니다 — `adb_commands_during_session` 은 도구가 창 안에서 낸 명령 수입니다.

수동 1회의 `result.json` (18.6초 세션):

| 칸 | 값 |
| --- | --- |
| `session.options.diagnose` · `adb_commands_during_session` · `trace_buffer_overrun` | `true` · 0 · `false` |
| `diagnose.status` · `app_slices_open` | `collected` · `true` |
| `trace_slices` · `target_process_slices` · `target_process_slices_unfinished` | 123,772 · 116,165 · 1 |
| `ftrace_overrun_events` · `trace_bytes` | 0 · 11,293,657 |
| `target_process_slice_names_unfolded` → 표 행 | 8,314 → 1,088 |
| `bindApplication` 행 | 메인 스레드 1회 · 115.2 ms |
| `Choreographer#doFrame *` 행 | 메인 스레드 1,070회 |
| `RV Scroll` 행 | 메인 스레드 795회 |

- **frametimeline 은 실제로 빠졌습니다.** 같은 원본을 `trace_processor` 로 따로 세면 대상 앱 프로세스의
  트랙에 slice 가 118,050개 있고 그중 1,885개가 Actual · Expected Timeline 입니다 — 블록의 116,165 는 그 차이와
  같습니다. 고유 이름 9,219 → 8,314, 비동기 갈래 2,079 → 194 도 같은 방식으로 맞습니다.
- **보고서** — `perftracker report` 로 낸 파일 하나의 진단 탭 slice 표가 1,088행(블록 표와 같음) ·
  외부 요청 0 · 1440 폭 가로 넘침 0 이었습니다.
- **끝난 뒤 기기** — `debug.atrace.tags.enableflags` 0 · `debug.atrace.app_number` 빈 값 · perfetto 세션 0 ·
  그 세션의 원격 파일 0. `debug.atrace.app_0` 에는 `com.google.android.youtube` 가 남습니다 — perfetto 가 마지막
  패키지를 남기는 것이고, 이 도구는 atrace 속성을 고치지 않습니다.
- **같은 조건의 평소 세션** — `result.json` · `session.json` 에 진단 관련 키 0 · 최대 30분. 원본에 실린
  TraceConfig(`trace_config_pbtxt`)를 꺼내 보면 진단 세션 것에서 `atrace_*` 네 줄이 빠지고 `duration_ms` 만
  600000 → 1800000 으로 다를 뿐 나머지는 글자까지 같습니다. 평소 원본의 스레드 slice 는 0개입니다.

온-디바이스 스펙 `packages/cli/test/on-device/diagnose.test.ts`(10개 — 2026-10-11 에 ART 칸 하나가 늘었습니다)가 같은 것을 봅니다. 수의 크기는 단언하지
않고 관계를 단언합니다 — `trace_processor` 로 따로 센 수 = 블록의 수, 보고서 행 모델의 행 수 = 블록 표 행 수,
`extract` 를 다시 돌린 블록 = `stop` 이 쓴 블록(바이트까지). 스펙 회차 가운데 한 번은 앱이 트레이스에
낡은 이름으로 남아 블록이 `partial` + `process_name_stale_in_trace` 였고 값은 다 있었습니다
([아래](docs/usage.md#트레이스가-앱을-다른-이름으로-아는-경우-zygote64--pre-initialized)). 스펙은 값을 싣는 `partial` 둘
(`process_name_stale_in_trace` · `ftrace_setup_errors`)을 받고 그 값이 `null` 이 아닌지 보며, 켜기 오류가 있던
회에는 행(`bindApplication` 등)을 보지 않습니다 — 어느 카테고리가 빠졌는지 원본이 말하지 않기 때문입니다.

**검증하지 못한 것:**

- **sdk 31–34 · sdk 30 이하 기기.** 앱 slice 열림 조건 표의 그 칸은 안드로이드 문서 근거와 합성 시험뿐입니다.
- **YouTube 말고 다른 앱.** 진단 스펙을 다른 앱으로 돌린 적이 없습니다. `RV Scroll` 행(androidx RecyclerView 가
  남기는 앱 slice)은 대상 앱이 YouTube 일 때만 단언하고, 아니면 그 시험을 건너뜀으로 셉니다(요약 줄의
  `skipped` · `--reporter=verbose` 면 이유까지) — 스와이프를 빼면 그 행이 사라지는 것은 봤습니다.
- **켜기 오류(`ftrace_setup_errors`)가 있는 회차.** 이 기기에서 돈 진단 회차는 켜기 오류가 전부 0 이었습니다.
  스펙이 그 갈래를 받는 것은 core 가 늘 켜기 오류로 내게 고친 빌드로만 돌려 봤습니다.
- **`bindApplication` 행이 atrace 켜짐 대기 덕인지.** 대기를 뺀 빌드로 돌린 1회에서도 행이 잡혔습니다
  (대기를 넣기 전 실측은 0/1). 경합이라 한 번으로는 못 가립니다 — 대기 자체는 유닛 시험(`D14 …`)이 지킵니다.
- **ftrace 손실이 0 이 아닌 회차** · **10분짜리 진단 원본으로 낸 블록**(쿼리 시간 · `result.json` 크기) — 본 적이 없습니다.

#### 컴파일 상태(`--compile`)를 실기기가 검증한 것 (2026-10-11, SM-S901N / sdk 36)

대상은 YouTube 21.40.161 (profileable 아님) · 실기기(SM-S901N) · `ro.build.type=user` 이고, 에뮬레이터가 같이 꽂혀 있어
모든 명령에 serial 을 줬습니다. 온-디바이스 스펙 `packages/cli/test/on-device/baseline.test.ts`(6개)가 한 바퀴를
돕니다 — (a) 평소 `--launch` → (b) `--compile speed` → (c) `--compile reset` → (d) 진단 + `--compile speed`
(스와이프 4회) → (e) (b) 가 낸 되돌림 줄을 **글자 그대로** 셸에 넘김. 앞 회의 끝이 뒤 회의 「바꾸기 전」 입니다.

| 회 | 본 것 (회마다 `adb_commands_during_session` 0) |
| --- | --- |
| (a) | `compile_state_start` · `_end` 의 dex 줄 전부가 같은 순간 창 밖에서 읽은 `dumpsys package` 와 같음 (base.apk `speed-profile` / `cmdline`) |
| (b) | 시작 상태 base.apk `speed` / `cmdline` · `session.compile.compile_state_before` 의 base 줄 = (a) 끝 · 걸린 69,468 · 19,405 ms · TotalTime 636 · 713 ms (두 회) · `start` 와 `stop` 이 같은 되돌림 줄을 냄 |
| (c) | 시작 상태 base.apk `verify` / `vdex-dm` · `location` 이 공백 든 문장(`primary.vdex mapped directly in memory from …/base.dm`) · 보조 dex 셋이 `run-from-apk` / `unknown` 으로 바뀜 |
| (d) | 컴파일 상태 slice 중 base 줄(dumpsys 의 base.apk `location` 과 같은 slice) `filter=speed` · `status=up-to-date` · JIT slice 0 · 접기 전 이름 25,233 · 34,398 → 표 927 · 1,442행(그중 `L*;` 한 행 · 화면 잠김 · 풀림 두 회) |
| (e) | 되돌림 줄 실행 → `Success` · base.apk `speed-profile`(처음 값) / **`cmdline`** |

- **보조 dex 는 처음으로 돌아오지 않았습니다.** 스펙 회차 사이에 기기가 보조 dex 하나를 스스로
  `speed-profile` / `bg-dexopt` 로 바꿔 둔 상태에서 (b) 가 돌았고, 바꾸기 전 보조 dex 의 `status` 가 서로 달라
  `--secondary-dex` 되돌림 줄 대신 그 사실 한 줄이 나왔습니다 (되돌림 규칙 그대로). 그 뒤 (c) 의 `--reset` 이 셋을
  `run-from-apk` 로 바꿨고, 끝 상태는 `verify` / `vdex` 하나 · `run-from-apk` / `unknown` 둘입니다 — 처음
  (`verify` / `cmdline` 셋)과 다릅니다. 두 번째 회는 그 상태에서 시작해 같은 상태로 끝났습니다(보조 dex 두 줄
  `location` 이 `error`). 스펙 밖에서 다시 컴파일하지 않았습니다. 되돌림 블록의 실제 꼴:

  ```
  되돌림 · 실행 뒤 reason = cmdline · 기기가 다시 바꿀 수 있음
    adb -s <serial> shell cmd package compile -m speed-profile -f com.google.android.youtube
    보조 dex 3개 · status 서로 다름 · 보조 dex 되돌림 줄 없음
  ```
- **트레이스 안 slice 와 dumpsys 가 같은 말을 합니다** — 진단 세션(`--compile` 없음)의 컴파일 상태 slice 중 base
  줄 `filter` 는 같은 세션 시작 상태 base.apk `status` 와 같고, JIT 수 · 컴파일 상태 줄 수는 같은 원본을
  `trace_processor` 로 따로 센 수와 같습니다 (`diagnose.test.ts` 의 `DM-16 ART 칸`). `dalvik` 이 켜진 그 진단 세션
  1회(잠금 푼 회): JIT 27 · 컴파일 상태 6줄 · 접기 전 이름 9,597 → 표 1,476행 · `RV Scroll` 행 있음 · 블록 `partial`
  (`process_name_stale_in_trace` — 값은 다 있음).
- **스펙이 기기 상태를 영구히 바꿉니다** — 돌릴 때마다 base.apk `reason` 이 `cmdline` 이 되고 보조 dex 가
  바뀔 수 있습니다. (e) 에 닿기 전에 실패하면 `afterAll` 이 잡아 둔 되돌림 줄을 대신 돌립니다.
- 측정 창 안 기기 접촉 0 은 그대로입니다 — 상태 바꾸기 · 다시 읽기는 창 열기 전, 끝 상태는 원본 회수 뒤입니다.

**검증하지 못한 것:**

- **sdk 30–35 기기의 `Dexopt state` · `cmd package compile` 출력 꼴** — 실측은 sdk 36 하나입니다.
- **YouTube 말고 다른 앱.** `baseline.test.ts` 는 다른 앱이면 건너뜁니다.
- **(b) · (d) 의 TotalTime · 표 행 수가 상태 몫인지** — 회마다 1회라 비교하지 않습니다 (도구는 비교하지 않습니다).
- **화면이 잠긴 채 돈 회.** 첫 전체 실행은 기기가 보안 잠금 상태였고(모든 세션 hwui 프레임 1) `DM-16 RV Scroll 행` ·
  `m0 포그라운드 패키지` 둘이 실패했습니다 — 스와이프가 피드를 못 굴렸고 포커스가 잠금 화면이었습니다. 사람이
  잠금을 푼 뒤 같은 스펙이 27/27 이었습니다. 온-디바이스 스펙은 화면이 켜지고 잠금이 풀린 기기를 전제합니다.

## 0.2.1 — 2026-08-31

- 산출물(`result.json` 의 `tool.version`)과 `--version` 이 자기 버전을 틀리게 말하던 것 — 버전을 `package.json` 에서 읽습니다.

## 0.2.0 — 2026-08-31

스키마 `1.1.0` 그대로 (옵셔널 확장).

- **시간별 프레임 (`metrics.frame`)** — Perfetto frametimeline 에서 앱 시간과 표시 시간을 프레임마다 꺼내 다른
  시계열과 같은 축에 놓습니다. 표본에 상한을 두되 튄 프레임은 남깁니다. 지표 7개 → 8개.
- 보고서 렌더 섹션을 `분포` / `타임라인` 서브탭으로 나누고, 시간별 프레임 차트(앱 · 표시 두 칸 · 16ms 참고선).

## 0.1.0 — 2026-08-20

첫 npm 배포. 스키마 `1.1.0`.

- 명령: `doctor` `devices` `apps` `schema` · `start` `mark` `status` `stop` `extract` · `runs`(`list` `rename` `rm`) ·
  `report` · `open`.
- 지표 7개: `startup` `hwui` `cpu` `memory` `log` `thermal` `network` · 측정 오버헤드 자체 계측.
- 로컬 웹 화면(`perftracker open`)과 서버 없이 여는 보고서 파일(`perftracker report`).

### 온-디바이스 스펙 이력

실기기 검증(2026-07-27)은 두 단계로 나뉩니다. **숫자가 다른 이유를 함께 적습니다** —
중간에 스펙이 하나 늘고 대상 앱이 바뀌었기 때문입니다.

| 언제 | 스펙 수 | 결과 | 대상 앱 |
| --- | --- | --- | --- |
| 실기기 검증 웨이브 | 10 | **5회 연속 10/10** | `com.android.settings` |
| CPU·Log 앱 단위화 이후 | 11 | **1회 11/11** | `com.nhn.android.webtoon` |
| 진단 세션 스펙 추가 (2026-10-08) | 20 | **1회 20/20** | `com.google.android.youtube` |
| 컴파일 상태 스펙 추가 (현재, 2026-10-11) | 27 | **1회 27/27** (화면이 잠긴 채 돈 앞 회는 25/27 — [위](#컴파일-상태--compile를-실기기가-검증한-것-2026-10-11-sm-s901n--sdk-36)) | `com.google.android.youtube` |

즉 **현재 스펙 구성으로 5회 연속을 돌린 적은 없습니다.** 5회 연속의 근거는 그 앞 구성의
것이고, 10 → 11 로 늘어난 스펙 하나는 "세션 스펙의 대상 앱이 이 기기에 설치되어 있다"(`m0`)입니다.
대상 앱을 바꾼 이유는 docs/usage.md 의 "온-디바이스 테스트를 다른 기기에서 돌리기" 에 있습니다.
11 → 20 은 진단 세션 스펙(`diagnose.test.ts`, 9개)이고, 그 회차의 대상 앱은 YouTube 입니다 —
**20개를 웹툰으로 돌린 적은 없습니다** ([위](#진단-세션--diagnose을-실기기가-검증한-것-2026-10-08-sm-s901n--sdk-36)).
20 → 27 은 컴파일 상태 스펙(`baseline.test.ts`, 6개)과 진단 스펙의 ART 칸 하나입니다 — `baseline.test.ts` 는
대상 앱이 YouTube 가 아니면 통째로 건너뜁니다 (그 앱의 컴파일 상태를 몰래 바꾸지 않으려고).

유닛 테스트는 그 시점에 `npm test` **723/723**, `npm run typecheck` · `npm run build`
클린이었습니다 (M3 당시의 수치입니다 — 지금은 더 늘었습니다).

### 검증 기록 (M2 · M3, 2026-07)

#### M3 에서 에뮬레이터가 **실제로 검증한** 것

`npm run test:device` 를 에뮬레이터에서 **5회 연속** 돌려 확인했습니다.

- **측정 창 안의 adb 호출이 0** 입니다. M3 이 기기로 보내는 명령을 둘(`dumpsys netstats`,
  `pm list packages -U`) 늘렸는데도 그렇습니다 — 두 명령 모두 `start` 에서는 트레이스를 켜기
  전에, `stop` 에서는 트레이서를 멈춘 뒤에 나갑니다.
- **스냅샷 원본이 전/후 짝으로** `raw/` 에 남고 `artifacts.raw` 에 등재됩니다
  (`thermalservice` / `netstats` / `packages` × `before` / `after`).
- **존 중복 제거가 실제로 동작합니다.** 이 에뮬레이터는 `Cached temperatures` 와
  `Current temperatures from HAL` 에 같은 센서를 하나씩 갖고 있어서, M3 이전 파서는 존을
  **2개**로 만들었습니다. 존이 1개뿐인 기기가 오히려 이 결함을 정확히 드러냅니다.
- **`mAppUidStatsMap` 절과 그 머리글**이 기대와 정확히 같고(`uid rxBytes rxPackets txBytes
  txPackets`), 대상 앱 uid 의 행이 실제로 있으며, `shared_uid_packages` 가 채워집니다.

#### M3 에서 **실기기가** 검증한 것 (2026-07-27, SM-S901N / sdk 36)

에뮬레이터가 못 하던 것들 중 실기기에서 **실제로 확인된** 항목입니다. 근거를 함께 적습니다.

- **`dumpsys netstats` 의 실기기 원문.** 예전에는 "아직 한 줄도 본 적이 없다" 였습니다.
  이제 봤습니다:
  - `mAppUidStatsMap` 절이 있고 머리글이 기대와 **정확히** 같습니다
    (`uid rxBytes rxPackets txBytes txPackets`).
  - 미끼 회피가 실기기에서도 성립합니다 — `BPF map status:` 절의 `mAppUidStatsMap: OK` 가
    앞에 있고(162행), 내용 절은 208행입니다. 콜론 뒤가 빈 줄만 앵커로 삼는 규칙이 필요합니다.
  - 표는 **93행**이고 바로 뒤 절(`mStatsMapA:`)에서 끊깁니다.
  - **uid 열에 음수가 찍힙니다.** 82번째 행이 `-253 151772 1156 2367519 1871` 입니다
    (3회 연속 관측, 같은 자리). 그 값이 무엇인지 이 도구는 모릅니다 — 해석하지 않고
    원문 그대로 싣습니다. 다만 uid 열을 부호 없이 읽으면 그 줄에서 표 읽기가 멈춰
    **뒤의 12행을 통째로 잃습니다** (그중 하나는 1.6GB 를 받은 uid 10070). 그 12행 안에
    대상 앱이 있으면 이 도구가 "트래픽이 없었을 수 있습니다" 라고 말하게 됩니다.
- **온도가 실제로 움직입니다.** 아무 조작 없이 앱만 띄워 둔 세션에서:
  - 14.3초 세션 — AP 31.1→32.3 (**+1.2**), PATHM +0.4, SKIN +0.2, 나머지 0
  - 122.3초 세션 — AP 31.2→33.5 (**+2.3**), PATHM +0.1, SKIN +0.1, USB +0.1
    (같은 세션의 `cpu.device_total_busy_pct` 는 8.74 — 유휴에 가깝습니다)
  - 즉 **세션이 길수록 AP 가 더 오릅니다.** 다만 이것은 부하 곡선이 아니라 유휴 드리프트
    입니다 — 아래 "확인하지 못한 것" 을 보세요.
  - 에뮬레이터의 thermal HAL 은 AOSP 예제 구현이라 상수를 돌려줍니다 (존 1개,
    `test temperature sensor`, 30.8°C 고정). `delta_c` 는 **항상 0** 이므로 온-디바이스
    스펙은 여전히 `delta_c !== 0` 을 단언하지 않습니다 — 그 스펙은 에뮬에서도 돌아야 합니다.
- **`PA1THM` 은 `Cached temperatures` 에만 있고 값이 얼어붙어 있습니다.** 실측 27.0°C 가
  세션 전·후 모두 같습니다. 존 병합 규칙(HAL 절을 먼저 싣고 cached 전용을 뒤에 붙인다)이
  실기기에서 실제로 필요한 이유가 이 센서입니다. `source: 'cached'` 로 실립니다.
- **`SUBBAT` / `SUBBATRAW` 가 0.0°C 를 보고합니다.** 이 도구는 그것을 그대로 싣습니다 —
  "센서가 없다" 로 바꾸지 않습니다. 기기가 0 이라고 말한 것이 사실이고, 그 해석은 소비자 몫입니다.
- **시큐어 폴더(별도 안드로이드 user)의 존재.** `pm list packages -U` 는 user 150 을 열거하지
  못하고(stderr, 종료 코드 0), `dumpsys netstats` 에는 그 user 의 uid 18개가 있습니다.
  `tryShell` 이 stderr 를 stdout 과 섞지 않는다는 것도 실기기로 재확인했습니다 —
  stdout 632줄에 `SecurityException` 은 **0건**, stderr 2줄.
- **공유 uid 가 예외가 아니라 기본값입니다.** uid 1000 을 **86개** 패키지가 씁니다.
- **측정 창 안의 adb 호출이 0** 입니다 (실기기 5회 연속, 세션마다 확인).

#### M3 에서 에뮬레이터가 **검증하지 못한** 것

여기 있는 것들은 테스트가 단언하지 않습니다. 단언하면 통과하지만 아무것도 확인하지 못합니다.

- **부하에 따른 온도 변화** — 에뮬레이터에서는 불가능하고(위 참조), **실기기에서도
  아직 부하 곡선은 못 봤습니다.** 위 두 세션은 사람이 화면을 만지지 않은 유휴 세션이고,
  이 저장소는 기기에 인위적 부하를 거는 도구를 설치하지 않습니다. 부하 아래의 거동은
  사람이 앱을 조작하면서 측정해야 확인됩니다. 옛 실기기 4세션의 원본에는 AP 가
  31.1→36.2 / 33.8→41.6 으로 오른 세션이 둘, 32.1→30.8 / 32.1→31.9 로 **내려간 세션이
  둘** 있습니다.
- **여러 존을 가진 기기의 섹션 병합** — 에뮬은 존이 1개라 `Cached` 에만 있는 센서
  (실기기의 `PA1THM`)를 밟지 못합니다. 유닛 테스트와 실기기 원본으로만 덮입니다.
  덧붙여 **"값이 다를 때 HAL 을 택한다" 는 tie-break 는 합성 픽스처로만 검증됐습니다** —
  실기기 8개 덤프를 대조한 결과 `Cached` 와 HAL 의 공유 존 값은 **전부 완전히 일치**했습니다.
  즉 그 기기의 실데이터에서 HAL 우선 규칙이 바꾼 값은 하나도 없고, 실효는 중복 제거와
  `PA1THM` 보존뿐입니다. (규칙 자체의 근거는 유효합니다: HAL 절은 덤프 시점의 라이브 조회이고
  `Cached` 는 프레임워크 보관값이며, 4세션 8덤프 내내 27.0°C 로 얼어붙은 `PA1THM` 이 그 증거입니다.)
- **throttling 전이** — **못 봤습니다.** 에뮬의 mock HAL 은 전이를 만들지 않고,
  실기기에서도 관측한 모든 세션이 `Thermal Status: 0 → 0` 이었습니다 (14초 / 122초 세션과
  기기 조회 전부). 전이를 만들려면 기기를 실제로 달궈야 하고 이 저장소는 그러지 않습니다.
  그리고 전/후 두 점 스냅샷으로는 **전이 자체를 볼 수 없습니다** — 중간에 올라갔다 내려온
  것과 내내 그대로였던 것이 같은 모양입니다 (M3 범위 밖).
- **네트워크 바이트의 크기·정확도** — 에뮬레이터는 호스트 NAT 를 타고, 세션 중 앱이 통신하지
  않을 수 있습니다. `rx_bytes > 0` 은 flaky 한 단언이라 파이프라인과 uid 귀속만 검증하고
  값의 크기는 검증하지 않습니다. 실기기에서도 마찬가지입니다 (Settings 를 띄운 유휴 세션의
  실측은 rx 376B / tx 120B 였습니다 — 크기를 단언할 수 있는 값이 아닙니다).
- **VPN / CLAT / 이중 계수 / GSO 추정** — 그런 구성 자체가 없습니다. 문서로만 서술합니다.
- **sdk 34 미만의 Network 미지원 경로 / 카운터 되감김 / BPF 맵 중복 행** — 재현할 방법이
  없어 유닛 테스트로만 덮입니다.
- **Power** — M3 범위 밖입니다. 배터리 에너지는 adb⇒USB⇒충전 때문에 구조적으로 측정할 수
  없고(실기기 4세션 중 3세션에서 충전 카운터가 만충으로 고정), 앱별 전력의 "측정값" 은
  안드로이드에 존재하지 않습니다.

#### M2 에서 에뮬레이터가 검증하지 못했고 **실기기가 검증한** 것

아래 셋은 에뮬레이터에서 원리적으로 못 보던 것들이고, 2026-07-27 실기기에서 확인됐습니다
(122초 세션, 대상 `com.android.settings`).

- **CPU 주파수 값** — 에뮬레이터의 `cpuinfo_max_freq` 는 `2` 라 kHz 가 아니었습니다.
  실기기에서는 실제 kHz 가 나옵니다: 614400~1785600 (little), 633600~2496000 (big),
  806400~2995200 (prime).
- **big.LITTLE 코어별 거동** — 에뮬레이터는 4코어가 모두 같은 클러스터입니다. 실기기는
  **3 클러스터** (`[0-3] / [4-6] / [7]`) 이고 코어별 사용률이 실제로 갈립니다
  (실측: cpu0 15.74% … cpu7 1.92%).
- **로그 수집** — 에뮬레이터 이미지는 SELinux 가 `traced_probes` 의 `logdr` 접근을 막아
  `android.log` 가 **항상 비어 있었습니다**(6세션 전부 `partial` / `no_log_entries`).
  **실기기에서도 같은 일이 일어납니다** — SM-A405S(Android 11)는 `android.log` 만 켠 트레이스가
  0줄이고 같은 config 가 SM-F936N(Android 16)에서는 1,021줄입니다. 데이터소스는 양쪽 다
  등록돼 있습니다. perfetto 문서는 이 데이터소스를 *"supported only on Android userdebug
  builds"* 라고 적지만 두 기기 다 `ro.build.type=user` 이고, 소스에는 빌드 타입 검사가 없이
  `/dev/socket/logdr` 에 붙어 실패하면 조용히 빕니다 — 버전이 아니라 **소켓 권한**입니다.
  실기기에서는 `collected` 이고 122초 세션에 **1,422건**이 잡혔습니다
  (warn 413 / error 1,009 / fatal 0). 크래시·ANR **분류** 자체는 실제 크래시를 만들어야
  검증되므로 여전히 유닛 테스트로만 덮입니다.

#### M2 에서 아직 검증하지 못한 것

- **Thermal** — 에뮬레이터에는 물리 센서가 없습니다. 실기기 값은 M3 절을 보세요.
  **GPU** 는 M3 에서도 범위 밖입니다.

에뮬레이터에서 **검증된** 항목 (`npm run test:device` 로 돌린 `--launch` 세션 11회 실측):

- **프레임 타임라인** — 11회 **전부** 대상 앱의 프레임을 수집했다 (4~9 프레임,
  `process = com.example.streaming.debug`).
  (예전 이 문서는 "에뮬레이터에서는 `actual_frame_timeline_slice` 가 채워지지 않는다" 고
  적었는데, 그것은 런처만 조작한 세션의 관측이었고 지금은 사실이 아니다. 다만 프레임 **수**가
  적으므로 분포·백분위의 통계적 의미는 실기기에서 봐야 한다.)
- **CPU 사용률과 주파수 이벤트의 존재** — 11회 모두 `collected`, 4코어 전부에서 `cpufreq`
  카운터가 나왔다 (값의 크기는 위 참조).
