# 컴파일 상태 · 베이스라인 프로파일 — 측정 조건으로 기록하고 맞춰 재기

| 항목 | 값 |
|---|---|
| 기능 | baseline-profile |
| 마지막 변경 | 2026-10-11 · BP-1 ~ BP-9 처음 — 시작 · 끝 컴파일 상태 · `start --compile` · 되돌림 줄 · 진단 ART 신호 |
| 디자인 | docs/design/baseline-profile.md |
| 항목 ID | BP-<번호> (예 BP-4) |

지표 · 스키마 · 명령의 정본은 README 다. 이 문서는 **무엇이 되어야 하나**만 적고, 필드 이름 · 옵션 표 · 문구는
README 와 디자인 문서가 정한다. 근거 실측은 2026-10-11 SM-S901N(R5CT0000001 · sdk 36 · user 빌드) ·
YouTube 21.40.161 (profileable 아님). 화면 · CLI 에서 ART 컴파일 결과를 부르는 낱말은 기기 원문 그대로다 —
`status`(= compiler filter) · `reason` · `location`.

## 기획

### 왜

- 콜드 스타트 · 스크롤 수치는 **앱이 어떤 컴파일 상태였나**에 크게 달린다. 같은 기기 · 같은 YouTube 를 상태만 바꿔
  다섯 번씩 띄우면 TotalTime 중앙값이 speed-profile 471 · verify 618 · speed 665 ms 였다. 지금 `result.json` 에는
  그 상태가 없다 — 두 세션의 차이가 앱 탓인지 상태 탓인지 읽는 쪽이 가를 수 없다.
- 상태는 사용자 모르게 바뀐다. Play 업데이트 · 백그라운드 dexopt · 제조사 작업(이 기기는 문서에 없는 reason
  `profile-utilization`)이 컴파일한다. `debuggable` 처럼 **측정 조건의 사실**로 남아야 한다.
- 상태를 맞춰 재려면 `cmd package compile` 로 기기를 바꿔야 한다. 이건 **영구히 남는 변경**이고, 되돌려도
  `reason` 이 처음과 달라진다(실측 `profile-utilization` → `cmdline`). 사람이 켜야만 하고, 바꾼 사실이 기록돼야 한다.
- 진단 세션에 ART(`dalvik`) atrace 를 켜면 트레이스 안에서 컴파일 상태 slice 와 JIT slice 를 읽을 수 있다 —
  상태마다 시작 구간 JIT slice 가 speed-profile 1 · verify 139 · speed 0 으로 갈렸다.

### 누구

| 누가 | 언제 쓰나 |
|---|---|
| 앱 성능을 보는 사람 | 두 세션 수치가 다를 때 컴파일 상태가 같았는지 먼저 본다 · 상태를 맞춰 다시 잰다 |
| 베이스라인 프로파일을 넣은 앱 개발자 | 릴리스 빌드가 기기에서 어떤 상태로 돌았나 · 진단 세션에서 JIT 가 얼마나 돌았나 |
| 데이터를 읽는 쪽 (CI · LLM) | `result.json` 에서 상태가 다른 세션을 거르거나, 상태를 바꾼 세션을 가른다 |

### 흐름

1. `perftracker start --app <앱> --launch` → 평소와 같음. `result.json` 에 시작 · 끝 컴파일 상태가 실린다
2. 상태를 맞춰 재려면 `start … --compile speed` (또는 `reset` · `speed-profile`) → 창 열기 전에 기기 상태를 바꾸고,
   바꾸기 전 → 뒤 상태 · 걸린 시간 · 되돌림 명령 줄
3. 앱 조작 — 도구는 기기를 건드리지 않는다
4. `perftracker stop` → `result.json` 경로 + 보고서 명령 (`--compile` 세션이면 + 되돌림 명령 줄)
5. 보고서 → 시작 · 끝 컴파일 상태 · 바꾼 기록이 보인다. 진단 세션이면 진단 탭에 ART 신호
6. 상태별 세션을 여러 번 → 나란히 읽고 비교하는 것은 읽는 쪽 몫 (도구는 비교하지 않는다)

### 결정

