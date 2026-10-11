# 핸드오프 — Baseline Profile · 컴파일 상태 (v1 · 구현 끝)

시안: `Report Readability.dc.html` 의 `summary` · `compile` · `end-null` · `legacy` · `diag` · `diag-noapp` 상태 (고침 5 — `report-readability/FIX-5.md`). 정본: 레포 `docs/design/baseline-profile.md` (`## 정한 것`).
CLI 출력 6블록: `cli-blocks.txt` (레포 `labs/baseline-profile-design/v1/` 생성기 · 검사). **구현 끝** — 레포 `packages/gui` (bp-gui-report 21dbe9e · 검수 고침 4d578ea) · `packages/cli` (bp-cli).

## 새 블록 `dexstates`
- **요약 · 맥락 끝** `컴파일 상태 (전 → 후)` · span 12.
  - 위 기록 칸: (compile) `바꾼 값`/`value` · `보낸 명령`/`command`(원문 등폭 · 깃발 토큰 `-m` `-f` `--reset` 은 그 안에서 줄을 바꾸지 않음 — B40) · `걸린 시간`/`elapsed_ms` / (그 밖) `바꾼 기록`/`session.compile` → `바꾸지 않음` — 그다음 못 읽은 때 행. 예: end-null `끝`/`compile_state_end` → `값 없음` + `dexopt_state_unavailable` (문장 `compile_state_end_reason` 은 행 `title`). 배지에 안 셈.
  - 아래: dex 줄마다
    - 머리 행 1 = `path` (13px 등폭) · 머리 행 2 = 필드 이름 그대로 칸 넷 `abi` · `primary_abi` · `secondary_dex` · `public_dex` (이름 12px 등폭 `neutral-600` · 값 13px 등폭 `neutral-800` · 참 `예` 거짓 `아니오` 같은 모양).
    - **위치 (B42)** — 그 줄이 있는 때의 `location` 이 글자 그대로 모두 같으면 머리 행 바로 아래 **한 번** · 한 줄 라벨 `파일 위치 location {원문}` (null → `값 없음`). 하나라도 다르면 때 행마다 그 아래 두 줄 라벨 위치 행 — 다른 칸만 고르지 않음.
    - 때 행 칸 셋 `때`(72px) · `컴파일 필터`/`status` · `컴파일 이유`/`reason` (값 `nowrap`).
  - 줄 맞춤: 키 = `path` + `abi`. 순서 = 때 순서(바꾸기 전 → 시작 → 끝)로 배열을 훑어 처음 나온 자리. 그 때 배열에 줄이 없으면 그 때 행 = `줄 없음` (위치는 그 줄이 있는 때끼리만 비교). 때 배열이 `null` 이면 그 때 행을 모든 줄에서 빼고 위 기록 칸 한 행으로 (코드 = 그 `_reason_code`). 시작 · 끝 둘 다 null 이면 표 없이 기록 행 둘 (배지 1).
  - legacy (`compile_state_start` 없음): 카드 본문 `수집 안 함 — target_app.compile_state_start 없음` (배지에 셈).
  - compile 상태 `경고` 카드 = `warnings[].message` 그대로 (core 문구).
- **진단 탭** `컴파일 상태 slice` · span 12 — `slice 이름별` 위. 머리 행 1 = `location` 원문 · 머리 행 2 = `oat 파일 상태` / `status` 값 · 값 행 칸 둘 `컴파일 필터`/`filter` · `컴파일 이유`/`reason`. 가로 스크롤 상자 없음. `[]` → `컴파일 상태 slice 없음`. null → `값 없음` + `_reason_code` (diag-noapp `process_not_in_trace` · 진단 배지 2 — B30).
- `slice 수` 끝 행 `JIT 컴파일 slice`/`target_process_jit_slices`.

## 필드 (core `schema/result.ts` · `session.compile` 은 bp-core-compile 0ef33ad)
`session.options.compile` · `session.compile{value,command,elapsed_ms,compile_state_before(+_reason_code · _reason)}` · `target_app.compile_state_start|end` = dex 줄 배열 바로 `[{path,secondary_dex,public_dex,abi,status,reason,primary_abi,location}]` (null = 못 읽음) + `compile_state_start|end_reason_code` · `_reason` · `diagnose.target_process_compile_state_slices[{location,status,filter,reason}]` + `_reason_code` · `_reason` · `diagnose.target_process_jit_slices` + `_reason_code` · `_reason`.

## 사진 — 구현 실렌더 (시안 캡처 아님)
`screenshots/` — 레포 `labs/report-readability-design/v1/samples/` 표본을 `perftracker report` 로 낸 파일의 카드 (bp-gui-report 검수 고침 4d578ea 뒤 · 2026-10-11).

| 파일 | 무엇 |
|---|---|
| `01-compile.png` | `compile` · 컴파일 카드 · 1440 — 보낸 명령 · 위치 한 번 · 끝에만 있는 보조 dex `줄 없음` |
| `02-end-null.png` | `end-null` · 기록 칸 `끝` `값 없음` + 코드 · 때 행 `시작` 만 |
| `03-legacy.png` | `legacy` · `수집 안 함` |
| `04-diag-noapp.png` | `diag-noapp` · 진단 `컴파일 상태 slice` `값 없음` + `process_not_in_trace` |
| `05-compile-390.png` | `compile` · 컴파일 카드 · 390 — `-m speed -f` 붙어 있음 (B40). 가운데 `마커` 띠는 고정 표식 줄이 카드 사진에 겹친 것 |
| `06-diag.png` | `diag` · 진단 `컴파일 상태 slice` · 1440 |

실기기 YouTube (SM-S901N · sdk 36 · 2026-10-11) 평소 · 진단 세션의 전체 화면은 `design_handoff_report-readability/screenshots/` — 그 두 세션은 `--compile` 이 아니라 보낸 명령 · 바꾼 기록 줄은 없다.
