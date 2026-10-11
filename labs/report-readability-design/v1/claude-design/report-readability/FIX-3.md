# Report Readability.dc.html — 고침 3 (디자인 검토 조건부 11 · core 실제 필드)

`states.js` 가 바뀌었다 — **core 실제 이름 · 모양**이다 (레포 KimHance/baseline-profile 20688ab). 시안이 읽는 자리를 거기에 맞추고 아래를 고친다. 나머지는 그대로.

1. **필드 이름 · 모양**
   - `target_app.compile_state_start` · `compile_state_end` = **dex 줄 배열 바로** (`{dex:[…]}` 아님). 한 줄 = `{path, secondary_dex, public_dex, abi, status, reason, primary_abi, location}` (`location` null 가능). 짝 `compile_state_start_reason_code` · `_reason` · `compile_state_end_reason_code` · `_reason`.
   - `session.compile.before` 도 같은 배열 (이것만 자리표시 이름).
   - 진단 `diagnose.target_process_compile_state_slices` (전 이름 `target_process_compile_states`) + `_reason_code` · `_reason`, `target_process_jit_slices` + `_reason_code` · `_reason`.
2. **dexstates 머리 행 2** — 지금 `arm64 · primary-abi` 를 칸 넷 **필드 이름 그대로**로: `abi arm64 · primary_abi 예 · secondary_dex 아니오 · public_dex 아니오` (이름 12px 등폭 `neutral-600` · 값 13px 등폭 `neutral-800` · 참 `예` · 거짓 `아니오` 같은 모양 · 색 · 굵기 0).
3. **줄 맞춤** — dex 줄 키 = `path` + `abi`. 행 순서 = 때 순서(바꾸기 전 → 시작 → 끝)로 배열을 훑어 처음 나온 자리 (compile 상태의 끝에만 있는 `…/app_tmp/fx/q.dex` 는 맨 뒤).
   - 그 때 배열에 그 줄이 없으면 그 때 행의 칸 셋 자리에 **`줄 없음`** (위치 행 없음). `값 없음` 이 아니다.
   - 위치 `location` 이 null 이면 위치 행 값 `값 없음`.
   - 한 때 배열이 **null** 이면 (end-null 의 `끝`) 그 때 행을 **모든 dex 줄에서 뺀다** — 지금처럼 줄마다 `끝 값 없음 compile_state_not_read` 를 되풀이하지 않는다. 대신 카드 위 기록 칸에 한 행: 단어 `끝` / 경로 줄 `compile_state_end` → `값 없음` + 코드 `dexopt_state_unavailable` (문장 `compile_state_end_reason` 은 행 `title`). 배지에 안 셈.
   - 기록 칸 순서: (compile) `바꾼 값` · `보낸 명령` · `걸린 시간` / (그 밖) `바꾼 기록` → `바꾸지 않음` — 그다음 못 읽은 때 행.
4. **진단 `컴파일 상태 slice` 카드** — 390 에서 칸 셋이 5px 넘쳐 `.rp-dex-scroll` 안에서 가로 스크롤된다. 바꾼다:
   - 머리 행 1 = `location` 원문 · **머리 행 2 = `oat 파일 상태` / `status` 값** (`up-to-date`) · 값 행 칸 **둘** `컴파일 필터`/`filter` · `컴파일 이유`/`reason`.
   - **`.rp-dex-scroll` 을 지운다** — 가로 스크롤 상자 0. 값 칸 `nowrap` 그대로.
   - 배열이 `[]` 면 카드 본문 `컴파일 상태 slice 없음`.
5. **경고 행** — `compile` 의 경고 카드는 `warnings[].message` 를 그대로 (core 문구 `세션 중 base.apk 컴파일 상태가 바뀌었음 — status … → … · reason … → … (target_app.compile_state_start · compile_state_end)`). 지어낸 글 0.
6. **타일 단어** — thermal 타일 `스로틀 종료` → **`스로틀 단계 · 종료`**.
7. **표식 · 툴팁** — `compile` 상태에 `session.marks` 둘이 있다. 지금 코드처럼 머리 아래 표식 줄 (`.rp-marks` · 라벨 `표식` `.rp-marks-label` · 칩 `.rp-mark` 안에 `.rp-mark-at` `0:03` + 라벨). 크기: `.rp-marks-label` 12px · `.rp-mark` 12px · `.rp-mark-at` 12px. 툴팁 `.rp-tip-head` 12px · `.rp-tip-sub` 12px (`.rp-tip-value` 16px 그대로).
8. **시계열 왼쪽 여백** — 눈금 12 단위가 들어가게 46 (지금 코드 `SPAD.l` 36).
9. **핸드오프** — 두 README 의 dexstates 설명을 위 2 · 3 · 4 로 고치고, `screenshots/` 8장을 다시 찍는다 (1440 · `?shot`): report-readability 넷 (summary · missing · device · diag) · baseline-profile 넷 (compile · end-null · legacy · diag-noapp). 찍은 뒤 임시 폴더(`_shots_tmp` 등) · 탐침 파일은 지운다.