| # | 날짜 · run | 결정 | 왜 | 누가 | 상태 |
|---|---|---|---|---|---|
| 1 | 2026-10-11 · baseline-profile | 실기기 시험은 시험 순간 연결된 한 대 · YouTube · 어느 기기였는지 기록 | "테스트는 지금 연결된 폰 유튜브로" (plan B2) | 나 | 정함 |
| 2 | 2026-10-11 · baseline-profile | `status` · `reason` 은 기기 원문 문자열 그대로 — enum 으로 좁히지 않는다 | 문서 표(install-dm · bg-dexopt · cmdline)에 없는 `profile-utilization` · `vdex-dm` · `run-from-apk` · `unknown` 을 실측 · `launch_state` 와 같은 이유 | 워커 | 정함 |
| 3 | 2026-10-11 · baseline-profile | 상태 바꾸기는 `start --compile` 옵트인 하나 · perfetto 세션 시작 전 · 실측한 셋(`reset` · `speed-profile` · `speed`)만 | 사람이 켜야만 (기기 영구 변경) · 측정 창 안 기기 접촉 0 · 실측 안 한 모드(`-m verify` 등)는 결과를 모른다 | 워커 | 정함 |
| 4 | 2026-10-11 · baseline-profile | 도구는 자동으로 되돌리지 않는다 — 되돌림 명령 줄을 내고, 되돌려도 `reason` 이 다를 수 있다는 한계를 README 에 적는다 | 처음 상태를 정확히 되살릴 명령이 없다 (`profile-utilization` → `cmdline` · `--reset` 이 지운 로컬 프로파일은 못 살림) · speed-profile 재컴파일 18.6초를 stop 에 숨기지 않음 | 워커 | 정함 |
| 5 | 2026-10-11 · baseline-profile | 프로파일 내용 덤프(`pm dump-profiles`) · APK/AAB 의 `baseline.prof` 검사는 이번에 안 한다 | 덤프 원본(ref · cur · 외부)을 확인 못 함 — `--reset` 직후에도 바이트 같음 · 덤프가 앱 프로세스에 flush 신호를 보냄 · APK 검사는 세션과 무관(기기 없음)하고 임의 앱 전제에서 APK 를 갖고 있지 않음 | 워커 | 정함 |
| 6 | 2026-10-11 · baseline-profile | 판정하지 않는다 — filter · JIT 수로 "프로파일 적용됨 · 안 됨 · AOT 로 덮임" 같은 결론을 내지 않는다 | 규칙 2 · JIT 수가 상태를 가른다는 것은 이 기기 세 상태 실측일 뿐 | 워커 | 정함 |

### 안 하는 것

| 안 한다 | 왜 (한 마디) |
|---|---|
| 프로파일 내용 덤프 · "JIT 된 메서드 − 프로파일 메서드" | 덤프 원본 미확인 · 앱 프로세스에 신호 · JIT 이름과 프로파일 이름 꼴 대조 미확인 (결정 5) |
| APK · AAB 의 `baseline.prof` · `.profm` · `r8.json` 검사 | 세션 밖 · APK 가 없음 · Android Studio APK Analyzer 몫 (결정 5) |
| 상태별 콜드 스타트를 한 명령으로 여러 번 (`bench`) · 상태별 분포 화면 | 보고서는 세션 하나 · 이번 범위 밖 — 열린 질문 3 |
| 자동 되돌림 | 정확히 되돌릴 명령이 없다 (결정 4) |
| 화면(측정 화면 04)의 `--compile` 토글 | 기기 영구 변경을 클릭 한 번에 두지 않음 · 이번 범위 밖 — 열린 질문 2 |
| `-m verify` · `-m quicken` · `--secondary-dex` 를 `--compile` 값으로 | 실측 안 함 (결정 3) |
| split APK · 보조 dex 의 상태를 따로 바꾸기 | base 한 줄만 바꾼다 · 보조 dex 는 기록만 |
| 상태 비교 · "다른 상태" 판정 | 판정 (규칙 2) — 바뀜 경고는 문자열이 다르다는 사실만 |
| `base.dm`(클라우드 프로파일) 유무 기록 | 이번 범위 밖 — 열린 질문 5 |

## 명세

### 동작

