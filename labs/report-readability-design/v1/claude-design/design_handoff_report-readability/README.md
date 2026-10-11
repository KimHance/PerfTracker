# 핸드오프 — Report Readability (v1)

시안 (고침 2 · `report-readability/FIX-1.md` · `FIX-2.md`): 프로젝트 루트 `Report Readability.dc.html` · CSS `report-readability/report-rr.css` · 표본 `report-readability/{base.json,states.js}`.
정본 문서: 레포 `docs/design/report-readability.md`. 비교 기준(고치지 않음): `Session Report.dc.html` · `diagnostic-mode/Report.html`.

## 보는 법
- `?state=` 또는 편집기 prop `state`: `summary` `missing` `compile` `end-null` `legacy` `device` `diag` `diag-noapp`. 처음 탭은 `RR_STATES[state][1]`, 레일로 바꿀 수 있음.
- `?shot` — 오른쪽 아래 상태 고르는 줄을 숨김 (사진용).
- 폭 1440 · 390 둘 다 확인.

## 코드에 옮길 것
1. `report.css` → `report-rr.css` 의 `/* rr … */` 주석 줄이 바뀐 글자 규칙 (토큰 값은 그대로). 새 클래스: `.rp-tiles` `.rp-tile*` · `.rp-lbl` `.rp-lbl-path` · `.rp-dex*` · `.rp-dist*` · `.rp-span-wide`.
2. 요약 맨 위 `지표` 섹션 — 타일 8 (순서 고정, 레일 배지에 안 셈).
3. 앱 시작 stat 카드에서 큰 숫자 삭제 (게이지 · 축 · 아래 줄만).
4. 렌더 각주 단어화 · 차트 `[]` → `표본 없음` / `프레임 없음` / `항목 없음` (배지에 안 셈).
5. 필드 이름 라벨 → 두 줄 (우리말 단어 + 지금 라벨 경로). th `white-space:normal` · 45%.
6. 긴 이름: 구분자 `/ : $ . ; , _` 뒤 `<wbr>` + `overflow-wrap:break-word` (`anywhere` · `break-all` 없음).
7. 머리 `duration` → `길이`, `옵션` 에 `--compile speed` (compile 상태만).
8. 레일 배지 = 그 탭의 `수집 안 함` · `값 없음` 카드 수.
9. 새 블록 `dexstates` — 요약 맥락 끝 `컴파일 상태 (전 → 후)`, 진단 탭 `컴파일 상태 slice` (자세히: `design_handoff_baseline-profile/README.md`). 가로 스크롤 상자 없음 — 값 칸 `nowrap`, 경로는 `<wbr>` 줄바꿈.
11. 머리 아래 표식 줄 `.rp-marks` (compile 상태) · 툴팁 `.rp-tip` 글자 12px (값 16px 그대로). 타일 단어 `스로틀 단계 · 종료`.
10. 진단: 카테고리에 `dalvik`, `slice 수` 끝 `JIT 컴파일 slice`, 단위 칸 `diagnose` → 빈 칸.

## 판정 금지 확인
상태 문자열(`speed-profile` `verify` `up-to-date` …)은 전부 같은 색 · 같은 굵기 · 등폭 · 원문 순. 예외는 앱 시작 게이지 6색 · 16ms 참고선 둘뿐.

## 사진
`screenshots/` — 1440 네 장 (summary · missing · device · diag · 고침 2 뒤). 상태 8 × 1440 · 390 전부와 글자 측정은 레포 `labs/report-readability-design/v1/shots/` · `README.md` (16/16: 12px 미만 0% · 4.5:1 미만 0% · 층 31.7 > 18 > 15 > 13 · 390 넘침 0).
