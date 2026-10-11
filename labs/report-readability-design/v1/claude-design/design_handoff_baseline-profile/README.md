# 핸드오프 — Baseline Profile · 컴파일 상태 (v1 · 고침 1)

시안: `Report Readability.dc.html` 의 `summary` · `compile` · `end-null` · `legacy` · `diag` · `diag-noapp` 상태. 정본: 레포 `docs/design/baseline-profile.md`.
CLI 출력 6블록: `cli-blocks.txt` (레포 `labs/baseline-profile-design/v1/` 생성기 · 검사). 사진: `screenshots/` · 레포 `labs/report-readability-design/v1/shots/`.

## 새 블록 `dexstates`
- **요약 · 맥락 끝** `컴파일 상태 (전 → 후)` · span 12.
  - 위: 바꾼 기록. compile 세션 = `바꾼 값`/`value` · `보낸 명령`/`command`(원문 등폭) · `걸린 시간`/`elapsed_ms`. 그 밖 새 세션 = `바꾼 기록`/`session.compile` → `바꾸지 않음` (배지에 안 셈).
  - 아래: dex 줄마다 **머리 행**(dex 경로 13px 등폭 + 그 아래 `arm64 · primary-abi`) → **때 행**(`바꾸기 전`(compile 만) · `시작` · `끝`) 칸 셋 `때` · `컴파일 필터`/`status` · `컴파일 이유`/`reason` (값 칸 `nowrap`) → **위치 행** `파일 위치`/`location` 12px 등폭. 순서 = 기기 원문 순.
  - end-null: 끝 행 = `값 없음` + `compile_state_not_read`. legacy: 카드 본문 `수집 안 함 — target_app.compile_state_start 없음` (배지에 셈).
  - compile 상태 `경고` 카드에 `compile_state_changed` 행 (기존 경고 카드).
- **진단 탭** `컴파일 상태 slice` · span 12 — `slice 이름별` 위. 머리 행 = `location` 원문, 칸 `oat 파일 상태`/`status` · `컴파일 필터`/`filter` · `컴파일 이유`/`reason` (두 `status` 를 라벨로 가름). diag-noapp: `값 없음` + `process_not_in_trace`.
- `slice 수` 끝 행 `JIT 컴파일 slice`/`target_process_jit_slices`. 카테고리 값 `am · wm · view · dalvik`.
- 머리 `옵션` 칸: `--launch --compile speed` (compile 세션에만).

## 판정 금지
`speed-profile` · `verify` · `speed` · `up-to-date` … 상태 문자열은 전부 같은 색 · 같은 굵기 · 등폭 · 원문 순. 바뀐 칸을 칠하지 않는다 — 바뀜은 경고 행이 말한다. 컴파일 상태는 요약 타일에 없다 (지표 아님).

## 필드 (자리표시 — 정본은 레포 README)
`session.options.compile` · `session.compile{value,command,before,elapsed_ms}` · `target_app.compile_state_start|end{dex[{path,abi,status,reason,location,primary_abi}]}` · `target_app.compile_state_end_reason_code` · `diagnose.target_process_compile_states[{location,status,filter,reason}]` · `diagnose.target_process_jit_slices` (+ `_reason_code`).