| ID | 동작 | 받아들임 기준 | 확인 |
|---|---|---|---|
| BP-1 | 시작 · 끝 컴파일 상태를 기록한다 | 모든 세션의 `result.json` `target_app` 에 시작 · 끝 컴파일 상태가 있다 — dex 줄마다 경로 · ABI · `status` · `reason` (+ 기기가 주면 `location`) · primary ABI 표시. base.apk 줄과 보조 dex 줄을 모두 싣고 줄 수를 줄이지 않는다. 값은 `dumpsys package <pkg>` 의 `Dexopt state` 원문 그대로 (결정 2). 시작 상태는 지금 `target_app` 을 읽는 `dumpsys package` 한 번의 출력에서 읽는다 — `--compile` 없는 세션의 `start` 기기 왕복 수가 늘지 않는다. 끝 상태는 `stop` 이 측정 창을 닫은 뒤 읽는다 — `stop` 의 기기 왕복은 많아야 하나 는다. 측정 창 안 adb 0 그대로. 실기기 원문 픽스처(`packages/core/test/fixtures/`)로 파싱해 base.apk `speed-profile` / `profile-utilization` · 보조 dex 셋 `verify` / `vdex` 가 나온다 | `BP-1 dumpsys Dexopt state 파싱` · `BP-1 시작 상태는 같은 dumpsys 출력에서` · `BP-1 끝 상태는 창 닫은 뒤` · 기존 `start.test.ts` 「기기로 나가는 명령 전체」 (stop 쪽 목록 갱신) |
| BP-2 | 못 읽으면 null + 이유 | `Dexopt state` 절이 없거나 대상 패키지 줄을 못 찾으면 그 상태는 `null` 이고 README enum 의 `reason_code` 가 같이 실린다 — `[]` · 빈 문자열로 채우지 않는다. 끝 상태를 못 읽은 경우(기기 끊김 · `stop` 전 `extract`)도 null + 코드. README 의 `reason_code` 개수 문장이 `packages/core/test/schema/readme.test.ts` 와 맞는다 | `BP-2 Dexopt state 없음 null` · `BP-2 extract 는 끝 상태 null` · 기존 `reason_code 개수가 METRIC_REASON_CODES 와 같다` |
| BP-3 | 세션 중 바뀐 사실을 경고로 | 시작 · 끝 상태가 둘 다 있고 base.apk 줄의 `status` 또는 `reason` 문자열이 다르면 `warnings` 에 바뀜 경고 하나 (관측된 사건 — 평가 낱말 0). 같으면 · 어느 쪽이 null 이면 경고 0. README 경고 목록에 있다 | `BP-3 상태 바뀜 경고` · `BP-3 null 이면 경고 없음` |
| BP-4 | `start --compile <reset\|speed-profile\|speed>` — 창 밖에서 상태를 맞춘다 | `--compile` 을 줄 때만 기기 상태를 바꾼다: `reset` = `cmd package compile --reset <pkg>` · `speed-profile` · `speed` = `cmd package compile -m <값> -f <pkg>`. 그 명령은 perfetto 세션 시작 · `am force-stop` 보다 앞에 나간다. 다른 값은 기기 명령 0 으로 거부된다. 명령이 실패하면(종료 코드 ≠ 0 · 출력 `Failure`) 세션을 열지 않고 perfetto 시작 · force-stop 0, 그 자리의 상태 줄과 되돌림 줄을 낸다. 성공하면 `result.json` 에 바꾼 기록(값 · 보낸 명령 원문 · 바꾸기 전 상태 · 걸린 ms)이 실리고, 바꾼 뒤 상태는 BP-1 의 시작 상태다. `--compile` 없는 세션은 기록 키 0 · 기기 명령 목록이 이 기능 전과 같다 (BP-1 의 stop 한 줄 빼고). 실측 67.5초(speed) 걸린 명령에서도 끊기지 않는다. README 「명령 전체」 · `packages/cli/AGENTS.md` 에 옵션이 있고 `packages/cli/test/readme.test.ts` 가 대조한다 | `BP-4 compile 명령은 perfetto · force-stop 전` · `BP-4 허용 밖 값 거부` · `BP-4 실패하면 세션 안 엶` · `BP-4 바꾼 기록` · `BP-4 --compile 없으면 기록 키 0` · 기존 `README 옵션 대조` |
| BP-5 | 되돌림 명령 줄과 한계 | `--compile` 세션의 `start` 와 `stop` 출력에 그대로 쳐서 도는 되돌림 명령이 있다 — 바꾸기 전 base.apk `status` 로 `cmd package compile -m <그 값> -f <pkg>`, 바꾸기 전 보조 dex 가 있고 그 `status` 가 모두 같으면 `-m <그 값> -f --secondary-dex <pkg>` 한 줄 더 (실측: 셋 다 `verify` · `reset` 뒤 둘이 `run-from-apk` 로 바뀜), 서로 다르면 그 사실 한 줄. 바꾸기 전 `status` 가 `-m` 이 받는 값이 아니거나 null 이면 명령 대신 그 사실 한 줄. `--compile` 없는 세션의 `start` · `stop` 출력은 지금과 같다. README 에 한계가 있다: 되돌려도 `reason` 이 `cmdline` 으로 남는다(실측 `profile-utilization` → `cmdline`) · `reset` 이 지운 로컬 프로파일은 되살리지 못한다 · 이후 bg-dexopt 가 다시 바꿀 수 있다 | `BP-5 되돌림 줄 — start · stop` · `BP-5 되돌릴 값 없으면 사실 한 줄` · `BP-5 --compile 없으면 출력 그대로` |
| BP-6 | CLI 표시 | `start` · `status` 에 `--compile` 세션이면 바꾼 값 · 전 → 후 `status` 줄이 붙는다 (80칸 안). `status` 는 기기를 건드리지 않는다. `status --json` · `runs --json` 은 `--compile` 세션에만 그 표시를 싣는다. 새 문구는 디자인 문서 `## 문구` 표가 정본이고 DM-15 단어형 규칙을 지킨다 | `BP-6 start · status 컴파일 줄` · `BP-6 --json 은 compile 세션에만` · `BP-6 문구 표 ↔ 코드` |
| BP-7 | 진단 세션의 ART 신호 | 진단 세션 config 가 `dalvik` atrace 카테고리를 켠다 (DM-3 · DM-4). 진단 블록에 대상 앱 프로세스의 (1) 컴파일 상태 slice 목록 — `location=… status=… filter=… reason=…` 꼴 slice 를 `location` · `status` · `filter` · `reason` 칸으로 (중복 없이) (2) JIT 컴파일 slice 수 (`JIT compiling` 으로 시작하는 slice) 가 실린다. 같은 원본을 trace_processor 로 다시 세면 둘이 같다. 대상 앱을 못 찾거나 ftrace 를 못 믿는 경우는 DM-9 의 대상 앱 몫과 같이 null. 순위 · 비율 · 판정 필드 0 (결정 6). 평소 세션 config 에 atrace 키 0 그대로 | `BP-7 진단 config dalvik` · `BP-7 컴파일 상태 slice 파싱` · `BP-7 JIT slice 수` · `BP-7 대상 앱 못 찾으면 null` · `DM-3 …` · `DM-4 …` |
| BP-8 | 보고서 표시 | 보고서에 시작 · 끝 컴파일 상태 · 바꾼 기록이, 진단 세션이면 진단 탭에 BP-7 의 두 칸이 나온다 — 파일에만 있는 새 필드 0 (DM-13 과 같은 다섯 자리 셈). null 은 `값 없음` + 코드, 필드가 없는 옛 `result.json` 은 `수집 안 함` (HANDOFF ①). 상태 문자열을 색 · 굵기로 구별하지 않는다. 라벨은 RR-6 규칙(우리말 단어 + 경로). 평소 세션 · `--compile` 없는 보고서도 시작 · 끝 상태는 보인다. 보고서 파일 하나 · 외부 요청 0 그대로 | `BP-8 새 필드 전부 보임` · `BP-8 옛 result.json 수집 안 함` · 수동 (1440 · 390 렌더) |
| BP-9 | 실기기 — YouTube | 시험 순간 연결된 한 대(결정 1 · 기기 모델 · serial · sdk 를 기록) · `com.google.android.youtube`: (a) `start --launch` → `stop`: 시작 · 끝 상태의 base.apk `status` · `reason` 이 같은 순간 창 밖에서 읽은 `dumpsys package` 와 같다 · `adb_commands_during_session` 0. (b) `start --launch --compile speed` → 시작 상태 `speed` / `cmdline` · 바꾼 기록의 바꾸기 전 상태가 (a) 의 끝 상태와 같다 · TotalTime 이 있다. (c) `--compile reset` → 시작 상태 `verify` (reason 은 원문 기록만 · 실측 `vdex-dm`). (d) 진단 + `--compile speed`: 컴파일 상태 slice 중 base 줄 `filter` 가 `speed` · JIT slice 수가 null 아님. (e) 출력의 되돌림 줄을 그대로 실행하면 base.apk `status` 가 처음 값으로 돌아오고 `reason` 은 `cmdline` 이다 — 이 차이를 시험 기록에 남긴다. 전 회 측정 창 안 adb 0 | 수동 · on-device `BP-9 …` (`packages/cli/test/on-device/`) |

