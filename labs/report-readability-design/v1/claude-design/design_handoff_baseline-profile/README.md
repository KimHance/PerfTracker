# 핸드오프 — Baseline Profile · 컴파일 상태 (v1 · 고침 1)

시안: `Report Readability.dc.html` 의 `summary` · `compile` · `end-null` · `legacy` · `diag` · `diag-noapp` 상태. 정본: 레포 `docs/design/baseline-profile.md`.
CLI 출력 6블록: `cli-blocks.txt` (레포 `labs/baseline-profile-design/v1/` 생성기 · 검사). 사진: `screenshots/` · 레포 `labs/report-readability-design/v1/shots/`.

## 새 블록 `dexstates`
- **요약 · 맥락 끝** `컴파일 상태 (전 → 후)` · span 12.
  - 위 기록 칸: (compile) `바꾼 값`/`value` · `보낸 명령`/`command`(원문 등폭) · `걸린 시간`/`elapsed_ms` / (그 밖) `바꾼 기록`/`session.compile` → `바꾸지 않음` — 그다음 못 읽은 때 행. 예: end-null `끝`/`compile_state_end` → `값 없음` + `dexopt_state_unavailable` (문장 `compile_state_end_reason` 은 행 `title`). 배지에 안 셈.
  - 아래: dex 줄마다
    - 머리 행 1 = `path` (13px 등폭) · 머리 행 2 = 필드 이름 그대로 칸 넷 `abi` · `primary_abi` · `secondary_dex` · `public_dex` (이름 12px 등폭 `neutral-600` · 값 13px 등폭 `neutral-800` · 참 `예` 거짓 `아니오` 같은 모양).
    - 때 행 칸 셋 `때`(72px) · `컴파일 필터`/`status` · `컴파일 이유`/`reason` (값 `nowrap`) → 위치 행 `파일 위치`/`location` 12px 등폭 (null → `값 없음`).
  - 줄 맞춤: 키 = `path` + `abi`. 순서 = 때 순서(바꾸기 전 → 시작 → 끝)로 배열을 훑어 처음 나온 자리. 그 때 배열에 줄이 없으면 그 때 행 = `줄 없음` (위치 행 없음). 때 배열이 `null` 이면 그 때 행을 모든 줄에서 빼고 위 기록 칸 한 행으로 (`바꾸기 전`/`compile_state_before` · `끝`/`compile_state_end` 같은 규칙 · 코드 = 그 `_reason_code`).
  - legacy (`compile_state_start` 없음): 카드 본문 `수집 안 함 — target_app.compile_state_start 없음` (배지에 셈).
  - compile 상태 `경고` 카드 = `warnings[].message` 그대로 (core 문구).
- **진단 탭** `컴파일 상태 slice` · span 12 — `slice 이름별` 위. 머리 행 1 = `location` 원문 · 머리 행 2 = `oat 파일 상태` / `status` 값 · 값 행 칸 둘 `컴파일 필터`/`filter` · `컴파일 이유`/`reason`. 가로 스크롤 상자 없음. `[]` → `컴파일 상태 slice 없음`. null → `값 없음` + `_reason_code` (diag-noapp `process_not_in_trace`).
- `slice 수` 끝 행 `JIT 컴파일 slice`/`target_process_jit_slices`.

## 필드 (core KimHance/baseline-profile 20688ab · `session.compile` 은 bp-core-compile 0ef33ad)
`session.options.compile` · `session.compile{value,command,elapsed_ms,compile_state_before(+_reason_code · _reason)}` · `target_app.compile_state_start|end` = dex 줄 배열 바로 `[{path,secondary_dex,public_dex,abi,status,reason,primary_abi,location}]` (null = 못 읽음) + `compile_state_start|end_reason_code` · `_reason` · `diagnose.target_process_compile_state_slices[{location,status,filter,reason}]` + `_reason_code` · `_reason` · `diagnose.target_process_jit_slices` + `_reason_code` · `_reason`.


