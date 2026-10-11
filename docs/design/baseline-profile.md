# 컴파일 상태 · 베이스라인 프로파일 — 디자인

| 항목 | 값 |
|---|---|
| 기능 | baseline-profile |
| 기능 문서 | docs/spec/baseline-profile.md (701a79f) |
| 등급 | 화면 (보고서 카드 · 진단 칸 · CLI 줄) |
| 마지막 변경 | 2026-10-11 · ⑨ 승격 — `## 정한 것` 12 · 시안 고침 5 (B40 · B42) · 핸드오프 사진 = 구현 실렌더 · RR-9 실기기 |

보고서 자리는 **한 곳씩** — 요약 탭 맥락 섹션 카드 `컴파일 상태 (전 → 후)` 하나(전폭) · 머리 `옵션` 칸 · 진단 탭 카드 하나 + `slice 수` 행 하나 (결정 16).
글자 크기 · 색 · 라벨 두 줄 규칙은 `docs/design/report-readability.md` 를 따른다 — 시안도 같은 파일의 상태다.

## 시안

| 차수 | 후보 | 고른 것 | 누가 | 로컬 폴더 | 시안 생성기 | 검사 명령 | Claude Design 파일 |
|---|---|---|---|---|---|---|---|
| 1 · 보고서 | 1 | 1 | 메인 (plan B16 · 후보 하나) | `labs/report-readability-design/v1/shots/` (`summary` · `compile` · `end-null` · `legacy` · `diag` · `diag-noapp`) | Claude Design (`report-readability-design/v1/brief-claude-design.md` → `FIX-1` ~ `FIX-5` · 5 는 구현 뒤 B40 · B42 를 손으로) | `python3 labs/report-readability-design/v1/check_shots.py` | [성능 측정 CLI GUI 도구](https://claude.ai/design/p/9ee5c8ab-33b9-4586-ae73-69f9e53ecd42) · `Report Readability.dc.html` · `design_handoff_baseline-profile/` |
| 1 · CLI | 1 | 1 | 메인 (plan B28) | `labs/baseline-profile-design/v1/cli/` | `gen_cli.py` → `cli/blocks.txt` | `python3 labs/baseline-profile-design/v1/check_cli.py` (깨 봄 `--break`) | `design_handoff_baseline-profile/cli-blocks.txt` |
| 1 · 문구 | — | — | 디자이너 | 이 문서 `## 문구` | 없음 | `check_cli.py` (cli 줄 단어형) | 없음 |

후보 1 — 자리는 결정 16 · 모양은 규칙(같은 색 · 같은 굵기 · 원문 순)으로 닫힌다.

## 제약

| 종류 | 제약 | 출처 |
|---|---|---|
| 데이터 | `target_app.compile_state_start` · `_end` = **dex × ABI 한 줄 = 한 항목의 배열** (칸 여덟 · `location` null 가능) · null = 못 읽음 · `[]` 안 씀 · 짝 `_reason_code` · `_reason` · 경로 ~150자 · `location` 이 문장 · `error` | core `schema/result.ts` DexoptLineSchema · plan B23 |
| 데이터 | 이유 코드 넷 `dexopt_state_section_missing` · `_package_missing` · `_unparsable` · `_unavailable` | `schema/reasons.ts` · plan B24 |
| 데이터 | 진단 `target_process_compile_state_slices`(배열) · `target_process_jit_slices` + 각 `_reason_code` · `_reason` · 코드 `dalvik_not_recorded` · `compile_state_slice_unparsable` · `process_not_in_trace` | `CompileStateSliceSchema` · plan B29 |
| 데이터 | 바꾼 기록 `session.compile` (`--compile` 세션에만) — `value` · `command` · `elapsed_ms` · `compile_state_before`(같은 dex 줄 배열 · null 가능) + `_reason_code` · `_reason` | BP-4 · bp-core-compile 0ef33ad · plan B31 |
| 그릴 것 | 블록 종류 8개에 안 맞음 → **새 종류 `dexstates`** 하나로 둘 다 · 블록 수 9 | feas-design #3 |
| 그릴 것 | 상태 문자열 · 불 값은 등폭 · 같은 색 · 굵기 · 기기 원문 순 · ✓ · 아이콘 · 강조 0 · 타일 밖 | BP-8 · 결정 6 |
| 그릴 것 | `status` 두 뜻을 라벨로 가름 — 앱 컴파일 상태 `status` = `컴파일 필터` · 진단 slice `status` = `oat 파일 상태` (`filter` 가 컴파일 필터) | 결정 14 |
| 그릴 것 | 새 필드 전부 보임 — 다섯 자리(행 · 배지 · 제목 title · 행 title · 코드) 중 하나에 | BP-8 |
| 크기 | 글자 바닥 · 층 · 색은 report-readability `## 크기` · `## 색` · 390 가로 넘침 0 — **표는 카드 안에서 줄바꿈 · 가로 스크롤 상자 0** | RR-1 ~ RR-3 · RR-7 |
| 크기 · 입력 | CLI 새 줄 ≤ 80칸 (되돌림 명령 줄만 밖 · 결정 13) · 보고서는 읽기만 (토글 · 되돌림 버튼 0) | BP-5 · BP-6 · 열린 질문 2 |

## 폭

| 이름 | 값 | 바뀌는 것 |
|---|---|---|
| 보고서 넓음 | 1440 | 컴파일 카드 span 12 · 때 행 칸 셋 (때 · 컴파일 필터 · 컴파일 이유) |
| 보고서 모바일 | 390 | 같은 표 · 구분자 뒤 줄바꿈 · 값 칸 `nowrap` · `때` 열 72px · 진단 값 칸 둘 |
| CLI | 80칸 | 새 줄 ≤ 80 · 되돌림 명령 줄 한 줄 그대로 |

## 화면

| 화면 | 무엇 | 시안 |
|---|---|---|
| 요약 · 머리 옵션 | `--launch --compile speed` (`--compile` 세션에만) | `?state=compile` |
| 요약 · 맥락 `컴파일 상태 (전 → 후)` · `경고` | 위: 기록 칸 (바꾼 기록 · 못 읽은 때) · 아래: `dexstates` 표 · 경고 카드에 `compile_state_changed` 행 (core 문구) | `summary` · `compile` · `end-null` · `legacy` |
| 진단 · `컴파일 상태 slice` | `dexstates` · span 12 · `slice 이름별` 표 위 | `diag` · `diag-noapp` |
| 진단 · `slice 수` | 끝 행 `JIT 컴파일 slice` / `target_process_jit_slices` | `diag` · `diag-noapp` |
| CLI | start 성공 · 실패 · 거부 · stop 되돌림 · 되돌릴 값 없음 · status · `--help` | `v1/cli/blocks.txt` 블록 1 – 6 |

### `dexstates` — 보고서 컴파일 카드

dex 줄(= `path` + `abi`)마다 **머리 행 + 위치 행(같으면 한 번) + 때 행**.

| 행 | 무엇 |
|---|---|
| 머리 행 1 | `path` 원문 (등폭 13px · 칸 전부 · 구분자 뒤 `<wbr>`) |
| 머리 행 2 | 칸 넷을 필드 이름 그대로 — `abi arm64 · primary_abi 예 · secondary_dex 아니오 · public_dex 아니오` (이름 12px `neutral-600` · 값 13px 등폭 `neutral-800` · `예` · `아니오` 는 기존 `bool` · 참 · 거짓이 같은 모양) |
| 때 행 | `바꾸기 전`(`--compile` 세션에만) · `시작` · `끝` — 칸 셋 `때` · `컴파일 필터`/`status` · `컴파일 이유`/`reason` · 값 칸 `nowrap` |
| 위치 행 (같음) | 그 줄이 있는 때의 `location` 이 **글자 그대로 모두 같으면** (null 은 null 끼리 같음 · 추측 · 정규화 0) 머리 행 바로 아래 **한 번** — 한 줄 라벨 `파일 위치 location {원문}` (단어 13px `neutral-700` · 이름 12px 등폭 `neutral-600` · 값 12px 등폭 `neutral-600` · 칸 전부 · 구분자 뒤 `<wbr>`) · null 이면 `값 없음` · 때 행 아래에는 없음 (plan B42 · 검수 #1) |
| 위치 행 (다름) | 하나라도 다르면 지금처럼 **때 행마다 그 아래** `파일 위치`/`location` 원문 (라벨 두 줄 · 12px 등폭 `neutral-600` · 칸 전부) · null 이면 `값 없음` — 다른 칸만 골라 보이지 않는다 (판정 · 차이 표시 0) |

**줄 맞춤 (P1-4)**

| 규칙 | 정함 |
|---|---|
| 맞춤 키 | `path` + `abi` — 같은 키면 한 dex 줄로 묶는다 |
| 행 순서 | 때 순서(바꾸기 전 → 시작 → 끝)로 훑어 **처음 나온 자리** — 기기 순서 그대로 · 끝에만 있는 줄(세션 중 불러온 보조 dex)은 뒤에 |
| 한 때 배열에만 없는 줄 | 그 때 행의 칸 셋 자리에 `줄 없음` (기기가 그 때 찍지 않은 줄 — `null` 이 아니다 · 배지에 안 셈) · 위치 행 없음 · 위치가 같은지는 그 줄이 있는 때끼리만 본다 |
| 한 때 배열이 `null` | 그 때 행을 모든 dex 줄에서 뺀다 (줄마다 되풀이 0) · 기록 칸에 한 행 `바꾸기 전`/`compile_state_before` · `시작`/`compile_state_start` · `끝`/`compile_state_end` → `값 없음` + `_reason_code` · 문장은 행 `title` · 배지에 안 셈 |
| 시작 · 끝 둘 다 `null` (`--compile` 아님) | 표 없음 — 카드 본문에 위 기록 행 둘만 (`값 없음` + 코드 둘) · **배지 1** (카드가 그린 것이 `값 없음` 뿐) |
| 시작 키 없음 (옛 파일) | 카드 본문 `수집 안 함 — target_app.compile_state_start 없음` · **배지 1** |
| `바꾸지 않음` | `compile_state_start` **키가 있고**(값 · null 둘 다) `session.compile` 키가 없을 때 — 기록 칸 `바꾼 기록`/`session.compile` → `바꾸지 않음` · 배지에 안 셈 (결정 15) |
| 바뀜 경고 | 표는 그대로 (차이 칸 · 색 0) — 경고 카드 행이 말한다 (BP-3) |

**진단 `컴파일 상태 slice`** — 같은 종류 · 때 칸 없음. 머리 행 1 = `location` 원문 · 머리 행 2 = `oat 파일 상태`/`status` 값 (진단 `status` 를 여기로 · 고침 1 — 칸 셋이 390 에서 5px 넘쳐 상자 안 스크롤이 됐음) · 값 행 칸 둘 `컴파일 필터`/`filter` · `컴파일 이유`/`reason`. 행 순서 = 원문 순.

| 경우 | 그 자리 · 배지 |
|---|---|
| 배열 `null` | 카드 본문 `값 없음` + `target_process_compile_state_slices_reason_code` (`dalvik_not_recorded` · `compile_state_slice_unparsable` · `process_not_in_trace`) · 문장은 제목 `title` · **배지에 셈** |
| `[]` | 카드 본문 `컴파일 상태 slice 없음` (재 봤더니 0개 · 배지에 안 셈) |
| JIT `null` | `slice 수` 카드의 그 행만 `값 없음` + `target_process_jit_slices_reason_code` · 행 `title` · 배지에 안 셈 (카드에 값이 있음) |
| 대상 앱 없음 | `slice 이름별` 표 · `컴파일 상태 slice` 둘 다 `값 없음` → **진단 배지 2** (plan B30 — 그 탭에서 `수집 안 함` · `값 없음` 을 그린 카드 수 그대로) |

## 상태

report-readability `## 상태` 의 행을 같이 쓴다 (6상태 × 2) · CLI 6블록.

| 상태 | 이 기능에서 보이는 것 | 1440 | 390 |
|---|---|---|---|
| summary | 컴파일 카드 `바꾸지 않음` · 시작 · 끝 같음 · 요약 배지 0 | ✓ | ✓ |
| compile | 옵션 `--compile speed` · 바꾼 기록 셋 · 때 행 셋 · 위치는 줄마다 한 번 (때마다 같음) · 끝에만 있는 보조 dex 한 줄 (`줄 없음` 둘 · 위치 `값 없음`) · 경고 행 · 표식 둘 | ✓ | ✓ |
| end-null | 기록 칸 `끝`/`compile_state_end` → `값 없음` + `dexopt_state_unavailable` · 때 행은 `시작` 만 · 요약 배지 0 | ✓ | ✓ |
| legacy | 카드 `수집 안 함` · 요약 배지 1 | ✓ | ✓ |
| diag | `컴파일 상태 slice` 넷 · `JIT 컴파일 slice` 52 · 카테고리 `am · wm · view · dalvik` · `L*;` 한 행 | ✓ | ✓ |
| diag-noapp | 두 카드 `값 없음` + `process_not_in_trace` · JIT 행 `값 없음` + 코드 · 진단 배지 2 | ✓ | ✓ |

## 조작

없음 — 보고서는 읽기만 (정렬 · 접기 없음 · 행 순서 = 기기 원문 순). CLI 는 옵션 하나 (`--compile <값>`).

## 넘침

| 무엇 | 상한 | 넘치면 |
|---|---|---|
| dex 경로 · `location` | 없음 (~150자 · 문장) | 칸 전부를 쓰는 행 · 구분자 뒤 `<wbr>` · ellipsis 0 |
| dex 줄 수 · 보낸 명령 | 없음 (YouTube 4 · ~60자) | 다 그림 · 접지 않음 · 구분자 뒤 줄바꿈 · 보낸 명령의 깃발 토큰(`-m` · `-f` · `--reset` — 공백으로 나눈 토큰 가운데 `-` 로 시작하는 것)은 토막 안에서 끊지 않음 (`nowrap` · 글자 · 복사 원문 그대로 · plan B40) |
| 값 칸 (`profile-utilization` · `no-dex-code`) | 19자 | `nowrap` — 390 에서 칸 셋(요약) · 둘(진단)이 카드 안에 듦 · 상자 스크롤 0 |
| CLI 되돌림 명령 | 한 줄 (91 · 102칸) | 자르지 않음 · 줄바꿈하지 않음 (결정 13) |

## 색

새 색 없음 — report-readability `## 색` 그대로. 상태 문자열 · 불 값 · 때 · 경고 행 모두 `neutral-800` 값 · `neutral-700` 단어 · `neutral-600` 경로 · 위치 · 필드 이름. 바뀐 칸 · 다른 칸 · 참 · 거짓을 칠하지 않는다.

대비 (surface) — `neutral-800` 10.13 · `neutral-700` 7.57 · `neutral-600` 5.48 · CLI 는 터미널 기본색 (색 0).

## 문구

새 문구의 **정본** (BP-6 · DM-15 · plan B25) — 패키지마다 시험이 양방향 대조. `{…}` = 값 자리. core 줄은 **코드 원문 그대로 받음** (고칠 곳 0 · 고치면 표가 먼저, 코드가 따름).

| 패키지 | 자리 | 문구 | 뜻 | 안 쓰는 말 |
|---|---|---|---|---|
| core | 경고 `compile_state_changed` | `세션 중 base.apk 컴파일 상태가 바뀌었음 — status {a} → {b} · reason {a} → {b} (target_app.compile_state_start · compile_state_end)` | BP-3 · `app/dexopt.ts` | 판정 · `나빠짐` |
| core | 사유 `dexopt_state_section_missing` | `dumpsys package 출력에 Dexopt state 절 없음 — 이 기기 · 안드로이드 버전의 출력 꼴이 다를 수 있음 · 꼴을 추측해 채우지 않음` | BP-2 | `실패` |
| core | 사유 `dexopt_state_package_missing` | `Dexopt state 절에 {package} 줄 없음 — 꼴을 추측해 채우지 않음` | BP-2 | — |
| core | 사유 `dexopt_state_unparsable` (줄 있음) | `Dexopt state 절에 꼴을 모르는 줄 있음 ({line}) — 꼴을 추측해 채우지 않음` | 결정 12 | — |
| core | 사유 `dexopt_state_unparsable` (dex 줄 0) | `Dexopt state 절에 대상 패키지의 dex 줄 없음 — 꼴을 추측해 채우지 않음` | 결정 12 | — |
| core | 사유 `dexopt_state_unavailable` (stop 전) | `아직 stop 하지 않은 세션 — {when} 컴파일 상태를 읽지 않음` | `{when}` = `세션 시작` · `세션 끝` | — |
| core | 사유 `dexopt_state_unavailable` (기록 없음) | `이 run 에 {when} 컴파일 상태 기록 없음 — 그것을 읽기 전의 도구가 멈춘 run` | — | — |
| core | 사유 `dexopt_state_unavailable` (명령 실패) | `{when} dumpsys package 출력을 받지 못함{code} — 기기 연결이 끊겼을 수 있음` | `{code}` = ` (종료 코드 {exit_code})` · 없으면 빈 칸 | — |
| core | 사유 `dalvik_not_recorded` (기록 없음) | `세션 기록에 켠 atrace 카테고리 없음 — dalvik 을 켰는지 모름 · 컴파일 상태 · JIT slice 수 모름` | BP-7 | `0개` |
| core | 사유 `dalvik_not_recorded` (dalvik 빠짐) | `세션 기록의 atrace 카테고리에 dalvik 없음 ({cats}) — 컴파일 상태 · JIT slice 수 모름` | `{cats}` = ` · ` 이음 | — |
| core | 사유 `compile_state_slice_unparsable` | `꼴을 모르는 location= slice 있음 ({name}) — 꼴을 추측해 채우지 않음` | BP-7 | — |
| cli | `start --help` 의 `--compile <값>` 설명 | `기기 컴파일 상태 바꿈 · reset · speed-profile · speed` | 78칸 · `--launch 와만` 은 거부 줄 · README · cli AGENTS 가 말함 (결정 4) | `최적화` · `프로파일 적용` |
| cli | `start` · `status` 컴파일 줄 | `Compile   {value} · base.apk {before} → {after} · {ms} ms` | `[primary-abi]` 줄 전 → 후 `status` | `AOT` · `예열` |
| cli | 되돌림 머리 (`start` · `stop`) | `되돌림 · 실행 뒤 reason = cmdline · 기기가 다시 바꿀 수 있음` | 자동으로 안 되돌림 · 한계 둘 | `복원` |
| cli | 되돌림 명령 (base) | `adb -s {serial} shell cmd package compile -m {status} -f {pkg}` | 호스트 꼴 · 80칸 밖 | — |
| cli | 되돌림 명령 (보조 dex) | `adb -s {serial} shell cmd package compile -m {status} -f --secondary-dex {pkg}` | 같음 | — |
| cli | 보조 dex `status` 서로 다름 | `보조 dex {n}개 · status 서로 다름 · 보조 dex 되돌림 줄 없음` | BP-5 | — |
| cli | 보조 dex `status` 모두 같은데 `-m` 밖 | `보조 dex {n}개 · status {status} · -m 이 받지 않는 값 · 되돌림 줄 없음` | BP-5 · plan B34 #5 — 침묵 안 함 · base 줄과 따로 판단 (base 가 `-m` 밖 · 모름이어도) · 머리 아래면 두 칸 들여 75칸 | `복원` |
| cli | 되돌릴 값이 `-m` 밖 | `되돌림 줄 없음 · 바꾸기 전 base.apk status {status} · -m 이 받지 않는 값` | sdk 36 도움말의 셋 밖 | — |
| cli | 바꾸기 전 `status` null | `되돌림 줄 없음 · 바꾸기 전 base.apk status 모름` | BP-2 | — |
| cli | 실패 머리 (종료 코드 · `Failure`) | `컴파일 실패 · 세션 안 엶 · exit {code}` | run 디렉토리 0 | `오류가 발생` |
| cli | 실패 머리 (한도) | `컴파일 한도 10분 넘음 · 세션 안 엶` | 결정 10 | — |
| cli | 실패 · 보낸 명령 | `보낸 명령  {cmd}` | 원문 그대로 | — |
| cli | 실패 · 상태 줄 | `Compile   {value} · base.apk 바꾸기 전 {before} · 지금 모름` | 실패 뒤 다시 읽지 않음 | — |
| cli | 컴파일 줄 · 실패 상태 줄의 `{before}` · `{after}` 값을 모를 때 | `모름` | 못 읽음 · base 줄을 하나로 못 고름 — `status 모름` · `지금 모름` 과 같은 말 (plan B34 #3) | `—` · `없음` |
| cli | 거부 · `--launch` 없음 | `--compile 은 --launch 와만 · 기기 명령 0` | 결정 8 | — |
| cli | 거부 · 허용 밖 값 | `--compile {value} · 받는 값 reset · speed-profile · speed · 기기 명령 0` | BP-4 | — |
| gui | 머리 `옵션` 칸 꼬리 | `--compile {value}` | `--launch` 뒤 | — |
| gui | 맥락 카드 제목 | `컴파일 상태 (전 → 후)` | 결정 16 | `프로파일` |
| gui | 바꾼 기록 · 단어 줄 | `바꾼 값` · `보낸 명령` · `걸린 시간` | `value` · `command` · `elapsed_ms` | — |
| gui | 바꾼 기록 없음 | `바꾼 기록` → `바꾸지 않음` | 경로 줄 `session.compile` · 결정 15 | `수집 안 함` · `없음` |
| gui | 못 읽은 때 · 단어 줄 | `바꾸기 전` · `시작` · `끝` | 경로 줄 `compile_state_before` · `compile_state_start` · `compile_state_end` | — |
| gui | 표 칸 | `때` · `컴파일 필터` · `컴파일 이유` · `파일 위치` | 경로 줄 — · `status` · `reason` · `location` | `상태` |
| gui | 때 행 | `바꾸기 전` · `시작` · `끝` | `session.compile.compile_state_before` · `target_app.compile_state_start` · `_end` | `이전` · `이후` |
| gui | 머리 행 2 이름 | `abi` · `primary_abi` · `secondary_dex` · `public_dex` | 필드 이름 그대로 (⌘F) | `★` · `보조` 표식 |
| gui | 그 때 없는 줄 | `줄 없음` | 그 때 배열에 그 `path` + `abi` 줄이 없음 | `값 없음` (null 이 아님) |
| gui | 진단 카드 제목 | `컴파일 상태 slice` | `location=…` slice | `프로파일 적용` |
| gui | 진단 표 칸 | `oat 파일 상태` · `컴파일 필터` · `컴파일 이유` | `status` · `filter` · `reason` (결정 14) | `상태` |
| gui | 진단 `[]` | `컴파일 상태 slice 없음` | 재 봤더니 0개 | `값 없음` |
| gui | `slice 수` 새 행 단어 | `JIT 컴파일 slice` | `target_process_jit_slices` | `JIT 많음` |

`check_cli.py` (2026-10-11): **새 줄 24 · 80칸 안 최대 78 · 되돌림 줄 최대 102칸 · 걸림 0** · `--break` 35 안 걸림 0 · core 줄 11 · DM-15 규칙 걸림 0.

## 기능 문서 항목

| 항목 ID | 화면 · 상태 |
|---|---|
| BP-5 | CLI 1 · 2 · 3 · 4 |
| BP-6 | CLI 1 · 5 · 6 · `## 문구` |
| BP-8 | 보고서 summary · compile · end-null · legacy · diag · diag-noapp |
| BP-2 · BP-3 | end-null (이유 코드) · compile (경고 행) |
| DM-3 · DM-7 | diag (카테고리 넷 · `L*;` 한 행 · ART 칸) |

## 정한 것

⑨ 승격 (2026-10-11 · run baseline-profile) — 디자이너 intent 4 `사람: 예` (bp-design · bp-gui-report) 와 plan 화면 결정. plan B28 이 디자이너 기본값을 받았고 검토 · 검수가 건 것만 고쳤다.

| # | 날짜 · run | 결정 | 확인 거리 |
|---|---|---|---|
| 1 | 2026-10-11 · baseline-profile | 후보 1 (후보 하나) · 자리 = 맥락 섹션 새 카드 `컴파일 상태 (전 → 후)` span 12 + 머리 `옵션` 칸 `--compile` · 진단 탭 카드 하나 + `slice 수` 행 하나 (plan B16 · 결정 16) | `## 화면` |
| 2 | 2026-10-11 · baseline-profile | dex 표 = 머리 행 둘(경로 · 필드 넷) + 때 행 칸 셋 + 위치 행 · 값 칸 `nowrap` (bp-design 4-9) | `compile-390` |
| 3 | 2026-10-11 · baseline-profile | 머리 행 2 = 필드 이름 그대로 `abi` · `primary_abi` · `secondary_dex` · `public_dex` + 값 (`예` · `아니오` 같은 모양) (bp-design 4-14) | `BP-8 새 필드 전부 보임` |
| 4 | 2026-10-11 · baseline-profile | 위치 — 때마다 글자 그대로 같으면 머리 행 아래 한 번 · 한 줄 라벨 · 하나라도 다르면 때 행마다 (plan B42 · 검수 #1) | `B42 …` 시험 셋 · 사진 `01-compile` |
| 5 | 2026-10-11 · baseline-profile | 보낸 명령 — 깃발 토큰(`-` 로 시작)은 통째 `nowrap` · 나머지 구분자 뒤 `<wbr>` · 복사 원문 그대로 (plan B40 · bp-gui-report 4-5) | 사진 `05-compile-390` (`-m speed -f` 붙음) |
| 6 | 2026-10-11 · baseline-profile | 낱말 `status` 두 뜻 — 앱 = `컴파일 필터` · 진단 slice = `oat 파일 상태` (bp-design 4-10 · 결정 14) | `## 문구` |
| 7 | 2026-10-11 · baseline-profile | 그 때 배열에 없는 줄 = `줄 없음` (null 아님 · 배지 밖) (bp-design 4-15) | `compile` 사진 |
| 8 | 2026-10-11 · baseline-profile | 한 때 배열 null = 그 때 행을 줄마다 빼고 기록 칸 한 행 `값 없음` + 코드 · 둘 다 null 이면 카드 본문만 (배지 1) (bp-design 4-16) | `end-null` 사진 |
| 9 | 2026-10-11 · baseline-profile | 진단 slice 표 = `oat 파일 상태` 를 머리 행 2 로 · 값 칸 둘 · 가로 스크롤 상자 0 (bp-design 4-17) | `diag-390` · 카드 안 스크롤 0 |
| 10 | 2026-10-11 · baseline-profile | 진단 대상 앱 없음 = 진단 배지 2 (그린 미수집 카드 수 그대로 · plan B30) | `diag-noapp` 레일 |
| 11 | 2026-10-11 · baseline-profile | CLI 줄 꼴 `Compile   {value} · base.apk {before} → {after} · {ms} ms` · 되돌림 머리 + 두 칸 들여 쓴 명령 · `--help` 에서 `--launch 와만` 뺌 (bp-design 4-11 · 디자인 검토 #10) | `check_cli.py` |
| 12 | 2026-10-11 · baseline-profile | 상태 문자열 · 불 값 · 바뀐 칸을 칠하지 않음 — 같은 색 · 같은 굵기 · 원문 순 (BP-8 · 결정 6 그대로) | `B42 …` · 검수 #2 시험 |

### 결정

| # | 결정 | 왜 | 확인 거리 |
|---|---|---|---|
| 1 | dex 표 = 머리 행 둘(경로 · 필드 넷) + 때 행(칸 셋) + 위치 행 | 칸 9 ~ 12 를 펴면 390 에서 토막 안 끊김 (시안 1차) | `compile-390` |
| 2 | 되돌림 명령 줄은 두 칸 들여 · 앞에 라벨 없음 | 줄째 복사해도 돈다 | `check_cli.py` |
| 3 | 실패 뒤 상태 `지금 모름` (다시 안 읽음) | 실패 경로 기기 명령 0 | CLI 2 |
| 4 | `--help` 에서 `--launch 와만` 생략 (디자인 검토 #10 받아들임) — **bp-cli 는 README 「명령 전체」 `--compile` 행 · `packages/cli/AGENTS.md` 에 `--launch` 와만을 적는다** (숨김 아님) · 넣으면 89칸 | 80칸 | bp-cli 검수 |
| 5 | 진단 대상 앱 없음 배지 2 (plan B30) — RR-8 문장 「진단 표 null 이면 배지 1」 은 ⑨ 승격 때 기획이 고침 | 새 카드도 `값 없음` 블록 | `diag-noapp` 레일 |

## 확인

| 시안 | 골든 | 시험 이름 | 실화면 결과 |
|---|---|---|---|
| 보고서 6상태 × 1440 · 390 | 없음 | `shoot.mjs` · `check_shots.py` | `labs/report-readability-design/v1/shots/` · `README.md` |
| CLI 6블록 | 없음 | `check_cli.py` (`--break`) | `## 문구` 끝 줄 |
| 구현 bp-gui-report (`dexstates` · 머리 `--compile` · 진단 ART 칸) 7상태 + device × 1440 · 390 | 없음 | `report.test.ts` (`BP-8 …` · `B30 …` · DM-13 블록 수 9) · `report-copy.test.ts` (`BP-6 문구 표 ↔ 코드 (gui)`) | 2026-10-11 · `samples/` → `perftracker report --file` 실렌더 · **16/16: 12px 미만 0% · 4.5:1 미만 0% · 390 넘침 0 · 카드 안 가로 스크롤 0** · 레일 summary 0 · missing 요약 4 · compile 0 · end-null 0 · legacy 요약 1 · diag 0 · diag-noapp 진단 2 (시안과 같음) · 검수 고침 4d578ea 뒤 390 `보낸 명령` 은 `-m speed -f` 가 붙음 (B40) · 위치 한 번 (B42) — 사진은 Claude Design `design_handoff_baseline-profile/screenshots/` |
| **RR-9 실기기** YouTube 평소 · 진단 (SM-S901N · sdk 36 · ffca69c) | 없음 | `measure.js` · `check_shots.py` `problems()` | 2026-10-11 · 요약 컴파일 카드 dex 4줄 · `바꾸지 않음` · 위치 한 번 · 진단 `컴파일 상태 slice` 6줄 · `JIT 컴파일 slice` 41 · 카테고리 `am · wm · view · dalvik` · 10/10 걸림 0 (report-readability `## 확인`) — `--compile` 세션이 아니라 보낸 명령 · 바꾼 기록 · 바뀜 경고는 실기기에서 못 봄 |

시험은 패키지가 한다 — `BP-6 문구 표 ↔ 코드` (core · cli · gui) · `BP-5 되돌림 줄 — start · stop · 호스트 꼴` · `BP-8 새 필드 전부 보임`.

## HANDOFF 와 어긋남

없음 — bp-gui-report · bp-cli 가 옮김 (`docs/design/report/HANDOFF.md` 블록 9종 · 머리 `--compile` · 맥락 카드 · 진단 카드 다섯 · B40 · B42 / README 「명령 전체」 · `packages/cli/AGENTS.md` 의 `--compile` · `--launch` 와만). 단위별 옛 표는 git 이력 (ffca69c).

## 열린 질문

| # | 무엇 | 지금 기본값 | 날짜 · run |
|---|---|---|---|
| 1 | labs 표본 · CLI 시안의 실기기 serial (`labs/baseline-profile-design/v1/gen_cli.py` · `cli/blocks.txt` · report-readability `v1/samples/`) — 루트 AGENTS 「합성 픽스처만」 이 labs 를 말하지 않음 | 고치지 않음 · AGENTS 예외 한 줄은 기획 (메인) | 2026-10-11 · baseline-profile (디자인 검토 #12) |
| 2 | 보낸 명령 · 바꾼 기록 · 바뀜 경고를 실기기 보고서로 본 적 없음 — RR-9 두 세션은 `--compile` 아님 · BP-9 는 CLI · 스펙만 | 표본 `compile` 실렌더로 대신 | 2026-10-11 · baseline-profile |
| 3 | 390 카드 사진에 고정 표식 줄(`마커`)이 겹침 — 카드만 찍을 때(`05-compile-390`) 생기는 사진 꾸밈 · 화면 결함 아님 | 그대로 | 2026-10-11 · baseline-profile |

## 검토

| 날짜 · run | 검토 | 누가 | 판정 | 왕복 |
|---|---|---|---|---|
| 2026-10-11 · baseline-profile | 실현성 (4985424) · 재검토 (fa572d9) | 디자인 · 개발 | 조건부 10 · 12 → 조건부 1 | 1 · 2 |
| 2026-10-11 · baseline-profile | 부합 · 구현 가능 (b8c2490) | 디자인 | 조건부 11 → 고침 1 | 1 |

## 바뀐 기록

| 날짜 | run | 무엇이 |
|---|---|---|
| 2026-10-11 | baseline-profile | 처음 — 보고서 카드 · 진단 ART 칸 · `dexstates` · CLI 6블록 · `## 문구` 정본 (cli 14 · gui 12) |
| 2026-10-11 | baseline-profile | 고침 1 (디자인 검토 #1 ~ 5 · 7 · 10 · 11) — core 이름 · 필드 넷 · 줄 맞춤 · 배지 셈 · core 문구 11 · 진단 값 칸 둘 |
| 2026-10-11 | baseline-profile | bp-gui-report 검수 왕복 1 · plan B40 · B42 — 위치 행: 때마다 글자 그대로 같으면 머리 행 아래 한 번 + 한 줄 라벨 · 다르면 때 행마다 그대로 · 보낸 명령 깃발 토큰 안 줄바꿈 0 |
| 2026-10-11 | baseline-profile | bp-gui-report 구현 — `## HANDOFF 와 어긋남` report §2 · §3 넷을 HANDOFF 에 옮김 (블록 9종 · 머리 `--compile` · 맥락 카드 · 진단 카드 다섯) · `## 확인` 한 줄 |
| 2026-10-11 | baseline-profile | bp-cli 검수 왕복 1 · plan B34 — cli 문구 둘 더함: 보조 dex `status` 모두 같은데 `-m` 밖 사실 줄 (#5 · 침묵 안 함) · 값 모름 낱말 `모름` (#3) |
| 2026-10-11 | baseline-profile | ⑨ 승격 — `## 정한 것` 12 (intent 4 사람 예 · plan B16 · B28 · B30 · B40 · B42) · 옛 `## 정한 것` 표 → `### 결정` · `## 시안` 고른 것 1 · 시안 고침 5 · 핸드오프 사진 = 구현 실렌더 6장 · `## 확인` 390 보낸 명령 줄 고침 · RR-9 실기기 · `## HANDOFF 와 어긋남` 없음 · `## 열린 질문` 셋 |