### 안 바뀔 것

| 무엇 | 확인 |
|---|---|
| 측정 창 안 기기 접촉 0 — `--compile` 의 기기 변경 · 끝 상태 읽기는 창 밖. `MeasurementWindow` 를 지나지 않는 경로 없음 | 기존 `startSession — 오케스트레이션 불변식` · BP-1 · BP-4 · BP-9 |
| 판정하지 않는다 — 상태 · JIT 수에 평가어 · 순위 · 비교 없음. `references` 는 비교에 안 씀 | BP-7 · BP-8 · DM-15 단어형 규칙 |
| 모르면 null + `reason_code` — 못 읽은 상태를 `[]` · `''` 로 채우지 않는다 | BP-2 |
| 의존 방향 cli → gui → core · 화면은 `packages/gui/src/contract/api.ts` 로만 core 를 본다 | 수동 (import grep) |
| `--compile` 없는 세션은 기기 상태를 바꾸지 않는다 — `cmd package compile` 0 | BP-4 시험 |
| 지표 8개 · `metrics` 모양 그대로 — 컴파일 상태는 `metrics` 밖 | 기존 `packages/core/test/schema/readme.test.ts` |
| 옛 `result.json` 이 새 스키마를 통과한다 | 기존 `DM-6 옛 result.json 통과` · `BP-8 옛 result.json 수집 안 함` |
| 진단 세션 최대 10분 · 평소 30분 | 기존 `DM-17 …` |
| `stop` · `extract` 는 요약을 안 찍는다 — 경로 · 보고서 명령 (+ BP-5 되돌림 줄) 만 | 기존 `stop.test.ts` · BP-5 |

