# 컴파일 상태 · 베이스라인 프로파일 — 디자인

| 항목 | 값 |
|---|---|
| 기능 | baseline-profile |
| 기능 문서 | docs/spec/baseline-profile.md (fa572d9) |
| 등급 | 화면 (보고서 카드 · 진단 칸 · CLI 줄) |
| 마지막 변경 | 2026-10-11 · 처음 — 보고서 컴파일 카드 · 진단 ART 칸 · CLI 6블록 · `## 문구` 정본 |

보고서 자리는 **한 곳씩** — 요약 탭 맥락 섹션 카드 `컴파일 상태 (전 → 후)` 하나(전폭) · 머리 `옵션` 칸 · 진단 탭 카드 하나 + `slice 수` 행 하나 (결정 16).
글자 크기 · 색 · 라벨 두 줄 규칙은 `docs/design/report-readability.md` 를 그대로 따른다 — 시안도 같은 파일의 상태다.

## 시안

| 차수 | 후보 | 고른 것 | 누가 | 로컬 폴더 | 시안 생성기 | 검사 명령 | Claude Design 파일 |
|---|---|---|---|---|---|---|---|
| 1 · 보고서 | 1 | | | `labs/report-readability-design/v1/shots/` (`compile` · `end-null` · `legacy` · `summary` · `diag` · `diag-noapp`) | Claude Design (`report-readability-design/v1/brief-claude-design.md`) | `python3 labs/report-readability-design/v1/check_shots.py` | [성능 측정 CLI GUI 도구](https://claude.ai/design/p/9ee5c8ab-33b9-4586-ae73-69f9e53ecd42) · `Report Readability.dc.html` · `design_handoff_baseline-profile/` |
| 1 · CLI | 1 | | | `labs/baseline-profile-design/v1/cli/` | `gen_cli.py` → `cli/blocks.txt` | `python3 labs/baseline-profile-design/v1/check_cli.py` (깨 봄 `--break`) | `design_handoff_baseline-profile/cli-blocks.txt` |
| 1 · 문구 | — | — | 디자이너 | 이 문서 `## 문구` | 없음 | `check_cli.py` (cli 줄 단어형) | 없음 |

후보 1 — 자리는 결정 16 · 모양은 규칙(같은 색 · 같은 굵기 · 원문 순)으로 닫힌다.

## 제약

| 종류 | 제약 | 출처 |
|---|---|---|
| 데이터 | 컴파일 상태 = dex 줄 배열 (경로 · ABI · `status` · `reason` · `location` · primary ABI) — YouTube 4줄(base 1 + 보조 3) · 경로 ~150자 · `location` 이 문장(공백) 이거나 `error` | feas-dev 표면 제약 · research A1 · F3 · C-state1 |
| 데이터 | 바꾼 기록 = 값 · 보낸 명령 원문 · 바꾸기 전 상태 · ms (실측 200 · 18,640 · 67,500) · `--compile` 세션에만 | BP-4 |
| 데이터 | 진단 ART — 컴파일 상태 slice (중복 없이 수 개 · `location` · `status` · `filter` · `reason`) · JIT slice 수 0 ~ 297 · dalvik 안 켠 원본 · 대상 앱 없음은 `null` + 코드 | BP-7 · research B · C |
| 데이터 | **필드 이름은 자리표시** — 시안의 `target_app.compile_state_start` · `_end` · `session.compile` · `diagnose.target_process_compile_states` · `target_process_jit_slices` · 코드 `compile_state_not_read` · `compile_state_changed` 는 README 가 정한다 (bp-core-state · bp-core-art · bp-core-compile) | brief 정하지 않은 것 7 · 17 |
| 그릴 것 | 지금 블록 종류 8개 어디에도 안 맞음 (`pairs` 칸 둘 · `delta` 행마다 값 하나) → **새 종류 `dexstates` 하나**로 dex 표 · 진단 slice 목록 둘 다 · HANDOFF §2 블록 수 9 · 블록 수 시험 갱신 | feas-design #3 · brief 정하지 않은 것 13 |
| 그릴 것 | 상태 문자열은 등폭 · 같은 색 · 같은 굵기 · 행 순서 = 기기 원문 순 · ✓ · 아이콘 · 강조 0 · 타일에 안 올림 (지표 아님) | BP-8 · 결정 6 · DM-15 |
| 그릴 것 | `status` 두 뜻을 라벨로 가름 — 앱 컴파일 상태의 `status` = 컴파일 필터 · 진단 slice 의 `status` = oat 파일 상태 (`filter` 칸이 컴파일 필터) | 결정 14 |
| 크기 | 보고서 글자 바닥 · 층 · 색은 report-readability `## 크기` · `## 색` · 390 가로 넘침 0 — 표는 카드 안에서 줄바꿈 (가로 스크롤 상자 없음) | RR-1 ~ RR-3 · RR-7 |
| 크기 | CLI 새 줄 ≤ 80칸 — 되돌림 명령 줄만 밖 (91 · 102칸 · 자르지 않음 · 결정 13) | BP-5 · BP-6 |
| 입력 | 보고서는 읽기만 — `--compile` 토글 · 되돌림 버튼 없음 (기기 영구 변경을 클릭에 두지 않음) | 안 하는 것 · 열린 질문 2 |

## 폭

| 이름 | 값 | 바뀌는 것 |
|---|---|---|
| 보고서 넓음 | 1440 | 컴파일 카드 span 12 · 표 칸 셋 (때 · 컴파일 필터 · 이유) + dex 머리 행(경로 · ABI) · 파일 위치 행 |
| 보고서 모바일 | 390 | 같은 표 — 경로 · 위치는 구분자 뒤 줄바꿈 · 칸 셋은 `nowrap` 짧은 값 (`profile-utilization` 19자 · `때` 열 72px) |
| CLI | 80칸 | 새 줄 ≤ 80 · 되돌림 명령 줄 한 줄 그대로 |

## 화면

| 화면 | 무엇 | 시안 |
|---|---|---|
| 요약 · 머리 옵션 | `--launch --compile speed` (`--compile` 세션에만) | `?state=compile` |
| 요약 · 맥락 `컴파일 상태 (전 → 후)` | 위: 바꾼 기록 줄 셋(바꾼 값 · 보낸 명령 · 걸린 시간) 또는 `바꾸지 않음` 한 줄 · 아래: `dexstates` 표 | `summary` · `compile` · `end-null` · `legacy` |
| 요약 · 맥락 `경고` | 바뀜 경고 한 행 (code · message — 기존 경고 카드 그대로) | `compile` |
| 진단 · `컴파일 상태 slice` 카드 | `dexstates` 표 (위치 머리 행 + 칸 셋) · span 12 · `slice 이름별` 표 위 | `diag` · `diag-noapp` |
| 진단 · `slice 수` 카드 | 행 하나 더 — `JIT 컴파일 slice` / 경로 줄 | `diag` · `diag-noapp` |
| CLI | start 성공 · 실패 · 거부 · stop 되돌림 · 되돌릴 값 없음 · status · `--help` | `v1/cli/blocks.txt` 블록 1 – 6 |

### `dexstates` 표 — 보고서 컴파일 카드

dex 줄마다 **머리 행 하나 + 때 행 둘 · 셋**. 머리 행 = dex 경로 (등폭 13px · 칸 전부 · 구분자 뒤 줄바꿈) + 그 아래 ABI 한 줄 `arm64 · primary-abi` (ABI 는 때가 아니라 dex 줄의 사실 · 고침 1). 때 행 = `바꾸기 전`(`--compile` 세션에만) · `시작` · `끝` — 기기 원문 순 그대로 · 같은 색 · 같은 굵기 · 값 칸 `nowrap` (`profile-utilization` 이 토막 안에서 끊기지 않게).

| 칸 | 단어 줄 / 경로 줄 | 값 |
|---|---|---|
| 때 | `때` / — | `바꾸기 전` · `시작` · `끝` |
| (머리 행) ABI | 단어 줄 없음 — 값만 | `arm64` · primary 면 `arm64 · primary-abi` (글자만 · 표식 0) |
| 컴파일 필터 | `컴파일 필터` / `status` | `speed-profile` · `verify` … (원문) |
| 이유 | `컴파일 이유` / `reason` | `profile-utilization` · `cmdline` … (원문) |
| 파일 위치 | `파일 위치` / `location` | 때 행 **아래 행**에 칸 전부 (12px 등폭 `neutral-600` · 문장 · `error` 그대로) |

| 경우 | 그 자리 |
|---|---|
| 시작 · 끝 `null` | 그 때 행의 칸 셋 대신 `값 없음` + 코드 (`.rp-none-code`) · 문장은 행 `title` |
| 바꾼 기록 키 없음 · 시작 상태 있음 (새 세션) | 위 줄 `바꾼 기록` / `session.compile` → `바꾸지 않음` — 배지에 안 셈 (결정 15) |
| 시작 상태 키 없음 (옛 파일) | 카드 본문 `수집 안 함 — target_app.compile_state_start 없음` · 배지에 셈 |
| 바뀜 경고 | 표는 그대로 (차이 칸 · 색 0) — 경고 카드 행이 사실을 말함 (BP-3) |

진단 카드 `컴파일 상태 slice` 는 같은 종류 — 머리 행 = `location` 원문, 칸 셋 = `oat 파일 상태` / `status` · `컴파일 필터` / `filter` · `컴파일 이유` / `reason`. 때 칸 없음. `null` 이면 카드 본문 `값 없음` + 코드.

## 상태

보고서 상태는 report-readability `## 상태` 표의 행을 같이 쓴다 (16장 중 이 기능 몫 6상태 × 2 = 12장). CLI 6블록.

| 상태 | 이 기능에서 보이는 것 | 1440 | 390 |
|---|---|---|---|
| summary | 컴파일 카드 `바꾸지 않음` · 시작 · 끝 같음 · 요약 배지 0 | ✓ | ✓ |
| compile | 옵션 `--compile speed` · 바꾼 기록 셋 · 때 행 셋 · 경고 행 | ✓ | ✓ |
| end-null | 끝 행 `값 없음` + `compile_state_not_read` | ✓ | ✓ |
| legacy | 카드 `수집 안 함` · 요약 배지 1 | ✓ | ✓ |
| diag | `컴파일 상태 slice` 넷 · `JIT 컴파일 slice` 52 · 카테고리 `am · wm · view · dalvik` · `L*;` 한 행 | ✓ | ✓ |
| diag-noapp | 두 칸 `값 없음` + `process_not_in_trace` | ✓ | ✓ |

## 조작

없음 — 보고서는 읽기만 (표 정렬 · 접기 없음 · 행 순서 = 기기 원문 순). CLI 는 명령 · 옵션 하나 (`--compile <값>`).

## 넘침

| 무엇 | 상한 | 넘치면 |
|---|---|---|
| dex 경로 · `location` | 없음 (~150자 · 문장) | 칸 전부를 쓰는 행 · 구분자 뒤 `<wbr>` · ellipsis 0 |
| dex 줄 수 | 없음 (YouTube 4) | 다 그림 — 접지 않음 |
| 보낸 명령 원문 | 없음 (~60자) | 등폭 · 구분자 뒤 줄바꿈 |
| CLI 되돌림 명령 | 한 줄 (91 · 102칸) | 자르지 않음 · 줄바꿈하지 않음 — 터미널이 접음 (결정 13) |

## 색

새 색 없음 — report-readability `## 색` 그대로. 상태 문자열 · 때 · 경고 행 모두 `neutral-800` 값 · `neutral-700` 단어 · `neutral-600` 경로 · 위치 줄. 바뀐 칸 · 다른 칸을 칠하지 않는다.

| 뜻 | 토큰 | 고정색 | 구별 | ansi 겹침 | 대비 |
|---|---|---|---|---|---|
| 상태 값 · dex 경로 | `neutral-800` | 없음 | 전 행 같음 | — | 10.13 (surface) |
| 때 · 라벨 단어 | `neutral-700` | 없음 | — | — | 7.57 |
| 위치 줄 · 경로 줄 · 코드 | `neutral-600` | 없음 | — | — | 5.48 |
| CLI | 터미널 기본색 | 없음 | 색 0 | — | 터미널 몫 |

## 문구

새 문구의 **정본** (BP-6 · DM-15 단어형) — 패키지마다 시험이 자기 줄과 코드를 양방향 대조. `{…}` = 값 자리. 필드 경로 줄은 README 이름(자리표시).

| 패키지 | 자리 | 문구 | 뜻 | 안 쓰는 말 |
|---|---|---|---|---|
| cli | `start --help` 의 `--compile <값>` 설명 | `기기 컴파일 상태 바꿈 · reset · speed-profile · speed` | 옵션 · 받는 값 (78칸) | `최적화` · `프로파일 적용` |
| cli | `start` · `status` 컴파일 줄 | `Compile   {value} · base.apk {before} → {after} · {ms} ms` | 바꾼 값 · `[primary-abi]` 줄 전 → 후 `status` · 걸린 ms | `AOT` · `예열` |
| cli | 되돌림 머리 (`start` · `stop`) | `되돌림 · 실행 뒤 reason = cmdline · 기기가 다시 바꿀 수 있음` | 자동으로 안 되돌림 · 한계 둘 (결정 4) | `복원` · `원래대로` |
| cli | 되돌림 명령 (base) | `adb -s {serial} shell cmd package compile -m {status} -f {pkg}` | 호스트 꼴 · 80칸 밖 (결정 13) | — |
| cli | 되돌림 명령 (보조 dex · 같은 `status`) | `adb -s {serial} shell cmd package compile -m {status} -f --secondary-dex {pkg}` | 같음 | — |
| cli | 보조 dex `status` 서로 다름 | `보조 dex {n}개 · status 서로 다름 · 보조 dex 되돌림 줄 없음` | BP-5 그 사실 한 줄 | — |
| cli | 되돌릴 값이 `-m` 밖 | `되돌림 줄 없음 · 바꾸기 전 base.apk status {status} · -m 이 받지 않는 값` | sdk 36 도움말의 셋 밖 | — |
| cli | 바꾸기 전 `status` null | `되돌림 줄 없음 · 바꾸기 전 base.apk status 모름` | BP-2 null | — |
| cli | 실패 머리 (종료 코드 · `Failure`) | `컴파일 실패 · 세션 안 엶 · exit {code}` | 세션 안 엶 · run 디렉토리 0 | `오류가 발생` |
| cli | 실패 머리 (한도) | `컴파일 한도 10분 넘음 · 세션 안 엶` | 결정 10 | — |
| cli | 실패 · 보낸 명령 | `보낸 명령  {cmd}` | 원문 그대로 | — |
| cli | 실패 · 상태 줄 | `Compile   {value} · base.apk 바꾸기 전 {before} · 지금 모름` | 실패 뒤 상태는 읽지 않음 | — |
| cli | 거부 · `--launch` 없음 | `--compile 은 --launch 와만 · 기기 명령 0` | 결정 8 | — |
| cli | 거부 · 허용 밖 값 | `--compile {value} · 받는 값 reset · speed-profile · speed · 기기 명령 0` | BP-4 | — |
| gui | 머리 `옵션` 칸 꼬리 | `--compile {value}` | `--compile` 세션에만 · `--launch` 뒤 | — |
| gui | 맥락 카드 제목 | `컴파일 상태 (전 → 후)` | 결정 16 | `프로파일` |
| gui | 바꾼 기록 · 단어 줄 | `바꾼 값` · `보낸 명령` · `걸린 시간` | `session.compile` 의 `value` · `command` · `elapsed_ms` | — |
| gui | 바꾼 기록 없음 | `바꾸지 않음` | `--compile` 없는 새 세션 (결정 15) | `수집 안 함` · `없음` |
| gui | 바꾼 기록 · 단어 줄 (없음 행) | `바꾼 기록` | 경로 줄 `session.compile` | — |
| gui | 표 칸 | `때` · `컴파일 필터` · `컴파일 이유` · `파일 위치` | 경로 줄 — · `status` · `reason` · `location` (ABI 는 머리 행 값만) | `상태` (두 뜻이 섞임) |
| gui | 때 행 | `바꾸기 전` · `시작` · `끝` | `before` · `compile_state_start` · `_end` | `이전` · `이후` |
| gui | ABI 꼬리 | `primary-abi` | 기기 원문 `[primary-abi]` | `★` · 굵게 |
| gui | 진단 카드 제목 | `컴파일 상태 slice` | 대상 앱 프로세스의 `location=…` slice | `프로파일 적용` |
| gui | 진단 표 칸 | `oat 파일 상태` · `컴파일 필터` · `컴파일 이유` | 경로 줄 `status` · `filter` · `reason` (결정 14) | `상태` |
| gui | `slice 수` 새 행 단어 | `JIT 컴파일 slice` | 경로 줄 `target_process_jit_slices` (자리표시) | `JIT 많음` |
| gui | 진단 `기록 범위` 값 | `am · wm · view · dalvik` | DM-3 — 값이지 문구 아님 (기존 `dots` 포맷) | — |

`check_cli.py` (2026-10-11): **새 줄 24 · 80칸 안 최대 78 · 되돌림 줄 최대 102칸 · 걸림 0** · `--break` 표본 35 안 걸림 0.

## 기능 문서 항목

| 항목 ID | 화면 · 상태 |
|---|---|
| BP-5 | CLI 1 · 2 · 3 · 4 |
| BP-6 | CLI 1 · 5 · 6 · `## 문구` cli 줄 |
| BP-8 | 보고서 summary · compile · end-null · legacy · diag · diag-noapp |
| BP-3 | 보고서 compile (경고 행) |
| DM-3 · DM-7 | 보고서 diag (카테고리 넷 · `L*;` 한 행 · ART 칸) |

## 정한 것

비어 있다 — ⑨ 승격 때 온다. 이번 차수의 선택은 아래.

### 결정 (이 차수)

| # | 결정 | 왜 | 확인 거리 |
|---|---|---|---|
| 1 | dex 표 = dex 머리 행(경로 · ABI) + 때 행(칸 셋) + 위치 행 — 행 하나에 때 × 칸을 펴지 않는다 · ABI 는 머리 행 (시안 1차에서 칸 넷이면 390 에서 `primary- / abi` · `utilizatio / n` 로 끊김 → 고침 1) | 펴면 칸 9 ~ 12 · 위치 150자가 390 에서 칸마다 줄바꿈 | `compile-390` 사진 |
| 2 | 되돌림 명령 줄은 앞 두 칸 들여 쓰고 머리 줄 아래에 — 명령 앞에 라벨을 붙이지 않음 | 줄 전체를 복사해도 그대로 돈다 (앞 공백은 셸이 무시) | `check_cli.py` 호스트 꼴 |
| 3 | 실패 뒤 상태는 다시 읽지 않고 `지금 모름` | 실패 경로에 기기 명령을 더하지 않음 (BP-4 목록) | CLI 2 |
| 4 | `--help` 설명에 `--launch 와만` 을 빼고 거부 줄이 말함 | 80칸 (100칸 → 78칸) | CLI 6 |

## 확인

| 시안 | 골든 | 시험 이름 | 실화면 결과 |
|---|---|---|---|
| 보고서 6상태 × 1440 · 390 | 골든 없음 | playwright 사진 · report-readability `check_shots.py` | `labs/report-readability-design/v1/shots/` |
| CLI 6블록 | 없음 | `check_cli.py` (깨 봄 `--break` → 걸림) | 위 `## 문구` 끝 줄 |

시험은 패키지가 한다 — `BP-6 문구 표 ↔ 코드` (cli · gui) · `BP-5 되돌림 줄 — start · stop · 호스트 꼴` · `BP-8 새 필드 전부 보임`.

## HANDOFF 와 어긋남

| 문서 · 절 | 지금 HANDOFF | 이 기능 뒤 |
|---|---|---|
| report §2 블록 | 8종 | 9 — `dexstates` (dex 머리 행 · 때 행 · 위치 행) |
| report §3 헤더 메타 | 옵션 `--launch` 또는 `attach` | + `--compile {value}` (`--compile` 세션에만) |
| report §3 요약 탭 · 맥락 | 온도 · 스로틀 · 기기 상태 · 네트워크 · 경고 · 측정 비용 | + `컴파일 상태 (전 → 후)` span 12 |
| report §3 진단 탭 | 카드 넷 | 다섯 — `컴파일 상태 slice` · `slice 수` 에 JIT 행 · 카테고리 넷 |

## 검토

| 날짜 · run | 검토 | 누가 | 판정 | 왕복 |
|---|---|---|---|---|
| 2026-10-11 · baseline-profile | 실현성 (4985424) | 디자인 · 개발 | 조건부 10 · 조건부 12 | 1 |
| 2026-10-11 · baseline-profile | 재검토 (fa572d9) | 개발 · 디자인 | 조건부 1 | 2 |

## 바뀐 기록

| 날짜 | run | 무엇이 |
|---|---|---|
| 2026-10-11 | baseline-profile | 처음 — 보고서 카드 · 진단 ART 칸 · `dexstates` · CLI 6블록 · `## 문구` 정본 (cli 14 · gui 12) |
