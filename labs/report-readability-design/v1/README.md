# report-readability 시안 v1 — 찍는 법 · 고친 기록 · 측정

디자인 문서: `docs/design/report-readability.md` · `docs/design/baseline-profile.md`. Claude Design 프로젝트
[성능 측정 CLI GUI 도구](https://claude.ai/design/p/9ee5c8ab-33b9-4586-ae73-69f9e53ecd42) — `Report Readability.dc.html` ·
`report-readability/` · `design_handoff_report-readability/` · `design_handoff_baseline-profile/` (2026-10-11). `Session Report.dc.html` 은 고치지 않았다.

| 폴더 · 파일 | 무엇 |
|---|---|
| `claude-design/` | Claude Design 에서 export 한 시안 (`Report Readability.dc.html` + 재료 `report-readability/` + 렌더에 필요한 `support.js` · `_ds/` + 핸드오프 폴더 둘) |
| `claude-design/report-readability/ref/dom-*.html` | 지금 코드 실렌더 DOM (기기 · 진단 탭 · 1440) — 시안 기준 |
| `gen_samples.py` | 실기기 result.json → 상태 8 표본 (`samples/`) + 지금 코드 실렌더용 runs 디렉토리 |
| `measure.js` · `shoot.mjs` | 글자 측정 · 사진 (레포 의존성 없음 — playwright-core · Chrome 경로를 환경 변수로) |
| `check_shots.py` | 12px · 4.5:1 · 층 · 390 넘침 · 사진 16장 (`--break` 로 깨 봄) |
| `before/` · `shots/` | 지금 코드 16장 · 시안 16장 + `measure.json` |
| `brief-claude-design.md` | Claude Design 에 올린 브리프 (`report-readability/BRIEF.md` 와 같음) · 고침은 `report-readability/FIX-1.md` |

## 찍는 법

```bash
S=<스크래치>; R=<실기기 result.json>   # 실기기 원문은 레포에 두지 않는다
python3 -I labs/report-readability-design/v1/gen_samples.py $R $S/runs      # session.json 은 {id,name} 한 줄씩 손으로 (listRuns 가 요구)
node packages/cli/dist/index.js report rr0000 -o $S/runs --file $S/before/summary.html --no-browser   # 상태마다
python3 -m http.server 8771 --bind 127.0.0.1 --directory $S &               # 띄운 pid 만 끈다
export PW=<playwright-core 디렉토리> CHROME=<Chrome 실행 파일>
node labs/report-readability-design/v1/shoot.mjs http://127.0.0.1:8771/before labs/report-readability-design/v1/before before
node labs/report-readability-design/v1/shoot.mjs "http://127.0.0.1:8771/cd/Report%20Readability.dc.html" labs/report-readability-design/v1/shots
python3 -I labs/report-readability-design/v1/check_shots.py            # 시안 — 걸림 0
python3 -I labs/report-readability-design/v1/check_shots.py …/before   # 지금 코드 — 걸림 64 (RED 확인)
```

시안은 `?state=<상태>&shot` 로 연다 (`&shot` = 상태 고르는 칩 숨김). fullPage 사진.

## 고친 기록

| 차수 | 무엇 | 사진으로 본 것 |
|---|---|---|
| 1차 generate | 브리프대로 새 `.dc.html` | 숫자 16/16 통과 · 그러나 렌더 카드 둘이 `HWUI 카운터` 하나로 합쳐지고 `Number …` 접두 · 코어별 막대 흙색 · logcat 제목 바뀜 · 크래시 · ANR 카드 빠짐 · 기기 상태 행 4개 · 390 에서 `profile-utilizatio / n` · `primary- / abi` · 눈금 `15s16s` 겹침 · 상태 칩이 페이지 가운데 |
| 고침 1 (`FIX-1.md`) | 위 아홉 · ABI 를 dex 머리 행으로 · 값 칸 `nowrap` · 끝 눈금 근처 정규 눈금 생략 · unsupported 타일은 `reason_code` 자체 | 아홉 다 고쳐짐 · 숫자 16/16 그대로 통과 · 그러나 기기 카드 `시리얼` 행 (지금 코드에 없음) · `versionCode` 쉼표 없음 · 목록 ` · ` · 막대 값 단위 빠짐 · diag-noapp null 칸마다 코드 |
| 핸드오프 사진 | Claude Design 이 `design_handoff_*/screenshots/` 에 1440 사진 8장 (자체 캡처) | — |
| 고침 2 (`FIX-2.md`) | 위 다섯 되돌림 · 기기 · diag-noapp 핸드오프 사진 다시 · `_shots_tmp` 지움 | 다섯 다 고쳐짐 · 숫자 16/16 · 내용 검사 그대로 |
| 고침 3 (`FIX-3.md` · 디자인 검토 조건부 11) | core 실제 이름 · 모양 (`states.js` · `gen_samples.py`) · 머리 행 필드 넷 · 줄 맞춤 (`줄 없음` · null 때 행 빼기) · 진단 표 값 칸 둘 · 스크롤 상자 0 · `스로틀 단계 · 종료` · 표식 · 툴팁 12px · 여백 46 · 핸드오프 사진 8장 다시 | 16/16 그대로 · 카드 안 가로 스크롤 0 (새 검사 — 고침 2 시안은 diag-390 `rp-dex-scroll` 로 걸림) |
| 고침 4 (`FIX-4.md` · plan B31) | `session.compile.before` → `compile_state_before` (+ 짝) | 모양 같음 · 사진 안 다시 찍음 |
| 고침 5 (`FIX-5.md` · ⑨ 승격 · plan B37 · B40 · B42) | 구현 뒤 결정을 손으로 (edit_file · 생성 0) — 위치가 때마다 같으면 머리 아래 한 번 · 보낸 명령 깃발 토큰 `.rp-nobr` · 온도 `zones` `[]` → `항목 없음` · 핸드오프 사진 두 폴더를 **구현 실렌더**로 (`design_handoff_report-readability` 6장 · `design_handoff_baseline-profile` 6장 — MCP `write_file` 이 utf8 만이라 같은 브라우저 세션의 `WriteFiles` 로 올림 · 서버가 C2PA `caBX` 덩이를 붙여 바이트는 다르고 픽셀 같음) | 16/16 그대로 · compile-1440 위치 한 번 (`shots/` 다시 찍음) |

## RR-9 — 실기기 보고서 (2026-10-11 · 969ea9a)

SM-S901N · serial `R5CT0000001` · sdk 36 · YouTube 21.40.161 — 평소 `bfaf14` (18,324 ms) · 진단 `6c997f` (13,453 ms). 재료는 기기 접촉 없이 run 디렉토리 그대로 (레포 밖).
`perftracker report <id> -o <rr9> --file <스크래치>/….html --no-browser` → 탭마다 클릭 → `measure.js` + 타일 · 배지 · 미수집 카드 셈 (`.rp-card` 안 `.rp-none` 이 `값 없음` · `수집 안 함` 으로 시작) · 기준은 `check_shots.py` 의 `problems()` 그대로.

| 세션-탭-폭 | 글자 | 12px 미만 · 4.5:1 미만 | 최소 | 층 | 타일 | 배지 = 미수집 카드 | 390 넘침 · 카드 안 스크롤 |
|---|---|---|---|---|---|---|---|
| 평소-요약-1440 · 390 | 3,680 · 3,637 | 0% · 0% | 12px · 5.48 | 31.68(390 26) > 18 > 15 > 13 | 8 | 0 = 0 | 0 · 0 |
| 평소-기기-1440 · 390 | 806 | 0% · 0% | 12px · 5.48 | — > 18 > 15 > 13 | — | 0 = 0 | 0 · 0 |
| 진단-요약-1440 · 390 | 3,723 · 3,680 | 0% · 0% | 12px · 5.48 | 31.68(390 26) > 18 > 15 > 13 | 8 | 0 = 0 | 0 · 0 |
| 진단-기기-1440 · 390 | 810 | 0% · 0% | 12px · 5.48 | — > 18 > 15 > 13 | — | 0 = 0 | 0 · 0 |
| 진단-진단-1440 · 390 | 112,971 | 0% · 0% | 12px · 5.48 | — > 18 > 15 > 13 | — | 0 = 0 | 0 · 0 |

걸림 0 (10장). 기기 모델 · serial 은 머리 메타와 기기 탭에 다 보임. 두 세션 모두 `수집 안 함` · `값 없음` 글자 0 — 배지 기준은 **0 = 0 으로만** 맞았다 (배지가 서는 실기기 경우는 못 봄 · 표본 `missing` · `legacy` · `diag-noapp` 이 대신 봄). hwui `partial` 은 배지 없음(정한 규칙). 두 세션 다 `--compile` 아님 — 보낸 명령 · 바꾼 기록 줄은 실기기에서 못 봄.
사진 10장 · `measure.json`: 레포 밖 `runs/baseline-profile/shots/rr9/` (사진 다섯은 Claude Design `design_handoff_report-readability/screenshots/` 에도).

## 측정 (글자 측정 · 2026-10-11)

12px 미만 · 4.5:1 미만 (글자 수 가중) · 최소 크기 · 최소 대비 / 층 = 타일 값 · 섹션 · 카드 제목 · 본문 px / 390 가로 넘침.

| 상태-폭 | 지금 코드 | 시안 (고침 3 · 4) | 층 | 넘침 |
|---|---|---|---|---|
| summary-1440 | 85.1% · 12.3% · 10px · 3.82 | 0% · 0% · 12px · 5.48 | 31.68 · 18 · 15 · 13 | 0 |
| missing-1440 | 84.4% · 15.1% · 9.5px · 3.82 | 0% · 0% · 12px · 5.48 | 31.68 · 18 · 15 · 13 | 0 |
| compile-1440 | 85.1% · 11.9% · 10px · 3.82 | 0% · 0% · 12px · 5.48 | 31.68 · 18 · 15 · 13 | 0 |
| end-null-1440 | 84.9% · 12.3% · 10px · 3.82 | 0% · 0% · 12px · 5.48 | 31.68 · 18 · 15 · 13 | 0 |
| legacy-1440 | 85% · 12.3% · 10px · 3.82 | 0% · 0% · 12px · 5.48 | 31.68 · 18 · 15 · 13 | 0 |
| device-1440 | 79.6% · 10% · 10px · 3.82 | 0% · 0% · 12px · 5.48 | — · 18 · 15 · 13 | 0 |
| diag-1440 | 94.5% · 3.5% · 10px · 3.82 | 0% · 0% · 12px · 5.48 | — · 18 · 15 · 13 | 0 |
| diag-noapp-1440 | 71.1% · 18.9% · 10px · 3.82 | 0% · 0% · 12px · 5.48 | — · 18 · 15 · 13 | 0 |
| summary-390 | 84.8% · 12.6% · 9.3px · 3.82 | 0% · 0% · 12px · 5.48 | 26 · 18 · 15 · 13 | 0 |
| missing-390 | 84.1% · 15.4% · 9.3px · 3.82 | 0% · 0% · 12px · 5.48 | 26 · 18 · 15 · 13 | 0 |
| compile-390 | 84.8% · 12.1% · 9.3px · 3.82 | 0% · 0% · 12px · 5.48 | 26 · 18 · 15 · 13 | 0 |
| end-null-390 | 84.6% · 12.5% · 9.3px · 3.82 | 0% · 0% · 12px · 5.48 | 26 · 18 · 15 · 13 | 0 |
| legacy-390 | 84.7% · 12.5% · 9.3px · 3.82 | 0% · 0% · 12px · 5.48 | 26 · 18 · 15 · 13 | 0 |
| device-390 | 79.6% · 10% · 10px · 3.82 | 0% · 0% · 12px · 5.48 | — · 18 · 15 · 13 | 0 |
| diag-390 | 94.5% · 3.5% · 10px · 3.82 | 0% · 0% · 12px · 5.48 | — · 18 · 15 · 13 | 0 |
| diag-noapp-390 | 71.1% · 18.9% · 10px · 3.82 | 0% · 0% · 12px · 5.48 | — · 18 · 15 · 13 | 0 |

카드 안 가로 스크롤 16/16 0 (slice 이름별 표 · 프레임 시간축 빼고). 최소 대비 5.48 = `neutral-600` on surface — 글자에 `neutral-500` · `alt-*` 0 이라는 뜻. 시계열 눈금은 SVG 배율로 잰 렌더 크기.

### 내용 (상태 8 · 1440 · `?shot`)

| 상태 | 타일 · 순서 | 레일 | 평가 · 판정 낱말 | ellipsis | `<wbr>` | 보인 낱말 |
|---|---|---|---|---|---|---|
| summary | 8 · startup,hwui,frame,cpu,memory,log,thermal,network | 요약 0 | 0 | 0 | 228 | `표본 없음` · `바꾸지 않음` · `길이` · `스로틀 단계 · 종료` |
| missing | 8 · 같음 | 요약 4 (시간별 프레임 · 앱 CPU · 앱 CPU 시간 · 네트워크) | 0 | 0 | 228 | `값 없음` · `sdk_too_low` |
| compile | 8 · 같음 | 요약 0 | 0 | 0 | 309 | `--compile speed` · 표식 둘 · `줄 없음` 둘 · `secondary_dex` · `public_dex` · core 경고 문구 |
| end-null | 8 · 같음 | 요약 0 | 0 | 0 | 173 | 기록 칸 `끝`/`compile_state_end` `값 없음` `dexopt_state_unavailable` · 끝 행 0 |
| legacy | 8 · 같음 | 요약 1 (컴파일 카드 `수집 안 함`) | 0 | 0 | 64 | `수집 안 함` |
| device | — | 0 | 0 | 0 | 26 | 라벨 두 줄 |
| diag | — | 진단 0 | 0 | 0 | 142 | ART 두 칸 · `oat 파일 상태` 머리 행 · `L*;` |
| diag-noapp | — | 진단 2 (표 · 컴파일 상태 slice · plan B30) | 0 | 0 | 26 | `값 없음` · `process_not_in_trace` |

평가 · 판정 낱말 = DM-15 목록 + `최적화` `적용됨` `AOT` `예열` `duration` `니다`. 본 사진: 고침 3 compile-1440(머리 · 컴파일 카드 · `줄 없음`) · end-null-1440(기록 칸) · diag-390(진단 표) / 1차 summary-1440 · missing-1440 · diag-1440 · compile-390 / 고침 1 summary-1440 · compile-1440(맥락) · compile-390(컴파일 카드) · missing-390(위) · device-390 · diag-noapp-1440 / 고침 2 device-390 · diag-noapp-1440. end-null · legacy 사진은 숫자 · 내용 검사만.