## 열린 질문

| # | 무엇 | 지금 기본값 | 날짜 · run |
|---|---|---|---|
| 1 | sdk 30–35 실기기의 `Dexopt state` 꼴 (실측은 sdk 36 SM-S901N · sdk 35 emulator 뿐) | 합성 픽스처 + 못 읽으면 null (BP-2) | 2026-10-11 · baseline-profile |
| 2 | 화면(측정 화면 04)에 `--compile` 을 둘지 | 두지 않음 — CLI 만 | 2026-10-11 · baseline-profile |
| 3 | 상태별 콜드 스타트를 한 명령으로 여러 번 돌리고 분포를 나란히 (`bench startup --compile …`) | 사람이 `start --compile` 세션을 여러 번 · 비교는 읽는 쪽 | 2026-10-11 · baseline-profile |
| 4 | 프로파일 덤프의 원본 (ref · cur · 외부) — `--reset` 직후 바이트 같음 · ref · cur 를 셸이 못 읽음 | 다루지 않음 (결정 5) | 2026-10-11 · baseline-profile |
| 5 | 설치 폴더의 `base.dm`(클라우드 프로파일 · 실측 1,605,936 B) 유무 · reason `install-dm` · `vdex-dm` 과의 관계 | 기록 안 함 | 2026-10-11 · baseline-profile |
| 6 | `--compile` 직후 첫 실행이 다음 실행들보다 길었다 (553/471 · 956/618 · 844/665 ms — 트레이스 몫인지 상태 바꾼 뒤 첫 실행 몫인지 못 가름) | 사실만 README 에 · 도구는 예열 실행을 하지 않음 | 2026-10-11 · baseline-profile |
| 7 | `dalvik` 이 더하는 slice 이름 — 클래스 디스크립터(`L…;` 15초 5,7xx 개 · 숫자 없는 난독화 이름이라 접히지 않음)가 slice 표 행을 얼마나 늘리나 | 표 규칙(DM 결정 7 · 22) 그대로 · BP-9 (d) 에서 행 수를 잰다 | 2026-10-11 · baseline-profile |
| 8 | `cmd package compile` 이 대상 앱이 떠 있을 때 앱을 죽이는지 | `--launch` 면 어차피 force-stop · 아니면 사실을 BP-9 에서 본다 | 2026-10-11 · baseline-profile |
| 9 | `reason=profile-utilization` 의 출처 — 같은 dumpsys 의 `Profile utilization state` 절(AOSP 에 없음 · 삼성 추가로 보이나 문서 확인 못 함) | 원문만 싣는다 (결정 2) | 2026-10-11 · baseline-profile |

## 바뀐 기록

| 날짜 | run | 항목 | 무엇이 |
|---|---|---|---|
| 2026-10-11 | baseline-profile | BP-1 ~ BP-9 | 처음 |
