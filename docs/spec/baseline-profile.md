# 컴파일 상태 · 베이스라인 프로파일 — 측정 조건으로 기록하고 맞춰 재기

| 항목 | 값 |
|---|---|
| 기능 | baseline-profile |
| 마지막 변경 | 2026-10-11 · BP-1 · BP-4 고침 (실현성 재검토 왕복 2) — `--compile` 세션의 시작 상태는 compile 바로 뒤 다시 읽은 `dumpsys package` |
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
2. 상태를 맞춰 재려면 `start --app <앱> --launch --compile speed` (또는 `reset` · `speed-profile` · `--launch` 없으면 거부)
   → 창 열기 전에 기기 상태를 바꾸고, 바꾸기 전 → 뒤 상태 · 걸린 시간 · 되돌림 명령 줄
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
| 7 | 2026-10-11 · baseline-profile | 컴파일 상태는 **모든 세션**에 싣는다 — 평소 세션 `result.json` 의 키가 바뀐다. `target_app` 이 닫힌 객체라 캐시한 1.1.0 스키마는 평소 산출물도 거부한다 — README 1.2.0 문단과 diagnostic-mode DM-6 을 고치고 스키마 바뀜을 README 에 적는다. diagnostic-mode 결정 18(켤 때만 키 · plan D12)과 **다른 길**이다 | 상태 비교가 가장 필요한 것이 평소 세션 · `--compile` 세션에만 실으면 평소 상태 기록(이 기능의 첫 목적)을 버린다 · 1.2.0 미출시라 지금이 가장 쌈 (plan B17 · 개발 검토 사람 #1) | 메인 | 정함 |
| 8 | 2026-10-11 · baseline-profile | `--compile` 은 `--launch` 와만 — `--launch` 없이 주면 기기 명령 0 으로 거부 | 이미 떠 있는 앱은 옛 odex 로 돌 수 있어 시작 상태(바꾼 뒤)와 실제로 돈 코드가 다를 수 있다 (plan B20 · 개발 검토 사람 #4) | 메인 | 정함 |
| 9 | 2026-10-11 · baseline-profile | 상태를 바꾸는 명령은 실측한 꼴 그대로 — `--primary-dex` 같은 범위 옵션을 붙이지 않는다. 기기가 의존 패키지 · split · 보조 dex 까지 바꿀 수 있다는 한계를 README 에 적고, 되돌림 줄은 대상 앱만 | 실측 안 한 옵션은 결과를 모른다 (결정 3) · 기기 도움말은 범위가 없으면 `--primary-dex --include-dependencies` 라 말함 (plan B19 · 개발 검토 사람 #3) | 메인 | 정함 |
| 10 | 2026-10-11 · baseline-profile | 상태 바꾸는 명령의 시간 한도는 10분 — 넘으면 BP-4 실패 경로 | adb 호출 기본 한도 60초가 실측 67.5초(speed)를 끊어, 기기는 계속 컴파일하는데 세션은 실패로 끝남 (개발 검토 #3 · brief 정하지 않은 것 8) | 워커 | 정함 |
| 11 | 2026-10-11 · baseline-profile | 상태 바꾸기는 설정 검증(DM-4) 뒤 · run 디렉토리 만들기 · 시작 스냅샷 **전** | 67.5초 컴파일의 발열이 시작 상태(배터리 온도 · thermal)에 섞이지 않음 · 실패 때 빈 run 디렉토리 0 · 거부될 config 로 기기를 바꾸지 않음 (개발 검토 #6) | 워커 | 정함 |
| 12 | 2026-10-11 · baseline-profile | 원문 꼴은 실측 하나(sdk 36 삼성)만 안다 — 한 dex 에 ABI 줄이 여럿이면 비교 · 되돌림 기준은 `[primary-abi]` 줄 · `location` 은 `[location is ` 뒤 문자열 그대로(`error` · 공백 든 문장 포함) · 절은 있는데 줄 꼴을 모르면 null + 코드 | 형식을 추측해 채우지 않는다 (규칙 3 · 개발 검토 #7) | 워커 | 정함 |
| 13 | 2026-10-11 · baseline-profile | 되돌림 줄은 호스트에서 그대로 도는 꼴(`adb -s <serial> shell cmd package compile …`) · 80칸 규칙에서 빼고 한 줄 그대로 (자르지 않음) | 「그대로 쳐서 도는」 과 80칸이 같이 못 섬 — 실측 91 · 100칸 (디자인 검토 #6) | 워커 | 정함 |
| 14 | 2026-10-11 · baseline-profile | 낱말 `status` 는 두 자리에서 뜻이 다르다 — `target_app` 컴파일 상태의 `status` = compiler filter · 진단 컴파일 상태 slice 의 `status` = oat 파일 상태(그 slice 의 compiler filter 는 `filter` 칸). README · schema 설명 · 보고서 라벨이 둘을 갈라 적는다 | 같은 낱말 다른 뜻이라 읽는 쪽이 섞음 · 이름은 기기 원문이라 바꾸지 않음 (결정 2 · 개발 검토 #10) | 워커 | 정함 |
| 15 | 2026-10-11 · baseline-profile | 보고서에서 `--compile` 없는 새 세션의 바꾼 기록 자리는 `바꾸지 않음` — `수집 안 함` · `값 없음` 이 아니고 레일 배지에 세지 않는다. 시작 상태 키가 있는데(새 파일) 기록 키가 없을 때만이고, 둘 다 없는 옛 파일은 `수집 안 함` | 기록 키 0(BP-4)은 "바꾸지 않았다" 는 사실 — `수집 안 함` 으로 그리면 평소 세션마다 거짓 미수집 · RR-8 과 부딪힘 (개발 검토 #2) | 워커 | 정함 |
| 16 | 2026-10-11 · baseline-profile | 보고서 자리 — 요약 탭 맥락 섹션에 새 카드 `컴파일 상태 (전 → 후)` 하나(전폭) + 머리 옵션 칸에 `--compile <값>`. 요약 타일에 올리지 않는다 (지표 아님) | 사실은 제자리 하나 · 측정 조건이라 맥락 섹션 (plan B16 · 디자인 검토 사람 #4) | 메인 | 정함 |

### 안 하는 것

| 안 한다 | 왜 (한 마디) |
|---|---|
| 프로파일 내용 덤프 · "JIT 된 메서드 − 프로파일 메서드" | 덤프 원본 미확인 · 앱 프로세스에 신호 · JIT 이름과 프로파일 이름 꼴 대조 미확인 (결정 5) |
| APK · AAB 의 `baseline.prof` · `.profm` · `r8.json` 검사 | 세션 밖 · APK 가 없음 · Android Studio APK Analyzer 몫 (결정 5) |
| 상태별 콜드 스타트를 한 명령으로 여러 번 (`bench`) · 상태별 분포 화면 | 보고서는 세션 하나 · 이번 범위 밖 — 열린 질문 3 |
| 자동 되돌림 | 정확히 되돌릴 명령이 없다 (결정 4) |
| 화면(측정 화면 04)의 `--compile` 토글 | 기기 영구 변경을 클릭 한 번에 두지 않음 · 이번 범위 밖 — 열린 질문 2 |
| `-m verify` · `-m quicken` · `--secondary-dex` 를 `--compile` 값으로 | 실측 안 함 (결정 3) |
| split APK · 보조 dex · 의존 패키지의 상태를 따로 바꾸거나 범위 옵션(`--primary-dex` 등)으로 좁히기 | 실측한 명령 꼴 그대로 — 기기가 함께 바꿀 수 있다는 한계만 README 에 (결정 9) |
| `--launch` 없는 `--compile` | 떠 있는 앱이 옛 코드로 돌 수 있음 — 거부 (결정 8) |
| 상태 비교 · "다른 상태" 판정 | 판정 (규칙 2) — 바뀜 경고는 문자열이 다르다는 사실만 |
| `base.dm`(클라우드 프로파일) 유무 기록 | 이번 범위 밖 — 열린 질문 5 |

## 명세

### 동작

| ID | 동작 | 받아들임 기준 | 확인 |
|---|---|---|---|
| BP-1 | 시작 · 끝 컴파일 상태를 기록한다 | **모든 세션**(평소 · 진단 · `--compile`)의 `result.json` `target_app` 에 시작 · 끝 컴파일 상태가 있다 (결정 7) — dex 줄마다 경로 · ABI · `status` · `reason` (+ 기기가 주면 `location`) · primary ABI 표시. base.apk 줄과 보조 dex 줄을 모두 싣고 줄 수를 줄이지 않는다. 값은 `dumpsys package <pkg>` 의 `Dexopt state` 원문 그대로 (결정 2 · 12) — `location` 은 `[location is ` 뒤 문자열 그대로(`error` · 공백 든 문장 포함). `--compile` 없는 세션의 시작 상태는 지금 `target_app` 을 읽는 `dumpsys package` 한 번(대상 앱 해석 `resolveTargetApp`)의 출력에서 읽는다 — 대상 앱 해석의 기기 명령 목록이 그대로다. `--compile` 세션의 시작 상태는 BP-4 의 다시 읽은 출력이다 (대상 앱 해석은 바꾸기 전이다). 끝 상태는 `stop` 이 측정 창을 닫고 원본을 회수한 뒤 `dumpsys package <pkg>` 하나로 읽는다 — `stop` 의 기기 명령 목록에 정확히 한 줄 늘고 그 밖 줄 · 순서는 그대로. 측정 창 안 adb 0 그대로. 실기기 원문 픽스처(`packages/core/test/fixtures/` — research `A1-dumpsys-package.txt` · `F3-dexopt-state-after.txt` · `C-state1-reset.txt` 를 줄여)로 파싱해: A1 → base.apk `speed-profile` / `profile-utilization` · 보조 dex 셋 `verify` / `vdex`, F3 → `location` 이 `error`, C-state1 → 공백 든 `location` 문장이 원문 그대로 나온다. README 「`result.json` 읽는 법」 의 1.2.0 문단과 「스키마를 다시 꺼내야 하는 때」 가 평소 세션 산출물도 1.1.0 스키마가 거부한다고 말하고(`target_app` 이 닫힌 객체), "평소 세션 산출물은 1.1.0 과 키가 같다" 는 문장이 README · `docs/STATUS.md` 에 0 | `BP-1 dumpsys Dexopt state 파싱` (A1 · F3 · C-state1) · `BP-1 시작 상태는 같은 dumpsys 출력에서` (`packages/core/test/app/target.test.ts` — 명령 목록 그대로) · `BP-1 끝 상태는 창 닫은 뒤` · 기존 `packages/core/test/session/stop.test.ts` 「기기로 나가는 명령 전체가 이 목록과 정확히 같다」 (한 줄 갱신) · `BP-1 README 1.2.0 문단 — 평소 산출물도 1.1.0 이 거부` |
| BP-2 | 못 읽으면 null + 이유 | `Dexopt state` 절이 없거나 · 대상 패키지 줄을 못 찾거나 · 절은 있는데 dex 줄 꼴을 모르면(결정 12 — 꼴을 추측하지 않음) 그 상태는 `null` 이고 README enum 의 `reason_code` 가 같이 실린다 — `[]` · 빈 문자열로 채우지 않는다. 끝 상태를 못 읽은 경우(기기 끊김 · `stop` 전 `extract`)도 null + 코드. README 의 `reason_code` 개수 문장이 `packages/core/test/schema/readme.test.ts` 와 맞는다 | `BP-2 Dexopt state 없음 null` · `BP-2 줄 꼴 모름 null` · `BP-2 extract 는 끝 상태 null` · 기존 `reason_code 개수가 METRIC_REASON_CODES 와 같다` |
| BP-3 | 세션 중 바뀐 사실을 경고로 | 시작 · 끝 상태가 둘 다 있고 base.apk 줄(ABI 줄이 여럿이면 `[primary-abi]` 줄 · 결정 12)의 `status` 또는 `reason` 문자열이 다르면 `warnings` 에 바뀜 경고 하나 (관측된 사건 — 평가 낱말 0). 같으면 · 어느 쪽이 null 이면 경고 0. README 경고 목록에 있다 | `BP-3 상태 바뀜 경고` · `BP-3 ABI 줄 여럿이면 primary-abi 줄로` · `BP-3 null 이면 경고 없음` |
| BP-4 | `start --launch --compile <reset\|speed-profile\|speed>` — 창 밖에서 상태를 맞춘다 | `--compile` 은 `--launch` 와 함께일 때만 받는다 — `--launch` 없이 주거나 허용 밖 값이면 기기 명령 0 으로 거부된다 (결정 8). 기기 상태는 `--compile` 을 줄 때만 바꾼다: `reset` = `cmd package compile --reset <pkg>` · `speed-profile` · `speed` = `cmd package compile -m <값> -f <pkg>` — 실측 꼴 그대로, 범위 옵션을 붙이지 않는다 (결정 9). 그 명령은 설정 검증(DM-4) 뒤에, run 디렉토리 만들기 · 시작 스냅샷 · perfetto 세션 시작 · `am force-stop` 보다 앞에 나간다 (결정 11) — 설정 검증이 거부하면 그 명령도 0. 명령의 시간 한도는 10분이다 (결정 10 — 실측 67.5초에서 끊기지 않음 · 기기 호출에 넘긴 한도로 확인). 명령이 실패하면(종료 코드 ≠ 0 · 출력 `Failure` · 한도 넘음) 세션을 열지 않고 run 디렉토리 · 시작 스냅샷 · perfetto 시작 · force-stop 0, 그 자리의 상태 줄과 되돌림 줄을 낸다. 성공하면 그 명령 바로 뒤 · run 디렉토리 만들기 전에 `dumpsys package <pkg>` 한 줄로 다시 읽어 그 출력이 시작 상태(= 바꾼 뒤 상태)다 — `--compile` 세션의 기기 명령 목록에 compile 줄 바로 다음 그 한 줄이 있다 (실패하면 그 줄 0). `result.json` 에 바꾼 기록(값 · 보낸 명령 원문 · 바꾸기 전 상태 · 걸린 ms)이 `--compile` 세션에만 실린다 — 바꾸기 전 상태는 대상 앱 해석의 출력이다. `--compile` 없는 세션은 기록 키 0 · 기기 명령 목록이 이 기능 전과 같다 (BP-1 의 stop 한 줄 빼고). README 「명령 전체」 · `packages/cli/AGENTS.md` 에 옵션이 있고 `packages/cli/test/readme.test.ts` 가 대조한다 | `BP-4 compile 은 DM-4 뒤 · 시작 스냅샷 · perfetto · force-stop 전` · `BP-4 --launch 없으면 거부` · `BP-4 허용 밖 값 거부` · `BP-4 compile 시간 한도` · `BP-4 실패하면 세션 안 엶 · run 디렉토리 0` · `BP-4 바꾼 뒤 상태는 다시 읽은 dumpsys` (명령 목록에 그 줄) · `BP-4 바꾼 기록` · `BP-4 --compile 없으면 기록 키 0` · 기존 `README 옵션 대조` |
| BP-5 | 되돌림 명령 줄과 한계 | `--compile` 세션의 `start` 와 `stop` 출력에 호스트에서 그대로 쳐서 도는 되돌림 명령이 있다 — `adb -s <serial> shell cmd package compile …` 꼴 · 한 줄 그대로 (80칸 규칙 밖 · 결정 13). 바꾸기 전 base.apk(`[primary-abi]` 줄)의 `status` 로 `-m <그 값> -f <pkg>`, 바꾸기 전 보조 dex 가 있고 그 `status` 가 모두 같으면 `-m <그 값> -f --secondary-dex <pkg>` 한 줄 더 (실측: 셋 다 `verify` · `reset` 뒤 둘이 `run-from-apk` 로 바뀜), 서로 다르면 그 사실 한 줄. `-m` 이 받는 값은 기기 도움말 실측의 `speed` · `speed-profile` · `verify` (sdk 36) — 바꾸기 전 `status` 가 그 밖이거나 null 이면 명령 대신 그 사실 한 줄. 되돌림 줄은 대상 앱만 (결정 9). `--compile` 없는 세션의 `start` · `stop` 출력은 지금과 같다. README 에 한계가 있다: 되돌려도 `reason` 이 `cmdline` 으로 남는다(실측 `profile-utilization` → `cmdline`) · `reset` 이 지운 로컬 프로파일은 되살리지 못한다 · 이후 bg-dexopt 가 다시 바꿀 수 있다 · 상태를 바꾸는 명령이 의존 패키지 · split · 보조 dex 도 바꿀 수 있다 (결정 9) | `BP-5 되돌림 줄 — start · stop · 호스트 꼴` · `BP-5 되돌릴 값 없으면 사실 한 줄` · `BP-5 --compile 없으면 출력 그대로` |
| BP-6 | CLI 표시 | `start` · `status` 에 `--compile` 세션이면 바꾼 값 · 전 → 후 `status` 줄이 붙는다 (80칸 안 — 되돌림 줄은 결정 13 으로 밖). `status` 는 기기를 건드리지 않는다. `status --json` · `runs --json` 은 `--compile` 세션에만 그 표시를 싣는다. 새 문구는 디자인 문서 `## 문구` 표가 정본이고 DM-15 단어형 규칙을 지킨다 | `BP-6 start · status 컴파일 줄` · `BP-6 --json 은 compile 세션에만` · `BP-6 문구 표 ↔ 코드` |
| BP-7 | 진단 세션의 ART 신호 | 진단 세션 config 가 `dalvik` atrace 카테고리를 켠다 (DM-3 · DM-4). 진단 블록에 대상 앱 프로세스의 (1) 컴파일 상태 slice 목록 — `location=… status=… filter=… reason=…` 꼴 slice 를 `location` · `status` · `filter` · `reason` 칸으로 (중복 없이 · `location` 에 공백이 들어도 칸이 맞게 갈림) (2) JIT 컴파일 slice 수 (`JIT compiling` 으로 시작하는 slice) 가 실린다. 같은 원본을 trace_processor 로 다시 세면 둘이 같다. 세션 기록의 켠 카테고리에 `dalvik` 이 없거나 그 기록이 null 이면(이 기능 전 진단 run 을 `extract` 로 다시 낸 경우 · DM-8) 두 칸은 `[]` · `0` 이 아니라 null + 새 `reason_code` 다 (README 정본 · 개수 문장 갱신) — 블록 `status` 는 그것 때문에 바뀌지 않는다. 대상 앱을 못 찾거나 ftrace 를 못 믿는 경우는 DM-9 의 대상 앱 몫과 같이 null. 이 slice 의 `status` 는 oat 파일 상태이고 compiler filter 는 `filter` 칸이다 — README · schema 설명이 BP-1 의 `status` 와 갈라 적는다 (결정 14). 순위 · 비율 · 판정 필드 0 (결정 6). 평소 세션 config 에 atrace 키 0 그대로. slice 표에서 클래스 디스크립터 이름(`L…;`)은 한 행으로 접힌다 (DM-7 · diagnostic-mode 결정 37) | `BP-7 진단 config dalvik` · `BP-7 컴파일 상태 slice 파싱` (공백 든 `location` 포함) · `BP-7 JIT slice 수` · `BP-7 dalvik 안 켠 원본은 null` · `BP-7 대상 앱 못 찾으면 null` · `BP-7 status 두 뜻 describe` · `DM-3 …` · `DM-4 …` · `DM-7 클래스 디스크립터 접기` |
| BP-8 | 보고서 표시 | 보고서 요약 탭 맥락 섹션의 카드 `컴파일 상태 (전 → 후)`(전폭)에 시작 · 끝 컴파일 상태 · 바꾼 기록이, 머리 옵션 칸에 `--compile <값>` 이 (`--compile` 세션에만), 진단 세션이면 진단 탭에 BP-7 의 두 칸이 나온다 (결정 16) — 파일에만 있는 새 필드 0 (DM-13 과 같은 다섯 자리 셈). null 은 `값 없음` + 코드, 필드가 없는 옛 `result.json` 은 `수집 안 함` (HANDOFF ①). 시작 상태가 있고 바꾼 기록이 없는 새 세션은 기록 자리에 `바꾸지 않음` 이고 레일 배지에 세지 않는다 (결정 15 · RR-8). 상태 문자열을 색 · 굵기로 구별하지 않고 행 순서는 기기 원문 순. 컴파일 상태는 요약 타일에 없다. 라벨은 RR-6 규칙(우리말 단어 + 경로)이고 두 `status` 를 갈라 적는다 (결정 14). dex 줄마다 여러 칸을 그리는 블록 종류가 `docs/design/report/HANDOFF.md` §2 블록 목록과 블록 수 시험(`packages/gui/test/report.test.ts`)에 맞는다. 평소 세션 · `--compile` 없는 보고서도 시작 · 끝 상태는 보인다. 보고서 파일 하나 · 외부 요청 0 그대로 | `BP-8 새 필드 전부 보임` · `BP-8 --compile 없는 새 세션 바꾸지 않음 · 배지 밖` · `BP-8 옛 result.json 수집 안 함` · 기존 HANDOFF §2 블록 수 시험 (갱신) · 수동 (1440 · 390 렌더) |
| BP-9 | 실기기 — YouTube | 시험 순간 연결된 한 대(결정 1 · 기기 모델 · serial · sdk 를 기록) · `com.google.android.youtube`: (a) `start --launch` → `stop`: 시작 · 끝 상태의 base.apk `status` · `reason` 이 같은 순간 창 밖에서 읽은 `dumpsys package` 와 같다 · `adb_commands_during_session` 0. (b) `start --launch --compile speed` → 시작 상태 `speed` / `cmdline` · 바꾼 기록의 바꾸기 전 상태가 (a) 의 끝 상태와 같다 · TotalTime 이 있다. (c) `--compile reset` → 시작 상태 `verify` (reason 은 원문 기록만 · 실측 `vdex-dm`). (d) 진단 + `--launch --compile speed`: 컴파일 상태 slice 중 base 줄 `filter` 가 `speed` · JIT slice 수가 null 아님 · 클래스 디스크립터를 접은 뒤 slice 표 행 수를 기록한다. (e) 출력의 되돌림 줄을 그대로 실행하면 base.apk `status` 가 처음 값으로 돌아오고 `reason` 은 `cmdline` 이다 — 이 차이를 시험 기록에 남긴다. 전 회 측정 창 안 adb 0 | 수동 · on-device `BP-9 …` (`packages/cli/test/on-device/`) |

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
| 7 | `dalvik` 이 더하는 slice 이름 — 클래스 디스크립터 말고도 JIT · 클래스 검증 slice 이름이 표 행을 얼마나 늘리나 (재집계: 접기 규칙 그대로면 1,099 → 6,227 ~ 27,335행 · 그중 `L…;` 5,233 · 25,523) | `L…;` 는 한 행으로 접는다 (diagnostic-mode 결정 37 · plan B18) · 그 밖은 표 규칙 그대로 · BP-9 (d) 에서 접은 뒤 행 수를 잰다 | 2026-10-11 · baseline-profile |
| 8 | `cmd package compile` 이 대상 앱이 떠 있을 때 앱을 죽이는지 | `--compile` 은 `--launch` 와만(결정 8) — 어차피 뒤에 force-stop · 확인하지 않음 | 2026-10-11 · baseline-profile |
| 9 | `reason=profile-utilization` 의 출처 — 같은 dumpsys 의 `Profile utilization state` 절(AOSP 에 없음 · 삼성 추가로 보이나 문서 확인 못 함) | 원문만 싣는다 (결정 2) | 2026-10-11 · baseline-profile |
| 10 | sdk ≤30 · 비디버그 앱에서 `dalvik` slice 가 앱 프로세스에 실리는지 (실리지 않으면 JIT 0 이 "없었다" 가 아님) · sdk ≤33 기기의 `cmd package compile` 출력 꼴 | 실측은 sdk 36 하나 · 확인 안 함 — 원문만 싣는다 | 2026-10-11 · baseline-profile |
| 11 | GUI 서버가 CLI 가 연 `--compile` 세션을 멈추면 되돌림 줄이 어디에도 안 나옴 · `stop` 이 extract 실패로 던질 때도 빠짐 | 후속 — 이번엔 CLI `start` · `stop` 출력만 | 2026-10-11 · baseline-profile |

## 바뀐 기록

| 날짜 | run | 항목 | 무엇이 |
|---|---|---|---|
| 2026-10-11 | baseline-profile | BP-1 ~ BP-9 | 처음 |
| 2026-10-11 | baseline-profile | BP-1 ~ BP-9 고침 · 결정 7 ~ 16 · 열린 질문 7 · 8 고침 · 10 · 11 · 안 하는 것 두 줄 | 실현성 검토 왕복 1 (개발 조건부 12 · 디자인 조건부 10) · plan B16 · B17 · B19 · B20 — 모든 세션에 상태 기록(평소 키 바뀜 · README 1.2.0 문단) · `--compile` 은 `--launch` 와만 · 범위 옵션 없음 · 시간 한도 10분 · DM-4 뒤 · 시작 스냅샷 전 · `[primary-abi]` 줄 · `location` 원문 · 꼴 모르면 null · 되돌림 줄 호스트 꼴 · 80칸 밖 · `status` 두 뜻 · dalvik 안 켠 원본 null · 보고서 맥락 카드 · `바꾸지 않음` · 확인 칸 시험 자리 (target.test · stop.test) |
| 2026-10-11 | baseline-profile | BP-1 · BP-4 고침 | 실현성 재검토 왕복 2 (조건부 1 · #1) — BP-1 의 "시작 상태는 대상 앱 해석의 `dumpsys package` 에서" 를 `--compile` 없는 세션으로 한정 · BP-4 성공 뒤 `dumpsys package <pkg>` 한 줄로 시작 상태(compile 바로 뒤 · run 디렉토리 전) · 확인 `BP-4 바꾼 뒤 상태는 다시 읽은 dumpsys` |
